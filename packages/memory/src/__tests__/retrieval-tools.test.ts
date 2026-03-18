import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { RetrievalTools } from '../retrieval-tools.js';

describe('RetrievalTools', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let msgStore: MessageStore;
  let sumStore: SummaryStore;
  let tools: RetrievalTools;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccbuddy-rt-test-'));
    db = new MemoryDatabase(join(tmpDir, 'test.db'));
    db.init();
    msgStore = new MessageStore(db);
    sumStore = new SummaryStore(db);
    tools = new RetrievalTools(msgStore, sumStore);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('grep()', () => {
    it('finds matching messages and summaries', () => {
      const base = Date.now();
      const msgId1 = msgStore.add({
        userId: 'u1',
        sessionId: 's1',
        platform: 'discord',
        content: 'I love cats very much',
        role: 'user',
        timestamp: base,
        tokens: 10,
      });
      msgStore.add({
        userId: 'u1',
        sessionId: 's1',
        platform: 'discord',
        content: 'dogs are also nice',
        role: 'assistant',
        timestamp: base + 1,
        tokens: 10,
      });
      sumStore.add({
        userId: 'u1',
        depth: 0,
        content: 'User mentioned liking cats in prior sessions',
        sourceIds: [msgId1],
        tokens: 15,
      });

      const result = tools.grep('u1', 'cats');

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toContain('cats');
      expect(result.summaries).toHaveLength(1);
      expect(result.summaries[0].content).toContain('cats');
    });

    it('returns empty results when no matches found', () => {
      msgStore.add({
        userId: 'u1',
        sessionId: 's1',
        platform: 'discord',
        content: 'Hello world',
        role: 'user',
        tokens: 5,
      });

      const result = tools.grep('u1', 'nonexistent_xyz');

      expect(result.messages).toHaveLength(0);
      expect(result.summaries).toHaveLength(0);
    });

    it('does not return results from other users', () => {
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'cats topic', role: 'user', tokens: 5 });
      msgStore.add({ userId: 'u2', sessionId: 's2', platform: 'discord', content: 'cats topic', role: 'user', tokens: 5 });

      const result = tools.grep('u1', 'cats');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].userId).toBe('u1');
    });
  });

  describe('expand()', () => {
    it('expands a leaf node (depth=0) to source messages', () => {
      const msgId1 = msgStore.add({
        userId: 'u1',
        sessionId: 's1',
        platform: 'discord',
        content: 'Original message A',
        role: 'user',
        tokens: 10,
      });
      const msgId2 = msgStore.add({
        userId: 'u1',
        sessionId: 's1',
        platform: 'discord',
        content: 'Original message B',
        role: 'assistant',
        tokens: 10,
      });

      const nodeId = sumStore.add({
        userId: 'u1',
        depth: 0,
        content: 'Summary of messages A and B',
        sourceIds: [msgId1, msgId2],
        tokens: 15,
      });

      const result = tools.expand('u1', nodeId);

      expect(result).toBeDefined();
      expect(result!.node.id).toBe(nodeId);
      expect(result!.sourceMessages).toHaveLength(2);
      expect(result!.sourceMessages[0].content).toBe('Original message A');
      expect(result!.sourceMessages[1].content).toBe('Original message B');
      expect(result!.sourceNodes).toBeUndefined();
    });

    it('expands a condensed node (depth>0) to child summary nodes', () => {
      const leafId1 = sumStore.add({
        userId: 'u1',
        depth: 0,
        content: 'Leaf summary one',
        sourceIds: [1, 2],
        tokens: 10,
      });
      const leafId2 = sumStore.add({
        userId: 'u1',
        depth: 0,
        content: 'Leaf summary two',
        sourceIds: [3, 4],
        tokens: 10,
      });

      const condensedId = sumStore.add({
        userId: 'u1',
        depth: 1,
        content: 'Condensed summary of leaves',
        sourceIds: [leafId1, leafId2],
        tokens: 15,
      });

      const result = tools.expand('u1', condensedId);

      expect(result).toBeDefined();
      expect(result!.node.depth).toBe(1);
      expect(result!.sourceNodes).toBeDefined();
      expect(result!.sourceNodes).toHaveLength(2);
      expect(result!.sourceNodes![0].content).toBe('Leaf summary one');
      expect(result!.sourceNodes![1].content).toBe('Leaf summary two');
    });

    it('returns undefined for a non-existent node ID', () => {
      const result = tools.expand('u1', 9999);
      expect(result).toBeUndefined();
    });

    it('returns undefined when the node belongs to a different user', () => {
      const nodeId = sumStore.add({
        userId: 'u2',
        depth: 0,
        content: 'u2 summary',
        sourceIds: [],
        tokens: 5,
      });

      const result = tools.expand('u1', nodeId);
      expect(result).toBeUndefined();
    });
  });

  describe('describe()', () => {
    it('returns messages in the specified time range', () => {
      const base = 1000000;
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'before range', role: 'user', timestamp: base - 100, tokens: 5 });
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'in range 1', role: 'user', timestamp: base, tokens: 5 });
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'in range 2', role: 'assistant', timestamp: base + 500, tokens: 5 });
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'after range', role: 'user', timestamp: base + 1100, tokens: 5 });

      const result = tools.describe('u1', { startMs: base, endMs: base + 1000 });

      expect(result.count).toBe(2);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('in range 1');
      expect(result.messages[1].content).toBe('in range 2');
    });

    it('returns empty result when no messages in range', () => {
      const result = tools.describe('u1', { startMs: 0, endMs: 1 });
      expect(result.count).toBe(0);
      expect(result.messages).toHaveLength(0);
    });

    it('count matches messages length', () => {
      const base = Date.now();
      for (let i = 0; i < 4; i++) {
        msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: `msg${i}`, role: 'user', timestamp: base + i, tokens: 5 });
      }

      const result = tools.describe('u1', { startMs: base, endMs: base + 10 });
      expect(result.count).toBe(result.messages.length);
    });
  });

  describe('getToolDefinitions()', () => {
    it('returns exactly 3 tool definitions', () => {
      const defs = tools.getToolDefinitions();
      expect(defs).toHaveLength(3);
    });

    it('includes memory_grep, memory_describe, and memory_expand', () => {
      const defs = tools.getToolDefinitions();
      const names = defs.map(d => d.name);
      expect(names).toContain('memory_grep');
      expect(names).toContain('memory_describe');
      expect(names).toContain('memory_expand');
    });

    it('each tool definition has name, description, and inputSchema', () => {
      const defs = tools.getToolDefinitions();
      for (const def of defs) {
        expect(def.name).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.inputSchema).toBeDefined();
        expect(def.inputSchema.type).toBe('object');
        expect(def.inputSchema.properties).toBeDefined();
      }
    });

    it('tool definitions are compatible with SkillRegistry ToolDescription shape', () => {
      const defs = tools.getToolDefinitions();
      for (const def of defs) {
        // ToolDescription requires: name, description, inputSchema
        expect(typeof def.name).toBe('string');
        expect(typeof def.description).toBe('string');
        expect(typeof def.inputSchema).toBe('object');
      }
    });
  });
});
