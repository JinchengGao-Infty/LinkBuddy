import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { ProfileStore } from '../profile-store.js';
import { ContextAssembler, type ContextAssemblerConfig } from '../context-assembler.js';

describe('ContextAssembler', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let msgStore: MessageStore;
  let sumStore: SummaryStore;
  let profStore: ProfileStore;

  const defaultConfig: ContextAssemblerConfig = {
    maxContextTokens: 1000,
    freshTailCount: 5,
    contextThreshold: 0.8,
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccbuddy-ca-test-'));
    db = new MemoryDatabase(join(tmpDir, 'test.db'));
    db.init();
    msgStore = new MessageStore(db);
    sumStore = new SummaryStore(db);
    profStore = new ProfileStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeAssembler(config: Partial<ContextAssemblerConfig> = {}): ContextAssembler {
    return new ContextAssembler(msgStore, sumStore, profStore, { ...defaultConfig, ...config });
  }

  describe('assemble() — profile + fresh tail', () => {
    it('includes profile and fresh tail in assembled context', () => {
      profStore.set('u1', 'name', 'Alice');
      profStore.set('u1', 'language', 'English');

      const base = Date.now();
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'Hello', role: 'user', timestamp: base, tokens: 10 });
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'Hi there', role: 'assistant', timestamp: base + 1, tokens: 10 });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');

      expect(ctx.profile).toContain('name: Alice');
      expect(ctx.profile).toContain('language: English');
      expect(ctx.messages).toHaveLength(2);
      expect(ctx.messages[0].content).toBe('Hello');
      expect(ctx.messages[1].content).toBe('Hi there');
    });
  });

  describe('assemble() — fresh tail limit', () => {
    it('limits fresh tail to freshTailCount', () => {
      const base = Date.now();
      for (let i = 0; i < 10; i++) {
        msgStore.add({
          userId: 'u1',
          sessionId: 's1',
          platform: 'discord',
          content: `msg${i}`,
          role: 'user',
          timestamp: base + i,
          tokens: 5,
        });
      }

      const assembler = makeAssembler({ freshTailCount: 3 });
      const ctx = assembler.assemble('u1', 's1');

      expect(ctx.messages).toHaveLength(3);
      // Should be the last 3 messages in chronological order
      expect(ctx.messages[0].content).toBe('msg7');
      expect(ctx.messages[1].content).toBe('msg8');
      expect(ctx.messages[2].content).toBe('msg9');
    });
  });

  describe('assemble() — includes summaries', () => {
    it('includes summary nodes in assembled context', () => {
      sumStore.add({
        userId: 'u1',
        depth: 0,
        content: 'Earlier discussion about cats',
        sourceIds: [1, 2],
        tokens: 20,
        timestamp: Date.now() - 10000,
      });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');

      expect(ctx.summaries).toHaveLength(1);
      expect(ctx.summaries[0].content).toBe('Earlier discussion about cats');
    });

    it('prioritizes higher depth (more condensed) summaries', () => {
      const base = Date.now();
      // Add depth 0 then depth 1 nodes
      sumStore.add({ userId: 'u1', depth: 0, content: 'Leaf summary', sourceIds: [1], tokens: 30, timestamp: base });
      sumStore.add({ userId: 'u1', depth: 1, content: 'Condensed summary', sourceIds: [10], tokens: 15, timestamp: base + 1 });

      // Small budget: only room for 40 tokens total (after profile/messages)
      const assembler = makeAssembler({ maxContextTokens: 40 });
      const ctx = assembler.assemble('u1', 's1');

      // Should prefer depth=1 (condensed) over depth=0 (leaf)
      const depths = ctx.summaries.map(s => s.depth);
      if (ctx.summaries.length === 1) {
        expect(depths).toContain(1); // condensed should be preferred
      }
    });
  });

  describe('assemble() — respects token budget', () => {
    it('does not exceed maxContextTokens when filling summaries', () => {
      const base = Date.now();
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'Recent msg', role: 'user', timestamp: base, tokens: 100 });

      // Add summaries that together would exceed the budget
      sumStore.add({ userId: 'u1', depth: 0, content: 'Summary A', sourceIds: [], tokens: 500, timestamp: base - 100 });
      sumStore.add({ userId: 'u1', depth: 0, content: 'Summary B', sourceIds: [], tokens: 500, timestamp: base - 200 });

      const assembler = makeAssembler({ maxContextTokens: 400 });
      const ctx = assembler.assemble('u1', 's1');

      expect(ctx.totalTokens).toBeLessThanOrEqual(400);
    });

    it('totalTokens reflects profile + messages + summaries tokens', () => {
      profStore.set('u1', 'name', 'Alice'); // ~14 chars -> ~4 tokens for "name: Alice\n"
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'hello', role: 'user', tokens: 50 });
      sumStore.add({ userId: 'u1', depth: 0, content: 'past discussion', sourceIds: [], tokens: 30 });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');

      // totalTokens should include profile + messages + summaries
      const expectedMsgTokens = 50;
      const expectedSumTokens = 30;
      expect(ctx.totalTokens).toBe(
        Math.ceil(ctx.profile.length / 4) + expectedMsgTokens + expectedSumTokens,
      );
    });
  });

  describe('assemble() — needsCompaction', () => {
    it('sets needsCompaction false when stored tokens are below threshold', () => {
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'small', role: 'user', tokens: 10 });

      const assembler = makeAssembler({ maxContextTokens: 1000, contextThreshold: 0.8 });
      const ctx = assembler.assemble('u1', 's1');

      // 10 tokens stored vs 800 threshold => should be false
      expect(ctx.needsCompaction).toBe(false);
    });

    it('sets needsCompaction true when stored tokens exceed threshold', () => {
      // Add enough messages to exceed threshold
      for (let i = 0; i < 5; i++) {
        msgStore.add({
          userId: 'u1',
          sessionId: 's1',
          platform: 'discord',
          content: `msg ${i}`,
          role: 'user',
          tokens: 200,
        });
      }
      // 1000 tokens stored, threshold = 1000 * 0.5 = 500, so 1000 > 500 => true
      const assembler = makeAssembler({ maxContextTokens: 1000, contextThreshold: 0.5 });
      const ctx = assembler.assemble('u1', 's1');

      expect(ctx.needsCompaction).toBe(true);
    });
  });

  describe('formatAsPrompt()', () => {
    it('returns XML-tagged string with all three sections', () => {
      profStore.set('u1', 'name', 'Bob');
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'Hello Bob', role: 'user', tokens: 10 });
      sumStore.add({ userId: 'u1', depth: 0, content: 'Prior chat summary', sourceIds: [], tokens: 20 });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');
      const prompt = assembler.formatAsPrompt(ctx);

      expect(prompt).toContain('<user_profile>');
      expect(prompt).toContain('</user_profile>');
      expect(prompt).toContain('<conversation_history_summary>');
      expect(prompt).toContain('</conversation_history_summary>');
      expect(prompt).toContain('<recent_messages>');
      expect(prompt).toContain('</recent_messages>');
    });

    it('includes profile content in user_profile section', () => {
      profStore.set('u1', 'name', 'Charlie');

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');
      const prompt = assembler.formatAsPrompt(ctx);

      expect(prompt).toContain('name: Charlie');
    });

    it('includes message content in recent_messages section', () => {
      msgStore.add({ userId: 'u1', sessionId: 's1', platform: 'discord', content: 'Test message content', role: 'user', tokens: 10 });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');
      const prompt = assembler.formatAsPrompt(ctx);

      expect(prompt).toContain('Test message content');
    });

    it('includes summary content in conversation_history_summary section', () => {
      sumStore.add({ userId: 'u1', depth: 0, content: 'Important earlier context', sourceIds: [], tokens: 10 });

      const assembler = makeAssembler();
      const ctx = assembler.assemble('u1', 's1');
      const prompt = assembler.formatAsPrompt(ctx);

      expect(prompt).toContain('Important earlier context');
    });
  });

  describe('assemble() — empty context for new user', () => {
    it('returns empty context for a user with no data', () => {
      const assembler = makeAssembler();
      const ctx = assembler.assemble('newuser', 'newsession');

      expect(ctx.profile).toBe('');
      expect(ctx.messages).toHaveLength(0);
      expect(ctx.summaries).toHaveLength(0);
      expect(ctx.totalTokens).toBe(0);
      expect(ctx.needsCompaction).toBe(false);
    });

    it('formatAsPrompt handles empty context gracefully', () => {
      const assembler = makeAssembler();
      const ctx = assembler.assemble('newuser', 'newsession');
      const prompt = assembler.formatAsPrompt(ctx);

      // All three XML tags should still be present
      expect(prompt).toContain('<user_profile>');
      expect(prompt).toContain('<conversation_history_summary>');
      expect(prompt).toContain('<recent_messages>');
    });
  });
});
