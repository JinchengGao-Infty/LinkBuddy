# Session Conflict Detection Design

## Overview

Prevent concurrent agent sessions from writing to the same working directory simultaneously. When a second request targets a directory already in use by another session, it's queued automatically and the user is notified. Scheduled jobs (briefings, consolidation) bypass conflict detection since they don't use working directories.

## Conflict Detection Logic

Detection happens in `AgentService.handleRequest()`, before dispatching to the backend.

### DirectoryLock

New class in `packages/agent/src/session/directory-lock.ts`:

```typescript
class DirectoryLock {
  private locks: Map<string, { sessionId: string; userId: string }>;

  acquire(dir: string, sessionId: string, userId: string): { acquired: boolean; heldBy?: { sessionId: string; userId: string } }
  release(dir: string, sessionId: string): void
  isLocked(dir: string, excludeSessionId?: string): boolean
}
```

- Paths normalized via `path.resolve()` for consistent comparison
- Parent/child conflict detection: if `/project` is locked, `/project/src` also conflicts (and vice versa). Check if either path starts with the other.
- Same session re-acquiring the same directory succeeds (idempotent — it's the same conversation continuing)
- Release by wrong session ID is a no-op (safety guard)

### Request Flow

1. Request arrives at `AgentService.handleRequest()`
2. If `request.workingDirectory` is set:
   a. Try `directoryLock.acquire(workingDir, sessionId, userId)`
   b. If acquired: proceed to backend execution. Release lock in `finally` block.
   c. If not acquired: publish `session.conflict` event, push request to per-directory wait queue.
3. If `request.workingDirectory` is not set (scheduled jobs, system tasks): skip lock, proceed directly.
4. On lock release: check wait queue for that directory. If non-empty, shift next request and execute it.

### Wait Queue

`Map<string, AgentRequest[]>` keyed by normalized directory path. FIFO order. When a lock is released, the next queued request is dequeued and executed automatically.

### Notification

On conflict detection, publish `session.conflict` event via EventBus:

```typescript
eventBus.publish('session.conflict', {
  userId: request.userId,
  sessionId: request.sessionId,
  channelId: request.channelId,
  platform: request.platform,
  workingDirectory: request.workingDirectory,
  conflictingPid: 0, // not tracking PIDs, just session-level
});
```

The gateway subscribes to `session.conflict` and sends a message to the user's channel: "Another session is using this directory — your request has been queued and will run when it's free."

## What Does NOT Conflict

- Requests without `workingDirectory` (scheduled jobs, briefings, consolidation, backup)
- Same session ID re-using the same directory (continuation of same conversation)
- Different directories (each user/channel gets its own lock)

## Testing Strategy

### DirectoryLock (unit)
- Acquire/release basic flow
- Same session re-acquires same directory (idempotent)
- Different session blocked on same directory
- Parent/child path conflicts detected
- Release unblocks subsequent acquire
- Release by wrong session ID is a no-op

### AgentService integration (unit)
- Request with working dir acquires lock, releases on completion
- Second request to same dir is queued, not rejected
- Queued request executes after first completes
- Request without working dir skips lock entirely
- `session.conflict` event published when queued
- Error in first request still releases lock (finally block)

### Gateway (unit)
- Subscribes to `session.conflict` event
- Sends notification message to user's channel
