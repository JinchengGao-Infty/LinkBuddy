/**
 * Full lifecycle integration test for the memory module.
 * Tests the complete stack: MemoryDatabase → MessageStore / SummaryStore / ProfileStore
 *   → ContextAssembler → RetrievalTools
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { ProfileStore } from '../profile-store.js';
import { ContextAssembler, type ContextAssemblerConfig } from '../context-assembler.js';
import { RetrievalTools } from '../retrieval-tools.js';

describe('Memory Module — Full Lifecycle Integration', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let messages: MessageStore;
  let summaries: SummaryStore;
  let profiles: ProfileStore;
  let assembler: ContextAssembler;
  let retrieval: RetrievalTools;

  const config: ContextAssemblerConfig = {
    maxContextTokens: 2000,
    freshTailCount: 10,
    contextThreshold: 0.8,
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccbuddy-integration-'));
    db = new MemoryDatabase(join(tmpDir, 'test.db'));
    db.init();
    messages = new MessageStore(db);
    summaries = new SummaryStore(db);
    profiles = new ProfileStore(db);
    assembler = new ContextAssembler(messages, summaries, profiles, config);
    retrieval = new RetrievalTools(messages, summaries);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Set user profile ─────────────────────────────────────────────────────
  it('1. sets and retrieves user profile', () => {
    profiles.set('dad', 'name', 'Robert');
    profiles.set('dad', 'language', 'English');
    profiles.set('dad', 'timezone', 'UTC-5');

    const profile = profiles.getAll('dad');
    expect(profile.name).toBe('Robert');
    expect(profile.language).toBe('English');
    expect(profile.timezone).toBe('UTC-5');
  });

  // ── 2. Store messages across two sessions and platforms ────────────────────
  it('2. stores messages across two sessions and two platforms', () => {
    const base = Date.now();

    // Discord session
    messages.add({ userId: 'dad', sessionId: 'discord-s1', platform: 'discord', content: 'Hello from Discord', role: 'user', timestamp: base, tokens: 10 });
    messages.add({ userId: 'dad', sessionId: 'discord-s1', platform: 'discord', content: 'Hi there', role: 'assistant', timestamp: base + 1, tokens: 8 });

    // Telegram session
    messages.add({ userId: 'dad', sessionId: 'telegram-s1', platform: 'telegram', content: 'Hello from Telegram', role: 'user', timestamp: base + 2, tokens: 10 });
    messages.add({ userId: 'dad', sessionId: 'telegram-s1', platform: 'telegram', content: 'Hey!', role: 'assistant', timestamp: base + 3, tokens: 5 });

    const allDadMsgs = messages.getByUser('dad');
    expect(allDadMsgs).toHaveLength(4);

    const discordMsgs = messages.getFreshTail('dad', 'discord-s1', 10);
    expect(discordMsgs).toHaveLength(2);
    expect(discordMsgs[0].platform).toBe('discord');

    const telegramMsgs = messages.getFreshTail('dad', 'telegram-s1', 10);
    expect(telegramMsgs).toHaveLength(2);
    expect(telegramMsgs[0].platform).toBe('telegram');
  });

  // ── 3. Create a summary node from message IDs ──────────────────────────────
  it('3. creates a summary node from message IDs', () => {
    const msgId1 = messages.add({ userId: 'dad', sessionId: 'discord-s1', platform: 'discord', content: 'What is the weather?', role: 'user', tokens: 10 });
    const msgId2 = messages.add({ userId: 'dad', sessionId: 'discord-s1', platform: 'discord', content: 'It is sunny today', role: 'assistant', tokens: 10 });

    const nodeId = summaries.add({
      userId: 'dad',
      depth: 0,
      content: 'Dad asked about weather; assistant said sunny',
      sourceIds: [msgId1, msgId2],
      tokens: 20,
    });

    const node = summaries.getById(nodeId);
    expect(node).toBeDefined();
    expect(node!.depth).toBe(0);
    expect(node!.sourceIds).toEqual([msgId1, msgId2]);
    expect(node!.content).toContain('weather');
  });

  // ── 4. Assemble context for a new session ─────────────────────────────────
  it('4. assembles context with profile, tail, and summaries within token budget', () => {
    profiles.set('dad', 'name', 'Robert');

    // Create some history
    const msgId1 = messages.add({ userId: 'dad', sessionId: 'old-session', platform: 'discord', content: 'Old message', role: 'user', tokens: 10 });
    summaries.add({ userId: 'dad', depth: 0, content: 'Dad discussed old topics', sourceIds: [msgId1], tokens: 15 });

    // Add current session messages
    const base = Date.now();
    messages.add({ userId: 'dad', sessionId: 'new-session', platform: 'discord', content: 'Recent msg 1', role: 'user', timestamp: base, tokens: 10 });
    messages.add({ userId: 'dad', sessionId: 'new-session', platform: 'discord', content: 'Recent msg 2', role: 'assistant', timestamp: base + 1, tokens: 10 });

    const ctx = assembler.assemble('dad', 'new-session');

    expect(ctx.profile).toContain('name: Robert');
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].content).toBe('Recent msg 1');
    expect(ctx.summaries).toHaveLength(1);
    expect(ctx.totalTokens).toBeLessThanOrEqual(config.maxContextTokens);
    expect(ctx.needsCompaction).toBe(false);
  });

  // ── 5. Format as prompt — verify XML tags ─────────────────────────────────
  it('5. formats assembled context as XML-tagged prompt', () => {
    profiles.set('dad', 'name', 'Robert');
    messages.add({ userId: 'dad', sessionId: 'session1', platform: 'discord', content: 'Test message', role: 'user', tokens: 10 });
    summaries.add({ userId: 'dad', depth: 0, content: 'Historical context', sourceIds: [], tokens: 10 });

    const ctx = assembler.assemble('dad', 'session1');
    const prompt = assembler.formatAsPrompt(ctx);

    expect(prompt).toContain('<user_profile>');
    expect(prompt).toContain('</user_profile>');
    expect(prompt).toContain('<conversation_history_summary>');
    expect(prompt).toContain('</conversation_history_summary>');
    expect(prompt).toContain('<recent_messages>');
    expect(prompt).toContain('</recent_messages>');
    expect(prompt).toContain('name: Robert');
    expect(prompt).toContain('Test message');
    expect(prompt).toContain('Historical context');
  });

  // ── 6. Search with grep — find across messages and summaries ──────────────
  it('6. grep finds results across both messages and summaries', () => {
    const msgId = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'I enjoy programming in TypeScript', role: 'user', tokens: 15 });
    summaries.add({ userId: 'dad', depth: 0, content: 'Dad mentioned TypeScript as preferred language', sourceIds: [msgId], tokens: 20 });

    const result = retrieval.grep('dad', 'TypeScript');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toContain('TypeScript');
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].content).toContain('TypeScript');
  });

  // ── 7. Expand summary node — get original messages ─────────────────────────
  it('7. expands a summary node to retrieve original source messages', () => {
    const msgId1 = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Original message one', role: 'user', tokens: 10 });
    const msgId2 = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Original message two', role: 'assistant', tokens: 10 });

    const nodeId = summaries.add({
      userId: 'dad',
      depth: 0,
      content: 'Summary of two messages',
      sourceIds: [msgId1, msgId2],
      tokens: 15,
    });

    const expanded = retrieval.expand('dad', nodeId);

    expect(expanded).toBeDefined();
    expect(expanded!.node.id).toBe(nodeId);
    expect(expanded!.sourceMessages).toHaveLength(2);
    expect(expanded!.sourceMessages[0].content).toBe('Original message one');
    expect(expanded!.sourceMessages[1].content).toBe('Original message two');
  });

  // ── 8. Cross-platform continuity (discord + telegram in same user) ─────────
  it('8. verifies cross-platform continuity for same user', () => {
    const base = Date.now();

    // Dad uses both Discord and Telegram
    messages.add({ userId: 'dad', sessionId: 'discord-s1', platform: 'discord', content: 'Discord message', role: 'user', timestamp: base, tokens: 10 });
    messages.add({ userId: 'dad', sessionId: 'telegram-s1', platform: 'telegram', content: 'Telegram message', role: 'user', timestamp: base + 1, tokens: 10 });

    // All messages belong to same user
    const allMsgs = messages.getByUser('dad');
    expect(allMsgs).toHaveLength(2);

    const platforms = allMsgs.map(m => m.platform);
    expect(platforms).toContain('discord');
    expect(platforms).toContain('telegram');

    // Summaries created from discord session are visible when assembling telegram context
    const discordMsgId = allMsgs.find(m => m.platform === 'discord')!.id;
    summaries.add({
      userId: 'dad',
      depth: 0,
      content: 'Dad connected via Discord previously',
      sourceIds: [discordMsgId],
      tokens: 15,
    });

    const ctx = assembler.assemble('dad', 'telegram-s1');
    expect(ctx.summaries).toHaveLength(1);
    expect(ctx.summaries[0].content).toContain('Discord');
  });

  // ── 9. User isolation (son sees nothing from dad) ──────────────────────────
  it('9. enforces strict user isolation between different users', () => {
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Dad private message', role: 'user', tokens: 10 });
    summaries.add({ userId: 'dad', depth: 0, content: 'Dad summary', sourceIds: [], tokens: 10 });
    profiles.set('dad', 'secret', 'Dad secret info');

    // Son should see nothing from dad
    const sonMessages = messages.getByUser('son');
    const sonSummaries = summaries.getRecent('son', 100);
    const sonProfile = profiles.getAll('son');
    const sonGrepResult = retrieval.grep('son', 'Dad');
    const sonCtx = assembler.assemble('son', 'son-session');

    expect(sonMessages).toHaveLength(0);
    expect(sonSummaries).toHaveLength(0);
    expect(Object.keys(sonProfile)).toHaveLength(0);
    expect(sonGrepResult.messages).toHaveLength(0);
    expect(sonGrepResult.summaries).toHaveLength(0);
    expect(sonCtx.profile).toBe('');
    expect(sonCtx.messages).toHaveLength(0);
    expect(sonCtx.summaries).toHaveLength(0);
  });

  // ── 10. Backup and restore ─────────────────────────────────────────────────
  it('10. backup and restore — data survives to new database', async () => {
    profiles.set('dad', 'name', 'Robert');
    const msgId = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Backup test message', role: 'user', tokens: 10 });
    summaries.add({ userId: 'dad', depth: 0, content: 'Backup test summary', sourceIds: [msgId], tokens: 10 });

    const backupPath = join(tmpDir, 'backup.db');
    await db.backup(backupPath);

    expect(existsSync(backupPath)).toBe(true);

    // Open backup DB and verify data
    const backupDb = new MemoryDatabase(backupPath);
    // No need to call init() since tables already exist in the backup
    const backupMessages = new MessageStore(backupDb);
    const backupSummaries = new SummaryStore(backupDb);
    const backupProfiles = new ProfileStore(backupDb);

    const restoredMsgs = backupMessages.getByUser('dad');
    expect(restoredMsgs).toHaveLength(1);
    expect(restoredMsgs[0].content).toBe('Backup test message');

    const restoredSummaries = backupSummaries.getRecent('dad', 10);
    expect(restoredSummaries).toHaveLength(1);
    expect(restoredSummaries[0].content).toBe('Backup test summary');

    const restoredProfile = backupProfiles.getAll('dad');
    expect(restoredProfile.name).toBe('Robert');

    backupDb.close();
  });

  // ── 11. Transaction rollback — verify atomicity ────────────────────────────
  it('11. transaction rollback — aborted operations leave no partial data', () => {
    let msgIdFromTxn: number | undefined;

    try {
      db.transaction(() => {
        msgIdFromTxn = messages.add({
          userId: 'dad',
          sessionId: 's1',
          platform: 'discord',
          content: 'Should be rolled back',
          role: 'user',
          tokens: 10,
        });
        // Force an error to trigger rollback
        throw new Error('Intentional rollback');
      });
    } catch {
      // Expected — swallow the error
    }

    // Message should not exist since transaction was rolled back
    const allMsgs = messages.getByUser('dad');
    expect(allMsgs).toHaveLength(0);

    if (msgIdFromTxn !== undefined) {
      expect(messages.getById(msgIdFromTxn)).toBeUndefined();
    }
  });

  // ── Bonus: successful transaction commits atomically ──────────────────────
  it('successful transaction commits all operations atomically', () => {
    let msgId: number;
    let sumId: number;

    db.transaction(() => {
      msgId = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Txn message', role: 'user', tokens: 10 });
      sumId = summaries.add({ userId: 'dad', depth: 0, content: 'Txn summary', sourceIds: [msgId!], tokens: 10 });
      profiles.set('dad', 'txn_test', 'success');
    });

    expect(messages.getById(msgId!)).toBeDefined();
    expect(summaries.getById(sumId!)).toBeDefined();
    expect(profiles.get('dad', 'txn_test')).toBe('success');
  });
});
