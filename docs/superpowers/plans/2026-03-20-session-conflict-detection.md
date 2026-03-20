# Session Conflict Detection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent concurrent agent sessions from operating on the same working directory by queuing conflicting requests and notifying users.

**Architecture:** `DirectoryLock` class manages per-directory locks. `AgentService.handleRequest()` acquires the lock before the existing concurrency check — if blocked, the caller's async generator suspends via a promise that resolves when the lock is released. Gateway subscribes to `session.conflict` events to notify users.

**Tech Stack:** TypeScript, vitest

**Spec:** `docs/superpowers/specs/2026-03-20-session-conflict-detection-design.md`

---

## Chunk 1: DirectoryLock + AgentService + Gateway

### Task 1: Implement DirectoryLock

**Files:**
- Create: `packages/agent/src/session/directory-lock.ts`
- Create: `packages/agent/src/__tests__/directory-lock.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/agent/src/__tests__/directory-lock.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DirectoryLock } from '../session/directory-lock.js';

describe('DirectoryLock', () => {
  it('acquires and releases a lock', () => {
    const lock = new DirectoryLock();
    const result = lock.acquire('/project', 'session-1', 'user-1');
    expect(result.acquired).toBe(true);

    lock.release('/project', 'session-1');
    expect(lock.isLocked('/project')).toBe(false);
  });

  it('same session re-acquires same directory (idempotent)', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');
    const result = lock.acquire('/project', 'session-1', 'user-1');
    expect(result.acquired).toBe(true);
  });

  it('different session is blocked on same directory', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');
    const result = lock.acquire('/project', 'session-2', 'user-2');
    expect(result.acquired).toBe(false);
    expect(result.heldBy?.sessionId).toBe('session-1');
    expect(result.heldBy?.userId).toBe('user-1');
  });

  it('detects parent/child path conflicts', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');

    const child = lock.acquire('/project/src', 'session-2', 'user-2');
    expect(child.acquired).toBe(false);

    lock.release('/project', 'session-1');

    lock.acquire('/project/src', 'session-2', 'user-2');
    const parent = lock.acquire('/project', 'session-3', 'user-3');
    expect(parent.acquired).toBe(false);
  });

  it('does not conflict on similar path prefixes', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');

    const result = lock.acquire('/projects', 'session-2', 'user-2');
    expect(result.acquired).toBe(true);
  });

  it('release by wrong session ID is a no-op', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');
    lock.release('/project', 'wrong-session');
    expect(lock.isLocked('/project')).toBe(true);
  });

  it('release unblocks subsequent acquire', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');
    expect(lock.acquire('/project', 'session-2', 'user-2').acquired).toBe(false);

    lock.release('/project', 'session-1');
    expect(lock.acquire('/project', 'session-2', 'user-2').acquired).toBe(true);
  });

  it('isLocked excludes specified session', () => {
    const lock = new DirectoryLock();
    lock.acquire('/project', 'session-1', 'user-1');
    expect(lock.isLocked('/project')).toBe(true);
    expect(lock.isLocked('/project', 'session-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/agent/src/__tests__/directory-lock.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DirectoryLock**

Create `packages/agent/src/session/directory-lock.ts`:

```typescript
import { resolve, sep } from 'node:path';

export interface LockHolder {
  sessionId: string;
  userId: string;
}

export interface AcquireResult {
  acquired: boolean;
  heldBy?: LockHolder;
}

export class DirectoryLock {
  private readonly locks = new Map<string, LockHolder>();

  acquire(dir: string, sessionId: string, userId: string): AcquireResult {
    const normalized = resolve(dir);

    // Check for conflicts (same dir, parent, or child)
    for (const [lockedDir, holder] of this.locks) {
      if (holder.sessionId === sessionId) continue; // same session — no conflict
      if (this.pathsConflict(normalized, lockedDir)) {
        return { acquired: false, heldBy: holder };
      }
    }

    // Acquire or re-acquire
    this.locks.set(normalized, { sessionId, userId });
    return { acquired: true };
  }

  release(dir: string, sessionId: string): void {
    const normalized = resolve(dir);
    const holder = this.locks.get(normalized);
    if (holder && holder.sessionId === sessionId) {
      this.locks.delete(normalized);
    }
  }

  isLocked(dir: string, excludeSessionId?: string): boolean {
    const normalized = resolve(dir);
    for (const [lockedDir, holder] of this.locks) {
      if (excludeSessionId && holder.sessionId === excludeSessionId) continue;
      if (this.pathsConflict(normalized, lockedDir)) {
        return true;
      }
    }
    return false;
  }

  private pathsConflict(a: string, b: string): boolean {
    return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/agent/src/__tests__/directory-lock.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Export from agent package**

Add to `packages/agent/src/index.ts` (read it first to see existing exports):
```typescript
export { DirectoryLock } from './session/directory-lock.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/session/directory-lock.ts packages/agent/src/__tests__/directory-lock.test.ts packages/agent/src/index.ts
git commit -m "feat(agent): implement DirectoryLock for session conflict detection"
```

---

### Task 2: Integrate DirectoryLock into AgentService

**Files:**
- Modify: `packages/agent/src/agent-service.ts`
- Modify: `packages/core/src/types/events.ts`
- Test: `packages/agent/src/__tests__/agent-service.test.ts`

- [ ] **Step 1: Update SessionConflictEvent type**

In `packages/core/src/types/events.ts`, replace the existing `SessionConflictEvent`:

```typescript
export interface SessionConflictEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  workingDirectory: string;
  conflictingPid?: number;
  conflictingSessionId?: string;
}
```

- [ ] **Step 2: Write failing tests for directory conflict in AgentService**

Add to `packages/agent/src/__tests__/agent-service.test.ts`:

```typescript
describe('directory conflict detection', () => {
  it('acquires lock for request with workingDirectory', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('done') });
    const events = await collectEvents(
      service.handleRequest(makeRequest({ workingDirectory: '/project' })),
    );
    expect(events[0].type).toBe('complete');
  });

  it('queues second request to same directory', async () => {
    const service = new AgentService({
      ...defaultOpts,
      backend: makeBackend('done', 100), // 100ms delay
    });

    // Start first request (will take 100ms)
    const gen1 = service.handleRequest(makeRequest({
      sessionId: 'session-1',
      workingDirectory: '/project',
    }));

    // Start second request to same directory, different session
    const gen2 = service.handleRequest(makeRequest({
      sessionId: 'session-2',
      workingDirectory: '/project',
    }));

    // Both should complete (second one waits)
    const [events1, events2] = await Promise.all([
      collectEvents(gen1),
      collectEvents(gen2),
    ]);

    expect(events1[0].type).toBe('complete');
    expect(events2[0].type).toBe('complete');
  });

  it('skips lock for requests without workingDirectory', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('done') });
    const events = await collectEvents(
      service.handleRequest(makeRequest({ workingDirectory: undefined })),
    );
    expect(events[0].type).toBe('complete');
  });

  it('publishes session.conflict event when queued', async () => {
    const eventBus = createEventBus();
    const conflicts: unknown[] = [];
    eventBus.subscribe('session.conflict', (e) => conflicts.push(e));

    const service = new AgentService({
      ...defaultOpts,
      backend: makeBackend('done', 100),
      eventBus,
    });

    const gen1 = service.handleRequest(makeRequest({
      sessionId: 'session-1',
      workingDirectory: '/project',
    }));
    const gen2 = service.handleRequest(makeRequest({
      sessionId: 'session-2',
      workingDirectory: '/project',
    }));

    await Promise.all([collectEvents(gen1), collectEvents(gen2)]);

    expect(conflicts).toHaveLength(1);
    expect((conflicts[0] as any).sessionId).toBe('session-2');
  });

  it('releases lock even when backend throws', async () => {
    const errorBackend: AgentBackend = {
      async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
        throw new Error('backend crash');
      },
      abort: vi.fn(),
    };
    const service = new AgentService({ ...defaultOpts, backend: errorBackend });

    const events = await collectEvents(
      service.handleRequest(makeRequest({ workingDirectory: '/project' })),
    );
    expect(events[0].type).toBe('error');

    // Lock should be released — next request should work
    const service2 = new AgentService({ ...defaultOpts, backend: makeBackend('ok') });
    // Use a new service since the lock is per-instance; actually we need same instance
    // Let's fix: use same service with a working backend
  });

  it('releases lock on error so next request proceeds', async () => {
    let callCount = 0;
    const backend: AgentBackend = {
      async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
        const base: AgentEventBase = {
          sessionId: req.sessionId, userId: req.userId,
          channelId: req.channelId, platform: req.platform,
        };
        callCount++;
        if (callCount === 1) {
          yield { ...base, type: 'error', error: 'first fails' };
        } else {
          yield { ...base, type: 'complete', response: 'second succeeds' };
        }
      },
      abort: vi.fn(),
    };

    const service = new AgentService({ ...defaultOpts, backend });

    const gen1 = service.handleRequest(makeRequest({
      sessionId: 'session-1',
      workingDirectory: '/project',
    }));
    // Consume first to completion
    await collectEvents(gen1);

    // Second should succeed (lock released)
    const events2 = await collectEvents(
      service.handleRequest(makeRequest({
        sessionId: 'session-2',
        workingDirectory: '/project',
      })),
    );
    expect(events2[0].type).toBe('complete');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run packages/agent/src/__tests__/agent-service.test.ts --reporter=verbose`
Expected: FAIL — directory conflict tests fail (no lock logic yet)

- [ ] **Step 4: Integrate DirectoryLock into AgentService**

In `packages/agent/src/agent-service.ts`:

Add import:
```typescript
import { DirectoryLock } from './session/directory-lock.js';
```

Add to class fields:
```typescript
  private readonly directoryLock = new DirectoryLock();
  private readonly directoryQueue = new Map<string, Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>>();
```

Update `handleRequest()` — insert directory lock check **after** rate limit check, **before** concurrency check:

```typescript
  async *handleRequest(request: AgentRequest): AsyncGenerator<AgentEvent> {
    const base: AgentEventBase = {
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };

    // Check rate limit
    if (!this.rateLimiter.tryAcquire(request.userId, request.permissionLevel)) {
      yield { ...base, type: 'error', error: 'rate limit exceeded' };
      return;
    }

    // Directory lock — wait if another session is using the same directory
    if (request.workingDirectory) {
      const lockResult = this.directoryLock.acquire(
        request.workingDirectory, request.sessionId, request.userId,
      );
      if (!lockResult.acquired) {
        // Notify about conflict
        if (this.eventBus) {
          void this.eventBus.publish('session.conflict', {
            userId: request.userId,
            sessionId: request.sessionId,
            channelId: request.channelId,
            platform: request.platform,
            workingDirectory: request.workingDirectory,
            conflictingSessionId: lockResult.heldBy?.sessionId,
          });
        }

        // Wait for lock to be released
        const acquired = await this.waitForDirectoryLock(request);
        if (!acquired) {
          yield { ...base, type: 'error', error: 'directory busy — request timed out' };
          return;
        }
      }
    }

    // Check concurrency — queue if at cap, reject if queue also full
    if (this.activeConcurrent >= this.maxConcurrent) {
      const queued = await this.tryEnqueue(request);
      if (!queued) {
        // Release directory lock if we acquired it
        if (request.workingDirectory) {
          this.directoryLock.release(request.workingDirectory, request.sessionId);
        }
        yield { ...base, type: 'error', error: 'server busy' };
        return;
      }
    }

    // Track session
    this.sessionManager.getOrCreate(request.sessionId);

    // Execute backend and yield events
    this.activeConcurrent += 1;
    try {
      for await (const event of this.backend.execute(request)) {
        if (this.eventBus !== undefined && (event.type === 'text' || event.type === 'tool_use')) {
          const progressPayload = {
            userId: event.userId,
            sessionId: event.sessionId,
            channelId: event.channelId,
            platform: event.platform,
            type: event.type as 'text' | 'tool_use',
            content: event.type === 'text' ? event.content : event.tool,
          };
          void this.eventBus.publish('agent.progress', progressPayload);
        }
        yield event;
      }
    } finally {
      this.activeConcurrent -= 1;
      // Release directory lock and drain directory queue
      if (request.workingDirectory) {
        this.directoryLock.release(request.workingDirectory, request.sessionId);
        this.drainDirectoryQueue(request.workingDirectory);
      }
      this.drainQueue();
    }
  }
```

Add helper methods:

```typescript
  private waitForDirectoryLock(request: AgentRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const dir = resolve(request.workingDirectory!);
      const entry = {
        resolve: () => {
          clearTimeout(entry.timer);
          // Try to acquire now
          const result = this.directoryLock.acquire(dir, request.sessionId, request.userId);
          resolve(result.acquired);
        },
        reject: () => resolve(false),
        timer: setTimeout(() => {
          // Remove from queue on timeout
          const queue = this.directoryQueue.get(dir);
          if (queue) {
            const idx = queue.indexOf(entry);
            if (idx !== -1) queue.splice(idx, 1);
            if (queue.length === 0) this.directoryQueue.delete(dir);
          }
          resolve(false);
        }, this.queueTimeoutSeconds * 1000),
      };

      if (!this.directoryQueue.has(dir)) {
        this.directoryQueue.set(dir, []);
      }
      this.directoryQueue.get(dir)!.push(entry);
    });
  }

  private drainDirectoryQueue(workingDirectory: string): void {
    const dir = resolve(workingDirectory);
    const queue = this.directoryQueue.get(dir);
    if (!queue || queue.length === 0) return;

    const next = queue.shift()!;
    if (queue.length === 0) this.directoryQueue.delete(dir);

    clearTimeout(next.timer);
    next.resolve();
  }
```

**IMPORTANT:** The `resolve` in `waitForDirectoryLock` shadows the outer `resolve` parameter. Rename the parameter:

```typescript
  private waitForDirectoryLock(request: AgentRequest): Promise<boolean> {
    return new Promise<boolean>((promiseResolve) => {
      const dir = require('node:path').resolve(request.workingDirectory!);
      // ... use promiseResolve instead of resolve
    });
  }
```

Also add the path import at top of file:
```typescript
import { resolve as resolvePath } from 'node:path';
```

And use `resolvePath` in both `waitForDirectoryLock` and `drainDirectoryQueue`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/agent/src/__tests__/agent-service.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 6: Build to verify**

Run: `npm run build -w packages/core -w packages/agent`
Expected: Clean build

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/agent-service.ts packages/core/src/types/events.ts packages/agent/src/__tests__/agent-service.test.ts
git commit -m "feat(agent): integrate DirectoryLock into AgentService for session conflict detection"
```

---

### Task 3: Gateway conflict notification

**Files:**
- Modify: `packages/gateway/src/gateway.ts`
- Test: `packages/gateway/src/__tests__/gateway.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/gateway/src/__tests__/gateway.test.ts` (read the file first for existing patterns):

```typescript
describe('session conflict notification', () => {
  it('sends notification when session.conflict event is published', async () => {
    // Setup gateway with adapter
    // ... (follow existing test patterns)

    // Publish session.conflict event
    await eventBus.publish('session.conflict', {
      userId: 'user-1',
      sessionId: 'session-1',
      channelId: 'dev',
      platform: 'discord',
      workingDirectory: '/project',
      conflictingSessionId: 'session-2',
    });

    // Verify adapter.sendText was called with notification
    expect(mockAdapter.sendText).toHaveBeenCalledWith(
      'dev',
      expect.stringContaining('queued'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/gateway/src/__tests__/gateway.test.ts --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Add subscription in Gateway constructor**

In `packages/gateway/src/gateway.ts`, update the constructor:

```typescript
  constructor(private deps: GatewayDeps) {
    // Subscribe to session conflict events for user notification
    deps.eventBus.subscribe('session.conflict', (event) => {
      const adapter = this.adapters.get(event.platform);
      if (adapter) {
        const msg = `Another session is using this directory — your request has been queued and will run when it's free.`;
        adapter.sendText(event.channelId, msg).catch((err) => {
          console.error(`[Gateway] Failed to send conflict notification:`, err);
        });
      }
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/gateway/src/__tests__/gateway.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/gateway.ts packages/gateway/src/__tests__/gateway.test.ts
git commit -m "feat(gateway): subscribe to session.conflict events for user notification"
```
