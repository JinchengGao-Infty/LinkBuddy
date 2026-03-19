# Morning Briefings Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable CCBuddy to send daily morning briefings by fixing three infrastructure gaps in the cron/scheduler system and configuring briefing jobs.

**Architecture:** Fix three gaps: (1) add memory context to cron jobs, (2) expose memory retrieval tools via the MCP server, (3) expose heartbeat status via MCP. Add per-job timezone support. Configure briefing cron jobs in local.yaml.

**Tech Stack:** TypeScript, better-sqlite3, @modelcontextprotocol/sdk, node-cron, vitest

**Spec:** `docs/superpowers/specs/2026-03-19-morning-briefings-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/scheduler/src/types.ts` | Modify | Add `assembleContext` to `SchedulerDeps`, `timezone?` to `ScheduledJob` |
| `packages/scheduler/src/cron-runner.ts` | Modify | Accept `assembleContext`, call it in `executePromptJob`, use per-job timezone |
| `packages/scheduler/src/scheduler-service.ts` | Modify | Forward `assembleContext` to CronRunner, map `timezone` from config |
| `packages/scheduler/src/__tests__/cron-runner.test.ts` | Modify | Add tests for memory context and per-job timezone |
| `packages/scheduler/src/__tests__/scheduler-service.test.ts` | Modify | Add test for timezone mapping |
| `packages/core/src/config/schema.ts` | Modify | Add `timezone?` to `ScheduledJobConfig` |
| `packages/skills/src/mcp-server.ts` | Modify | Add `--memory-db`, `--heartbeat-status-file` flags, retrieval tools, `system_health` tool |
| `packages/skills/src/__tests__/mcp-server.test.ts` | Modify | Add tests for retrieval tools and system_health |
| `packages/main/src/bootstrap.ts` | Modify | Wire `assembleContext` to scheduler, add MCP args, add heartbeat file listener |
| `config/local.yaml` | Modify | Add scheduler timezone, default_target, briefing jobs |

---

## Chunk 1: Memory Context in Cron Jobs

### Task 1: Add `assembleContext` to scheduler types

**Files:**
- Modify: `packages/core/src/config/schema.ts:106-114`
- Modify: `packages/scheduler/src/types.ts:9-21,38-46`

- [ ] **Step 1: Add `timezone?` to `ScheduledJobConfig` in schema.ts**

In `packages/core/src/config/schema.ts`, add `timezone?` to `ScheduledJobConfig`:

```typescript
export interface ScheduledJobConfig {
  cron: string;
  prompt?: string;
  skill?: string;
  user: string;
  target?: MessageTarget;
  enabled?: boolean;
  permission_level?: 'admin' | 'system';
  timezone?: string;
}
```

- [ ] **Step 2: Add `timezone?` to `ScheduledJob` in types.ts**

In `packages/scheduler/src/types.ts`, add to `ScheduledJob`:

```typescript
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
  timezone?: string;
}
```

- [ ] **Step 3: Add `assembleContext` to `SchedulerDeps` in types.ts**

```typescript
export interface SchedulerDeps {
  config: CCBuddyConfig;
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  runSkill?: (name: string, input: Record<string, unknown>) => Promise<string>;
  checkDatabase: () => Promise<boolean>;
  checkAgent: () => Promise<{ reachable: boolean; durationMs: number }>;
  assembleContext: (userId: string, sessionId: string) => string;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/config/schema.ts packages/scheduler/src/types.ts
git commit -m "feat(scheduler): add assembleContext to deps and timezone to job config"
```

---

### Task 2: Wire `assembleContext` into CronRunner

**Files:**
- Modify: `packages/scheduler/src/cron-runner.ts:10-16,44,74-84`
- Test: `packages/scheduler/src/__tests__/cron-runner.test.ts`

- [ ] **Step 1: Write failing test — cron job includes memoryContext**

In `packages/scheduler/src/__tests__/cron-runner.test.ts`, add to `createMockDeps()`:

```typescript
assembleContext: vi.fn().mockReturnValue('Memory context for user'),
```

Add a new test (note: use `runner.executeJob(job)` directly, matching existing test patterns):

```typescript
it('executePromptJob includes memoryContext from assembleContext', async () => {
  const deps = createMockDeps();
  const runner = new CronRunner(deps);
  const job = createMockJob();

  await runner.executeJob(job);

  expect(deps.assembleContext).toHaveBeenCalledWith(
    job.user,
    expect.stringMatching(/^scheduler:cron:daily-report:\d+$/),
  );

  const request = (deps.executeAgentRequest as any).mock.calls[0][0];
  expect(request.memoryContext).toBe('Memory context for user');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/scheduler/src/__tests__/cron-runner.test.ts -t "memoryContext"`
Expected: FAIL — `assembleContext` not in CronRunnerOptions

- [ ] **Step 3: Write failing test — per-job timezone overrides global**

```typescript
it('uses per-job timezone when set', async () => {
  const deps = createMockDeps();
  const runner = new CronRunner(deps);
  const job = createMockJob({ timezone: 'America/Chicago' });
  runner.registerJob(job);

  expect(mockSchedule).toHaveBeenCalledWith(
    job.cron,
    expect.any(Function),
    { timezone: 'America/Chicago' },
  );
});

it('falls back to global timezone when job has no timezone', async () => {
  const deps = createMockDeps();
  const runner = new CronRunner(deps);
  const job = createMockJob();
  runner.registerJob(job);

  expect(mockSchedule).toHaveBeenCalledWith(
    job.cron,
    expect.any(Function),
    { timezone: 'UTC' },
  );
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run packages/scheduler/src/__tests__/cron-runner.test.ts`
Expected: FAIL — timezone tests fail

- [ ] **Step 5: Add `assembleContext` to `CronRunnerOptions` and implement**

In `packages/scheduler/src/cron-runner.ts`:

Add to `CronRunnerOptions`:

```typescript
export interface CronRunnerOptions {
  eventBus: EventBus;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  sendProactiveMessage: (target: MessageTarget, text: string) => Promise<void>;
  runSkill?: (name: string, input: Record<string, unknown>) => Promise<string>;
  timezone: string;
  assembleContext: (userId: string, sessionId: string) => string;
}
```

In `registerJob()`, change the timezone line:

```typescript
{ timezone: job.timezone ?? this.opts.timezone },
```

In `executePromptJob()`, add `memoryContext`:

```typescript
private async executePromptJob(job: ScheduledJob): Promise<void> {
  const sessionId = `scheduler:cron:${job.name}:${Date.now()}`;
  const memoryContext = this.opts.assembleContext(job.user, sessionId);

  const request: AgentRequest = {
    prompt: job.payload,
    userId: job.user,
    sessionId,
    channelId: job.target.channel,
    platform: job.target.platform,
    permissionLevel: job.permissionLevel,
    memoryContext,
  };
  // ... rest unchanged
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/scheduler/src/__tests__/cron-runner.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/scheduler/src/cron-runner.ts packages/scheduler/src/__tests__/cron-runner.test.ts
git commit -m "feat(scheduler): add memory context and per-job timezone to cron runner"
```

---

### Task 3: Wire through SchedulerService and bootstrap

**Files:**
- Modify: `packages/scheduler/src/scheduler-service.ts:13-21,42-68`
- Modify: `packages/main/src/bootstrap.ts:185-209`
- Test: `packages/scheduler/src/__tests__/scheduler-service.test.ts`

- [ ] **Step 1: Update scheduler-service test mock deps to include assembleContext**

In `packages/scheduler/src/__tests__/scheduler-service.test.ts`, add to the `createMockDeps()` function:

```typescript
assembleContext: vi.fn().mockReturnValue(''),
```

This must be done first so existing tests still compile with the new `SchedulerDeps` interface.

- [ ] **Step 2: Write failing test — scheduler maps timezone from config**

In `packages/scheduler/src/__tests__/scheduler-service.test.ts`, add a test. Note: `createMockDeps()` takes `Partial<SchedulerDeps>`, not a config object. Override the config inside the deps:

```typescript
it('maps timezone from job config to ScheduledJob', async () => {
  const config = createMinimalConfig();
  config.scheduler.jobs = {
    briefing: {
      cron: '0 7 * * *',
      prompt: 'Morning briefing',
      user: 'testuser',
      timezone: 'America/Chicago',
    },
  };
  const deps = createMockDeps({ config });
  const service = new SchedulerService(deps);
  await service.start();

  const jobs = service.getJobs();
  expect(jobs[0].timezone).toBe('America/Chicago');

  await service.stop();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/scheduler/src/__tests__/scheduler-service.test.ts -t "timezone"`
Expected: FAIL — `timezone` not mapped in `registerCronJobs()`

- [ ] **Step 4: Update SchedulerService to forward assembleContext and map timezone**

In `packages/scheduler/src/scheduler-service.ts`:

Constructor — pass `assembleContext` to CronRunner:

```typescript
this.cronRunner = new CronRunner({
  eventBus: deps.eventBus,
  executeAgentRequest: deps.executeAgentRequest,
  sendProactiveMessage: deps.sendProactiveMessage,
  runSkill: deps.runSkill,
  timezone: deps.config.scheduler.timezone,
  assembleContext: deps.assembleContext,
});
```

In `registerCronJobs()`, add `timezone` to the job mapping:

```typescript
const job: ScheduledJob = {
  name,
  cron: jobConfig.cron,
  type: jobConfig.skill ? 'skill' : 'prompt',
  payload: jobConfig.skill ?? jobConfig.prompt ?? '',
  user: jobConfig.user,
  target,
  permissionLevel: jobConfig.permission_level ?? 'system',
  enabled: jobConfig.enabled !== false,
  nextRun: 0,
  running: false,
  timezone: jobConfig.timezone,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/scheduler`
Expected: ALL PASS

- [ ] **Step 6: Update bootstrap to pass assembleContext to scheduler**

In `packages/main/src/bootstrap.ts`, in the `SchedulerService` constructor call, add `assembleContext`:

```typescript
const schedulerService = new SchedulerService({
  config,
  eventBus,
  executeAgentRequest: (request) => agentService.handleRequest({
    ...request,
    mcpServers: [skillMcpServer],
    systemPrompt: [request.systemPrompt, skillNudge].filter(Boolean).join('\n\n'),
  }),
  sendProactiveMessage,
  runSkill: undefined,
  assembleContext: (userId, sessionId) => {
    const context = contextAssembler.assemble(userId, sessionId);
    return contextAssembler.formatAsPrompt(context);
  },
  checkDatabase: async () => {
    messageStore.getById(0);
    return true;
  },
  checkAgent: async () => {
    const start = Date.now();
    const { execFile } = await import('node:child_process');
    return new Promise<{ reachable: boolean; durationMs: number }>((resolve) => {
      execFile('claude', ['--version'], { timeout: 10_000 }, (err) => {
        resolve({ reachable: !err, durationMs: Date.now() - start });
      });
    });
  },
});
```

- [ ] **Step 7: Build all packages**

Run: `npx turbo build`
Expected: ALL PASS

- [ ] **Step 8: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add packages/scheduler/src/scheduler-service.ts packages/scheduler/src/__tests__/scheduler-service.test.ts packages/main/src/bootstrap.ts
git commit -m "feat(scheduler): wire assembleContext through service and bootstrap"
```

---

## Chunk 2: Memory Retrieval Tools in MCP Server

### Task 4: Add `--memory-db` flag and retrieval tools to MCP server

**Files:**
- Modify: `packages/skills/src/mcp-server.ts:28-68,129-184,187-319`
- Test: `packages/skills/src/__tests__/mcp-server.test.ts`

- [ ] **Step 1: Write failing test — MCP server exposes memory tools when --memory-db provided**

In `packages/skills/src/__tests__/mcp-server.test.ts`, add a new describe block. The test needs a seeded SQLite database:

```typescript
describe('with --memory-db', () => {
  let memClient: Client;
  let memTransport: StdioClientTransport;
  let testDbPath: string;

  beforeAll(async () => {
    // Create a temp database with test data
    testDbPath = join(tmpDir, 'test-memory.sqlite');
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        content TEXT NOT NULL,
        role TEXT NOT NULL,
        attachments TEXT,
        timestamp INTEGER NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE summary_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        content TEXT NOT NULL,
        source_ids TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `);
    db.prepare('INSERT INTO messages (user_id, session_id, platform, content, role, timestamp, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      'testuser', 'sess-1', 'discord', 'Hello world', 'user', Date.now(), 10
    );
    db.prepare('INSERT INTO summary_nodes (user_id, depth, content, source_ids, tokens, timestamp) VALUES (?, ?, ?, ?, ?, ?)').run(
      'testuser', 0, 'Summary about greetings', '[1]', 20, Date.now()
    );
    db.close();

    // Connect MCP client with --memory-db flag
    memTransport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--registry', registryPath, '--skills-dir', skillsDir, '--memory-db', testDbPath],
    });
    memClient = new Client({ name: 'test-client', version: '1.0.0' });
    await memClient.connect(memTransport);
  }, 15_000);

  afterAll(async () => {
    await memClient?.close();
  });

  it('lists memory tools alongside skill tools', async () => {
    const result = await memClient.listTools();
    const names = result.tools.map(t => t.name);
    expect(names).toContain('list_skills');
    expect(names).toContain('create_skill');
    expect(names).toContain('memory_grep');
    expect(names).toContain('memory_describe');
    expect(names).toContain('memory_expand');
  });

  it('memory_grep returns matching messages and summaries', async () => {
    const result = await memClient.callTool({ name: 'memory_grep', arguments: { userId: 'testuser', query: 'Hello' } });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.messages.length).toBeGreaterThan(0);
    expect(parsed.messages[0].content).toContain('Hello');
  });

  it('memory_describe returns messages in time range', async () => {
    const now = Date.now();
    const result = await memClient.callTool({
      name: 'memory_describe',
      arguments: { userId: 'testuser', startMs: now - 60_000, endMs: now + 60_000 },
    });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/skills/src/__tests__/mcp-server.test.ts`
Expected: FAIL — `--memory-db` not recognized, memory tools not listed

- [ ] **Step 3: Add `@ccbuddy/memory` and `better-sqlite3` as dependencies of `@ccbuddy/skills`**

In `packages/skills/package.json`, add to `dependencies`:

```json
"@ccbuddy/memory": "workspace:*",
"better-sqlite3": "^11.0.0"
```

Run: `npm install` from the repo root.

Also add `@ccbuddy/memory` to the TypeScript project references in `packages/skills/tsconfig.json` if not already there:

```json
{ "path": "../memory" }
```

- [ ] **Step 4: Implement --memory-db in MCP server**

In `packages/skills/src/mcp-server.ts`:

Add to `parseArgs()`:

```typescript
let memoryDbPath = '';

// inside switch:
case '--memory-db':
  memoryDbPath = argv[++i] ?? '';
  break;

// return:
return { registryPath, skillsDir, requireApproval, autoGitCommit, memoryDbPath };
```

In `main()`, after loading the registry, conditionally create retrieval tools:

```typescript
import {
  MemoryDatabase,
  MessageStore,
  SummaryStore,
  RetrievalTools,
} from '@ccbuddy/memory';

// After registry load — open DB in read-only mode, skip init() (schema already exists):
let retrievalTools: RetrievalTools | null = null;
if (args.memoryDbPath) {
  const memoryDatabase = new MemoryDatabase(args.memoryDbPath, { readonly: true });
  // Do NOT call memoryDatabase.init() — it runs DDL which fails on read-only handles
  const messageStore = new MessageStore(memoryDatabase);
  const summaryStore = new SummaryStore(memoryDatabase);
  retrievalTools = new RetrievalTools(messageStore, summaryStore);
}
```

**Note:** `MemoryDatabase` constructor currently doesn't accept options. Add an optional `{ readonly: true }` parameter to `MemoryDatabase`:

In `packages/memory/src/database.ts`, update the constructor:

```typescript
constructor(dbPath: string, opts?: { readonly?: boolean }) {
  this.db = new Database(dbPath, opts?.readonly ? { readonly: true } : undefined);
}
```

This is a minimal change. The existing call sites pass no options and are unaffected.

In the `ListToolsRequestSchema` handler, after the dynamic skill tools loop, add:

```typescript
if (retrievalTools) {
  for (const tool of retrievalTools.getToolDefinitions()) {
    tools.push({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    });
  }
}
```

In the `CallToolRequestSchema` handler, before the "Unknown tool" fallback, add:

```typescript
// Memory retrieval tools
if (retrievalTools && name === 'memory_grep') {
  const result = retrievalTools.grep(toolArgs.userId as string, toolArgs.query as string);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
if (retrievalTools && name === 'memory_describe') {
  const result = retrievalTools.describe(toolArgs.userId as string, {
    startMs: toolArgs.startMs as number,
    endMs: toolArgs.endMs as number,
  });
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
if (retrievalTools && name === 'memory_expand') {
  const result = retrievalTools.expand(toolArgs.userId as string, toolArgs.nodeId as number);
  return { content: [{ type: 'text', text: JSON.stringify(result ?? { error: 'Node not found' }) }] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/skills/src/__tests__/mcp-server.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/skills/src/mcp-server.ts packages/skills/src/__tests__/mcp-server.test.ts packages/skills/package.json packages/memory/src/database.ts
git commit -m "feat(skills): add memory retrieval tools to MCP server via --memory-db"
```

---

### Task 5: Wire `--memory-db` into bootstrap

**Files:**
- Modify: `packages/main/src/bootstrap.ts:83-91`

- [ ] **Step 1: Add --memory-db to skillMcpServer args**

In `packages/main/src/bootstrap.ts`, update the `skillMcpServer` args:

```typescript
const skillMcpServer = {
  name: 'ccbuddy-skills',
  command: 'node',
  args: [
    skillMcpServerPath,
    '--registry', registryPath,
    '--skills-dir', registryDir,
    ...(config.skills.require_admin_approval_for_elevated ? [] : ['--no-approval']),
    ...(config.skills.auto_git_commit ? [] : ['--no-git-commit']),
    '--memory-db', config.memory.db_path,
  ],
};
```

- [ ] **Step 2: Build and verify**

Run: `npx turbo build`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add packages/main/src/bootstrap.ts
git commit -m "feat(main): pass --memory-db to skill MCP server"
```

---

## Chunk 3: Heartbeat Status Tool

### Task 6: Add heartbeat status file writing

**Files:**
- Modify: `packages/main/src/bootstrap.ts`

- [ ] **Step 1: Add heartbeat status file event listener in bootstrap**

In `packages/main/src/bootstrap.ts`, after creating the `schedulerService` but before `schedulerService.start()`, add an event listener:

```typescript
import { writeFileSync, renameSync } from 'node:fs';

// Heartbeat status file — atomic write for MCP server reads
const heartbeatStatusPath = join(config.data_dir, 'heartbeat-status.json');
eventBus.subscribe('heartbeat.status', (data) => {
  const tmpPath = heartbeatStatusPath + '.tmp';
  try {
    writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
    renameSync(tmpPath, heartbeatStatusPath);
  } catch {
    // Non-fatal — MCP server will report "no data"
  }
});
```

- [ ] **Step 2: Add --heartbeat-status-file to skillMcpServer args**

Update the `skillMcpServer` args array:

```typescript
'--heartbeat-status-file', join(config.data_dir, 'heartbeat-status.json'),
```

- [ ] **Step 3: Build and verify**

Run: `npx turbo build`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/main/src/bootstrap.ts
git commit -m "feat(main): write heartbeat status file and pass path to MCP server"
```

---

### Task 7: Add `system_health` tool to MCP server

**Files:**
- Modify: `packages/skills/src/mcp-server.ts`
- Test: `packages/skills/src/__tests__/mcp-server.test.ts`

- [ ] **Step 1: Write failing test — system_health tool**

In `packages/skills/src/__tests__/mcp-server.test.ts`, add a new describe block:

```typescript
describe('with --heartbeat-status-file', () => {
  let hbClient: Client;
  let hbTransport: StdioClientTransport;
  let statusFilePath: string;

  beforeAll(async () => {
    statusFilePath = join(tmpDir, 'heartbeat-status.json');
    writeFileSync(statusFilePath, JSON.stringify({
      modules: { process: 'healthy', database: 'healthy', agent: 'degraded' },
      system: { cpuPercent: 10, memoryPercent: 2.5, diskPercent: 45 },
      timestamp: Date.now(),
    }));

    hbTransport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--registry', registryPath, '--skills-dir', skillsDir, '--heartbeat-status-file', statusFilePath],
    });
    hbClient = new Client({ name: 'test-client', version: '1.0.0' });
    await hbClient.connect(hbTransport);
  }, 15_000);

  afterAll(async () => {
    await hbClient?.close();
  });

  it('lists system_health tool', async () => {
    const result = await hbClient.listTools();
    const names = result.tools.map(t => t.name);
    expect(names).toContain('system_health');
  });

  it('returns heartbeat status', async () => {
    const result = await hbClient.callTool({ name: 'system_health', arguments: {} });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.modules.agent).toBe('degraded');
    expect(parsed.system.cpuPercent).toBe(10);
  });

  it('returns stale warning when data is old', async () => {
    // Write a status file with an old timestamp (>10 min ago)
    const stalePath = join(tmpDir, 'heartbeat-stale.json');
    writeFileSync(stalePath, JSON.stringify({
      modules: { process: 'healthy' },
      system: { cpuPercent: 5, memoryPercent: 1, diskPercent: 30 },
      timestamp: Date.now() - 700_000, // ~11 minutes ago
    }));

    const staleTransport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--registry', registryPath, '--skills-dir', skillsDir, '--heartbeat-status-file', stalePath],
    });
    const staleClient = new Client({ name: 'test-client', version: '1.0.0' });
    await staleClient.connect(staleTransport);

    const result = await staleClient.callTool({ name: 'system_health', arguments: {} });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.stale).toBe(true);

    await staleClient.close();
  }, 15_000);

  it('returns no-data when file missing', async () => {
    // Create a client pointing to a non-existent file
    const badTransport = new StdioClientTransport({
      command: 'node',
      args: [serverPath, '--registry', registryPath, '--skills-dir', skillsDir, '--heartbeat-status-file', join(tmpDir, 'nonexistent.json')],
    });
    const badClient = new Client({ name: 'test-client', version: '1.0.0' });
    await badClient.connect(badTransport);

    const result = await badClient.callTool({ name: 'system_health', arguments: {} });
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.status).toBe('no_data');

    await badClient.close();
  }, 15_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/skills/src/__tests__/mcp-server.test.ts`
Expected: FAIL — `system_health` tool not found

- [ ] **Step 3: Implement --heartbeat-status-file and system_health tool**

In `packages/skills/src/mcp-server.ts`:

Add to `parseArgs()`:

```typescript
let heartbeatStatusFile = '';

// inside switch:
case '--heartbeat-status-file':
  heartbeatStatusFile = argv[++i] ?? '';
  break;

// return:
return { registryPath, skillsDir, requireApproval, autoGitCommit, memoryDbPath, heartbeatStatusFile };
```

In the `ListToolsRequestSchema` handler, add:

```typescript
if (args.heartbeatStatusFile) {
  tools.push({
    name: 'system_health',
    description: 'Get the latest system health status from the heartbeat monitor. Returns module statuses (process, database, agent) and system metrics (cpu, memory, disk).',
    inputSchema: { type: 'object', properties: {} },
  });
}
```

In the `CallToolRequestSchema` handler, add before the "Unknown tool" fallback:

```typescript
if (name === 'system_health' && args.heartbeatStatusFile) {
  try {
    const raw = readFileSync(args.heartbeatStatusFile, 'utf8');
    const data = JSON.parse(raw);
    // Mark as stale if timestamp is >10 minutes old (2x default 5-min heartbeat interval)
    const STALE_THRESHOLD_MS = 10 * 60 * 1000;
    if (data.timestamp && Date.now() - data.timestamp > STALE_THRESHOLD_MS) {
      data.stale = true;
    }
    return { content: [{ type: 'text', text: JSON.stringify(data) }] };
  } catch {
    return { content: [{ type: 'text', text: JSON.stringify({ status: 'no_data', message: 'Heartbeat status file not available' }) }] };
  }
}
```

Add `import { readFileSync } from 'node:fs';` at the top.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/skills/src/__tests__/mcp-server.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/skills/src/mcp-server.ts packages/skills/src/__tests__/mcp-server.test.ts
git commit -m "feat(skills): add system_health tool to MCP server via --heartbeat-status-file"
```

---

## Chunk 4: Integration and Briefing Config

### Task 8: Full build and test verification

**Files:**
- All modified packages

- [ ] **Step 1: Build all packages**

Run: `npx turbo build`
Expected: ALL 10 packages build successfully

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: ALL tests pass (321 existing + new tests)

- [ ] **Step 3: If any failures, fix and re-run**

- [ ] **Step 4: Commit any fixes**

---

### Task 9: Configure briefing cron jobs

**Files:**
- Modify: `config/local.yaml`

- [ ] **Step 1: Update local.yaml with scheduler config and briefing jobs**

Add to `config/local.yaml`:

```yaml
ccbuddy:
  agent:
    backend: "sdk"

  users:
    flyingchickens:
      name: "flyingchickens"
      role: "admin"
      discord_id: "212025519770697728"

  heartbeat:
    interval_seconds: 300

  scheduler:
    timezone: "America/Chicago"
    default_target:
      platform: discord
      channel: "1483632556522995912"
    jobs:
      morning_briefing_weekday:
        cron: "0 7 * * 1-5"
        prompt: &briefing_prompt |
          You are delivering a morning briefing to flyingchickens.

          ## Required sections:
          1. **Greeting** — brief, warm, personalized to time of day and day of week.
          2. **Conversation recap** — summarize key topics from the last 24 hours using the memory context provided and memory tools. Highlight any unresolved questions or action items.
          3. **System health** — use system_health tool. Only mention if there are failures or degraded modules. If all healthy, skip this section entirely.
          4. **Weather & calendar** — use available skills if they exist. If no skill exists for weather or calendar, create one using create_skill that fetches this data. If skill creation isn't possible right now, note what's missing and move on gracefully.

          ## Briefing preferences:
          Check the user's profile for any stored briefing preferences (additional topics to include, topics to skip). Honor those preferences.

          ## Format:
          Keep it concise — aim for a quick morning read, not a report. Use short paragraphs, not bullet-heavy walls of text.
        user: flyingchickens
      morning_briefing_weekend:
        cron: "0 8 * * 0,6"
        prompt: *briefing_prompt
        user: flyingchickens

  platforms:
    discord:
      enabled: true
      token: "${DISCORD_BOT_TOKEN}"
```

- [ ] **Step 2: Verify config loads correctly**

Run a quick smoke test: start CCBuddy and verify logs show the cron jobs being registered.

Look for: `[Scheduler] Started` and no "skipping" warnings for the briefing jobs.

---

### Task 10: Smoke test the briefing

- [ ] **Step 1: Start CCBuddy**

Run: `node bin/start.mjs > data/ccbuddy.stdout.log 2> data/ccbuddy.stderr.log &`

- [ ] **Step 2: Manually trigger a briefing for testing**

To test without waiting for the cron schedule, temporarily change one job's cron to fire in 1-2 minutes from now, or send a DM to CCBuddy with the briefing prompt directly. Verify:

- Agent receives memory context (conversation summaries from previous DMs)
- Agent can call `memory_grep` / `memory_describe` tools
- Agent can call `system_health` tool
- Agent responds with a properly formatted briefing
- Response appears in the Discord DM channel

- [ ] **Step 3: Verify no errors in logs**

Check: `tail -50 data/ccbuddy.log` and `cat data/ccbuddy.stderr.log`

- [ ] **Step 4: Final commit if any config tweaks needed**
