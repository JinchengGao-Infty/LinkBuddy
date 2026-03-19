# Memory Consolidation & Backup Design

## Overview

Wire up the already-configured but unimplemented memory consolidation and backup cron jobs. Consolidation compacts old messages into the existing DAG summary hierarchy using agent-powered summarization. Backup creates timestamped SQLite snapshots with integrity verification.

## Config Schema

One new field added to `memory` config:

```typescript
memory: {
  // existing fields used by this feature:
  consolidation_cron: '0 3 * * *',
  backup_cron: '0 4 * * *',
  backup_dir: './data/backups',
  max_backups: 7,
  leaf_chunk_tokens: 20000,
  leaf_target_tokens: 1200,
  condensed_target_tokens: 2000,
  max_expand_tokens: 4000,
  fresh_tail_count: 32,

  // new:
  message_retention_days: 30,  // keep raw messages this long after summarization
}
```

## ConsolidationService

**Package:** `@ccbuddy/memory`

**Constructor dependencies:**
- `MessageStore` — message data access
- `SummaryStore` — summary node data access
- `MemoryDatabase` — transactions
- `config.memory` — thresholds and retention config
- `summarize: (text: string) => Promise<string>` — injected closure that calls the agent to produce a summary (keeps memory package decoupled from agent)

### `consolidate(userId: string): Promise<ConsolidationStats>`

Three-phase process:

#### Phase 1: Leaf Summarization

1. Call new `MessageStore.getUnsummarizedMessages(userId, excludeRecent)` — returns messages where `summarized_at IS NULL`, ordered by timestamp ASC, excluding the most recent `fresh_tail_count` messages **across all sessions** (never touch the active conversation tail). Query: `SELECT * FROM messages WHERE user_id = ? AND summarized_at IS NULL ORDER BY timestamp ASC LIMIT -1 OFFSET (SELECT MAX(0, COUNT(*) - ?) FROM messages WHERE user_id = ? AND summarized_at IS NULL)` — but simpler: fetch all unsummarized, drop the last N.
2. Batch messages into chunks of ~`leaf_chunk_tokens` tokens each
3. For each chunk:
   - Call `summarize()` with a prompt: "Summarize this conversation preserving key facts, decisions, and user preferences"
   - Insert result as a depth-0 summary node with `source_ids` = original message IDs, `tokens` = `estimateTokens(summaryText)`
   - Set `summarized_at = Date.now()` on the source messages
4. Wrap each chunk's insert + update in a transaction for atomicity

#### Phase 2: Multi-Level Condensation

1. Starting at depth 0, iterate upward:
   - Count nodes at this depth where `condensed_at IS NULL`
   - If 4+ uncondensed nodes exist at this depth:
     - Batch them and call `summarize()` to produce a condensed summary
     - Insert result as depth+1 node with `source_ids` = source node IDs
     - Set `condensed_at = Date.now()` on source nodes
   - Repeat until no level has 4+ uncondensed nodes

#### Phase 3: Retention Pruning

1. Delete messages where:
   - `summarized_at IS NOT NULL`
   - `summarized_at < Date.now() - (message_retention_days * 86400000)`
2. This preserves `memory_expand` capability for recent history while bounding database growth
3. **Note:** After pruning, depth-0 summary nodes' `source_ids` become dangling references. This is intentional — the summaries themselves contain the compressed information. `memory_expand` on these nodes will return the summary text rather than original messages.

### `runFullConsolidation(): Promise<Map<string, ConsolidationStats>>`

Calls new `MessageStore.getDistinctUserIds()` (`SELECT DISTINCT user_id FROM messages`), runs `consolidate()` for each. Returns stats per user. Concurrency is guarded by the `CronRunner.running` flag which prevents overlapping cron executions of the same job.

### `ConsolidationStats`

```typescript
interface ConsolidationStats {
  userId: string;
  messagesChunked: number;
  leafNodesCreated: number;
  condensedNodesCreated: number;
  messagesPruned: number;
}
```

## BackupService

**Package:** `@ccbuddy/memory`

**Constructor dependencies:**
- `MemoryDatabase` — for `database.backup()`
- `config.memory` — for `backup_dir` and `max_backups`
- `eventBus: EventBus` — for integrity failure alerts

### `backup(): Promise<void>`

1. Ensure `backup_dir` exists (`mkdir -p`)
2. Generate filename: `memory-YYYY-MM-DDTHH-MM-SS.sqlite`
3. Call `database.backup(destPath)`
4. Open the backup file read-only with better-sqlite3
5. Run `PRAGMA integrity_check`
6. Close the backup database
7. If integrity check fails, emit `backup.integrity_failed` event with details, delete the corrupt file (it would waste a rotation slot and is untrustworthy)
8. Call `rotateBackups()`

### `rotateBackups(): Promise<void>`

1. List `*.sqlite` files in `backup_dir`, sorted alphabetically (timestamp naming = chronological)
2. If count > `max_backups`, delete the oldest excess files

## New Store Methods

### MessageStore
- `getUnsummarizedMessages(userId: string, excludeRecent: number): Message[]` — Returns messages where `summarized_at IS NULL` for the user, ordered by timestamp ASC, excluding the N most recent unsummarized messages (cross-session). Implementation: fetch all unsummarized ordered by timestamp ASC, slice off the last `excludeRecent`.
- `getDistinctUserIds(): string[]` — `SELECT DISTINCT user_id FROM messages`.
- `markSummarized(ids: number[], timestamp: number): void` — `UPDATE messages SET summarized_at = ? WHERE id IN (...)`.
- `pruneOldSummarized(beforeTimestamp: number): number` — `DELETE FROM messages WHERE summarized_at IS NOT NULL AND summarized_at < ?`. Returns count deleted.

### SummaryStore
- `getUncondensedByDepth(userId: string, depth: number): SummaryNode[]` — `WHERE user_id = ? AND depth = ? AND condensed_at IS NULL`.
- `markCondensed(ids: number[], timestamp: number): void` — `UPDATE summary_nodes SET condensed_at = ? WHERE id IN (...)`.

## SQLite Schema Changes

Migration-style additions in `MemoryDatabase.init()`. Use `PRAGMA table_info(tablename)` to check if columns exist before adding — consistent with the existing `CREATE TABLE IF NOT EXISTS` pattern:

```typescript
const messagesCols = db.pragma('table_info(messages)') as Array<{ name: string }>;
if (!messagesCols.some(c => c.name === 'summarized_at')) {
  db.exec('ALTER TABLE messages ADD COLUMN summarized_at INTEGER');
}
// same pattern for summary_nodes.condensed_at
```

## Scheduler Integration

### Job Type: Discriminated Union

Refactor `ScheduledJob` into a discriminated union to avoid dummy fields on internal jobs:

```typescript
interface BaseJob {
  name: string;
  cron: string;
  enabled: boolean;
  nextRun: number;
  lastRun?: number;
  running: boolean;
  timezone?: string;
}

interface PromptJob extends BaseJob {
  type: 'prompt';
  payload: string;
  user: string;
  target: MessageTarget;
  permissionLevel: 'admin' | 'system';
}

interface SkillJob extends BaseJob {
  type: 'skill';
  payload: string;
  user: string;
  target: MessageTarget;
  permissionLevel: 'admin' | 'system';
}

interface InternalJob extends BaseJob {
  type: 'internal';
}

type ScheduledJob = PromptJob | SkillJob | InternalJob;
```

### CronRunner Changes

When `job.type === 'internal'`:
- Look up callback from `internalJobs` map by job name
- Execute the callback directly
- No agent session, no proactive message
- Log success/failure
- Emit `scheduler.job.complete` event

### SchedulerDeps Addition

```typescript
interface SchedulerDeps {
  // ... existing ...
  internalJobs?: Map<string, () => Promise<void>>;
}
```

## Bootstrap Wiring

In `packages/main/src/bootstrap.ts`, after memory stores are initialized:

1. Create `ConsolidationService` with stores, database, config, and a `summarize` closure:
   ```typescript
   const summarize = async (text: string): Promise<string> => {
     // Call executeAgentRequest with summarization system prompt
     // Collect text chunks from the async generator
     // Return concatenated summary text
   };
   ```

2. Create `BackupService` with database, config, eventBus

3. Register internal scheduler jobs:
   - `memory_consolidation`: cron from `config.memory.consolidation_cron`, callback = `consolidationService.runFullConsolidation()`
   - `memory_backup`: cron from `config.memory.backup_cron`, callback = `backupService.backup()`

## Events

Add to `EventMap` in `packages/core/src/types/events.ts`:

```typescript
'consolidation.complete': ConsolidationStats;
'backup.complete': { path: string };
'backup.integrity_failed': { path: string; error: string };
```

| Event | Payload | When |
|-------|---------|------|
| `consolidation.complete` | `ConsolidationStats` | After each user's consolidation |
| `backup.complete` | `{ path: string }` | After successful backup |
| `backup.integrity_failed` | `{ path: string, error: string }` | If PRAGMA integrity_check fails |

## Testing Strategy

### ConsolidationService (unit)
- Leaf summarization: messages chunked by token budget, `summarize` called per chunk, depth-0 nodes created with correct `source_ids`, messages marked with `summarized_at`
- Multi-level condensation: seed depth-0 nodes, depth-1 nodes created when 4+ threshold met, `condensed_at` set on sources
- Retention pruning: old summarized messages deleted, unsummarized untouched, recently-summarized kept
- Edge cases: no messages, only fresh tail, single message below chunk threshold

### BackupService (unit)
- Creates timestamped file in correct directory
- Rotation deletes oldest when exceeding `max_backups`
- Integrity failure emits event but doesn't throw

### Integration
- Full `consolidate()` with real SQLite and mock summarizer
- `runFullConsolidation()` across multiple users
- Backup + rotate with real filesystem (temp dir)

### Scheduler
- Internal job type executes callback on cron trigger
- Internal job emits `scheduler.job.complete` event
