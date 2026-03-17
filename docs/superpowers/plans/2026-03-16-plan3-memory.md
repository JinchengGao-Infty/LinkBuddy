# Plan 3: Memory Module — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LCM-inspired memory module — SQLite-backed storage for messages, a DAG-based summarization system, context assembly for each agent request, and retrieval tools that Claude Code can use to search conversation history.

**Architecture:** New `packages/memory` package with 5 layers: (1) `Database` — SQLite connection with WAL mode, schema migrations, and backup; (2) `MessageStore` — CRUD for raw messages; (3) `SummaryStore` — DAG node management (create, link, query by depth/recency); (4) `ContextAssembler` — builds token-budgeted context from fresh tail + summaries + user profile; (5) `RetrievalTools` — `memory_grep`, `memory_describe`, `memory_expand` implementations registerable as skills. Summarization (calling CC to summarize chunks) is deferred to Plan 4 since it requires the agent module wired through the gateway; the interfaces and data structures are built here.

**Tech Stack:** TypeScript, `better-sqlite3`, Vitest, `@ccbuddy/core` (types, config), `@ccbuddy/skills` (tool registration)

**Spec:** `docs/superpowers/specs/2026-03-16-ccbuddy-design.md` — Section 4

**Depends on:** Plan 1 (core), Plan 2 (skills — for registering retrieval tools)

---

## Scope Decisions

**In scope (this plan):**
- SQLite database with WAL mode, schema creation, backup utility
- MessageStore: store/retrieve raw messages per user/session
- SummaryStore: create/query DAG summary nodes, link to sources
- UserProfileStore: key-value per-user preferences
- ContextAssembler: build context within token budget
- RetrievalTools: memory_grep (full-text search), memory_describe, memory_expand
- Register retrieval tools with the skill registry

**Deferred (needs agent wiring):**
- Actual LLM-powered summarization (leaf/condensation — needs CC integration via gateway)
- Consolidation cron job (needs scheduler module)
- Archival to cold storage (future enhancement)
- Size monitoring alerts (needs heartbeat module)

---

## File Structure

```
packages/
└── memory/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── index.ts                          # barrel export
        ├── database.ts                       # SQLite connection, schema, WAL, backup
        ├── message-store.ts                  # CRUD for raw messages
        ├── summary-store.ts                  # DAG node CRUD, depth queries
        ├── profile-store.ts                  # per-user key-value preferences
        ├── context-assembler.ts              # token-budgeted context building
        ├── retrieval-tools.ts                # memory_grep, memory_describe, memory_expand
        ├── token-counter.ts                  # simple token estimation
        └── __tests__/
            ├── database.test.ts
            ├── message-store.test.ts
            ├── summary-store.test.ts
            ├── profile-store.test.ts
            ├── context-assembler.test.ts
            ├── retrieval-tools.test.ts
            └── integration.test.ts
```

---

## Chunk 1: Package Setup + Database + MessageStore

### Task 1: Initialize Memory Package

> **TDD exception:** Scaffolding.

**Files:**
- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/vitest.config.ts`
- Create: `packages/memory/src/index.ts`

- [ ] **Step 1: Create packages/memory/package.json**

```json
{
  "name": "@ccbuddy/memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@ccbuddy/core": "*",
    "@ccbuddy/skills": "*",
    "better-sqlite3": "^11"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7",
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json, vitest.config.ts, placeholder index.ts**

tsconfig references core and skills. vitest config uses `src/**/__tests__/**/*.test.ts`. Index exports `{}`.

- [ ] **Step 3: Install deps, verify build**

```bash
npm install && npx turbo build
```

- [ ] **Step 4: Commit**

```bash
git add packages/memory/
git commit -m "feat(memory): initialize memory package with better-sqlite3"
```

---

### Task 2: Database Layer

**Files:**
- Create: `packages/memory/src/database.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/database.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, existsSync } from 'fs';

describe('MemoryDatabase', () => {
  let tmpDir: string;
  let db: MemoryDatabase;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-mem-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates database with schema on init', () => {
    db.init();
    // Verify tables exist
    const tables = db.raw().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('messages');
    expect(names).toContain('summary_nodes');
    expect(names).toContain('user_profiles');
  });

  it('enables WAL mode', () => {
    db.init();
    const result = db.raw().pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('creates backup', async () => {
    db.init();
    const backupPath = join(tmpDir, 'backup.sqlite');
    await db.backup(backupPath);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('is idempotent on repeated init', () => {
    db.init();
    db.init(); // should not throw
    const tables = db.raw().prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all();
    expect(tables.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Implement database.ts**

```typescript
import Database from 'better-sqlite3';

export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  init(): void {
    // Enable WAL mode for concurrent read/write
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
        attachments TEXT,
        timestamp INTEGER NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(user_id, timestamp);

      CREATE TABLE IF NOT EXISTS summary_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        source_ids TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_user_id ON summary_nodes(user_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_depth ON summary_nodes(user_id, depth);

      CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
  }

  raw(): Database.Database {
    return this.db;
  }

  async backup(destPath: string): Promise<void> {
    await this.db.backup(destPath);
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add MemoryDatabase with SQLite schema, WAL mode, and backup"
```

---

### Task 3: Token Counter

**Files:**
- Create: `packages/memory/src/token-counter.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/token-counter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../token-counter.js';

describe('estimateTokens', () => {
  it('estimates tokens for English text (~4 chars per token)', () => {
    const text = 'Hello, world!'; // 13 chars ≈ 3-4 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(2);
    expect(tokens).toBeLessThan(8);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('handles long text', () => {
    const text = 'word '.repeat(1000); // 5000 chars ≈ 1250 tokens
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(900);
    expect(tokens).toBeLessThan(1600);
  });
});
```

- [ ] **Step 2: Implement token-counter.ts**

```typescript
/**
 * Simple token estimation: ~4 characters per token (Claude average).
 * This is intentionally approximate. For precise counting, swap in
 * a real tokenizer (e.g., tiktoken) via this interface.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add token estimation utility"
```

---

### Task 4: MessageStore

**Files:**
- Create: `packages/memory/src/message-store.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/message-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('MessageStore', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let store: MessageStore;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-msg-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
    store = new MessageStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves a message', () => {
    const id = store.add({
      userId: 'dad', sessionId: 's1', platform: 'discord',
      content: 'Hello!', role: 'user', tokens: 3,
    });
    expect(id).toBeGreaterThan(0);
    const msg = store.getById(id);
    expect(msg).toBeDefined();
    expect(msg!.content).toBe('Hello!');
    expect(msg!.userId).toBe('dad');
  });

  it('retrieves recent messages for a session (fresh tail)', () => {
    for (let i = 0; i < 10; i++) {
      store.add({
        userId: 'dad', sessionId: 's1', platform: 'discord',
        content: `Message ${i}`, role: i % 2 === 0 ? 'user' : 'assistant', tokens: 5,
      });
    }
    const tail = store.getFreshTail('dad', 's1', 5);
    expect(tail).toHaveLength(5);
    expect(tail[0].content).toBe('Message 5'); // oldest of last 5
    expect(tail[4].content).toBe('Message 9'); // newest
  });

  it('retrieves messages by user across sessions', () => {
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'A', role: 'user', tokens: 1 });
    store.add({ userId: 'dad', sessionId: 's2', platform: 'telegram', content: 'B', role: 'user', tokens: 1 });
    store.add({ userId: 'son', sessionId: 's3', platform: 'discord', content: 'C', role: 'user', tokens: 1 });

    const dadMsgs = store.getByUser('dad');
    expect(dadMsgs).toHaveLength(2);
  });

  it('scopes queries to user (isolation)', () => {
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Secret', role: 'user', tokens: 2 });
    store.add({ userId: 'son', sessionId: 's2', platform: 'discord', content: 'Public', role: 'user', tokens: 2 });

    const sonMsgs = store.getByUser('son');
    expect(sonMsgs).toHaveLength(1);
    expect(sonMsgs[0].content).toBe('Public');
  });

  it('counts tokens for a user', () => {
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'A', role: 'user', tokens: 10 });
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'B', role: 'assistant', tokens: 20 });
    expect(store.getTotalTokens('dad')).toBe(30);
  });

  it('retrieves messages in a time range', () => {
    const now = Date.now();
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Old', role: 'user', tokens: 1, timestamp: now - 86400000 });
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'New', role: 'user', tokens: 1, timestamp: now });

    const recent = store.getByTimeRange('dad', now - 3600000, now + 1000);
    expect(recent).toHaveLength(1);
    expect(recent[0].content).toBe('New');
  });

  it('full-text search across messages', () => {
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'The weather in Paris is sunny', role: 'assistant', tokens: 7 });
    store.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'What about Tokyo?', role: 'user', tokens: 4 });
    store.add({ userId: 'son', sessionId: 's2', platform: 'discord', content: 'Paris is great', role: 'user', tokens: 3 });

    const results = store.search('dad', 'Paris');
    expect(results).toHaveLength(1); // only dad's message, not son's
    expect(results[0].content).toContain('Paris');
  });
});
```

- [ ] **Step 2: Implement message-store.ts**

```typescript
import type { MemoryDatabase } from './database.js';
import { estimateTokens } from './token-counter.js';

export interface StoredMessage {
  id: number;
  userId: string;
  sessionId: string;
  platform: string;
  content: string;
  role: 'user' | 'assistant';
  attachments?: string;
  timestamp: number;
  tokens: number;
}

export interface AddMessageParams {
  userId: string;
  sessionId: string;
  platform: string;
  content: string;
  role: 'user' | 'assistant';
  attachments?: string;
  tokens?: number;
  timestamp?: number;
}

export class MessageStore {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase) {
    this.db = db;
  }

  add(params: AddMessageParams): number {
    const tokens = params.tokens ?? estimateTokens(params.content);
    const timestamp = params.timestamp ?? Date.now();
    const stmt = this.db.raw().prepare(`
      INSERT INTO messages (user_id, session_id, platform, content, role, attachments, timestamp, tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      params.userId, params.sessionId, params.platform,
      params.content, params.role, params.attachments ?? null,
      timestamp, tokens,
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): StoredMessage | undefined {
    const row = this.db.raw().prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    return row ? this.toMessage(row) : undefined;
  }

  getFreshTail(userId: string, sessionId: string, limit: number): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages WHERE user_id = ? AND session_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(userId, sessionId, limit) as any[];
    return rows.map((r: any) => this.toMessage(r)).reverse(); // chronological order
  }

  getByUser(userId: string, limit = 1000): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages WHERE user_id = ? ORDER BY timestamp ASC LIMIT ?
    `).all(userId, limit) as any[];
    return rows.map((r: any) => this.toMessage(r));
  }

  getByTimeRange(userId: string, startMs: number, endMs: number): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(userId, startMs, endMs) as any[];
    return rows.map((r: any) => this.toMessage(r));
  }

  getTotalTokens(userId: string): number {
    const row = this.db.raw().prepare(
      'SELECT COALESCE(SUM(tokens), 0) as total FROM messages WHERE user_id = ?'
    ).get(userId) as { total: number };
    return row.total;
  }

  search(userId: string, query: string): StoredMessage[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM messages WHERE user_id = ? AND content LIKE ?
      ORDER BY timestamp DESC LIMIT 50
    `).all(userId, `%${query}%`) as any[];
    return rows.map((r: any) => this.toMessage(r));
  }

  getMessageCount(userId: string): number {
    const row = this.db.raw().prepare(
      'SELECT COUNT(*) as count FROM messages WHERE user_id = ?'
    ).get(userId) as { count: number };
    return row.count;
  }

  private toMessage(row: any): StoredMessage {
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      platform: row.platform,
      content: row.content,
      role: row.role,
      attachments: row.attachments,
      timestamp: row.timestamp,
      tokens: row.tokens,
    };
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add MessageStore with CRUD, fresh tail, search, and token counting"
```

---

## Chunk 2: SummaryStore + ProfileStore

### Task 5: SummaryStore (DAG Nodes)

**Files:**
- Create: `packages/memory/src/summary-store.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/summary-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { SummaryStore } from '../summary-store.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('SummaryStore', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let store: SummaryStore;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-summary-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
    store = new SummaryStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a leaf summary node (depth 0)', () => {
    const id = store.add({
      userId: 'dad',
      depth: 0,
      content: 'User discussed weather in Paris and Tokyo.',
      sourceIds: [1, 2, 3], // message IDs
      tokens: 10,
    });
    expect(id).toBeGreaterThan(0);
    const node = store.getById(id);
    expect(node).toBeDefined();
    expect(node!.depth).toBe(0);
    expect(node!.sourceIds).toEqual([1, 2, 3]);
  });

  it('creates a condensed node (depth 1) from leaf nodes', () => {
    const leaf1 = store.add({ userId: 'dad', depth: 0, content: 'Leaf 1', sourceIds: [1, 2], tokens: 5 });
    const leaf2 = store.add({ userId: 'dad', depth: 0, content: 'Leaf 2', sourceIds: [3, 4], tokens: 5 });

    const condensed = store.add({
      userId: 'dad',
      depth: 1,
      content: 'Condensed summary of leaves 1 and 2',
      sourceIds: [leaf1, leaf2], // references to leaf node IDs
      tokens: 8,
    });

    const node = store.getById(condensed);
    expect(node!.depth).toBe(1);
    expect(node!.sourceIds).toEqual([leaf1, leaf2]);
  });

  it('retrieves nodes by user and depth', () => {
    store.add({ userId: 'dad', depth: 0, content: 'L1', sourceIds: [1], tokens: 3 });
    store.add({ userId: 'dad', depth: 0, content: 'L2', sourceIds: [2], tokens: 3 });
    store.add({ userId: 'dad', depth: 1, content: 'C1', sourceIds: [1, 2], tokens: 5 });

    const leaves = store.getByDepth('dad', 0);
    expect(leaves).toHaveLength(2);
    const condensed = store.getByDepth('dad', 1);
    expect(condensed).toHaveLength(1);
  });

  it('retrieves recent summaries for context assembly', () => {
    for (let i = 0; i < 10; i++) {
      store.add({ userId: 'dad', depth: 0, content: `Leaf ${i}`, sourceIds: [i], tokens: 5 });
    }
    const recent = store.getRecent('dad', 5);
    expect(recent).toHaveLength(5);
    expect(recent[0].content).toBe('Leaf 5'); // oldest of last 5
  });

  it('scopes queries to user (isolation)', () => {
    store.add({ userId: 'dad', depth: 0, content: 'Dad leaf', sourceIds: [1], tokens: 3 });
    store.add({ userId: 'son', depth: 0, content: 'Son leaf', sourceIds: [2], tokens: 3 });

    const dadNodes = store.getByDepth('dad', 0);
    expect(dadNodes).toHaveLength(1);
    expect(dadNodes[0].content).toBe('Dad leaf');
  });

  it('full-text search across summaries', () => {
    store.add({ userId: 'dad', depth: 0, content: 'Discussion about machine learning models', sourceIds: [1], tokens: 6 });
    store.add({ userId: 'dad', depth: 0, content: 'Vacation planning for Hawaii', sourceIds: [2], tokens: 5 });

    const results = store.search('dad', 'machine learning');
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('machine learning');
  });

  it('gets total token count for user summaries', () => {
    store.add({ userId: 'dad', depth: 0, content: 'L1', sourceIds: [1], tokens: 10 });
    store.add({ userId: 'dad', depth: 1, content: 'C1', sourceIds: [1], tokens: 20 });
    expect(store.getTotalTokens('dad')).toBe(30);
  });

  it('deletes a summary node', () => {
    const id = store.add({ userId: 'dad', depth: 0, content: 'Test', sourceIds: [1], tokens: 3 });
    store.delete(id);
    expect(store.getById(id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implement summary-store.ts**

```typescript
import type { MemoryDatabase } from './database.js';

export interface SummaryNode {
  id: number;
  userId: string;
  depth: number;
  content: string;
  sourceIds: number[];
  tokens: number;
  timestamp: number;
}

export interface AddSummaryParams {
  userId: string;
  depth: number;
  content: string;
  sourceIds: number[];
  tokens: number;
  timestamp?: number;
}

export class SummaryStore {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase) {
    this.db = db;
  }

  add(params: AddSummaryParams): number {
    const timestamp = params.timestamp ?? Date.now();
    const stmt = this.db.raw().prepare(`
      INSERT INTO summary_nodes (user_id, depth, content, source_ids, tokens, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      params.userId, params.depth, params.content,
      JSON.stringify(params.sourceIds), params.tokens, timestamp,
    );
    return Number(result.lastInsertRowid);
  }

  getById(id: number): SummaryNode | undefined {
    const row = this.db.raw().prepare('SELECT * FROM summary_nodes WHERE id = ?').get(id) as any;
    return row ? this.toNode(row) : undefined;
  }

  getByDepth(userId: string, depth: number): SummaryNode[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM summary_nodes WHERE user_id = ? AND depth = ?
      ORDER BY timestamp ASC
    `).all(userId, depth) as any[];
    return rows.map((r: any) => this.toNode(r));
  }

  getRecent(userId: string, limit: number): SummaryNode[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM summary_nodes WHERE user_id = ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(userId, limit) as any[];
    return rows.map(this.toNode).reverse();
  }

  search(userId: string, query: string): SummaryNode[] {
    const rows = this.db.raw().prepare(`
      SELECT * FROM summary_nodes WHERE user_id = ? AND content LIKE ?
      ORDER BY timestamp DESC LIMIT 50
    `).all(userId, `%${query}%`) as any[];
    return rows.map((r: any) => this.toNode(r));
  }

  getTotalTokens(userId: string): number {
    const row = this.db.raw().prepare(
      'SELECT COALESCE(SUM(tokens), 0) as total FROM summary_nodes WHERE user_id = ?'
    ).get(userId) as { total: number };
    return row.total;
  }

  delete(id: number): void {
    this.db.raw().prepare('DELETE FROM summary_nodes WHERE id = ?').run(id);
  }

  private toNode(row: any): SummaryNode {
    return {
      id: row.id,
      userId: row.user_id,
      depth: row.depth,
      content: row.content,
      sourceIds: JSON.parse(row.source_ids),
      tokens: row.tokens,
      timestamp: row.timestamp,
    };
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add SummaryStore for DAG node management with depth queries and search"
```

---

### Task 6: ProfileStore

**Files:**
- Create: `packages/memory/src/profile-store.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/profile-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { ProfileStore } from '../profile-store.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('ProfileStore', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let store: ProfileStore;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-profile-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
    store = new ProfileStore(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets and gets a profile key', () => {
    store.set('dad', 'preferred_language', 'English');
    expect(store.get('dad', 'preferred_language')).toBe('English');
  });

  it('updates existing key', () => {
    store.set('dad', 'mood', 'happy');
    store.set('dad', 'mood', 'focused');
    expect(store.get('dad', 'mood')).toBe('focused');
  });

  it('returns undefined for missing key', () => {
    expect(store.get('dad', 'nonexistent')).toBeUndefined();
  });

  it('gets all profile entries for a user', () => {
    store.set('dad', 'language', 'English');
    store.set('dad', 'expertise', 'TypeScript');
    store.set('son', 'grade', '8th');

    const dadProfile = store.getAll('dad');
    expect(Object.keys(dadProfile)).toHaveLength(2);
    expect(dadProfile.language).toBe('English');
    expect(dadProfile.expertise).toBe('TypeScript');
  });

  it('deletes a profile key', () => {
    store.set('dad', 'temp_key', 'temp_value');
    store.delete('dad', 'temp_key');
    expect(store.get('dad', 'temp_key')).toBeUndefined();
  });

  it('isolates profiles between users', () => {
    store.set('dad', 'role', 'engineer');
    store.set('son', 'role', 'student');
    expect(store.get('dad', 'role')).toBe('engineer');
    expect(store.get('son', 'role')).toBe('student');
  });

  it('formats profile as context string', () => {
    store.set('dad', 'name', 'Dad');
    store.set('dad', 'expertise', 'TypeScript');
    const context = store.getAsContext('dad');
    expect(context).toContain('name: Dad');
    expect(context).toContain('expertise: TypeScript');
  });
});
```

- [ ] **Step 2: Implement profile-store.ts**

```typescript
import type { MemoryDatabase } from './database.js';

export class ProfileStore {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase) {
    this.db = db;
  }

  set(userId: string, key: string, value: string): void {
    this.db.raw().prepare(`
      INSERT INTO user_profiles (user_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(userId, key, value, Date.now());
  }

  get(userId: string, key: string): string | undefined {
    const row = this.db.raw().prepare(
      'SELECT value FROM user_profiles WHERE user_id = ? AND key = ?'
    ).get(userId, key) as { value: string } | undefined;
    return row?.value;
  }

  getAll(userId: string): Record<string, string> {
    const rows = this.db.raw().prepare(
      'SELECT key, value FROM user_profiles WHERE user_id = ? ORDER BY key'
    ).all(userId) as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  delete(userId: string, key: string): void {
    this.db.raw().prepare(
      'DELETE FROM user_profiles WHERE user_id = ? AND key = ?'
    ).run(userId, key);
  }

  /**
   * Format all profile entries as a human-readable context string
   * for injection into Claude Code prompts.
   */
  getAsContext(userId: string): string {
    const profile = this.getAll(userId);
    if (Object.keys(profile).length === 0) return '';
    return Object.entries(profile)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add ProfileStore for per-user key-value preferences"
```

---

## Chunk 3: ContextAssembler + RetrievalTools + Integration

### Task 7: ContextAssembler

**Files:**
- Create: `packages/memory/src/context-assembler.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/context-assembler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { ProfileStore } from '../profile-store.js';
import { ContextAssembler } from '../context-assembler.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('ContextAssembler', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let messages: MessageStore;
  let summaries: SummaryStore;
  let profiles: ProfileStore;
  let assembler: ContextAssembler;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-ctx-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
    messages = new MessageStore(db);
    summaries = new SummaryStore(db);
    profiles = new ProfileStore(db);
    assembler = new ContextAssembler(messages, summaries, profiles, {
      maxContextTokens: 1000,
      freshTailCount: 5,
      contextThreshold: 0.75,
    });
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('assembles context with profile + fresh tail', () => {
    profiles.set('dad', 'expertise', 'TypeScript');
    for (let i = 0; i < 3; i++) {
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: `Msg ${i}`, role: 'user', tokens: 10 });
    }

    const context = assembler.assemble('dad', 's1');
    expect(context.profile).toContain('expertise: TypeScript');
    expect(context.messages).toHaveLength(3);
    expect(context.totalTokens).toBeGreaterThan(0);
  });

  it('limits fresh tail to configured count', () => {
    for (let i = 0; i < 20; i++) {
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: `Msg ${i}`, role: 'user', tokens: 5 });
    }

    const context = assembler.assemble('dad', 's1');
    expect(context.messages.length).toBeLessThanOrEqual(5);
  });

  it('includes summary nodes when available', () => {
    summaries.add({ userId: 'dad', depth: 0, content: 'Previous conversation about Paris weather', sourceIds: [1, 2], tokens: 10 });
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Current msg', role: 'user', tokens: 5 });

    const context = assembler.assemble('dad', 's1');
    expect(context.summaries.length).toBeGreaterThanOrEqual(1);
    expect(context.summaries[0].content).toContain('Paris');
  });

  it('respects token budget', () => {
    // Fill up with many large summaries
    for (let i = 0; i < 50; i++) {
      summaries.add({ userId: 'dad', depth: 0, content: 'A'.repeat(200), sourceIds: [i], tokens: 50 });
    }
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Current', role: 'user', tokens: 5 });

    const context = assembler.assemble('dad', 's1');
    expect(context.totalTokens).toBeLessThanOrEqual(1000);
  });

  it('formats as prompt string', () => {
    profiles.set('dad', 'name', 'Dad');
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Hello', role: 'user', tokens: 2 });

    const context = assembler.assemble('dad', 's1');
    const formatted = assembler.formatAsPrompt(context);
    expect(formatted).toContain('name: Dad');
    expect(formatted).toContain('Hello');
  });

  it('returns empty context for new user', () => {
    const context = assembler.assemble('newuser', 's1');
    expect(context.messages).toHaveLength(0);
    expect(context.summaries).toHaveLength(0);
    expect(context.profile).toBe('');
  });
});
```

- [ ] **Step 2: Implement context-assembler.ts**

```typescript
import type { MessageStore, StoredMessage } from './message-store.js';
import type { SummaryStore, SummaryNode } from './summary-store.js';
import type { ProfileStore } from './profile-store.js';
import { estimateTokens } from './token-counter.js';

export interface ContextAssemblerConfig {
  maxContextTokens: number;
  freshTailCount: number;
  contextThreshold: number; // 0.0 - 1.0
}

export interface AssembledContext {
  profile: string;
  messages: StoredMessage[];
  summaries: SummaryNode[];
  totalTokens: number;
  needsCompaction: boolean; // true when total user tokens exceed threshold — caller should trigger summarization
}

export class ContextAssembler {
  private messages: MessageStore;
  private summaries: SummaryStore;
  private profiles: ProfileStore;
  private config: ContextAssemblerConfig;

  constructor(
    messages: MessageStore,
    summaries: SummaryStore,
    profiles: ProfileStore,
    config: ContextAssemblerConfig,
  ) {
    this.messages = messages;
    this.summaries = summaries;
    this.profiles = profiles;
    this.config = config;
  }

  assemble(userId: string, sessionId: string): AssembledContext {
    const budget = this.config.maxContextTokens;
    let usedTokens = 0;

    // 1. User profile (always included, low cost)
    const profile = this.profiles.getAsContext(userId);
    usedTokens += estimateTokens(profile);

    // 2. Fresh tail (recent messages from this session)
    const tail = this.messages.getFreshTail(userId, sessionId, this.config.freshTailCount);
    const tailTokens = tail.reduce((sum, m) => sum + m.tokens, 0);
    usedTokens += tailTokens;

    // 3. Summary nodes (fill remaining budget with most recent)
    const remainingBudget = budget - usedTokens;
    const includedSummaries: SummaryNode[] = [];

    if (remainingBudget > 0) {
      // Get recent summaries, prioritizing higher-depth (more condensed) first
      const candidates = this.summaries.getRecent(userId, 50);

      // Sort: higher depth first (more condensed = higher value), then by recency
      candidates.sort((a, b) => {
        if (a.depth !== b.depth) return b.depth - a.depth;
        return b.timestamp - a.timestamp;
      });

      let summaryTokens = 0;
      for (const node of candidates) {
        if (summaryTokens + node.tokens > remainingBudget) continue;
        includedSummaries.push(node);
        summaryTokens += node.tokens;
      }
      usedTokens += summaryTokens;
    }

    // Check if total stored tokens exceed the compaction threshold
    const totalUserMessageTokens = this.messages.getTotalTokens(userId);
    const totalUserSummaryTokens = this.summaries.getTotalTokens(userId);
    const totalStored = totalUserMessageTokens + totalUserSummaryTokens;
    const needsCompaction = totalStored > budget * this.config.contextThreshold;

    return {
      profile,
      messages: tail,
      summaries: includedSummaries,
      totalTokens: usedTokens,
      needsCompaction,
    };
  }

  formatAsPrompt(context: AssembledContext): string {
    const parts: string[] = [];

    if (context.profile) {
      parts.push(`<user_profile>\n${context.profile}\n</user_profile>`);
    }

    if (context.summaries.length > 0) {
      const summaryText = context.summaries
        .map((s) => s.content)
        .join('\n\n');
      parts.push(`<conversation_history_summary>\n${summaryText}\n</conversation_history_summary>`);
    }

    if (context.messages.length > 0) {
      const msgText = context.messages
        .map((m) => `[${m.role}]: ${m.content}`)
        .join('\n');
      parts.push(`<recent_messages>\n${msgText}\n</recent_messages>`);
    }

    return parts.join('\n\n');
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add ContextAssembler with token-budgeted context building"
```

---

### Task 8: RetrievalTools

**Files:**
- Create: `packages/memory/src/retrieval-tools.ts`

- [ ] **Step 1: Write tests**

Create `packages/memory/src/__tests__/retrieval-tools.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { RetrievalTools } from '../retrieval-tools.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('RetrievalTools', () => {
  let tmpDir: string;
  let db: MemoryDatabase;
  let messages: MessageStore;
  let summaries: SummaryStore;
  let tools: RetrievalTools;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-retrieval-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
    messages = new MessageStore(db);
    summaries = new SummaryStore(db);
    tools = new RetrievalTools(messages, summaries);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('memory_grep', () => {
    it('searches messages and summaries', () => {
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'The weather in Paris is great', role: 'assistant', tokens: 7 });
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'What about lunch?', role: 'user', tokens: 4 });
      summaries.add({ userId: 'dad', depth: 0, content: 'Discussed Paris travel plans', sourceIds: [1], tokens: 5 });

      const result = tools.grep('dad', 'Paris');
      expect(result.messages).toHaveLength(1);
      expect(result.summaries).toHaveLength(1);
    });

    it('returns empty for no matches', () => {
      const result = tools.grep('dad', 'nonexistent');
      expect(result.messages).toHaveLength(0);
      expect(result.summaries).toHaveLength(0);
    });
  });

  describe('memory_expand', () => {
    it('expands a summary node to its source messages', () => {
      const msg1 = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'First message', role: 'user', tokens: 3 });
      const msg2 = messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Second message', role: 'assistant', tokens: 3 });
      const summaryId = summaries.add({ userId: 'dad', depth: 0, content: 'Summary of two messages', sourceIds: [msg1, msg2], tokens: 5 });

      const expanded = tools.expand('dad', summaryId);
      expect(expanded.node).toBeDefined();
      expect(expanded.sourceMessages).toHaveLength(2);
      expect(expanded.sourceMessages[0].content).toBe('First message');
    });

    it('returns null for non-existent node', () => {
      const expanded = tools.expand('dad', 999);
      expect(expanded.node).toBeUndefined();
    });

    it('expands nested summaries (depth > 0)', () => {
      const leaf1 = summaries.add({ userId: 'dad', depth: 0, content: 'Leaf 1', sourceIds: [1, 2], tokens: 5 });
      const leaf2 = summaries.add({ userId: 'dad', depth: 0, content: 'Leaf 2', sourceIds: [3, 4], tokens: 5 });
      const condensed = summaries.add({ userId: 'dad', depth: 1, content: 'Condensed', sourceIds: [leaf1, leaf2], tokens: 8 });

      const expanded = tools.expand('dad', condensed);
      expect(expanded.node).toBeDefined();
      expect(expanded.sourceNodes).toHaveLength(2);
      expect(expanded.sourceNodes![0].content).toBe('Leaf 1');
    });
  });

  describe('memory_describe', () => {
    it('describes messages in a time range', () => {
      const now = Date.now();
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Morning message', role: 'user', tokens: 3, timestamp: now - 3600000 });
      messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Afternoon message', role: 'user', tokens: 3, timestamp: now });

      const desc = tools.describe('dad', { startMs: now - 7200000, endMs: now + 1000 });
      expect(desc.messages).toHaveLength(2);
      expect(desc.messageCount).toBe(2);
    });
  });

  describe('tool definitions', () => {
    it('returns skill-compatible tool definitions', () => {
      const defs = tools.getToolDefinitions();
      expect(defs).toHaveLength(3);
      const names = defs.map(d => d.name);
      expect(names).toContain('memory_grep');
      expect(names).toContain('memory_describe');
      expect(names).toContain('memory_expand');
    });
  });
});
```

- [ ] **Step 2: Implement retrieval-tools.ts**

```typescript
import type { MessageStore, StoredMessage } from './message-store.js';
import type { SummaryStore, SummaryNode } from './summary-store.js';
import type { ToolDescription } from '@ccbuddy/skills';

export interface GrepResult {
  messages: StoredMessage[];
  summaries: SummaryNode[];
}

export interface ExpandResult {
  node: SummaryNode | undefined;
  sourceMessages: StoredMessage[];
  sourceNodes?: SummaryNode[];
}

export interface DescribeResult {
  messages: StoredMessage[];
  messageCount: number;
}

export class RetrievalTools {
  private messages: MessageStore;
  private summaries: SummaryStore;

  constructor(messages: MessageStore, summaries: SummaryStore) {
    this.messages = messages;
    this.summaries = summaries;
  }

  grep(userId: string, query: string): GrepResult {
    return {
      messages: this.messages.search(userId, query),
      summaries: this.summaries.search(userId, query),
    };
  }

  expand(userId: string, nodeId: number): ExpandResult {
    const node = this.summaries.getById(nodeId);
    if (!node || node.userId !== userId) {
      return { node: undefined, sourceMessages: [] };
    }

    if (node.depth === 0) {
      // Leaf node — source_ids are message IDs
      const sourceMessages = node.sourceIds
        .map((id) => this.messages.getById(id))
        .filter((m): m is StoredMessage => m !== undefined);
      return { node, sourceMessages };
    }

    // Higher depth — source_ids are summary node IDs
    const sourceNodes = node.sourceIds
      .map((id) => this.summaries.getById(id))
      .filter((n): n is SummaryNode => n !== undefined);
    return { node, sourceMessages: [], sourceNodes };
  }

  describe(userId: string, options: { startMs: number; endMs: number }): DescribeResult {
    const msgs = this.messages.getByTimeRange(userId, options.startMs, options.endMs);
    return {
      messages: msgs,
      messageCount: msgs.length,
    };
  }

  /**
   * Returns tool definitions for registering with the skill registry.
   */
  getToolDefinitions(): ToolDescription[] {
    return [
      {
        name: 'memory_grep',
        description: 'Search conversation history for messages and summaries matching a query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (keyword or phrase)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'memory_describe',
        description: 'Describe messages in a specific time range from conversation history',
        inputSchema: {
          type: 'object',
          properties: {
            start_hours_ago: { type: 'number', description: 'Start of range (hours ago from now)' },
            end_hours_ago: { type: 'number', description: 'End of range (hours ago, 0 = now)' },
          },
          required: ['start_hours_ago'],
        },
      },
      {
        name: 'memory_expand',
        description: 'Expand a summary node to see the original messages or sub-summaries it was created from',
        inputSchema: {
          type: 'object',
          properties: {
            node_id: { type: 'number', description: 'ID of the summary node to expand' },
          },
          required: ['node_id'],
        },
      },
    ];
  }
}
```

- [ ] **Step 3: Update barrel, run tests, commit**

```bash
git commit -m "feat(memory): add RetrievalTools (memory_grep, memory_describe, memory_expand)"
```

---

### Task 9: Integration Test + Final Verification

**Files:**
- Create: `packages/memory/src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

Test the full flow: create database → store messages → create summaries → assemble context → search with retrieval tools → verify token budgeting.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryDatabase } from '../database.js';
import { MessageStore } from '../message-store.js';
import { SummaryStore } from '../summary-store.js';
import { ProfileStore } from '../profile-store.js';
import { ContextAssembler } from '../context-assembler.js';
import { RetrievalTools } from '../retrieval-tools.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync } from 'fs';

describe('Memory Module Integration', () => {
  let tmpDir: string;
  let db: MemoryDatabase;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-mem-int-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    db = new MemoryDatabase(join(tmpDir, 'test.sqlite'));
    db.init();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full lifecycle: store → summarize → assemble → search', () => {
    const messages = new MessageStore(db);
    const summaries = new SummaryStore(db);
    const profiles = new ProfileStore(db);
    const assembler = new ContextAssembler(messages, summaries, profiles, {
      maxContextTokens: 500, freshTailCount: 3, contextThreshold: 0.75,
    });
    const tools = new RetrievalTools(messages, summaries);

    // 1. Set user profile
    profiles.set('dad', 'expertise', 'TypeScript');
    profiles.set('dad', 'preference', 'concise answers');

    // 2. Store some messages (simulating a conversation)
    const msgIds: number[] = [];
    msgIds.push(messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'How do I use async/await in TypeScript?', role: 'user', tokens: 10 }));
    msgIds.push(messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Use the async keyword before function and await before promises.', role: 'assistant', tokens: 15 }));
    msgIds.push(messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'What about error handling?', role: 'user', tokens: 6 }));
    msgIds.push(messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Wrap in try/catch blocks. You can also use .catch() on the promise.', role: 'assistant', tokens: 15 }));
    // New session
    msgIds.push(messages.add({ userId: 'dad', sessionId: 's2', platform: 'telegram', content: 'Remind me about Paris trip planning', role: 'user', tokens: 8 }));

    // 3. Create a summary (simulating what CC would produce)
    const leafId = summaries.add({
      userId: 'dad', depth: 0,
      content: 'Dad asked about async/await and error handling in TypeScript. Covered async keyword, await, try/catch, and .catch().',
      sourceIds: [msgIds[0], msgIds[1], msgIds[2], msgIds[3]],
      tokens: 20,
    });

    // 4. Assemble context for new session s2
    const context = assembler.assemble('dad', 's2');
    expect(context.profile).toContain('TypeScript');
    expect(context.messages).toHaveLength(1); // only s2 message
    expect(context.summaries.length).toBeGreaterThanOrEqual(1);
    expect(context.totalTokens).toBeLessThanOrEqual(500);

    // 5. Format as prompt
    const prompt = assembler.formatAsPrompt(context);
    expect(prompt).toContain('expertise: TypeScript');
    expect(prompt).toContain('async/await');
    expect(prompt).toContain('Paris trip');

    // 6. Search with retrieval tools
    const grepResult = tools.grep('dad', 'TypeScript');
    expect(grepResult.messages.length + grepResult.summaries.length).toBeGreaterThan(0);

    // 7. Expand summary
    const expanded = tools.expand('dad', leafId);
    expect(expanded.sourceMessages).toHaveLength(4);

    // 8. Cross-platform: s1 (discord) and s2 (telegram) are in the same memory
    const allMsgs = messages.getByUser('dad');
    expect(allMsgs).toHaveLength(5);

    // 9. User isolation: son sees nothing
    const sonMsgs = messages.getByUser('son');
    expect(sonMsgs).toHaveLength(0);
  });

  it('database backup and restore', async () => {
    const messages = new MessageStore(db);
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Important data', role: 'user', tokens: 3 });

    // Backup
    const backupPath = join(tmpDir, 'backup.sqlite');
    await db.backup(backupPath);

    // Verify backup has data
    const backupDb = new MemoryDatabase(backupPath);
    backupDb.init();
    const backupMessages = new MessageStore(backupDb);
    const msgs = backupMessages.getByUser('dad');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Important data');
    backupDb.close();
  });

  it('transaction rollback on error', () => {
    const messages = new MessageStore(db);
    messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Before', role: 'user', tokens: 2 });

    expect(() => {
      db.transaction(() => {
        messages.add({ userId: 'dad', sessionId: 's1', platform: 'discord', content: 'Inside txn', role: 'user', tokens: 3 });
        throw new Error('Simulated failure');
      });
    }).toThrow('Simulated failure');

    // Only the first message should exist
    const allMsgs = messages.getByUser('dad');
    expect(allMsgs).toHaveLength(1);
    expect(allMsgs[0].content).toBe('Before');
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx turbo build && npx turbo test
```

All packages must pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "test(memory): add full lifecycle integration test with backup and transaction rollback"
```

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "chore: plan 3 complete — memory module with stores, context assembly, and retrieval tools"
```

---

## Summary

**Plan 3 delivers:**
- `@ccbuddy/memory` package with 7 components:
  - **MemoryDatabase** — SQLite with WAL mode, schema, backup, transactions
  - **TokenCounter** — simple ~4 chars/token estimation
  - **MessageStore** — CRUD, fresh tail, time range, search, token counting
  - **SummaryStore** — DAG nodes with depth, source linking, search
  - **ProfileStore** — per-user key-value with context formatting
  - **ContextAssembler** — token-budgeted context from profile + tail + summaries
  - **RetrievalTools** — memory_grep, memory_describe, memory_expand with skill-registry-compatible tool definitions
- Full integration tests (lifecycle, backup, transaction rollback)

**What's NOT in this plan (deferred):**
- LLM-powered summarization (leaf/condensation) — needs CC integration through gateway (Plan 4)
- Consolidation cron job — needs scheduler module (Plan 5)
- Archival to cold storage — future enhancement
- Size monitoring alerts — needs heartbeat module (Plan 5)
- FTS5 full-text search index — current `LIKE` queries work for moderate data; swap to FTS5 when performance requires it
- Registering retrieval tools with skill registry — `getToolDefinitions()` returns the definitions; actual `registry.registerExternalTool()` calls happen when the gateway wires everything (Plan 4)
- Extending `MemoryConfig` in `@ccbuddy/core` — fields like `fresh_tail_count`, `backup_dir`, `max_backups` should be added when the features that use them are wired in (summarization, backup cron)
- Event bus integration (`memory.stored`, `memory.context` events) — add when consumers exist (Plan 5 heartbeat)
- `memory_describe` topic filtering — current implementation returns raw messages in time range; LLM-powered summarization deferred to Plan 4
- SQL `LIKE` search doesn't escape `%` and `_` in user queries — known limitation, acceptable for family-scale usage
