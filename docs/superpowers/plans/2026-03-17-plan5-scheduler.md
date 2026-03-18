# Plan 5: Scheduler — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scheduler system — cron jobs, heartbeat monitoring, webhook ingestion, and proactive message delivery — so CCBuddy can take autonomous actions on a schedule and in response to external events.

**Architecture:** One new package (`@ccbuddy/scheduler`) with four internal modules sharing a common pipeline: trigger (cron/heartbeat/webhook) -> agent request -> proactive message delivery. Dependencies are injected via `SchedulerDeps` — the package depends only on `@ccbuddy/core` types. The proactive sender is a closure built in `bootstrap.ts` that wraps gateway adapter calls. All config changes happen in `@ccbuddy/core`.

**Tech Stack:** TypeScript, node-cron (cron scheduling), luxon (timezone support for node-cron), Node `http` module (webhooks), Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-scheduler-design.md`

**Depends on:** Plans 1-4 (Core, Agent, Skills, Memory, Gateway, Platforms)

---

## File Structure

### Files to create:
- `packages/scheduler/package.json` — package manifest
- `packages/scheduler/tsconfig.json` — TypeScript config
- `packages/scheduler/src/index.ts` — public exports
- `packages/scheduler/src/types.ts` — ScheduledJob, TriggerResult, HealthCheckResult, SchedulerDeps
- `packages/scheduler/src/cron-runner.ts` — cron job registry and execution
- `packages/scheduler/src/heartbeat.ts` — health checks, state transitions, daily report
- `packages/scheduler/src/webhook-server.ts` — HTTP listener, signature verification, dispatch
- `packages/scheduler/src/scheduler-service.ts` — orchestrator (wires cron, heartbeat, webhooks)
- `packages/scheduler/src/__tests__/cron-runner.test.ts` — cron runner tests
- `packages/scheduler/src/__tests__/heartbeat.test.ts` — heartbeat tests
- `packages/scheduler/src/__tests__/webhook-server.test.ts` — webhook server tests
- `packages/scheduler/src/__tests__/scheduler-service.test.ts` — scheduler service integration tests

### Files to modify:
- `packages/core/src/config/schema.ts` — expand SchedulerConfig, HeartbeatConfig, WebhooksConfig, rate_limits, DEFAULT_CONFIG
- `packages/core/src/types/events.ts` — add MessageTarget, SchedulerJobCompleteEvent, EventMap entry
- `packages/core/src/types/index.ts` — re-export new types
- `packages/main/package.json` — add @ccbuddy/scheduler dependency
- `packages/main/src/bootstrap.ts` — wire scheduler into boot sequence, pass system rate limit to AgentService
- `config/default.yaml` — update webhook comments (handlers→endpoints), add scheduler example config

---

## Chunk 1: Core Type & Config Changes

### Task 1: Add MessageTarget and SchedulerJobCompleteEvent to core types

**Files:**
- Modify: `packages/core/src/types/events.ts`
- Modify: `packages/core/src/types/index.ts`

- [ ] **Step 1: Add MessageTarget interface to events.ts**

Add at the top of `packages/core/src/types/events.ts`, before the existing interfaces:

```typescript
export interface MessageTarget {
  platform: string;
  channel: string;
}
```

- [ ] **Step 2: Add SchedulerJobCompleteEvent interface**

Add after `AgentProgressEvent` in `packages/core/src/types/events.ts`:

```typescript
export interface SchedulerJobCompleteEvent {
  jobName: string;
  source: 'cron' | 'heartbeat' | 'webhook';
  success: boolean;
  target: MessageTarget;
  timestamp: number;
}
```

- [ ] **Step 3: Add to EventMap**

Add to the `EventMap` interface in `packages/core/src/types/events.ts`:

```typescript
'scheduler.job.complete': SchedulerJobCompleteEvent;
```

- [ ] **Step 4: Re-export new types from index.ts**

In `packages/core/src/types/index.ts`, ensure `MessageTarget` and `SchedulerJobCompleteEvent` are exported. The file should already re-export from `events.js` — verify that pattern covers the new types.

- [ ] **Step 5: Build core to verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run existing core tests to verify no breakage**

Run: `npx turbo test --filter=@ccbuddy/core`
Expected: All existing tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types/events.ts packages/core/src/types/index.ts
git commit -m "feat(core): add MessageTarget and SchedulerJobCompleteEvent types"
```

---

### Task 2: Expand config schema and DEFAULT_CONFIG

**Files:**
- Modify: `packages/core/src/config/schema.ts`

- [ ] **Step 1: Add system rate limit to AgentConfig**

In `packages/core/src/config/schema.ts`, modify the `rate_limits` field in `AgentConfig`:

```typescript
rate_limits: {
  admin: number;
  chat: number;
  system: number;
};
```

And in `DEFAULT_CONFIG.agent.rate_limits`, add:

```typescript
system: 20,
```

- [ ] **Step 2: Add MessageTarget import and expand SchedulerConfig**

Import `MessageTarget` from the types file at the top of schema.ts, then replace the existing `SchedulerConfig`:

```typescript
import type { MessageTarget } from '../types/events.js';

export interface ScheduledJobConfig {
  cron: string;
  prompt?: string;
  skill?: string;
  user: string;
  target?: MessageTarget;
  enabled?: boolean;
  permission_level?: 'admin' | 'system';
}

export interface SchedulerConfig {
  timezone: string;
  default_target?: MessageTarget;
  jobs?: Record<string, ScheduledJobConfig>;
}
```

- [ ] **Step 3: Expand HeartbeatConfig**

Replace the existing `HeartbeatConfig`:

```typescript
export interface HeartbeatConfig {
  interval_seconds: number;
  alert_target?: MessageTarget;
  daily_report_cron?: string;
  checks: {
    process: boolean;
    database: boolean;
    agent: boolean;
  };
}
```

Update `DEFAULT_CONFIG.heartbeat`:

```typescript
heartbeat: {
  interval_seconds: 60,
  checks: {
    process: true,
    database: true,
    agent: true,
  },
},
```

- [ ] **Step 4: Expand WebhooksConfig**

Replace `WebhookHandler` and `WebhooksConfig`:

```typescript
export interface WebhookEndpointConfig {
  path: string;
  secret_env?: string;
  signature_header?: string;
  signature_algorithm?: string;
  prompt_template: string;
  max_payload_chars?: number;
  user: string;
  target?: MessageTarget;
  enabled?: boolean;
}

export interface WebhooksConfig {
  enabled: boolean;
  port: number;
  endpoints?: Record<string, WebhookEndpointConfig>;
}
```

Remove the old `WebhookHandler` interface entirely. Update `DEFAULT_CONFIG.webhooks` — the existing default is fine (enabled: false, port: 18800), no changes needed.

- [ ] **Step 5: Build core to verify types compile**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run existing core tests**

Run: `npx turbo test --filter=@ccbuddy/core`
Expected: All existing tests pass

- [ ] **Step 7: Also build downstream packages to check nothing breaks**

Run: `npx turbo build`
Expected: All packages build cleanly. If any downstream code references the old `WebhookHandler` type, fix those references.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/schema.ts
git commit -m "feat(core): expand config types for scheduler, heartbeat, webhooks"
```

---

## Chunk 2: Package Scaffold & Types

### Task 3: Create @ccbuddy/scheduler package with types

**Files:**
- Create: `packages/scheduler/package.json`
- Create: `packages/scheduler/tsconfig.json`
- Create: `packages/scheduler/src/types.ts`
- Create: `packages/scheduler/src/index.ts`

- [ ] **Step 1: Create package.json**

Create `packages/scheduler/package.json`:

```json
{
  "name": "@ccbuddy/scheduler",
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
    "node-cron": "^3"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/node-cron": "^3",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/scheduler/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Create types.ts**

Create `packages/scheduler/src/types.ts`:

```typescript
import type {
  MessageTarget,
  EventBus,
  AgentRequest,
  AgentEvent,
  CCBuddyConfig,
} from '@ccbuddy/core';

export interface ScheduledJob {
  name: string;
  cron: string;
  type: 'prompt' | 'skill';
  payload: string;
  user: string;
  target: MessageTarget;
  permissionLevel: 'admin' | 'system';
  enabled: boolean;
  nextRun: number;
  lastRun?: number;
  running: boolean;
}

export interface TriggerResult {
  source: 'cron' | 'heartbeat' | 'webhook';
  name: string;
  response: string;
  target: MessageTarget;
  timestamp: number;
}

export interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  message?: string;
  durationMs: number;
}

export interface SchedulerDeps {
  config: CCBuddyConfig;
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  runSkill?: (name: string, input: Record<string, unknown>) => Promise<string>;
  checkDatabase: () => Promise<boolean>;
  checkAgent: () => Promise<{ reachable: boolean; durationMs: number }>;
}

export type { MessageTarget };
```

- [ ] **Step 4: Create index.ts**

Create `packages/scheduler/src/index.ts`:

```typescript
export type {
  ScheduledJob,
  TriggerResult,
  HealthCheckResult,
  SchedulerDeps,
} from './types.js';
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: node-cron installed, workspace links created

- [ ] **Step 6: Build scheduler to verify types compile**

Run: `npx turbo build --filter=@ccbuddy/scheduler`
Expected: Builds cleanly

- [ ] **Step 7: Commit**

```bash
git add packages/scheduler/
git commit -m "feat(scheduler): scaffold package with types"
```

---

## Chunk 3: Cron Runner

### Task 4: Cron runner — job registration and execution

**Files:**
- Create: `packages/scheduler/src/__tests__/cron-runner.test.ts`
- Create: `packages/scheduler/src/cron-runner.ts`

- [ ] **Step 1: Write failing tests for job registration and prompt execution**

Create `packages/scheduler/src/__tests__/cron-runner.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CronRunner } from '../cron-runner.js';
import type { ScheduledJob } from '../types.js';
import type { MessageTarget, AgentRequest, AgentEvent } from '@ccbuddy/core';

// Mock node-cron
vi.mock('node-cron', () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
  validate: vi.fn(() => true),
}));

function createMockDeps() {
  const sentMessages: { target: MessageTarget; text: string }[] = [];
  const executedRequests: AgentRequest[] = [];

  async function* mockExecute(request: AgentRequest): AsyncGenerator<AgentEvent> {
    executedRequests.push(request);
    yield {
      type: 'complete' as const,
      response: `Response to: ${request.prompt}`,
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };
  }

  return {
    executeAgentRequest: vi.fn(mockExecute),
    sendProactiveMessage: vi.fn(async (target: MessageTarget, text: string) => {
      sentMessages.push({ target, text });
    }),
    runSkill: vi.fn(async (name: string) => `Skill ${name} result`),
    eventBus: {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    sentMessages,
    executedRequests,
  };
}

describe('CronRunner', () => {
  let runner: CronRunner;
  let deps: ReturnType<typeof createMockDeps>;
  const nodeCron = vi.mocked(await import('node-cron'));

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  afterEach(async () => {
    if (runner) await runner.stop();
  });

  describe('registerJob', () => {
    it('registers a job with node-cron', () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'test-job',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Hello world',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      runner.registerJob(job);

      expect(nodeCron.schedule).toHaveBeenCalledWith(
        '0 8 * * *',
        expect.any(Function),
        expect.objectContaining({ timezone: 'UTC' }),
      );
    });

    it('skips disabled jobs', () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'disabled-job',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Hello',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: false,
        nextRun: 0,
        running: false,
      };

      runner.registerJob(job);

      expect(nodeCron.schedule).not.toHaveBeenCalled();
    });
  });

  describe('executeJob', () => {
    it('executes a prompt job and sends the response', async () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'test-prompt',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Give me a briefing',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      await runner.executeJob(job);

      expect(deps.executeAgentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Give me a briefing',
          userId: 'testuser',
          sessionId: expect.stringContaining('scheduler:cron:test-prompt'),
          platform: 'discord',
          channelId: '123',
          permissionLevel: 'system',
        }),
      );

      expect(deps.sendProactiveMessage).toHaveBeenCalledWith(
        { platform: 'discord', channel: '123' },
        'Response to: Give me a briefing',
      );
    });

    it('executes a skill job using runSkill', async () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        runSkill: deps.runSkill,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'test-skill',
        cron: '0 8 * * *',
        type: 'skill',
        payload: 'check-backups',
        user: 'testuser',
        target: { platform: 'discord', channel: '456' },
        permissionLevel: 'admin',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      await runner.executeJob(job);

      expect(deps.runSkill).toHaveBeenCalledWith('check-backups', {});
      expect(deps.sendProactiveMessage).toHaveBeenCalledWith(
        { platform: 'discord', channel: '456' },
        'Skill check-backups result',
      );
    });

    it('publishes scheduler.job.complete event on success', async () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'test-event',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Hello',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      await runner.executeJob(job);

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'scheduler.job.complete',
        expect.objectContaining({
          jobName: 'test-event',
          source: 'cron',
          success: true,
        }),
      );
    });
  });

  describe('skip-if-running', () => {
    it('skips execution if the job is already running', async () => {
      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'running-job',
        cron: '* * * * *',
        type: 'prompt',
        payload: 'Hello',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: true, // already running
      };

      await runner.executeJob(job);

      expect(deps.executeAgentRequest).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('sends error message on job failure and publishes failure event', async () => {
      const failingExecute = vi.fn(async function* () {
        yield {
          type: 'error' as const,
          error: 'Agent failed',
          sessionId: 'test',
          userId: 'test',
          channelId: '123',
          platform: 'discord',
        };
      });

      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: failingExecute as any,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      const job: ScheduledJob = {
        name: 'failing-job',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Hello',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      await runner.executeJob(job);

      expect(deps.sendProactiveMessage).toHaveBeenCalledWith(
        { platform: 'discord', channel: '123' },
        expect.stringContaining('failing-job'),
      );

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'scheduler.job.complete',
        expect.objectContaining({
          jobName: 'failing-job',
          success: false,
        }),
      );
    });
  });

  describe('stop', () => {
    it('stops all registered cron tasks', async () => {
      const mockTask = { stop: vi.fn() };
      nodeCron.schedule.mockReturnValue(mockTask as any);

      runner = new CronRunner({
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
        timezone: 'UTC',
      });

      runner.registerJob({
        name: 'job1',
        cron: '0 8 * * *',
        type: 'prompt',
        payload: 'Hello',
        user: 'testuser',
        target: { platform: 'discord', channel: '123' },
        permissionLevel: 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      });

      await runner.stop();

      expect(mockTask.stop).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo test --filter=@ccbuddy/scheduler`
Expected: FAIL — `cron-runner.ts` does not exist

- [ ] **Step 3: Implement cron-runner.ts**

Create `packages/scheduler/src/cron-runner.ts`:

```typescript
import cron from 'node-cron';
import type { EventBus, AgentRequest, AgentEvent, MessageTarget } from '@ccbuddy/core';
import type { ScheduledJob } from './types.js';

export interface CronRunnerOptions {
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  runSkill?: (name: string, input: Record<string, unknown>) => Promise<string>;
  timezone: string;
}

export class CronRunner {
  private tasks: cron.ScheduledTask[] = [];
  private jobs = new Map<string, ScheduledJob>();
  private readonly options: CronRunnerOptions;

  constructor(options: CronRunnerOptions) {
    this.options = options;
  }

  registerJob(job: ScheduledJob): void {
    if (!job.enabled) return;

    this.jobs.set(job.name, job);

    const task = cron.schedule(
      job.cron,
      () => {
        this.executeJob(job).catch((err) => {
          console.error(`[Scheduler] Unexpected error in job '${job.name}':`, err);
        });
      },
      { timezone: this.options.timezone },
    );

    this.tasks.push(task);
  }

  async executeJob(job: ScheduledJob): Promise<void> {
    if (job.running) {
      console.log(`[Scheduler] Skipping job '${job.name}' — still running from previous tick`);
      return;
    }

    job.running = true;
    const startTime = Date.now();

    try {
      let response: string;

      if (job.type === 'skill' && this.options.runSkill) {
        response = await this.options.runSkill(job.payload, {});
      } else {
        response = await this.executePromptJob(job);
      }

      await this.options.sendProactiveMessage(job.target, response);

      await this.options.eventBus.publish('scheduler.job.complete', {
        jobName: job.name,
        source: 'cron' as const,
        success: true,
        target: job.target,
        timestamp: Date.now(),
      });

      job.lastRun = Date.now();
      console.log(`[Scheduler] Job '${job.name}' completed in ${Date.now() - startTime}ms`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Scheduler] Job '${job.name}' failed:`, errorMsg);

      await this.options.sendProactiveMessage(
        job.target,
        `[Scheduler] Job '${job.name}' failed: ${errorMsg}`,
      ).catch(() => {}); // best-effort alert

      await this.options.eventBus.publish('scheduler.job.complete', {
        jobName: job.name,
        source: 'cron' as const,
        success: false,
        target: job.target,
        timestamp: Date.now(),
      });
    } finally {
      job.running = false;
    }
  }

  private async executePromptJob(job: ScheduledJob): Promise<string> {
    const request: AgentRequest = {
      prompt: job.payload,
      userId: job.user,
      sessionId: `scheduler:cron:${job.name}:${Date.now()}`,
      channelId: job.target.channel,
      platform: job.target.platform,
      permissionLevel: job.permissionLevel,
    };

    const generator = this.options.executeAgentRequest(request);
    let finalResponse = '';

    for await (const event of generator) {
      if (event.type === 'complete') {
        finalResponse = (event as any).response ?? '';
      } else if (event.type === 'error') {
        throw new Error((event as any).error ?? 'Agent execution failed');
      }
    }

    return finalResponse;
  }

  async stop(): Promise<void> {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
    this.jobs.clear();
  }
}
```

- [ ] **Step 4: Export CronRunner from index.ts**

Update `packages/scheduler/src/index.ts`:

```typescript
export type {
  ScheduledJob,
  TriggerResult,
  HealthCheckResult,
  SchedulerDeps,
} from './types.js';

export { CronRunner } from './cron-runner.js';
```

- [ ] **Step 5: Build and run tests**

Run: `npx turbo build --filter=@ccbuddy/scheduler && npx turbo test --filter=@ccbuddy/scheduler`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/
git commit -m "feat(scheduler): implement cron runner with TDD"
```

---

## Chunk 4: Heartbeat Monitor

### Task 5: Heartbeat — health checks and state transition alerts

**Files:**
- Create: `packages/scheduler/src/__tests__/heartbeat.test.ts`
- Create: `packages/scheduler/src/heartbeat.ts`

- [ ] **Step 1: Write failing tests for heartbeat**

Create `packages/scheduler/src/__tests__/heartbeat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatMonitor } from '../heartbeat.js';
import type { MessageTarget } from '@ccbuddy/core';

function createMockDeps() {
  return {
    eventBus: {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    sendProactiveMessage: vi.fn(async () => {}),
    checkDatabase: vi.fn(async () => true),
    checkAgent: vi.fn(async (): Promise<{ reachable: boolean; durationMs: number }> => ({
      reachable: true,
      durationMs: 100,
    })),
  };
}

describe('HeartbeatMonitor', () => {
  let monitor: HeartbeatMonitor;
  let deps: ReturnType<typeof createMockDeps>;

  const alertTarget: MessageTarget = { platform: 'discord', channel: '123' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    deps = createMockDeps();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (monitor) monitor.stop();
  });

  describe('runChecks', () => {
    it('publishes heartbeat.status event with all healthy checks', async () => {
      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: true, database: true, agent: true },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      await monitor.runChecks();

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'heartbeat.status',
        expect.objectContaining({
          modules: expect.objectContaining({
            process: 'healthy',
            database: 'healthy',
            agent: 'healthy',
          }),
        }),
      );
    });

    it('detects database failure', async () => {
      deps.checkDatabase.mockRejectedValue(new Error('SQLITE_CANTOPEN'));

      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: true, database: true, agent: true },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      await monitor.runChecks();

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'heartbeat.status',
        expect.objectContaining({
          modules: expect.objectContaining({
            database: 'down',
          }),
        }),
      );
    });

    it('detects slow agent as degraded', async () => {
      deps.checkAgent.mockResolvedValue({ reachable: true, durationMs: 6000 });

      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: true, database: true, agent: true },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      await monitor.runChecks();

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'heartbeat.status',
        expect.objectContaining({
          modules: expect.objectContaining({
            agent: 'degraded',
          }),
        }),
      );
    });
  });

  describe('state transitions', () => {
    it('alerts on transition from healthy to down', async () => {
      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: false, database: true, agent: false },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      // First check: healthy — previousStatus was initialized to healthy, so no transition
      await monitor.runChecks();
      expect(deps.sendProactiveMessage).not.toHaveBeenCalled();

      // Second check: database fails — transition from healthy to down
      deps.checkDatabase.mockRejectedValue(new Error('DB error'));
      await monitor.runChecks();

      expect(deps.sendProactiveMessage).toHaveBeenCalledWith(
        alertTarget,
        expect.stringContaining('database'),
      );

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'alert.health',
        expect.objectContaining({
          module: 'database',
          status: 'down',
        }),
      );
    });

    it('does not alert repeatedly for same state', async () => {
      deps.checkDatabase.mockRejectedValue(new Error('DB error'));

      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: false, database: true, agent: false },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      await monitor.runChecks(); // first: transition to down — alerts
      await monitor.runChecks(); // second: still down — no alert

      // sendProactiveMessage called once for the transition, not twice
      expect(deps.sendProactiveMessage).toHaveBeenCalledTimes(1);
    });

    it('sends recovery alert when check returns to healthy', async () => {
      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: false, database: true, agent: false },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      // Healthy
      await monitor.runChecks();
      // Down
      deps.checkDatabase.mockRejectedValue(new Error('DB error'));
      await monitor.runChecks();
      // Recovery
      deps.checkDatabase.mockResolvedValue(true);
      await monitor.runChecks();

      // Two alerts: one for down, one for recovery
      expect(deps.sendProactiveMessage).toHaveBeenCalledTimes(2);
      expect(deps.sendProactiveMessage).toHaveBeenLastCalledWith(
        alertTarget,
        expect.stringContaining('recovered'),
      );
    });
  });

  describe('skips disabled checks', () => {
    it('only runs enabled checks', async () => {
      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: false, database: true, agent: false },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      await monitor.runChecks();

      expect(deps.checkDatabase).toHaveBeenCalled();
      expect(deps.checkAgent).not.toHaveBeenCalled();
    });
  });

  describe('start/stop', () => {
    it('starts and stops the interval', () => {
      monitor = new HeartbeatMonitor({
        eventBus: deps.eventBus,
        sendProactiveMessage: deps.sendProactiveMessage,
        alertTarget,
        intervalSeconds: 60,
        checks: { process: true, database: true, agent: true },
        checkDatabase: deps.checkDatabase,
        checkAgent: deps.checkAgent,
      });

      monitor.start();

      // Advance timer — should trigger runChecks
      vi.advanceTimersByTime(60_000);

      monitor.stop();

      // After stop, advancing timer should not trigger
      deps.eventBus.publish.mockClear();
      vi.advanceTimersByTime(60_000);
      expect(deps.eventBus.publish).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo test --filter=@ccbuddy/scheduler`
Expected: FAIL — `heartbeat.ts` does not exist

- [ ] **Step 3: Implement heartbeat.ts**

Create `packages/scheduler/src/heartbeat.ts`:

```typescript
import * as os from 'node:os';
import type { EventBus, MessageTarget } from '@ccbuddy/core';

type CheckStatus = 'healthy' | 'degraded' | 'down';

export interface HeartbeatOptions {
  eventBus: EventBus;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  alertTarget?: MessageTarget;
  intervalSeconds: number;
  checks: { process: boolean; database: boolean; agent: boolean };
  checkDatabase: () => Promise<boolean>;
  checkAgent: () => Promise<{ reachable: boolean; durationMs: number }>;
  dailyReportCron?: string;
}

export class HeartbeatMonitor {
  private interval: ReturnType<typeof setInterval> | null = null;
  private dailyReportTimer: ReturnType<typeof setTimeout> | null = null;
  private previousStatus: Record<string, CheckStatus>;
  private readonly startTime = Date.now();
  private readonly options: HeartbeatOptions;

  constructor(options: HeartbeatOptions) {
    this.options = options;
    // Initialize all enabled checks as 'healthy' so the first detection of
    // a non-healthy state triggers an alert immediately
    this.previousStatus = {};
    if (options.checks.process) this.previousStatus.process = 'healthy';
    if (options.checks.database) this.previousStatus.database = 'healthy';
    if (options.checks.agent) this.previousStatus.agent = 'healthy';
  }

  start(): void {
    this.interval = setInterval(() => {
      this.runChecks().catch((err) => {
        console.error('[Heartbeat] Unexpected error during health checks:', err);
      });
    }, this.options.intervalSeconds * 1000);

    // Schedule daily report if configured (independent setTimeout-based scheduler)
    if (this.options.dailyReportCron && this.options.alertTarget) {
      this.scheduleDailyReport();
    }
  }

  private scheduleDailyReport(): void {
    // Parse cron to find next run time, then use setTimeout
    // For simplicity, use a fixed 24h interval aligned to the configured hour
    const cronParts = this.options.dailyReportCron?.split(' ') ?? [];
    const minute = parseInt(cronParts[0] ?? '0', 10);
    const hour = parseInt(cronParts[1] ?? '9', 10);

    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delayMs = next.getTime() - now.getTime();
    this.dailyReportTimer = setTimeout(() => {
      this.sendDailyReport().catch((err) => {
        console.error('[Heartbeat] Daily report error:', err);
      });
      // Re-schedule for next day
      this.scheduleDailyReport();
    }, delayMs);
  }

  private async sendDailyReport(): Promise<void> {
    if (!this.options.alertTarget) return;

    // Only send if all checks are healthy
    const allHealthy = Object.values(this.previousStatus).every((s) => s === 'healthy');
    if (!allHealthy) return;

    const uptimeMs = Date.now() - this.startTime;
    const uptimeHours = Math.round(uptimeMs / (1000 * 60 * 60));
    const memMb = Math.round(process.memoryUsage().rss / (1024 * 1024));

    const report = [
      '[Heartbeat] Daily Report — All Systems Nominal',
      `Uptime: ${uptimeHours}h`,
      `Memory: ${memMb}MB RSS`,
      `Checks: ${Object.entries(this.previousStatus).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    ].join('\n');

    await this.options.sendProactiveMessage(this.options.alertTarget, report);
    console.log('[Heartbeat] Daily report sent');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.dailyReportTimer) {
      clearTimeout(this.dailyReportTimer);
      this.dailyReportTimer = null;
    }
  }

  async runChecks(): Promise<void> {
    const modules: Record<string, CheckStatus> = {};
    const system = { cpuPercent: 0, memoryPercent: 0, diskPercent: 0 };

    // Process check
    if (this.options.checks.process) {
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const rss = memUsage.rss;
      system.memoryPercent = Math.round((rss / totalMem) * 100);

      const cpus = os.cpus();
      if (cpus.length > 0) {
        const totalIdle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
        const totalTick = cpus.reduce(
          (sum, cpu) => sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
          0,
        );
        system.cpuPercent = totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0;
      }

      modules.process = rss > 512 * 1024 * 1024 ? 'degraded' : 'healthy';
    }

    // Database check
    if (this.options.checks.database) {
      try {
        await this.options.checkDatabase();
        modules.database = 'healthy';
      } catch {
        modules.database = 'down';
      }
    }

    // Agent check
    if (this.options.checks.agent) {
      try {
        const result = await this.options.checkAgent();
        if (!result.reachable) {
          modules.agent = 'down';
        } else if (result.durationMs > 5000) {
          modules.agent = 'degraded';
        } else {
          modules.agent = 'healthy';
        }
      } catch {
        modules.agent = 'down';
      }
    }

    // Publish heartbeat.status event
    await this.options.eventBus.publish('heartbeat.status', {
      modules,
      system,
      timestamp: Date.now(),
    });

    // Check for state transitions and alert
    await this.checkTransitions(modules);

    // Update previous status
    this.previousStatus = { ...modules };
  }

  private async checkTransitions(current: Record<string, CheckStatus>): Promise<void> {
    if (!this.options.alertTarget) return;

    for (const [module, status] of Object.entries(current)) {
      const prev = this.previousStatus[module];

      // No previous state — first run, no alert
      if (prev === undefined) continue;

      // Transition to degraded or down
      if (prev === 'healthy' && (status === 'degraded' || status === 'down')) {
        await this.options.eventBus.publish('alert.health', {
          module,
          status,
          message: `${module} is ${status}`,
          timestamp: Date.now(),
        });

        await this.options.sendProactiveMessage(
          this.options.alertTarget,
          `[Heartbeat] ${module} is ${status}`,
        ).catch(() => {});
      } else if (status === 'down' && prev === 'degraded') {
        await this.options.eventBus.publish('alert.health', {
          module,
          status: 'down',
          message: `${module} transitioned from degraded to down`,
          timestamp: Date.now(),
        });

        await this.options.sendProactiveMessage(
          this.options.alertTarget,
          `[Heartbeat] ${module} is now down (was degraded)`,
        ).catch(() => {});
      } else if ((prev === 'degraded' || prev === 'down') && status === 'healthy') {
        // Recovery
        await this.options.sendProactiveMessage(
          this.options.alertTarget,
          `[Heartbeat] ${module} has recovered to healthy`,
        ).catch(() => {});
      }
    }
  }
}
```

- [ ] **Step 4: Export HeartbeatMonitor from index.ts**

Add to `packages/scheduler/src/index.ts`:

```typescript
export { HeartbeatMonitor } from './heartbeat.js';
```

- [ ] **Step 5: Build and run tests**

Run: `npx turbo build --filter=@ccbuddy/scheduler && npx turbo test --filter=@ccbuddy/scheduler`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/
git commit -m "feat(scheduler): implement heartbeat monitor with TDD"
```

---

## Chunk 5: Webhook Server

### Task 6: Webhook server — HTTP listener with signature verification

**Files:**
- Create: `packages/scheduler/src/__tests__/webhook-server.test.ts`
- Create: `packages/scheduler/src/webhook-server.ts`

- [ ] **Step 1: Write failing tests for webhook server**

Create `packages/scheduler/src/__tests__/webhook-server.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { WebhookServer } from '../webhook-server.js';
import type { MessageTarget, AgentRequest, AgentEvent } from '@ccbuddy/core';

function makeRequest(
  port: number,
  path: string,
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode!, body: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function createMockDeps() {
  const sentMessages: { target: MessageTarget; text: string }[] = [];

  async function* mockExecute(request: AgentRequest): AsyncGenerator<AgentEvent> {
    yield {
      type: 'complete' as const,
      response: `Processed: ${request.prompt.substring(0, 50)}`,
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };
  }

  return {
    executeAgentRequest: vi.fn(mockExecute),
    sendProactiveMessage: vi.fn(async (target: MessageTarget, text: string) => {
      sentMessages.push({ target, text });
    }),
    eventBus: {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    sentMessages,
  };
}

describe('WebhookServer', () => {
  let server: WebhookServer;
  let deps: ReturnType<typeof createMockDeps>;
  const port = 19900 + Math.floor(Math.random() * 100); // avoid port conflicts

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  afterEach(async () => {
    if (server) await server.stop();
  });

  describe('routing', () => {
    it('returns 404 for unknown paths', async () => {
      server = new WebhookServer({
        port,
        endpoints: {},
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/unknown', '{}');
      expect(res.statusCode).toBe(404);
    });

    it('returns 405 for non-POST methods', async () => {
      server = new WebhookServer({
        port,
        endpoints: {
          test: {
            path: '/webhooks/test',
            prompt_template: '{{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/webhooks/test', '{}', {}, 'GET');
      expect(res.statusCode).toBe(405);
    });

    it('routes POST to matching endpoint and returns 200', async () => {
      server = new WebhookServer({
        port,
        endpoints: {
          test: {
            path: '/webhooks/test',
            prompt_template: 'Event: {{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/webhooks/test', '{"action":"push"}');
      expect(res.statusCode).toBe(200);
    });
  });

  describe('signature verification', () => {
    it('returns 401 when signature is invalid', async () => {
      process.env.TEST_WEBHOOK_SECRET = 'mysecret';

      server = new WebhookServer({
        port,
        endpoints: {
          github: {
            path: '/webhooks/github',
            secret_env: 'TEST_WEBHOOK_SECRET',
            signature_header: 'x-hub-signature-256',
            signature_algorithm: 'sha256',
            prompt_template: '{{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/webhooks/github', '{"test":true}', {
        'x-hub-signature-256': 'sha256=invalid',
      });
      expect(res.statusCode).toBe(401);

      delete process.env.TEST_WEBHOOK_SECRET;
    });

    it('accepts valid signature', async () => {
      const secret = 'mysecret';
      process.env.TEST_WEBHOOK_SECRET2 = secret;
      const body = '{"test":true}';
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

      server = new WebhookServer({
        port,
        endpoints: {
          github: {
            path: '/webhooks/github',
            secret_env: 'TEST_WEBHOOK_SECRET2',
            signature_header: 'x-hub-signature-256',
            signature_algorithm: 'sha256',
            prompt_template: '{{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/webhooks/github', body, {
        'x-hub-signature-256': sig,
      });
      expect(res.statusCode).toBe(200);

      delete process.env.TEST_WEBHOOK_SECRET2;
    });
  });

  describe('template rendering', () => {
    it('renders {{payload}} and {{endpoint}} in prompt template', async () => {
      server = new WebhookServer({
        port,
        endpoints: {
          github: {
            path: '/webhooks/github',
            prompt_template: 'Source: {{endpoint}}\nData: {{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      await makeRequest(port, '/webhooks/github', '{"action":"opened"}');

      // Wait briefly for async dispatch
      await new Promise((r) => setTimeout(r, 100));

      expect(deps.executeAgentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Source: github'),
        }),
      );

      expect(deps.executeAgentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('{"action":"opened"}'),
        }),
      );
    });

    it('truncates payload to max_payload_chars', async () => {
      const largePayload = JSON.stringify({ data: 'x'.repeat(200) });

      server = new WebhookServer({
        port,
        endpoints: {
          test: {
            path: '/webhooks/test',
            prompt_template: '{{payload}}',
            max_payload_chars: 50,
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      await makeRequest(port, '/webhooks/test', largePayload);
      await new Promise((r) => setTimeout(r, 100));

      const call = deps.executeAgentRequest.mock.calls[0]?.[0];
      expect(call?.prompt.length).toBeLessThanOrEqual(55); // 50 chars + possible truncation marker
    });
  });

  describe('error responses', () => {
    it('returns 400 for invalid JSON', async () => {
      server = new WebhookServer({
        port,
        endpoints: {
          test: {
            path: '/webhooks/test',
            prompt_template: '{{payload}}',
            user: 'testuser',
            target: { platform: 'discord', channel: '123' },
          },
        },
        eventBus: deps.eventBus,
        executeAgentRequest: deps.executeAgentRequest,
        sendProactiveMessage: deps.sendProactiveMessage,
      });
      await server.start();

      const res = await makeRequest(port, '/webhooks/test', 'not json{{{');
      expect(res.statusCode).toBe(400);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo test --filter=@ccbuddy/scheduler`
Expected: FAIL — `webhook-server.ts` does not exist

- [ ] **Step 3: Implement webhook-server.ts**

Create `packages/scheduler/src/webhook-server.ts`:

```typescript
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type { EventBus, AgentRequest, AgentEvent, MessageTarget } from '@ccbuddy/core';

export interface WebhookEndpoint {
  path: string;
  secret_env?: string;
  signature_header?: string;
  signature_algorithm?: string;
  prompt_template: string;
  max_payload_chars?: number;
  user: string;
  target: MessageTarget;
}

export interface WebhookServerOptions {
  port: number;
  endpoints: Record<string, WebhookEndpoint>;
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB
const DEFAULT_MAX_PAYLOAD_CHARS = 50000;

export class WebhookServer {
  private server: http.Server | null = null;
  private readonly pathMap = new Map<string, { name: string; endpoint: WebhookEndpoint }>();
  private readonly options: WebhookServerOptions;

  constructor(options: WebhookServerOptions) {
    this.options = options;

    for (const [name, endpoint] of Object.entries(options.endpoints)) {
      this.pathMap.set(endpoint.path, { name, endpoint });
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          console.error('[Webhook] Unexpected error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal Server Error');
          }
        });
      });

      this.server.listen(this.options.port, '127.0.0.1', () => {
        console.log(`[Webhook] Listening on port ${this.options.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const entry = this.pathMap.get(req.url ?? '');

    if (!entry) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    // Read body
    const bodyBuffer = await this.readBody(req);
    if (!bodyBuffer) {
      res.writeHead(413);
      res.end('Payload Too Large');
      return;
    }

    const rawBody = bodyBuffer.toString('utf-8');

    // Verify signature if configured
    if (entry.endpoint.secret_env) {
      const valid = this.verifySignature(entry.endpoint, rawBody, req.headers);
      if (!valid) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
      }
    }

    // Parse JSON
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      res.writeHead(400);
      res.end('Bad Request: Invalid JSON');
      return;
    }

    // Return 200 immediately — dispatch is async
    res.writeHead(200);
    res.end('OK');

    // Dispatch asynchronously
    this.dispatch(entry.name, entry.endpoint, rawBody, req.headers).catch((err) => {
      console.error(`[Webhook] Dispatch error for '${entry.name}':`, err);
    });
  }

  private async dispatch(
    name: string,
    endpoint: WebhookEndpoint,
    rawBody: string,
    headers: http.IncomingHttpHeaders,
  ): Promise<void> {
    const maxChars = endpoint.max_payload_chars ?? DEFAULT_MAX_PAYLOAD_CHARS;
    const truncatedPayload =
      rawBody.length > maxChars ? rawBody.substring(0, maxChars) + '...[truncated]' : rawBody;

    const eventType = String(headers['x-github-event'] ?? headers['x-event-type'] ?? 'unknown');

    const prompt = endpoint.prompt_template
      .replace(/\{\{payload\}\}/g, truncatedPayload)
      .replace(/\{\{event_type\}\}/g, eventType)
      .replace(/\{\{endpoint\}\}/g, name);

    const request: AgentRequest = {
      prompt,
      userId: endpoint.user,
      sessionId: `scheduler:webhook:${name}:${Date.now()}`,
      channelId: endpoint.target.channel,
      platform: endpoint.target.platform,
      permissionLevel: 'system',
    };

    // Publish webhook.received event
    await this.options.eventBus.publish('webhook.received', {
      handler: name,
      userId: endpoint.user,
      payload: rawBody,
      promptTemplate: endpoint.prompt_template,
      timestamp: Date.now(),
    });

    try {
      const generator = this.options.executeAgentRequest(request);
      let finalResponse = '';

      for await (const event of generator) {
        if (event.type === 'complete') {
          finalResponse = (event as any).response ?? '';
        } else if (event.type === 'error') {
          throw new Error((event as any).error ?? 'Agent execution failed');
        }
      }

      await this.options.sendProactiveMessage(endpoint.target, finalResponse);

      await this.options.eventBus.publish('scheduler.job.complete', {
        jobName: name,
        source: 'webhook' as const,
        success: true,
        target: endpoint.target,
        timestamp: Date.now(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Webhook] Job '${name}' failed:`, errorMsg);

      await this.options.sendProactiveMessage(
        endpoint.target,
        `[Webhook] Handler '${name}' failed: ${errorMsg}`,
      ).catch(() => {});

      await this.options.eventBus.publish('scheduler.job.complete', {
        jobName: name,
        source: 'webhook' as const,
        success: false,
        target: endpoint.target,
        timestamp: Date.now(),
      });
    }
  }

  private verifySignature(
    endpoint: WebhookEndpoint,
    rawBody: string,
    headers: http.IncomingHttpHeaders,
  ): boolean {
    const secret = process.env[endpoint.secret_env!];
    if (!secret) {
      console.warn(`[Webhook] Secret env var '${endpoint.secret_env}' not set`);
      return false;
    }

    const sigHeader = headers[endpoint.signature_header?.toLowerCase() ?? ''];
    if (!sigHeader || typeof sigHeader !== 'string') return false;

    const algorithm = endpoint.signature_algorithm ?? 'sha256';
    const expected = algorithm + '=' + crypto.createHmac(algorithm, secret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
    } catch {
      return false; // length mismatch
    }
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          resolve(null);
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(null));
    });
  }
}
```

- [ ] **Step 4: Export WebhookServer from index.ts**

Add to `packages/scheduler/src/index.ts`:

```typescript
export { WebhookServer } from './webhook-server.js';
```

- [ ] **Step 5: Build and run tests**

Run: `npx turbo build --filter=@ccbuddy/scheduler && npx turbo test --filter=@ccbuddy/scheduler`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/
git commit -m "feat(scheduler): implement webhook server with TDD"
```

---

## Chunk 6: Scheduler Service & Bootstrap Integration

### Task 7: Scheduler service — orchestrator

**Files:**
- Create: `packages/scheduler/src/__tests__/scheduler-service.test.ts`
- Create: `packages/scheduler/src/scheduler-service.ts`

- [ ] **Step 1: Write failing tests for scheduler service**

Create `packages/scheduler/src/__tests__/scheduler-service.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SchedulerService } from '../scheduler-service.js';
import type { MessageTarget, AgentEvent, AgentRequest, CCBuddyConfig } from '@ccbuddy/core';

// Mock node-cron
vi.mock('node-cron', () => ({
  schedule: vi.fn(() => ({
    stop: vi.fn(),
  })),
  validate: vi.fn(() => true),
}));

function createMinimalConfig(overrides: Partial<CCBuddyConfig> = {}): CCBuddyConfig {
  return {
    data_dir: './data',
    log_level: 'info',
    agent: {
      backend: 'cli',
      max_concurrent_sessions: 3,
      session_timeout_minutes: 30,
      queue_max_depth: 10,
      queue_timeout_seconds: 120,
      rate_limits: { admin: 30, chat: 10, system: 20 },
      default_working_directory: '~',
      admin_skip_permissions: true,
      session_cleanup_hours: 24,
      pending_input_timeout_minutes: 10,
      graceful_shutdown_timeout_seconds: 30,
    },
    memory: {
      db_path: './data/memory.sqlite',
      max_context_tokens: 100000,
      context_threshold: 0.75,
      fresh_tail_count: 32,
      leaf_chunk_tokens: 20000,
      leaf_target_tokens: 1200,
      condensed_target_tokens: 2000,
      max_expand_tokens: 4000,
      consolidation_cron: '0 3 * * *',
      backup_cron: '0 4 * * *',
      backup_dir: './data/backups',
      max_backups: 7,
    },
    gateway: { unknown_user_reply: true },
    platforms: {},
    scheduler: {
      timezone: 'UTC',
      default_target: { platform: 'discord', channel: '999' },
      jobs: {
        briefing: {
          cron: '0 8 * * *',
          prompt: 'Morning briefing',
          user: 'testuser',
        },
      },
    },
    heartbeat: {
      interval_seconds: 60,
      checks: { process: true, database: true, agent: true },
    },
    webhooks: { enabled: false, port: 18800 },
    media: { max_file_size_mb: 10, allowed_mime_types: [] },
    image_generation: { enabled: false },
    skills: {
      generated_dir: './skills/generated',
      sandbox_enabled: true,
      require_admin_approval_for_elevated: true,
      auto_git_commit: true,
    },
    apple: { shortcuts_enabled: false },
    users: {},
    ...overrides,
  } as CCBuddyConfig;
}

function createMockDeps(configOverrides: Partial<CCBuddyConfig> = {}) {
  async function* mockExecute(request: AgentRequest): AsyncGenerator<AgentEvent> {
    yield {
      type: 'complete' as const,
      response: 'test response',
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };
  }

  return {
    config: createMinimalConfig(configOverrides),
    eventBus: {
      publish: vi.fn(async () => {}),
      subscribe: vi.fn(() => ({ dispose: vi.fn() })),
    },
    executeAgentRequest: vi.fn(mockExecute),
    sendProactiveMessage: vi.fn(async () => {}),
    runSkill: vi.fn(async () => 'skill result'),
    checkDatabase: vi.fn(async () => true),
    checkAgent: vi.fn(async () => ({ reachable: true, durationMs: 100 })),
  };
}

describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (service) await service.stop();
  });

  it('creates and starts without error', async () => {
    const deps = createMockDeps();
    service = new SchedulerService(deps);
    await service.start();
  });

  it('registers cron jobs from config', async () => {
    const nodeCron = vi.mocked(await import('node-cron'));
    const deps = createMockDeps();
    service = new SchedulerService(deps);
    await service.start();

    expect(nodeCron.schedule).toHaveBeenCalledWith(
      '0 8 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'UTC' }),
    );
  });

  it('resolves job target from default_target when job has no target', async () => {
    const deps = createMockDeps();
    service = new SchedulerService(deps);
    await service.start();

    // The briefing job has no target, should use default_target
    const registeredJob = service.getJobs()[0];
    expect(registeredJob?.target).toEqual({ platform: 'discord', channel: '999' });
  });

  it('does not start webhook server when webhooks disabled', async () => {
    const deps = createMockDeps();
    service = new SchedulerService(deps);
    await service.start();
    // No error thrown, webhook server not started
  });

  it('shuts down cleanly', async () => {
    const deps = createMockDeps();
    service = new SchedulerService(deps);
    await service.start();
    await service.stop();
    // No error thrown
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo test --filter=@ccbuddy/scheduler`
Expected: FAIL — `scheduler-service.ts` does not exist

- [ ] **Step 3: Implement scheduler-service.ts**

Create `packages/scheduler/src/scheduler-service.ts`:

```typescript
import type { SchedulerDeps, ScheduledJob } from './types.js';
import type { MessageTarget } from '@ccbuddy/core';
import { CronRunner } from './cron-runner.js';
import { HeartbeatMonitor } from './heartbeat.js';
import { WebhookServer } from './webhook-server.js';

export class SchedulerService {
  private cronRunner: CronRunner;
  private heartbeat: HeartbeatMonitor | null = null;
  private webhookServer: WebhookServer | null = null;
  private readonly deps: SchedulerDeps;
  private readonly jobs: ScheduledJob[] = [];

  constructor(deps: SchedulerDeps) {
    this.deps = deps;

    this.cronRunner = new CronRunner({
      eventBus: deps.eventBus,
      executeAgentRequest: deps.executeAgentRequest,
      sendProactiveMessage: deps.sendProactiveMessage,
      runSkill: deps.runSkill,
      timezone: deps.config.scheduler.timezone,
    });
  }

  async start(): Promise<void> {
    this.registerCronJobs();
    this.startHeartbeat();
    await this.startWebhooks();
    console.log('[Scheduler] Started');
  }

  async stop(): Promise<void> {
    await this.cronRunner.stop();

    if (this.heartbeat) {
      this.heartbeat.stop();
    }

    if (this.webhookServer) {
      await this.webhookServer.stop();
    }

    console.log('[Scheduler] Stopped');
  }

  getJobs(): readonly ScheduledJob[] {
    return this.jobs;
  }

  private registerCronJobs(): void {
    const { jobs, default_target } = this.deps.config.scheduler;
    if (!jobs) return;

    for (const [name, jobConfig] of Object.entries(jobs)) {
      if (jobConfig.enabled === false) continue;

      const target = jobConfig.target ?? default_target;
      if (!target) {
        console.warn(`[Scheduler] Job '${name}' has no target and no default_target — skipping`);
        continue;
      }

      const job: ScheduledJob = {
        name,
        cron: jobConfig.cron,
        type: jobConfig.skill ? 'skill' : 'prompt',
        payload: jobConfig.skill ?? jobConfig.prompt ?? '',
        user: jobConfig.user,
        target,
        permissionLevel: jobConfig.permission_level ?? 'system',
        enabled: true,
        nextRun: 0,
        running: false,
      };

      this.jobs.push(job);
      this.cronRunner.registerJob(job);
      console.log(`[Scheduler] Registered job '${name}' with cron '${jobConfig.cron}'`);
    }
  }

  private startHeartbeat(): void {
    const hbConfig = this.deps.config.heartbeat;

    this.heartbeat = new HeartbeatMonitor({
      eventBus: this.deps.eventBus,
      sendProactiveMessage: this.deps.sendProactiveMessage,
      alertTarget: hbConfig.alert_target,
      intervalSeconds: hbConfig.interval_seconds,
      checks: hbConfig.checks,
      checkDatabase: this.deps.checkDatabase,
      checkAgent: this.deps.checkAgent,
      dailyReportCron: hbConfig.daily_report_cron,
    });

    this.heartbeat.start();
    console.log(`[Scheduler] Heartbeat started (interval: ${hbConfig.interval_seconds}s)`);
  }

  private async startWebhooks(): Promise<void> {
    const whConfig = this.deps.config.webhooks;
    if (!whConfig.enabled) return;
    if (!whConfig.endpoints || Object.keys(whConfig.endpoints).length === 0) return;

    const endpoints: Record<string, any> = {};
    const defaultTarget = this.deps.config.scheduler.default_target;

    for (const [name, epConfig] of Object.entries(whConfig.endpoints)) {
      if (epConfig.enabled === false) continue;

      const target = epConfig.target ?? defaultTarget;
      if (!target) {
        console.warn(`[Scheduler] Webhook endpoint '${name}' has no target — skipping`);
        continue;
      }

      endpoints[name] = {
        path: epConfig.path,
        secret_env: epConfig.secret_env,
        signature_header: epConfig.signature_header,
        signature_algorithm: epConfig.signature_algorithm,
        prompt_template: epConfig.prompt_template,
        max_payload_chars: epConfig.max_payload_chars,
        user: epConfig.user,
        target,
      };
    }

    this.webhookServer = new WebhookServer({
      port: whConfig.port,
      endpoints,
      eventBus: this.deps.eventBus,
      executeAgentRequest: this.deps.executeAgentRequest,
      sendProactiveMessage: this.deps.sendProactiveMessage,
    });

    await this.webhookServer.start();
    console.log(`[Scheduler] Webhook server started on port ${whConfig.port}`);
  }
}
```

- [ ] **Step 4: Export SchedulerService from index.ts**

Update `packages/scheduler/src/index.ts` to its final form:

```typescript
export type {
  ScheduledJob,
  TriggerResult,
  HealthCheckResult,
  SchedulerDeps,
} from './types.js';

export { CronRunner } from './cron-runner.js';
export { HeartbeatMonitor } from './heartbeat.js';
export { WebhookServer } from './webhook-server.js';
export { SchedulerService } from './scheduler-service.js';
```

- [ ] **Step 5: Build and run all scheduler tests**

Run: `npx turbo build --filter=@ccbuddy/scheduler && npx turbo test --filter=@ccbuddy/scheduler`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/scheduler/
git commit -m "feat(scheduler): implement scheduler service orchestrator with TDD"
```

---

### Task 8: Bootstrap integration — wire scheduler into main

**Files:**
- Modify: `packages/main/package.json`
- Modify: `packages/main/src/bootstrap.ts`
- Modify: `config/default.yaml`

- [ ] **Step 1: Add @ccbuddy/scheduler dependency to main**

In `packages/main/package.json`, add to `dependencies`:

```json
"@ccbuddy/scheduler": "*"
```

- [ ] **Step 2: Update AgentService construction to include system rate limit**

In `packages/main/src/bootstrap.ts`, modify the `rateLimits` passed to `AgentService` (around line 41-44):

```typescript
    rateLimits: {
      admin: config.agent.rate_limits.admin,
      chat: config.agent.rate_limits.chat,
      system: config.agent.rate_limits.system,
    },
```

This ensures scheduler requests with `permissionLevel: 'system'` are not rejected by the rate limiter.

- [ ] **Step 3: Wire scheduler into bootstrap.ts**

Add import at top of `packages/main/src/bootstrap.ts`:

```typescript
import { SchedulerService } from '@ccbuddy/scheduler';
```

Add after the SDK backend swap (after line 138), before the `return` statement:

```typescript
  // 14. Create proactive sender closure (wraps gateway adapters)
  const sendProactiveMessage = async (target: { platform: string; channel: string }, text: string) => {
    const adapter = gateway.getAdapter(target.platform);
    if (!adapter) {
      console.error(`[Scheduler] No adapter for platform '${target.platform}'`);
      return;
    }

    // Chunk by platform limit (Discord: 2000, Telegram: 4096, default: 2000)
    const limit = target.platform === 'telegram' ? 4096 : 2000;
    const { chunkMessage } = await import('@ccbuddy/gateway');
    const chunks = chunkMessage(text, limit);

    for (const chunk of chunks) {
      await adapter.sendText(target.channel, chunk);
    }

    await eventBus.publish('message.outgoing', {
      userId: 'system',
      sessionId: 'scheduler',
      channelId: target.channel,
      platform: target.platform,
      text,
    });
  };

  // 15. Create and start scheduler
  const schedulerService = new SchedulerService({
    config,
    eventBus,
    executeAgentRequest: (request) => agentService.handleRequest(request),
    sendProactiveMessage,
    runSkill: undefined, // TODO: wire skill runner when skill execution API is ready
    checkDatabase: async () => {
      // Simple read test against the memory database
      database.db.prepare('SELECT 1').get();
      return true;
    },
    checkAgent: async () => {
      const start = Date.now();
      try {
        // For CLI backend: verify claude is accessible
        const { execSync } = await import('node:child_process');
        execSync('claude --version', { timeout: 10_000, stdio: 'ignore' });
        return { reachable: true, durationMs: Date.now() - start };
      } catch {
        return { reachable: false, durationMs: Date.now() - start };
      }
    },
  });

  shutdownHandler.register('scheduler', async () => {
    await schedulerService.stop();
  });

  await schedulerService.start();
```

- [ ] **Step 4: Verify chunkMessage is exported from gateway**

Check `packages/gateway/src/index.ts` — if `chunkMessage` is not exported, add it:

```typescript
export { chunkMessage } from './chunker.js';
```

- [ ] **Step 5: Update config/default.yaml with scheduler example**

Add commented-out scheduler config to `config/default.yaml` as a reference:

```yaml
# scheduler:
#   timezone: "UTC"
#   default_target:
#     platform: discord
#     channel: "YOUR_CHANNEL_ID"
#   jobs:
#     morning_briefing:
#       cron: "0 8 * * 1-5"
#       prompt: "Give me a morning briefing"
#       user: YOUR_USERNAME

# heartbeat:
#   interval_seconds: 60
#   alert_target:
#     platform: discord
#     channel: "YOUR_CHANNEL_ID"
#   daily_report_cron: "0 9 * * *"
#   checks:
#     process: true
#     database: true
#     agent: true
```

- [ ] **Step 6: Install dependencies and build entire project**

Run: `npm install && npx turbo build`
Expected: All packages build cleanly

- [ ] **Step 7: Run all tests**

Run: `npx turbo test`
Expected: All tests pass across all packages

- [ ] **Step 8: Commit**

```bash
git add packages/main/ packages/gateway/src/index.ts config/default.yaml
git commit -m "feat(main): wire scheduler into bootstrap with proactive sender"
```

---

### Task 9: Smoke test — verify end-to-end startup

- [ ] **Step 1: Start CCBuddy with scheduler config**

Create or update `config/local.yaml` with a minimal scheduler test config (if Discord is configured):

```yaml
scheduler:
  timezone: "UTC"
```

Run: `node bin/start.mjs`
Expected: See `[Scheduler] Started` and `[Scheduler] Heartbeat started` in logs. No crashes.

- [ ] **Step 2: Verify clean shutdown**

Send SIGTERM: `kill -TERM <pid>` (or Ctrl+C)
Expected: See `[Scheduler] Stopped` in logs. Clean exit.

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git add -A
git commit -m "fix(scheduler): adjustments from smoke test"
```

(Skip this commit if no changes were needed.)
