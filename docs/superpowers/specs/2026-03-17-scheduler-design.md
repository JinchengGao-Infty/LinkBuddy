# CCBuddy Scheduler Design Spec

**Date:** 2026-03-17
**Status:** Draft
**Depends on:** Plans 1-4 (Core, Agent, Skills, Memory, Gateway, Platforms)

## Overview

A unified scheduler system that handles all non-user-initiated actions: cron jobs, heartbeat monitoring, webhook ingestion, and proactive message delivery. One new package (`@ccbuddy/scheduler`) provides four internal modules that share a common execution pipeline: **trigger -> agent request -> routed response**.

## Goals

1. Run scheduled prompts and skills on cron expressions (e.g., morning briefings, periodic reports)
2. Monitor system health and alert on failures, with a daily "all clear" report
3. Accept inbound webhooks from external services (GitHub, Sentry, Home Assistant, IFTTT) and route them through the agent
4. Deliver all non-user-initiated responses to configurable platform channels

## Non-Goals (v1)

- Hot-reload of scheduler config (restart required, matches current adapter pattern)
- Webhook retry queues or payload persistence
- Custom health check plugins (only 3 built-in checks)
- Per-job cron timezone (all jobs use `scheduler.timezone`)
- Memory context accumulation for scheduler sessions (each execution is stateless)

---

## Config Schema Changes

### MessageTarget (new, in @ccbuddy/core)

```typescript
interface MessageTarget {
  platform: string;
  channel: string;
}
```

### AgentConfig.rate_limits (expanded)

The existing `rate_limits` only defines `admin` and `chat`. Scheduler jobs run as `system` priority, so a `system` rate limit must be added:

```typescript
rate_limits: {
  admin: number;    // existing, default 30
  chat: number;     // existing, default 10
  system: number;   // NEW, default 20 — for scheduler-initiated requests
}
```

### SchedulerConfig (expanded)

```typescript
interface SchedulerConfig {
  timezone: string;                          // IANA timezone, default 'UTC'
  default_target?: MessageTarget;            // fallback channel for job output
  jobs?: Record<string, ScheduledJobConfig>;
}

interface ScheduledJobConfig {
  cron: string;                              // cron expression (5-field)
  prompt?: string;                           // raw prompt — mutually exclusive with skill
  skill?: string;                            // skill name — mutually exclusive with prompt
  user: string;                              // user identity to run as
  target?: MessageTarget;                    // override default_target
  enabled?: boolean;                         // default true
  permission_level?: 'admin' | 'system';     // default 'system'
}
```

### HeartbeatConfig (expanded)

```typescript
interface HeartbeatConfig {
  interval_seconds: number;                  // check interval, default 60
  alert_target?: MessageTarget;              // where to send failure/recovery alerts
  daily_report_cron?: string;                // "all clear" schedule, e.g., "0 9 * * *"
  checks: {
    process: boolean;                        // memory/cpu + disk usage thresholds
    database: boolean;                       // SQLite read/write test
    agent: boolean;                          // backend reachability
  };
}
```

### WebhooksConfig (expanded)

The existing `WebhooksConfig.handlers` field is renamed to `endpoints` with a richer schema. This is a breaking change to the config format (see Migration section).

```typescript
interface WebhooksConfig {
  enabled: boolean;                          // default false
  port: number;                              // default 18800
  endpoints?: Record<string, WebhookEndpointConfig>;  // replaces old `handlers`
}

interface WebhookEndpointConfig {
  path: string;                              // URL path, e.g., "/webhooks/github"
  secret_env?: string;                       // env var name holding HMAC secret
  signature_header?: string;                 // header containing signature
  signature_algorithm?: string;              // HMAC algorithm, default "sha256"
  prompt_template: string;                   // template with {{payload}}, {{event_type}}
  max_payload_chars?: number;                // truncate {{payload}} to this length, default 50000
  user: string;                              // user identity to run as
  target?: MessageTarget;                    // override scheduler.default_target
  enabled?: boolean;                         // default true
}
```

### New Event Type

Added to `EventMap` in `@ccbuddy/core` (requires updating the event types file):

```typescript
// Added to EventMap in packages/core/src/types/events.ts
'scheduler.job.complete': SchedulerJobCompleteEvent;

interface SchedulerJobCompleteEvent {
  jobName: string;
  source: 'cron' | 'heartbeat' | 'webhook';
  success: boolean;
  target: MessageTarget;
  timestamp: number;
}
```

---

## Package Structure

```
packages/scheduler/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # public exports
│   ├── types.ts              # ScheduledJob, TriggerResult, HealthCheckResult
│   ├── scheduler-service.ts  # main orchestrator
│   ├── cron-runner.ts        # cron job registry and execution
│   ├── heartbeat.ts          # health checks, alerts, daily report
│   ├── webhook-server.ts     # HTTP listener, signature verification
│   └── proactive-sender.ts   # MessageTarget -> adapter.sendText()
└── __tests__/
    ├── cron-runner.test.ts
    ├── heartbeat.test.ts
    ├── webhook-server.test.ts
    ├── proactive-sender.test.ts
    └── scheduler-service.test.ts
```

Depends only on `@ccbuddy/core` (types). All concrete dependencies injected via `SchedulerDeps`.

---

## Core Types

```typescript
interface ScheduledJob {
  name: string;
  cron: string;
  type: 'prompt' | 'skill';
  payload: string;              // prompt text or skill name
  user: string;
  target: MessageTarget;        // resolved (job-level or default)
  permissionLevel: 'admin' | 'system';
  enabled: boolean;
  nextRun: number;
  lastRun?: number;
  running: boolean;             // prevents overlap — skip if still running
}

interface TriggerResult {
  source: 'cron' | 'heartbeat' | 'webhook';
  name: string;
  response: string;
  target: MessageTarget;
  timestamp: number;
}

interface HealthCheckResult {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  message?: string;
  durationMs: number;
}

interface SchedulerDeps {
  config: CCBuddyConfig;
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  runSkill?: (name: string, input: Record<string, unknown>) => Promise<string>;
}
```

### Synthetic AgentRequest Fields

`AgentRequest` requires `sessionId`, `channelId`, and `platform` — fields normally derived from an incoming user message. For scheduler-initiated requests, these are synthesized:

- **sessionId:** `scheduler:<source>:<name>` — e.g., `scheduler:cron:morning_briefing`, `scheduler:webhook:github`, `scheduler:heartbeat:daily_report`. Each execution gets a fresh session (no persistent memory context across runs, per Non-Goals).
- **channelId:** Taken from the resolved `MessageTarget.channel`.
- **platform:** Taken from the resolved `MessageTarget.platform`.
- **permissionLevel:** From job config (default `system`).
- **userId:** Resolved from the job's `user` field via `UserManager.findByName()`.

This means scheduler requests create ephemeral sessions that are cleaned up by the existing `SessionManager.tick()` after the idle timeout.

---

## Module Designs

### Cron Runner

**Responsibility:** Parse cron expressions, register jobs, execute them on schedule.

**Implementation:**
- Uses `node-cron` library for cron parsing and scheduling (well-maintained, supports timezones, no native deps)
- Each config job is parsed into a `ScheduledJob` and registered with `node-cron`
- On fire: builds an `AgentRequest` (for prompt jobs) or calls `runSkill()` (for skill jobs)
- Response collected from the `complete` event of the agent's async generator
- Response sent via injected `sendProactiveMessage()`

**Concurrency:**
- Jobs share the AgentService queue with user messages
- Jobs run at `system` priority (between admin and chat)
- A job that's still running when the next cron tick fires is skipped (no overlap)

**Error handling:**
- Failed jobs log the error and send an alert to the job's target channel
- No automatic retry — the job runs again at the next cron tick
- Publishes `scheduler.job.complete` event with `success: false`

### Heartbeat Monitor

**Responsibility:** Periodic health checks with alerting on state transitions and a daily "all clear" report.

**Implementation:**
- Runs on `setInterval` (not cron) — heartbeat must be independent of the cron system to detect if cron is broken
- Three built-in checks, each enabled/disabled via config:
  1. **Process:** `process.memoryUsage()` + `os.cpus()` + disk usage via `statvfs`/`df` — `degraded` if RSS > 512MB or disk > 90%
  2. **Database:** `SELECT 1` on SQLite — `down` if throws
  3. **Agent:** SDK lightweight ping or CLI `claude --version` — `degraded` if >5s, `down` if fails/times out at 10s
- Populates the existing `HeartbeatStatusEvent.system` fields: `cpuPercent` (from `os.cpus()`), `memoryPercent` (from `process.memoryUsage()` / `os.totalmem()`), `diskPercent` (from data dir free space check)

**Alert behavior:**
- Alerts only on **state transitions** (healthy->degraded, healthy->down, degraded->down)
- Recovery alerts on transition back to healthy
- Publishes `heartbeat.status` event every tick (existing event type)
- Publishes `alert.health` event on degraded/down transitions (existing event type)
- Sends proactive message to `heartbeat.alert_target` on transitions

**Daily report:**
- Runs on its own `setTimeout`-based scheduler within the heartbeat module, independent of the cron runner — so it can still fire even if the cron system is broken
- Sends to `heartbeat.alert_target`: uptime, current status of all checks, memory/cpu/disk usage
- Only sent when all checks are healthy (if something is broken, you're already getting alerts)

### Webhook Server

**Responsibility:** Accept inbound HTTP webhooks, verify signatures, dispatch to agent.

**Implementation:**
- Node built-in `http.createServer()` — no Express dependency
- Starts only when `webhooks.enabled: true`
- Routes requests by matching `req.url` to configured endpoint paths

**Request flow:**
1. Match path to endpoint config
2. Verify signature (if `secret_env` configured)
3. Parse JSON body
4. Render prompt template (`{{payload}}`, `{{event_type}}`, `{{endpoint}}` substitution) — `{{payload}}` is truncated to `max_payload_chars` (default 50000) to prevent exceeding agent token limits
5. Return 200 immediately (fire-and-forget from caller's perspective)
6. Build `AgentRequest` with rendered prompt
7. Execute via `executeAgentRequest()`
8. Send response to target via `sendProactiveMessage()`
9. Publish `webhook.received` event and `scheduler.job.complete` event

**Signature verification:**
- Read secret from `process.env[endpoint.secret_env]`
- Compute HMAC with `crypto.createHmac(algorithm, secret)` over raw body bytes
- Compare to signature in configured header using `timingSafeEqual`
- 401 on mismatch

**Error responses:**
- Unknown path: 404
- Non-POST: 405
- Body > 1MB: 413
- JSON parse failure: 400
- Missing/invalid signature: 401

### Proactive Sender

**Responsibility:** Resolve `MessageTarget` to platform adapter calls.

**Implementation:**
- Constructed in bootstrap with access to the gateway's registered adapters
- Looks up adapter by `target.platform`
- Handles chunking internally (imports `chunkMessage` from gateway, or reimplements the simple logic — split on platform char limit). The `sendProactiveMessage` callback injected into `SchedulerDeps` encapsulates all of this, so the scheduler package itself never needs to know about chunking or platform limits.
- Calls `adapter.sendText(target.channel, chunk)` for each chunk
- Publishes `message.outgoing` event for audit trail
- Throws if platform adapter not found

**Note:** The `ProactiveSender` is implemented as a closure in `bootstrap.ts` (not a class in the scheduler package). The scheduler receives it as the `sendProactiveMessage` function in `SchedulerDeps`. This keeps the scheduler package dependent only on `@ccbuddy/core` types.

---

## Bootstrap Integration

The scheduler wires into `bootstrap.ts` after the gateway starts:

```
1.  Load config
2.  Create event bus, user manager
3.  Create agent service, memory, skills, gateway
4.  Register platform adapters
5.  Start gateway (connects adapters)
6.  Swap SDK backend (if configured)
7.  Create ProactiveSender (needs gateway's adapters)        <-- NEW
8.  Create SchedulerService (inject deps)                    <-- NEW
9.  Start scheduler (cron jobs, heartbeat, webhook server)   <-- NEW
10. Register scheduler with ShutdownHandler                  <-- NEW
```

**Shutdown:** The scheduler registers **one composite callback** with `ShutdownHandler` that runs these steps sequentially:
1. Stop all cron jobs (`node-cron` task.stop())
2. Clear heartbeat interval and daily report timer
3. Close webhook HTTP server (`server.close()`)
4. Wait for in-flight job executions to complete (reuses `agent.graceful_shutdown_timeout_seconds`)

---

## Config Example

```yaml
scheduler:
  timezone: "America/New_York"
  default_target:
    platform: discord
    channel: "123456789"
  jobs:
    morning_briefing:
      cron: "0 8 * * 1-5"
      prompt: "Give me a morning briefing: weather, calendar, and top news"
      user: flyingchickens
    nightly_backup_check:
      cron: "0 5 * * *"
      skill: check-backups
      user: flyingchickens
      permission_level: admin

heartbeat:
  interval_seconds: 60
  alert_target:
    platform: discord
    channel: "123456789"
  daily_report_cron: "0 9 * * *"
  checks:
    process: true
    database: true
    agent: true

webhooks:
  enabled: true
  port: 18800
  endpoints:
    github:
      path: /webhooks/github
      secret_env: GITHUB_WEBHOOK_SECRET
      signature_header: x-hub-signature-256
      signature_algorithm: sha256
      prompt_template: "GitHub {{event_type}} event on repo:\n\n```json\n{{payload}}\n```\n\nSummarize what happened and whether I need to take action."
      user: flyingchickens
      target:
        platform: discord
        channel: "987654321"
    sentry:
      path: /webhooks/sentry
      secret_env: SENTRY_WEBHOOK_SECRET
      signature_header: sentry-hook-signature
      prompt_template: "Sentry alert:\n\n{{payload}}\n\nSummarize the error and suggest next steps."
      user: flyingchickens
```

---

## Testing Strategy

- **Cron runner:** Unit tests with mocked `node-cron` — verify job registration, execution callback, skip-if-running, error handling
- **Heartbeat:** Unit tests with mocked health check targets — verify state transition detection, alert-only-on-transition, daily report scheduling
- **Webhook server:** Integration tests using Node `http.request` — verify routing, signature verification (valid/invalid/missing), template rendering, error codes
- **Proactive sender:** Unit tests with mocked adapters — verify chunking, platform lookup, event publishing
- **Scheduler service:** Integration test — verify bootstrap wiring, shutdown sequence, end-to-end flow (register job, fire, verify message sent)

---

## Logging

All scheduler modules use console-based logging with prefixed tags, consistent with the existing codebase:
- `[Scheduler]` — job registration, execution start/complete, skip-if-running
- `[Heartbeat]` — check results each tick (debug level), state transitions (info), alerts (warn/error)
- `[Webhook]` — request received, signature verification result, dispatch (info); errors (error)
- Log level respects `config.log_level`

---

## Migration / Breaking Changes

Changes to `@ccbuddy/core` types:

1. **`AgentConfig.rate_limits`** — add `system: number` field (default 20). Existing configs without this field use the default.
2. **`SchedulerConfig`** — add `default_target` and `jobs` fields (both optional, backward compatible).
3. **`HeartbeatConfig`** — add `alert_target`, `daily_report_cron`, `checks` fields. `DEFAULT_CONFIG` must include defaults (`checks: { process: true, database: true, agent: true }`).
4. **`WebhooksConfig`** — rename `handlers` to `endpoints` with expanded schema. **Breaking:** any existing config using `webhooks.handlers` must rename to `webhooks.endpoints`. Since webhooks were `enabled: false` by default and no handler implementations existed, this is unlikely to affect anyone.
5. **`EventMap`** — add `'scheduler.job.complete': SchedulerJobCompleteEvent` entry.
6. **`WebhookEvent`** — existing `handler` field will be populated with the endpoint name (no rename needed in the event type itself, keeps backward compat).
7. **`DEFAULT_CONFIG`** — update with new defaults for all expanded fields.

### Memory Config Cron Jobs

The existing `memory.consolidation_cron` and `memory.backup_cron` fields remain as-is in v1. They are internal memory maintenance timers, not user-visible scheduled tasks. The memory package will eventually consume these via the scheduler, but for now they remain independent (deferred to a future plan).

---

## Dependencies

**New npm dependencies:**
- `node-cron` (MIT, ~50KB, no native deps)
- `luxon` (MIT, ~70KB) — required by `node-cron` for timezone support with IANA timezone strings

**Package dependencies:** `@ccbuddy/core` only (types). All runtime dependencies injected.
