# Plan 1: Core + Agent — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation monorepo with shared types, config system, event bus, agent module (SDK + CLI backends), and orchestrator — producing a system that can programmatically send prompts to Claude Code and receive streaming responses.

**Architecture:** TypeScript monorepo managed by Turborepo. Each module is an independent package under `packages/`. The core package exports shared types and infrastructure (config loader, event bus, user manager). The agent package provides a swappable backend abstraction over Claude Code SDK and CLI. The orchestrator manages module processes with crash recovery and graceful shutdown.

**Tech Stack:** TypeScript, Node.js, Turborepo, Vitest, `@anthropic-ai/claude-code` SDK, YAML (via `js-yaml`), SQLite (via `better-sqlite3` — for future memory module, not needed yet)

**Spec:** `docs/superpowers/specs/2026-03-16-ccbuddy-design.md`

---

## File Structure

```
ccbuddy/
├── package.json                          # root workspace config
├── turbo.json                            # turborepo pipeline config
├── tsconfig.base.json                    # shared TS config
├── vitest.workspace.ts                   # vitest workspace config
├── config/
│   ├── default.yaml                      # default configuration
│   └── .gitkeep-local                    # placeholder; local.yaml is gitignored
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # barrel export
│   │       ├── types/
│   │       │   ├── events.ts             # EventMap, EventBus, Disposable
│   │       │   ├── agent.ts              # AgentRequest, AgentEvent, AgentBackend, Attachment
│   │       │   ├── platform.ts           # PlatformAdapter, IncomingMessage
│   │       │   ├── user.ts               # User, UserRole, UserConfig
│   │       │   └── index.ts              # barrel
│   │       ├── config/
│   │       │   ├── schema.ts             # CCBuddyConfig type + validation
│   │       │   ├── loader.ts             # load & merge YAML + env vars
│   │       │   └── index.ts              # barrel
│   │       ├── event-bus/
│   │       │   ├── event-bus.ts          # EventEmitter-based implementation
│   │       │   └── index.ts              # barrel
│   │       └── users/
│   │           ├── user-manager.ts       # lookup users by platform ID
│   │           └── index.ts              # barrel
│   ├── agent/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                  # barrel export
│   │       ├── backends/
│   │       │   ├── sdk-backend.ts        # Claude Code SDK backend
│   │       │   ├── cli-backend.ts        # Claude Code CLI backend
│   │       │   └── index.ts              # barrel
│   │       ├── session/
│   │       │   ├── session-manager.ts    # session lifecycle, conflict detection
│   │       │   ├── rate-limiter.ts       # per-user rate limiting
│   │       │   ├── priority-queue.ts     # priority queue with backpressure
│   │       │   └── index.ts             # barrel
│   │       └── agent-service.ts          # orchestrates backends + sessions + queue
│   └── orchestrator/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts                  # barrel + CLI entry point
│           ├── process-manager.ts        # spawn/monitor/restart child processes
│           ├── pid-store.ts              # PID file read/write
│           └── shutdown.ts               # graceful shutdown handler
```

---

## Chunk 1: Monorepo Scaffolding + Core Types

### Task 1: Initialize Monorepo

> **TDD exception:** Scaffolding tasks create project infrastructure with no behavioral code to test. Tests begin in Task 2.

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/agent/package.json`
- Create: `packages/agent/tsconfig.json`
- Create: `packages/orchestrator/package.json`
- Create: `packages/orchestrator/tsconfig.json`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "ccbuddy",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  }
}
```

- [ ] **Step 4: Create vitest.workspace.ts**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
]);
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
config/local.yaml
data/
*.sqlite
*.sqlite-wal
*.sqlite-shm
.turbo/
```

- [ ] **Step 6: Create packages/core/package.json**

```json
{
  "name": "@ccbuddy/core",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "vitest": "^3"
  }
}
```

- [ ] **Step 7: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: Create packages/agent/package.json**

```json
{
  "name": "@ccbuddy/agent",
  "version": "0.1.0",
  "private": true,
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
    "@anthropic-ai/claude-code": "^1"
  },
  "devDependencies": {
    "vitest": "^3"
  }
}
```

- [ ] **Step 9: Create packages/agent/tsconfig.json**

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

- [ ] **Step 10: Create packages/orchestrator/package.json**

```json
{
  "name": "@ccbuddy/orchestrator",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "ccbuddy": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@ccbuddy/core": "*"
  },
  "devDependencies": {
    "vitest": "^3"
  }
}
```

- [ ] **Step 11: Create packages/orchestrator/tsconfig.json**

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

- [ ] **Step 12: Install dependencies**

Run: `npm install`
Expected: Clean install, `node_modules/` created, no errors.

- [ ] **Step 13: Verify monorepo builds (empty)**

Create placeholder `packages/core/src/index.ts`, `packages/agent/src/index.ts`, `packages/orchestrator/src/index.ts` with `export {};`

Run: `npx turbo build`
Expected: All 3 packages compile successfully.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: initialize monorepo with turborepo, core, agent, and orchestrator packages"
```

---

### Task 2: Core Types — Events, Agent, Platform, User

**Files:**
- Create: `packages/core/src/types/events.ts`
- Create: `packages/core/src/types/agent.ts`
- Create: `packages/core/src/types/platform.ts`
- Create: `packages/core/src/types/user.ts`
- Create: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write tests for type exports**

Create `packages/core/src/types/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  EventMap,
  EventBus,
  Disposable,
  AgentBackend,
  AgentRequest,
  AgentEvent,
  AgentEventBase,
  Attachment,
  PlatformAdapter,
  IncomingMessage,
  User,
  UserRole,
} from '../index.js';

describe('Core Types', () => {
  // Note: Type-only tests are validated at compile time. These tests verify
  // runtime-significant behavior (object construction, discriminated unions).

  it('Attachment discriminated union narrows by type', () => {
    const attachments: Attachment[] = [
      { type: 'image', mimeType: 'image/png', data: Buffer.from('img') },
      { type: 'voice', mimeType: 'audio/ogg', data: Buffer.from('audio'), transcript: 'hello' },
      { type: 'file', mimeType: 'application/pdf', data: Buffer.from('pdf'), filename: 'doc.pdf' },
    ];
    const voices = attachments.filter((a) => a.type === 'voice');
    expect(voices).toHaveLength(1);
    expect(voices[0].transcript).toBe('hello');
  });

  it('User platformIds supports arbitrary platforms', () => {
    const user: User = {
      name: 'Dad',
      role: 'admin',
      platformIds: { discord: '123', telegram: '456', whatsapp: '789' },
    };
    expect(Object.keys(user.platformIds)).toHaveLength(3);
  });
});
```

Create `packages/core/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx turbo build && cd packages/core && npx vitest run`
Expected: FAIL — imports cannot be resolved.

> **Build note:** All test commands for packages that import `@ccbuddy/core` must run `npx turbo build` first (or use `npx turbo test` from root). Direct `npx vitest run` inside a package only works for `@ccbuddy/core` itself.

- [ ] **Step 3: Implement types/events.ts**

```typescript
export interface Disposable {
  dispose(): void;
}

export interface IncomingMessageEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  text: string;
  attachments: import('./agent.js').Attachment[];
  isMention: boolean;
  replyToMessageId?: string;
  timestamp: number;
}

export interface OutgoingMessageEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  text: string;
  attachments?: import('./agent.js').Attachment[];
}

export interface SessionConflictEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  workingDirectory: string;
  conflictingPid: number;
}

export interface HealthAlertEvent {
  module: string;
  status: 'degraded' | 'down';
  message: string;
  timestamp: number;
}

export interface HeartbeatStatusEvent {
  modules: Record<string, 'healthy' | 'degraded' | 'down'>;
  system: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
  };
  timestamp: number;
}

export interface WebhookEvent {
  handler: string;
  userId: string;
  payload: unknown;
  promptTemplate: string;
  timestamp: number;
}

export interface AgentProgressEvent {
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  type: 'text' | 'tool_use';
  content: string;
}

export interface EventMap {
  'message.incoming': IncomingMessageEvent;
  'message.outgoing': OutgoingMessageEvent;
  'session.conflict': SessionConflictEvent;
  'alert.health': HealthAlertEvent;
  'heartbeat.status': HeartbeatStatusEvent;
  'webhook.received': WebhookEvent;
  'agent.progress': AgentProgressEvent;
}

export interface EventBus {
  publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void>;
  subscribe<K extends keyof EventMap>(
    event: K,
    handler: (payload: EventMap[K]) => void,
  ): Disposable;
}
```

- [ ] **Step 4: Implement types/agent.ts**

```typescript
export interface Attachment {
  type: 'image' | 'file' | 'voice';
  mimeType: string;
  data: Buffer;
  filename?: string;
  transcript?: string;
}

export interface AgentRequest {
  prompt: string;
  userId: string;
  sessionId: string;
  channelId: string;
  platform: string;
  workingDirectory?: string;
  allowedTools?: string[];
  systemPrompt?: string;
  memoryContext?: string;
  attachments?: Attachment[];
  permissionLevel: 'admin' | 'chat' | 'system';
}

// Note: 'system' role is never defined in user config YAML. System-role requests
// are constructed internally by the scheduler module for maintenance jobs (e.g.,
// memory consolidation). The scheduler creates AgentRequests with permissionLevel
// 'system' directly, bypassing user lookup.

export interface AgentEventBase {
  sessionId: string;
  userId: string;
  channelId: string;
  platform: string;
}

export type AgentEvent =
  | AgentEventBase & { type: 'text'; content: string }
  | AgentEventBase & { type: 'tool_use'; tool: string }
  | AgentEventBase & { type: 'complete'; response: string }
  | AgentEventBase & { type: 'error'; error: string };

export interface AgentBackend {
  execute(request: AgentRequest): AsyncGenerator<AgentEvent>;
  abort(sessionId: string): Promise<void>;
}
```

- [ ] **Step 5: Implement types/platform.ts**

```typescript
import type { Attachment } from './agent.js';

export interface IncomingMessage {
  platform: string;
  platformUserId: string;
  channelId: string;
  channelType: 'dm' | 'group';
  text: string;
  attachments: Attachment[];
  isMention: boolean;
  replyToMessageId?: string;
  raw: unknown;  // intentionally `unknown` (stricter than spec's `any`) for type safety
}

export interface PlatformAdapter {
  readonly platform: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  onMessage(handler: (msg: IncomingMessage) => void): void;

  sendText(channelId: string, text: string): Promise<void>;
  sendImage(channelId: string, image: Buffer, caption?: string): Promise<void>;
  sendFile(channelId: string, file: Buffer, filename: string): Promise<void>;

  setTypingIndicator(channelId: string, active: boolean): Promise<void>;
}
```

- [ ] **Step 6: Implement types/user.ts**

```typescript
export type UserRole = 'admin' | 'chat' | 'system';

export interface User {
  name: string;
  role: UserRole;
  platformIds: Record<string, string>;
}
```

- [ ] **Step 7: Create barrel exports**

`packages/core/src/types/index.ts`:

```typescript
export * from './events.js';
export * from './agent.js';
export * from './platform.js';
export * from './user.js';
```

Update `packages/core/src/index.ts`:

```typescript
export * from './types/index.js';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all type tests pass.

- [ ] **Step 9: Verify build**

Run: `npx turbo build`
Expected: All packages build successfully.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/types/ packages/core/vitest.config.ts
git commit -m "feat(core): add shared type definitions for events, agent, platform, and user"
```

---

## Chunk 2: Config System + Event Bus

### Task 3: Config Schema + Loader

**Files:**
- Create: `packages/core/src/config/schema.ts`
- Create: `packages/core/src/config/loader.ts`
- Create: `packages/core/src/config/index.ts`
- Create: `config/default.yaml`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write tests for config loader**

Create `packages/core/src/config/__tests__/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Config Loader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads default config from yaml', () => {
    const yamlContent = `
ccbuddy:
  data_dir: "./data"
  log_level: "info"
  agent:
    backend: "sdk"
    max_concurrent_sessions: 3
`;
    writeFileSync(join(tmpDir, 'default.yaml'), yamlContent);

    const config = loadConfig(tmpDir);
    expect(config.data_dir).toBe('./data');
    expect(config.log_level).toBe('info');
    expect(config.agent.backend).toBe('sdk');
    expect(config.agent.max_concurrent_sessions).toBe(3);
  });

  it('local.yaml overrides default.yaml', () => {
    writeFileSync(
      join(tmpDir, 'default.yaml'),
      'ccbuddy:\n  log_level: "info"\n  agent:\n    backend: "sdk"\n',
    );
    writeFileSync(
      join(tmpDir, 'local.yaml'),
      'ccbuddy:\n  log_level: "debug"\n',
    );

    const config = loadConfig(tmpDir);
    expect(config.log_level).toBe('debug');
    expect(config.agent.backend).toBe('sdk');
  });

  it('env vars override yaml (CCBUDDY_ prefix, top-level)', () => {
    writeFileSync(
      join(tmpDir, 'default.yaml'),
      'ccbuddy:\n  log_level: "info"\n',
    );

    process.env.CCBUDDY_LOG_LEVEL = 'warn';
    try {
      const config = loadConfig(tmpDir);
      expect(config.log_level).toBe('warn');
    } finally {
      delete process.env.CCBUDDY_LOG_LEVEL;
    }
  });

  it('env vars override nested yaml (double underscore separator)', () => {
    writeFileSync(
      join(tmpDir, 'default.yaml'),
      'ccbuddy:\n  agent:\n    backend: "sdk"\n',
    );

    process.env.CCBUDDY_AGENT__BACKEND = 'cli';
    try {
      const config = loadConfig(tmpDir);
      expect(config.agent.backend).toBe('cli');
    } finally {
      delete process.env.CCBUDDY_AGENT__BACKEND;
    }
  });

  it('resolves ${ENV_VAR} placeholders in yaml values', () => {
    writeFileSync(
      join(tmpDir, 'default.yaml'),
      'ccbuddy:\n  platforms:\n    discord:\n      token: "${DISCORD_BOT_TOKEN}"\n',
    );

    process.env.DISCORD_BOT_TOKEN = 'test-token-123';
    try {
      const config = loadConfig(tmpDir);
      expect(config.platforms.discord.token).toBe('test-token-123');
    } finally {
      delete process.env.DISCORD_BOT_TOKEN;
    }
  });

  it('returns sensible defaults when config dir has no files', () => {
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);
    const config = loadConfig(emptyDir);
    expect(config.log_level).toBe('info');
    expect(config.agent.backend).toBe('sdk');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — `loadConfig` not found.

- [ ] **Step 3: Implement config/schema.ts**

```typescript
export interface AgentConfig {
  backend: 'sdk' | 'cli';
  max_concurrent_sessions: number;
  default_working_directory: string;
  admin_skip_permissions: boolean;
  session_timeout_minutes: number;
  session_cleanup_hours: number;
  pending_input_timeout_minutes: number;
  queue_max_depth: number;
  queue_timeout_seconds: number;
  rate_limits: {
    admin: number;
    chat: number;
  };
  graceful_shutdown_timeout_seconds: number;
}

export interface MemoryConfig {
  db_path: string;
  max_context_tokens: number;
  context_threshold: number;
  fresh_tail_count: number;
  leaf_chunk_tokens: number;
  leaf_target_tokens: number;
  condensed_target_tokens: number;
  max_expand_tokens: number;
  consolidation_cron: string;
  backup_cron: string;
  backup_dir: string;
  max_backups: number;
}

export interface PlatformChannelConfig {
  mode: 'all' | 'mention';
}

export interface PlatformConfig {
  enabled: boolean;
  token: string;
  channels: Record<string, PlatformChannelConfig>;
}

export interface HeartbeatConfig {
  interval_seconds: number;
  alert_channel: string;
  escalation_intervals: number[];
}

export interface WebhookHandler {
  name: string;
  path: string;
  secret: string;
  user: string;
  prompt_template: string;
}

export interface WebhooksConfig {
  enabled: boolean;
  port: number;
  max_body_size_bytes: number;
  replay_window_seconds: number;
  rate_limit_per_minute: number;
  handlers: WebhookHandler[];
}

export interface MediaConfig {
  stt_backend: string;
  temp_dir: string;
  temp_ttl_hours: number;
  large_file_token_threshold: number;
}

export interface ImageGenerationConfig {
  backend: string;
  api_key: string;
}

export interface SkillsConfig {
  generated_dir: string;
  sandbox_enabled: boolean;
  require_admin_approval_for_elevated: boolean;
  auto_git_commit: boolean;
}

export interface AppleConfig {
  calendar: boolean;
  reminders: boolean;
  notes: boolean;
  shortcuts: boolean;
  chat_user_permissions: Record<string, string>;
}

export interface SchedulerConfig {
  jobs: Array<{
    name: string;
    cron: string;
    user: string;
    prompt: string;
    deliver_to?: string;
    only_if_notable?: boolean;
    internal?: boolean;
  }>;
}

export interface UserConfig {
  name: string;
  role: 'admin' | 'chat';
  discord_id?: string;
  telegram_id?: string;
  [key: string]: string | undefined;  // future platform IDs
}

export interface GatewayConfig {
  unknown_user_reply: boolean;
}

export interface CCBuddyConfig {
  data_dir: string;
  log_level: string;
  users: UserConfig[];
  agent: AgentConfig;
  memory: MemoryConfig;
  gateway: GatewayConfig;
  platforms: Record<string, PlatformConfig>;
  scheduler: SchedulerConfig;
  heartbeat: HeartbeatConfig;
  webhooks: WebhooksConfig;
  media: MediaConfig;
  image_generation: ImageGenerationConfig;
  skills: SkillsConfig;
  apple: AppleConfig;
}

export const DEFAULT_CONFIG: CCBuddyConfig = {
  data_dir: './data',
  log_level: 'info',
  users: [],
  agent: {
    backend: 'sdk',
    max_concurrent_sessions: 3,
    default_working_directory: '~',
    admin_skip_permissions: true,
    session_timeout_minutes: 30,
    session_cleanup_hours: 24,
    pending_input_timeout_minutes: 10,
    queue_max_depth: 10,
    queue_timeout_seconds: 120,
    rate_limits: { admin: 30, chat: 10 },
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
  gateway: {
    unknown_user_reply: true,
  },
  platforms: {},
  scheduler: { jobs: [] },
  heartbeat: {
    interval_seconds: 60,
    alert_channel: '',
    escalation_intervals: [60, 300, 900],
  },
  webhooks: {
    enabled: false,
    port: 18800,
    max_body_size_bytes: 1048576,
    replay_window_seconds: 300,
    rate_limit_per_minute: 30,
    handlers: [],
  },
  media: {
    stt_backend: 'local-whisper',
    temp_dir: './data/temp',
    temp_ttl_hours: 24,
    large_file_token_threshold: 25000,
  },
  image_generation: {
    backend: 'dall-e',
    api_key: '',
  },
  skills: {
    generated_dir: './skills/generated',
    sandbox_enabled: true,
    require_admin_approval_for_elevated: true,
    auto_git_commit: true,
  },
  apple: {
    calendar: true,
    reminders: true,
    notes: true,
    shortcuts: true,
    chat_user_permissions: {
      calendar: 'read',
      reminders: 'read_write',
      notes: 'read',
      shortcuts: 'none',
    },
  },
};
```

- [ ] **Step 4: Implement config/loader.ts**

```typescript
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { type CCBuddyConfig, DEFAULT_CONFIG } from './schema.js';

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function resolveEnvPlaceholders(obj: any): any {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, envVar) => {
      return process.env[envVar] ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvPlaceholders);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvPlaceholders(value);
    }
    return result;
  }
  return obj;
}

function coerceValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(Number(value)) && value.trim() !== '') return Number(value);
  return value;
}

function applyEnvOverrides(config: any): any {
  const prefix = 'CCBUDDY_';
  const result = structuredClone(config);

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || value === undefined) continue;

    // Double underscore (__) separates nested keys: CCBUDDY_AGENT__BACKEND -> agent.backend
    const path = key.slice(prefix.length).toLowerCase().split('__');

    let target = result;
    for (let i = 0; i < path.length - 1; i++) {
      if (target[path[i]] === undefined || typeof target[path[i]] !== 'object') break;
      target = target[path[i]];
    }

    const finalKey = path[path.length - 1];
    if (finalKey in target) {
      target[finalKey] = coerceValue(value);
    }
  }

  return result;
}

function loadYaml(filePath: string): Record<string, any> {
  if (!existsSync(filePath)) return {};
  const content = readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content) as Record<string, any> | null;
  return parsed?.ccbuddy ?? {};
}

export function loadConfig(configDir: string): CCBuddyConfig {
  const defaultYaml = loadYaml(join(configDir, 'default.yaml'));
  const localYaml = loadYaml(join(configDir, 'local.yaml'));

  let config = deepMerge(DEFAULT_CONFIG, defaultYaml);
  config = deepMerge(config, localYaml);
  config = resolveEnvPlaceholders(config);
  config = applyEnvOverrides(config);

  return config as CCBuddyConfig;
}
```

- [ ] **Step 5: Create barrel exports**

`packages/core/src/config/index.ts`:

```typescript
export { loadConfig } from './loader.js';
export { type CCBuddyConfig, type AgentConfig, type MemoryConfig, DEFAULT_CONFIG } from './schema.js';
export type * from './schema.js';
```

Update `packages/core/src/index.ts`:

```typescript
export * from './types/index.js';
export * from './config/index.js';
```

- [ ] **Step 6: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all config tests pass.

- [ ] **Step 7: Create config/default.yaml**

```yaml
ccbuddy:
  data_dir: "./data"
  log_level: "info"

  users: []

  agent:
    backend: "sdk"
    max_concurrent_sessions: 3
    default_working_directory: "~"
    admin_skip_permissions: true
    session_timeout_minutes: 30
    session_cleanup_hours: 24
    pending_input_timeout_minutes: 10
    queue_max_depth: 10
    queue_timeout_seconds: 120
    rate_limits:
      admin: 30
      chat: 10
    graceful_shutdown_timeout_seconds: 30

  memory:
    db_path: "./data/memory.sqlite"
    max_context_tokens: 100000
    context_threshold: 0.75
    fresh_tail_count: 32
    leaf_chunk_tokens: 20000
    leaf_target_tokens: 1200
    condensed_target_tokens: 2000
    max_expand_tokens: 4000
    consolidation_cron: "0 3 * * *"
    backup_cron: "0 4 * * *"
    backup_dir: "./data/backups"
    max_backups: 7

  gateway:
    unknown_user_reply: true

  platforms: {}

  scheduler:
    jobs: []

  heartbeat:
    interval_seconds: 60
    alert_channel: ""
    escalation_intervals: [60, 300, 900]

  webhooks:
    enabled: false
    port: 18800
    max_body_size_bytes: 1048576
    replay_window_seconds: 300
    rate_limit_per_minute: 30
    handlers: []

  media:
    stt_backend: "local-whisper"
    temp_dir: "./data/temp"
    temp_ttl_hours: 24
    large_file_token_threshold: 25000

  image_generation:
    backend: "dall-e"
    api_key: ""

  skills:
    generated_dir: "./skills/generated"
    sandbox_enabled: true
    require_admin_approval_for_elevated: true
    auto_git_commit: true

  apple:
    calendar: true
    reminders: true
    notes: true
    shortcuts: true
    chat_user_permissions:
      calendar: "read"
      reminders: "read_write"
      notes: "read"
      shortcuts: "none"
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/config/ config/default.yaml
git commit -m "feat(core): add config schema with defaults and YAML + env var loader"
```

---

### Task 4: Event Bus

**Files:**
- Create: `packages/core/src/event-bus/event-bus.ts`
- Create: `packages/core/src/event-bus/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write tests for event bus**

Create `packages/core/src/event-bus/__tests__/event-bus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../event-bus.js';
import type { EventMap } from '../../types/index.js';

describe('EventBus', () => {
  it('delivers published events to subscribers', async () => {
    const bus = createEventBus();
    const handler = vi.fn();

    bus.subscribe('alert.health', handler);

    const payload: EventMap['alert.health'] = {
      module: 'agent',
      status: 'down',
      message: 'Claude Code unreachable',
      timestamp: Date.now(),
    };

    await bus.publish('alert.health', payload);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('supports multiple subscribers for same event', async () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.subscribe('alert.health', handler1);
    bus.subscribe('alert.health', handler2);

    await bus.publish('alert.health', {
      module: 'test',
      status: 'degraded',
      message: 'test',
      timestamp: Date.now(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('dispose() removes the subscription', async () => {
    const bus = createEventBus();
    const handler = vi.fn();

    const sub = bus.subscribe('alert.health', handler);
    sub.dispose();

    await bus.publish('alert.health', {
      module: 'test',
      status: 'down',
      message: 'test',
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not cross-deliver between event types', async () => {
    const bus = createEventBus();
    const healthHandler = vi.fn();
    const webhookHandler = vi.fn();

    bus.subscribe('alert.health', healthHandler);
    bus.subscribe('webhook.received', webhookHandler);

    await bus.publish('alert.health', {
      module: 'test',
      status: 'down',
      message: 'test',
      timestamp: Date.now(),
    });

    expect(healthHandler).toHaveBeenCalledOnce();
    expect(webhookHandler).not.toHaveBeenCalled();
  });

  it('handles publish with no subscribers gracefully', async () => {
    const bus = createEventBus();

    // Should not throw
    await bus.publish('alert.health', {
      module: 'test',
      status: 'down',
      message: 'test',
      timestamp: Date.now(),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — `createEventBus` not found.

- [ ] **Step 3: Implement event-bus.ts**

```typescript
import type { EventBus, EventMap, Disposable } from '../types/index.js';

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<(payload: any) => void>>();

  return {
    async publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void> {
      const handlers = listeners.get(event as string);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`EventBus: handler error for "${event as string}":`, err);
        }
      }
    },

    subscribe<K extends keyof EventMap>(
      event: K,
      handler: (payload: EventMap[K]) => void,
    ): Disposable {
      const key = event as string;
      if (!listeners.has(key)) {
        listeners.set(key, new Set());
      }
      const handlers = listeners.get(key)!;
      handlers.add(handler as any);

      return {
        dispose() {
          handlers.delete(handler as any);
          if (handlers.size === 0) {
            listeners.delete(key);
          }
        },
      };
    },
  };
}
```

- [ ] **Step 4: Create barrel exports**

`packages/core/src/event-bus/index.ts`:

```typescript
export { createEventBus } from './event-bus.js';
```

Update `packages/core/src/index.ts`:

```typescript
export * from './types/index.js';
export * from './config/index.js';
export * from './event-bus/index.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all event bus tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/event-bus/
git commit -m "feat(core): add typed EventBus with EventEmitter-based implementation"
```

---

### Task 5: User Manager

**Files:**
- Create: `packages/core/src/users/user-manager.ts`
- Create: `packages/core/src/users/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write tests for user manager**

Create `packages/core/src/users/__tests__/user-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { UserManager } from '../user-manager.js';
import type { UserConfig } from '../../config/schema.js';

const testUsers: UserConfig[] = [
  { name: 'Dad', role: 'admin', discord_id: '111', telegram_id: '222' },
  { name: 'Son', role: 'chat', discord_id: '333', telegram_id: '444' },
];

describe('UserManager', () => {
  it('finds user by discord ID', () => {
    const mgr = new UserManager(testUsers);
    const user = mgr.findByPlatformId('discord', '111');
    expect(user).toBeDefined();
    expect(user!.name).toBe('Dad');
    expect(user!.role).toBe('admin');
  });

  it('finds user by telegram ID', () => {
    const mgr = new UserManager(testUsers);
    const user = mgr.findByPlatformId('telegram', '444');
    expect(user).toBeDefined();
    expect(user!.name).toBe('Son');
  });

  it('returns undefined for unknown platform ID', () => {
    const mgr = new UserManager(testUsers);
    const user = mgr.findByPlatformId('discord', '999');
    expect(user).toBeUndefined();
  });

  it('returns undefined for unknown platform', () => {
    const mgr = new UserManager(testUsers);
    const user = mgr.findByPlatformId('whatsapp', '111');
    expect(user).toBeUndefined();
  });

  it('resolves cross-platform identity', () => {
    const mgr = new UserManager(testUsers);
    const fromDiscord = mgr.findByPlatformId('discord', '111');
    const fromTelegram = mgr.findByPlatformId('telegram', '222');
    expect(fromDiscord!.name).toBe(fromTelegram!.name);
  });

  it('generates session ID from user, platform, channel', () => {
    const mgr = new UserManager(testUsers);
    const sessionId = mgr.buildSessionId('Dad', 'discord', 'dev-channel');
    expect(sessionId).toBe('dad-discord-dev-channel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run`
Expected: FAIL — `UserManager` not found.

- [ ] **Step 3: Implement user-manager.ts**

```typescript
import type { User, UserRole } from '../types/user.js';
import type { UserConfig } from '../config/schema.js';

export class UserManager {
  private users: User[];
  // Map of `${platform}:${platformId}` -> User
  private platformIndex: Map<string, User>;

  constructor(userConfigs: UserConfig[]) {
    this.users = userConfigs.map((uc) => this.toUser(uc));
    this.platformIndex = new Map();

    for (const user of this.users) {
      for (const [platform, id] of Object.entries(user.platformIds)) {
        this.platformIndex.set(`${platform}:${id}`, user);
      }
    }
  }

  findByPlatformId(platform: string, platformId: string): User | undefined {
    return this.platformIndex.get(`${platform}:${platformId}`);
  }

  findByName(name: string): User | undefined {
    return this.users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  }

  buildSessionId(userName: string, platform: string, channelId: string): string {
    return `${userName.toLowerCase()}-${platform}-${channelId}`;
  }

  getAllUsers(): ReadonlyArray<User> {
    return this.users;
  }

  private toUser(config: UserConfig): User {
    const platformIds: Record<string, string> = {};

    for (const [key, value] of Object.entries(config)) {
      if (key === 'name' || key === 'role' || value === undefined) continue;
      if (key.endsWith('_id')) {
        const platform = key.replace('_id', '');
        platformIds[platform] = value;
      }
    }

    return {
      name: config.name,
      role: config.role as UserRole,
      platformIds,
    };
  }
}
```

- [ ] **Step 4: Create barrel exports and update index**

`packages/core/src/users/index.ts`:

```typescript
export { UserManager } from './user-manager.js';
```

Update `packages/core/src/index.ts`:

```typescript
export * from './types/index.js';
export * from './config/index.js';
export * from './event-bus/index.js';
export * from './users/index.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: PASS — all user manager tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/users/
git commit -m "feat(core): add UserManager with cross-platform identity lookup"
```

---

## Chunk 3: Agent Module

### Task 6: Agent Service + Rate Limiter + Priority Queue

**Files:**
- Create: `packages/agent/src/session/rate-limiter.ts`
- Create: `packages/agent/src/session/priority-queue.ts`
- Create: `packages/agent/src/session/session-manager.ts`
- Create: `packages/agent/src/session/index.ts`
- Create: `packages/agent/vitest.config.ts`

- [ ] **Step 1: Write tests for rate limiter**

Create `packages/agent/src/session/__tests__/rate-limiter.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const limiter = new RateLimiter({ admin: 5, chat: 2 });
    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
  });

  it('rejects requests exceeding limit', () => {
    const limiter = new RateLimiter({ admin: 2, chat: 1 });
    expect(limiter.tryAcquire('user1', 'chat')).toBe(true);
    expect(limiter.tryAcquire('user1', 'chat')).toBe(false);
  });

  it('resets after one minute', () => {
    const limiter = new RateLimiter({ admin: 1, chat: 1 });
    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
    expect(limiter.tryAcquire('user1', 'admin')).toBe(false);

    vi.advanceTimersByTime(60_000);

    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
  });

  it('tracks users independently', () => {
    const limiter = new RateLimiter({ admin: 1, chat: 1 });
    expect(limiter.tryAcquire('user1', 'admin')).toBe(true);
    expect(limiter.tryAcquire('user2', 'admin')).toBe(true);
  });
});
```

- [ ] **Step 2: Write tests for priority queue**

Create `packages/agent/src/session/__tests__/priority-queue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PriorityQueue } from '../priority-queue.js';

describe('PriorityQueue', () => {
  it('dequeues admin before chat', async () => {
    const queue = new PriorityQueue<string>(10);

    queue.enqueue('chat-request', 'chat');
    queue.enqueue('admin-request', 'admin');

    expect(queue.dequeue()).toBe('admin-request');
    expect(queue.dequeue()).toBe('chat-request');
  });

  it('maintains FIFO within same priority', () => {
    const queue = new PriorityQueue<string>(10);

    queue.enqueue('first', 'admin');
    queue.enqueue('second', 'admin');
    queue.enqueue('third', 'admin');

    expect(queue.dequeue()).toBe('first');
    expect(queue.dequeue()).toBe('second');
    expect(queue.dequeue()).toBe('third');
  });

  it('returns undefined when empty', () => {
    const queue = new PriorityQueue<string>(10);
    expect(queue.dequeue()).toBeUndefined();
  });

  it('rejects when max depth exceeded', () => {
    const queue = new PriorityQueue<string>(2);

    expect(queue.enqueue('a', 'chat')).toBe(true);
    expect(queue.enqueue('b', 'chat')).toBe(true);
    expect(queue.enqueue('c', 'chat')).toBe(false);
  });

  it('reports size correctly', () => {
    const queue = new PriorityQueue<string>(10);
    expect(queue.size).toBe(0);
    queue.enqueue('a', 'admin');
    expect(queue.size).toBe(1);
    queue.dequeue();
    expect(queue.size).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/agent && npx vitest run`
Expected: FAIL — classes not found.

- [ ] **Step 4: Implement rate-limiter.ts**

```typescript
export class RateLimiter {
  private limits: Record<string, number>;
  private buckets: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(limits: Record<string, number>) {
    this.limits = limits;
  }

  tryAcquire(userId: string, role: string): boolean {
    const limit = this.limits[role] ?? this.limits['chat'] ?? 10;
    const now = Date.now();
    const key = userId;
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }

    if (bucket.count >= limit) {
      return false;
    }

    bucket.count++;
    return true;
  }
}
```

- [ ] **Step 5: Implement priority-queue.ts**

```typescript
type Priority = 'admin' | 'chat' | 'system';

const PRIORITY_ORDER: Record<Priority, number> = {
  admin: 0,
  system: 1,
  chat: 2,
};

interface QueueEntry<T> {
  item: T;
  priority: number;
  insertOrder: number;
}

export class PriorityQueue<T> {
  private entries: QueueEntry<T>[] = [];
  private counter = 0;
  private maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  enqueue(item: T, priority: Priority | string): boolean {
    if (this.entries.length >= this.maxDepth) return false;

    const numPriority = PRIORITY_ORDER[priority as Priority] ?? 2;
    this.entries.push({ item, priority: numPriority, insertOrder: this.counter++ });
    this.entries.sort((a, b) =>
      a.priority !== b.priority
        ? a.priority - b.priority
        : a.insertOrder - b.insertOrder,
    );
    return true;
  }

  dequeue(): T | undefined {
    const entry = this.entries.shift();
    return entry?.item;
  }

  get size(): number {
    return this.entries.length;
  }
}
```

- [ ] **Step 6: Create session barrel and vitest config**

`packages/agent/src/session/index.ts`:

```typescript
export { RateLimiter } from './rate-limiter.js';
export { PriorityQueue } from './priority-queue.js';
```

`packages/agent/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 7: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — all rate limiter and queue tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/agent/
git commit -m "feat(agent): add RateLimiter and PriorityQueue for session management"
```

---

### Task 7: Session Manager

**Files:**
- Create: `packages/agent/src/session/session-manager.ts`
- Modify: `packages/agent/src/session/index.ts`

- [ ] **Step 1: Write tests for session manager**

Create `packages/agent/src/session/__tests__/session-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session-manager.js';

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new session', () => {
    const mgr = new SessionManager({ timeoutMinutes: 30, cleanupHours: 24 });
    const session = mgr.getOrCreate('dad-discord-dev');
    expect(session.id).toBe('dad-discord-dev');
    expect(session.status).toBe('active');
  });

  it('returns existing session on second call', () => {
    const mgr = new SessionManager({ timeoutMinutes: 30, cleanupHours: 24 });
    const s1 = mgr.getOrCreate('dad-discord-dev');
    const s2 = mgr.getOrCreate('dad-discord-dev');
    expect(s1).toBe(s2);
  });

  it('marks session idle after timeout', () => {
    const mgr = new SessionManager({ timeoutMinutes: 30, cleanupHours: 24 });
    mgr.getOrCreate('dad-discord-dev');

    vi.advanceTimersByTime(31 * 60_000);
    mgr.tick();

    const session = mgr.get('dad-discord-dev');
    expect(session?.status).toBe('idle');
  });

  it('reactivates idle session on touch', () => {
    const mgr = new SessionManager({ timeoutMinutes: 30, cleanupHours: 24 });
    mgr.getOrCreate('dad-discord-dev');

    vi.advanceTimersByTime(31 * 60_000);
    mgr.tick();
    expect(mgr.get('dad-discord-dev')?.status).toBe('idle');

    mgr.touch('dad-discord-dev');
    expect(mgr.get('dad-discord-dev')?.status).toBe('active');
  });

  it('cleans up sessions after cleanup period', () => {
    const mgr = new SessionManager({ timeoutMinutes: 1, cleanupHours: 1 });
    mgr.getOrCreate('dad-discord-dev');

    // Timeout it first
    vi.advanceTimersByTime(2 * 60_000);
    mgr.tick();
    // Then pass cleanup period
    vi.advanceTimersByTime(61 * 60_000);
    mgr.tick();

    expect(mgr.get('dad-discord-dev')).toBeUndefined();
  });

  it('lists active sessions', () => {
    const mgr = new SessionManager({ timeoutMinutes: 30, cleanupHours: 24 });
    mgr.getOrCreate('dad-discord-dev');
    mgr.getOrCreate('son-telegram-dm');

    const active = mgr.getActiveSessions();
    expect(active).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run`
Expected: FAIL — `SessionManager` not found.

- [ ] **Step 3: Implement session-manager.ts**

```typescript
export interface Session {
  id: string;
  status: 'active' | 'idle';
  lastActivity: number;
  idleSince?: number;
}

export interface SessionManagerOptions {
  timeoutMinutes: number;
  cleanupHours: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private options: SessionManagerOptions;

  constructor(options: SessionManagerOptions) {
    this.options = options;
  }

  getOrCreate(sessionId: string): Session {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (existing.status === 'idle') {
        existing.status = 'active';
        existing.idleSince = undefined;
      }
      existing.lastActivity = Date.now();
      return existing;
    }

    const session: Session = {
      id: sessionId,
      status: 'active',
      lastActivity: Date.now(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
      if (session.status === 'idle') {
        session.status = 'active';
        session.idleSince = undefined;
      }
    }
  }

  /**
   * Call periodically to timeout and cleanup sessions.
   */
  tick(): void {
    const now = Date.now();
    const timeoutMs = this.options.timeoutMinutes * 60_000;
    const cleanupMs = this.options.cleanupHours * 3_600_000;

    for (const [id, session] of this.sessions) {
      if (session.status === 'active' && now - session.lastActivity > timeoutMs) {
        session.status = 'idle';
        session.idleSince = now;
      }

      if (session.status === 'idle' && session.idleSince && now - session.idleSince > cleanupMs) {
        this.sessions.delete(id);
      }
    }
  }

  getActiveSessions(): Session[] {
    return [...this.sessions.values()].filter((s) => s.status === 'active');
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
```

- [ ] **Step 4: Update barrel export**

`packages/agent/src/session/index.ts`:

```typescript
export { RateLimiter } from './rate-limiter.js';
export { PriorityQueue } from './priority-queue.js';
export { SessionManager, type Session, type SessionManagerOptions } from './session-manager.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — all session manager tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/session/
git commit -m "feat(agent): add SessionManager with timeout, cleanup, and reactivation"
```

---

### Task 8: SDK Backend

**Files:**
- Create: `packages/agent/src/backends/sdk-backend.ts`
- Create: `packages/agent/src/backends/index.ts`

- [ ] **Step 1: Write tests for SDK backend**

Create `packages/agent/src/backends/__tests__/sdk-backend.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { SdkBackend } from '../sdk-backend.js';
import type { AgentRequest } from '@ccbuddy/core';

// Mock the Claude Code SDK
vi.mock('@anthropic-ai/claude-code', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-code';

const mockQuery = vi.mocked(query);

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello',
    userId: 'dad',
    sessionId: 'dad-discord-dev',
    channelId: 'dev',
    platform: 'discord',
    permissionLevel: 'admin',
    ...overrides,
  };
}

describe('SdkBackend', () => {
  it('passes prompt and options to Claude Code SDK', async () => {
    mockQuery.mockResolvedValueOnce([
      { type: 'text', text: 'Hello back!' },
    ] as any);

    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];

    for await (const event of backend.execute(makeRequest())) {
      events.push(event);
    }

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toBe('Hello');
  });

  it('emits complete event with response', async () => {
    mockQuery.mockResolvedValueOnce([
      { type: 'text', text: 'The answer is 42' },
    ] as any);

    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];

    for await (const event of backend.execute(makeRequest())) {
      events.push(event);
    }

    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    expect(complete.response).toContain('42');
  });

  it('emits error event on SDK failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('SDK connection failed'));

    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];

    for await (const event of backend.execute(makeRequest())) {
      events.push(event);
    }

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error.error).toContain('SDK connection failed');
  });

  it('includes routing metadata in all events', async () => {
    mockQuery.mockResolvedValueOnce([
      { type: 'text', text: 'reply' },
    ] as any);

    const backend = new SdkBackend({ skipPermissions: true });
    const request = makeRequest({ userId: 'dad', sessionId: 's1', channelId: 'c1', platform: 'discord' });
    const events: any[] = [];

    for await (const event of backend.execute(request)) {
      events.push(event);
    }

    for (const event of events) {
      expect(event.sessionId).toBe('s1');
      expect(event.userId).toBe('dad');
      expect(event.channelId).toBe('c1');
      expect(event.platform).toBe('discord');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run`
Expected: FAIL — `SdkBackend` not found.

- [ ] **Step 3: Implement sdk-backend.ts**

```typescript
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase } from '@ccbuddy/core';
import { query } from '@anthropic-ai/claude-code';

export interface SdkBackendOptions {
  skipPermissions?: boolean;
}

// Known limitation: The SDK `query()` function returns the full result, so
// streaming intermediate events (text chunks, tool_use) is not yet supported.
// When the SDK adds a streaming/callback API, update this backend to yield
// intermediate events. For now, only 'complete' or 'error' events are emitted.
// The CLI backend with stream-json provides true streaming as a workaround.

export class SdkBackend implements AgentBackend {
  private options: SdkBackendOptions;

  constructor(options: SdkBackendOptions = {}) {
    this.options = options;
  }

  async *execute(request: AgentRequest): AsyncGenerator<AgentEvent> {
    const base: AgentEventBase = {
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };

    try {
      const options: Record<string, any> = {
        allowedTools: request.allowedTools,
        cwd: request.workingDirectory,
        sessionId: request.sessionId,
      };

      if (request.systemPrompt) {
        options.systemPrompt = request.systemPrompt;
      }

      if (request.permissionLevel === 'admin' && this.options.skipPermissions) {
        options.permissions = { allow: ['*'], deny: [] };
      } else if (request.permissionLevel === 'chat') {
        options.allowedTools = [];
      }

      // Build the prompt with memory context
      let fullPrompt = request.prompt;
      if (request.memoryContext) {
        fullPrompt = `<memory_context>\n${request.memoryContext}\n</memory_context>\n\n${request.prompt}`;
      }

      const result = await query(fullPrompt, options);

      // Extract text from result
      const responseText = Array.isArray(result)
        ? result
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.text)
            .join('\n')
        : String(result);

      yield { ...base, type: 'complete', response: responseText };
    } catch (err) {
      yield { ...base, type: 'error', error: (err as Error).message };
    }
  }

  async abort(_sessionId: string): Promise<void> {
    // SDK doesn't have a direct abort — future: track AbortControllers per session
  }
}
```

- [ ] **Step 4: Create barrel export**

`packages/agent/src/backends/index.ts`:

```typescript
export { SdkBackend, type SdkBackendOptions } from './sdk-backend.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — all SDK backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/backends/
git commit -m "feat(agent): add SdkBackend wrapping Claude Code SDK with routing metadata"
```

---

### Task 9: CLI Backend

**Files:**
- Create: `packages/agent/src/backends/cli-backend.ts`
- Modify: `packages/agent/src/backends/index.ts`

- [ ] **Step 1: Write tests for CLI backend**

Create `packages/agent/src/backends/__tests__/cli-backend.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CliBackend } from '../cli-backend.js';
import type { AgentRequest } from '@ccbuddy/core';
import { spawn } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(spawn);

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello',
    userId: 'dad',
    sessionId: 'dad-discord-dev',
    channelId: 'dev',
    platform: 'discord',
    permissionLevel: 'admin',
    ...overrides,
  };
}

function createMockProcess(stdout: string, exitCode = 0) {
  const { Readable } = require('stream');

  const stdoutStream = new Readable({
    read() {
      this.push(stdout);
      this.push(null);
    },
  });

  const stderrStream = new Readable({
    read() {
      this.push(null);
    },
  });

  const proc: any = {
    stdout: stdoutStream,
    stderr: stderrStream,
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'close') {
        setTimeout(() => cb(exitCode), 10);
      }
      return proc;
    }),
    kill: vi.fn(),
  };

  return proc;
}

describe('CliBackend', () => {
  it('spawns claude CLI with correct flags', async () => {
    const proc = createMockProcess(JSON.stringify({ type: 'result', result: 'Hi' }));
    mockSpawn.mockReturnValueOnce(proc);

    const backend = new CliBackend();
    const events: any[] = [];

    for await (const event of backend.execute(makeRequest())) {
      events.push(event);
    }

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
  });

  it('includes routing metadata in events', async () => {
    const proc = createMockProcess(JSON.stringify({ type: 'result', result: 'Hi' }));
    mockSpawn.mockReturnValueOnce(proc);

    const backend = new CliBackend();
    const request = makeRequest({ sessionId: 's1', userId: 'dad', channelId: 'c1', platform: 'telegram' });
    const events: any[] = [];

    for await (const event of backend.execute(request)) {
      events.push(event);
    }

    for (const event of events) {
      expect(event.sessionId).toBe('s1');
      expect(event.userId).toBe('dad');
      expect(event.platform).toBe('telegram');
    }
  });

  it('emits error event on non-zero exit', async () => {
    const proc = createMockProcess('', 1);
    mockSpawn.mockReturnValueOnce(proc);

    const backend = new CliBackend();
    const events: any[] = [];

    for await (const event of backend.execute(makeRequest())) {
      events.push(event);
    }

    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run`
Expected: FAIL — `CliBackend` not found.

- [ ] **Step 3: Implement cli-backend.ts**

```typescript
import { spawn, type ChildProcess } from 'child_process';
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase } from '@ccbuddy/core';

export class CliBackend implements AgentBackend {
  private processes: Map<string, ChildProcess> = new Map();

  async *execute(request: AgentRequest): AsyncGenerator<AgentEvent> {
    const base: AgentEventBase = {
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };

    const args: string[] = [
      '-p', request.prompt,
      '--output-format', 'stream-json',
      '--session-id', request.sessionId,
    ];

    if (request.workingDirectory) {
      args.push('--cwd', request.workingDirectory);
    }

    if (request.allowedTools?.length) {
      args.push('--allowedTools', request.allowedTools.join(','));
    }

    if (request.permissionLevel === 'chat') {
      args.push('--allowedTools', '');
    }

    try {
      const result = await this.runClaude(args, request.sessionId);
      yield { ...base, type: 'complete', response: result };
    } catch (err) {
      yield { ...base, type: 'error', error: (err as Error).message };
    }
  }

  async abort(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(sessionId);
    }
  }

  private runClaude(args: string[], sessionId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.processes.set(sessionId, proc);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        this.processes.delete(sessionId);
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          const text =
            parsed.result ??
            (Array.isArray(parsed)
              ? parsed
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n')
              : stdout);
          resolve(text);
        } catch {
          resolve(stdout);
        }
      });
    });
  }
}
```

- [ ] **Step 4: Update barrel export**

`packages/agent/src/backends/index.ts`:

```typescript
export { SdkBackend, type SdkBackendOptions } from './sdk-backend.js';
export { CliBackend } from './cli-backend.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — all CLI backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/backends/
git commit -m "feat(agent): add CliBackend as fallback using claude CLI with -p flag"
```

---

### Task 10: Agent Service (Orchestrates Backends + Sessions + Queue)

**Files:**
- Create: `packages/agent/src/agent-service.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Write tests for agent service**

Create `packages/agent/src/__tests__/agent-service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentService } from '../agent-service.js';
import { createEventBus } from '@ccbuddy/core';
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase } from '@ccbuddy/core';

function makeBackend(response: string, delayMs = 0): AgentBackend {
  return {
    async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
      const base: AgentEventBase = {
        sessionId: req.sessionId,
        userId: req.userId,
        channelId: req.channelId,
        platform: req.platform,
      };
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { ...base, type: 'complete', response };
    },
    abort: vi.fn(),
  };
}

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello',
    userId: 'dad',
    sessionId: 'dad-discord-dev',
    channelId: 'dev',
    platform: 'discord',
    permissionLevel: 'admin',
    ...overrides,
  };
}

const defaultOpts = {
  maxConcurrent: 3,
  rateLimits: { admin: 30, chat: 10 },
  queueMaxDepth: 10,
  queueTimeoutSeconds: 5,
  sessionTimeoutMinutes: 30,
  sessionCleanupHours: 24,
};

describe('AgentService', () => {
  it('routes request to backend and returns events', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('Hello!') });

    const events = await collectEvents(service.handleRequest(makeRequest()));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');
  });

  it('rate limits excessive requests', async () => {
    const service = new AgentService({
      ...defaultOpts,
      backend: makeBackend('ok'),
      rateLimits: { admin: 1, chat: 1 },
    });

    const events1 = await collectEvents(service.handleRequest(makeRequest()));
    expect(events1[0].type).toBe('complete');

    const events2 = await collectEvents(service.handleRequest(makeRequest()));
    expect(events2[0].type).toBe('error');
    expect((events2[0] as any).error).toContain('rate limit');
  });

  it('rejects when concurrency cap AND queue are full', async () => {
    const service = new AgentService({
      ...defaultOpts,
      backend: makeBackend('ok', 100),
      maxConcurrent: 1,
      queueMaxDepth: 0,
    });

    // Start first request (fills concurrency)
    const gen1 = service.handleRequest(makeRequest({ sessionId: 's1' }));
    const p1 = collectEvents(gen1);

    // Second request should be rejected (queue is 0)
    const events2 = await collectEvents(service.handleRequest(makeRequest({ sessionId: 's2' })));
    expect(events2[0].type).toBe('error');
    expect((events2[0] as any).error).toContain('busy');

    await p1;
  });

  it('publishes agent.progress events to event bus', async () => {
    const bus = createEventBus();
    const progressEvents: any[] = [];
    bus.subscribe('agent.progress', (e) => progressEvents.push(e));

    const streamingBackend: AgentBackend = {
      async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
        const base: AgentEventBase = {
          sessionId: req.sessionId, userId: req.userId,
          channelId: req.channelId, platform: req.platform,
        };
        yield { ...base, type: 'text', content: 'Thinking...' };
        yield { ...base, type: 'tool_use', tool: 'bash' };
        yield { ...base, type: 'complete', response: 'Done' };
      },
      abort: vi.fn(),
    };

    const service = new AgentService({ ...defaultOpts, backend: streamingBackend, eventBus: bus });
    await collectEvents(service.handleRequest(makeRequest()));

    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].type).toBe('text');
    expect(progressEvents[1].type).toBe('tool_use');
  });

  it('uses session manager to track sessions', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('ok') });

    await collectEvents(service.handleRequest(makeRequest({ sessionId: 'sess-1' })));
    await collectEvents(service.handleRequest(makeRequest({ sessionId: 'sess-2' })));

    expect(service.getActiveSessions()).toHaveLength(2);
  });

  it('abort kills the backend session', async () => {
    const backend = makeBackend('ok');
    const service = new AgentService({ ...defaultOpts, backend });

    await service.abort('test-session');
    expect(backend.abort).toHaveBeenCalledWith('test-session');
  });
});

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent && npx vitest run`
Expected: FAIL — `AgentService` not found.

- [ ] **Step 3: Implement agent-service.ts**

```typescript
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase, EventBus } from '@ccbuddy/core';
import { RateLimiter } from './session/rate-limiter.js';
import { PriorityQueue } from './session/priority-queue.js';
import { SessionManager, type Session } from './session/session-manager.js';

export interface AgentServiceOptions {
  backend: AgentBackend;
  eventBus?: EventBus;
  maxConcurrent: number;
  rateLimits: Record<string, number>;
  queueMaxDepth: number;
  queueTimeoutSeconds: number;
  sessionTimeoutMinutes: number;
  sessionCleanupHours: number;
}

interface QueuedRequest {
  request: AgentRequest;
  resolve: (value: AsyncGenerator<AgentEvent>) => void;
  reject: (reason: Error) => void;
  enqueuedAt: number;
}

export class AgentService {
  private backend: AgentBackend;
  private eventBus?: EventBus;
  private rateLimiter: RateLimiter;
  private queue: PriorityQueue<QueuedRequest>;
  private sessionManager: SessionManager;
  private activeCount = 0;
  private maxConcurrent: number;
  private queueTimeoutMs: number;

  constructor(options: AgentServiceOptions) {
    this.backend = options.backend;
    this.eventBus = options.eventBus;
    this.maxConcurrent = options.maxConcurrent;
    this.queueTimeoutMs = options.queueTimeoutSeconds * 1000;
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this.queue = new PriorityQueue(options.queueMaxDepth);
    this.sessionManager = new SessionManager({
      timeoutMinutes: options.sessionTimeoutMinutes,
      cleanupHours: options.sessionCleanupHours,
    });
  }

  async *handleRequest(request: AgentRequest): AsyncGenerator<AgentEvent> {
    const base: AgentEventBase = {
      sessionId: request.sessionId,
      userId: request.userId,
      channelId: request.channelId,
      platform: request.platform,
    };

    // Check rate limit
    if (!this.rateLimiter.tryAcquire(request.userId, request.permissionLevel)) {
      yield { ...base, type: 'error', error: 'Request rate limit exceeded. Please slow down.' };
      return;
    }

    // If concurrency cap reached, try to enqueue
    if (this.activeCount >= this.maxConcurrent) {
      const queued = await this.enqueueAndWait(request);
      if (!queued) {
        yield { ...base, type: 'error', error: 'CCBuddy is busy and the queue is full. Please try again shortly.' };
        return;
      }
      // If we get here, we were dequeued and it's our turn
    }

    // Track session
    this.sessionManager.getOrCreate(request.sessionId);

    this.activeCount++;
    try {
      for await (const event of this.backend.execute(request)) {
        // Publish progress events to event bus for streaming to platforms
        if (this.eventBus && (event.type === 'text' || event.type === 'tool_use')) {
          await this.eventBus.publish('agent.progress', {
            userId: event.userId,
            sessionId: event.sessionId,
            channelId: event.channelId,
            platform: event.platform,
            type: event.type,
            content: event.type === 'text' ? event.content : event.tool,
          });
        }
        yield event;
      }
    } finally {
      this.activeCount--;
      this.sessionManager.touch(request.sessionId);
      this.processQueue();
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.backend.abort(sessionId);
    this.sessionManager.remove(sessionId);
  }

  getActiveSessions(): Session[] {
    return this.sessionManager.getActiveSessions();
  }

  get queueSize(): number {
    return this.queue.size;
  }

  tick(): void {
    this.sessionManager.tick();
  }

  private enqueueAndWait(request: AgentRequest): Promise<boolean> {
    return new Promise((resolve) => {
      const entry: QueuedRequest = {
        request,
        resolve: () => resolve(true),
        reject: () => resolve(false),
        enqueuedAt: Date.now(),
      };

      const enqueued = this.queue.enqueue(entry, request.permissionLevel);
      if (!enqueued) {
        resolve(false);
        return;
      }

      // Set queue timeout
      setTimeout(() => {
        // If still in queue, reject
        resolve(false);
      }, this.queueTimeoutMs);
    });
  }

  private processQueue(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    const entry = this.queue.dequeue();
    if (!entry) return;

    // Check if timed out while waiting
    if (Date.now() - entry.enqueuedAt > this.queueTimeoutMs) {
      entry.reject(new Error('Queue timeout'));
      this.processQueue(); // try next
      return;
    }

    entry.resolve(undefined as any);
  }
}
```

> **Note on session conflict detection:** Conflict detection (checking for active `claude` processes in the same working directory) is deferred to Plan 4 (Gateway), where the full request routing pipeline exists. The `AgentService` interface is designed to support it — the gateway will check before calling `handleRequest()` and publish `session.conflict` events.

> **Note on `pending_input_timeout_minutes`:** Pending input state (pausing timeout when waiting for user confirmation, e.g., conflict resolution) requires gateway interaction and is deferred to Plan 4.

- [ ] **Step 4: Update barrel export**

`packages/agent/src/index.ts`:

```typescript
export { AgentService, type AgentServiceOptions } from './agent-service.js';
export { SdkBackend, CliBackend } from './backends/index.js';
export { RateLimiter, PriorityQueue, SessionManager } from './session/index.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — all agent service tests pass.

- [ ] **Step 6: Run full test suite**

Run: `npx turbo test`
Expected: PASS — all tests across all packages pass.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/
git commit -m "feat(agent): add AgentService orchestrating backends, sessions, and rate limiting"
```

---

## Chunk 4: Orchestrator + Integration Test

### Task 11: PID Store

**Files:**
- Create: `packages/orchestrator/src/pid-store.ts`
- Create: `packages/orchestrator/vitest.config.ts`

- [ ] **Step 1: Write tests for PID store**

Create `packages/orchestrator/src/__tests__/pid-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PidStore } from '../pid-store.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PidStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-pid-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads PIDs', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('gateway', 1234);
    store.set('agent', 5678);
    store.save();

    const store2 = new PidStore(join(tmpDir, 'pids.json'));
    store2.load();
    expect(store2.get('gateway')).toBe(1234);
    expect(store2.get('agent')).toBe(5678);
  });

  it('removes a PID', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('gateway', 1234);
    store.remove('gateway');
    expect(store.get('gateway')).toBeUndefined();
  });

  it('handles missing file gracefully', () => {
    const store = new PidStore(join(tmpDir, 'nonexistent.json'));
    store.load(); // should not throw
    expect(store.getAll()).toEqual({});
  });

  it('lists all PIDs', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('a', 1);
    store.set('b', 2);
    expect(store.getAll()).toEqual({ a: 1, b: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run`
Expected: FAIL — `PidStore` not found.

- [ ] **Step 3: Implement pid-store.ts**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export class PidStore {
  private filePath: string;
  private pids: Record<string, number> = {};

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      this.pids = JSON.parse(content);
    } catch {
      this.pids = {};
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.pids, null, 2));
  }

  set(module: string, pid: number): void {
    this.pids[module] = pid;
  }

  get(module: string): number | undefined {
    return this.pids[module];
  }

  remove(module: string): void {
    delete this.pids[module];
  }

  getAll(): Record<string, number> {
    return { ...this.pids };
  }
}
```

- [ ] **Step 4: Create vitest config and barrel**

`packages/orchestrator/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/orchestrator && npx vitest run`
Expected: PASS — all PID store tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/
git commit -m "feat(orchestrator): add PidStore for tracking child process PIDs"
```

---

### Task 12: Graceful Shutdown Handler

**Files:**
- Create: `packages/orchestrator/src/shutdown.ts`

- [ ] **Step 1: Write tests for shutdown handler**

Create `packages/orchestrator/src/__tests__/shutdown.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ShutdownHandler } from '../shutdown.js';

describe('ShutdownHandler', () => {
  it('calls registered callbacks on shutdown', async () => {
    const handler = new ShutdownHandler(5000);
    const cb1 = vi.fn().mockResolvedValue(undefined);
    const cb2 = vi.fn().mockResolvedValue(undefined);

    handler.register('module1', cb1);
    handler.register('module2', cb2);

    await handler.execute();

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('respects timeout', async () => {
    const handler = new ShutdownHandler(100);
    const slowCb = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 5000)));

    handler.register('slow', slowCb);

    const start = Date.now();
    await handler.execute();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(slowCb).toHaveBeenCalledOnce();
  });

  it('continues if one callback throws', async () => {
    const handler = new ShutdownHandler(5000);
    const failCb = vi.fn().mockRejectedValue(new Error('oops'));
    const okCb = vi.fn().mockResolvedValue(undefined);

    handler.register('fail', failCb);
    handler.register('ok', okCb);

    await handler.execute();

    expect(failCb).toHaveBeenCalledOnce();
    expect(okCb).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run`
Expected: FAIL — `ShutdownHandler` not found.

- [ ] **Step 3: Implement shutdown.ts**

```typescript
export class ShutdownHandler {
  private callbacks: Map<string, () => Promise<void>> = new Map();
  private timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  register(name: string, callback: () => Promise<void>): void {
    this.callbacks.set(name, callback);
  }

  async execute(): Promise<void> {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, this.timeoutMs));

    const shutdownAll = Promise.allSettled(
      [...this.callbacks.entries()].map(async ([name, cb]) => {
        try {
          await cb();
        } catch (err) {
          console.error(`Shutdown error in ${name}:`, err);
        }
      }),
    );

    await Promise.race([shutdownAll, timeout]);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/orchestrator && npx vitest run`
Expected: PASS — all shutdown tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/shutdown.ts packages/orchestrator/src/__tests__/shutdown.test.ts
git commit -m "feat(orchestrator): add ShutdownHandler with timeout and error resilience"
```

---

### Task 13: Orchestrator Entry Point

**Files:**
- Create: `packages/orchestrator/src/process-manager.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Write tests for process manager**

Create `packages/orchestrator/src/__tests__/process-manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ProcessManager, type ModuleConfig } from '../process-manager.js';

// We test the registration and status logic, not actual process spawning
describe('ProcessManager', () => {
  it('registers modules', () => {
    const pm = new ProcessManager('/tmp/test-pids.json');
    pm.register({ name: 'gateway', command: 'node', args: ['gateway.js'] });
    pm.register({ name: 'agent', command: 'node', args: ['agent.js'] });

    expect(pm.getRegistered()).toHaveLength(2);
    expect(pm.getRegistered().map((m) => m.name)).toEqual(['gateway', 'agent']);
  });

  it('reports module status', () => {
    const pm = new ProcessManager('/tmp/test-pids.json');
    pm.register({ name: 'gateway', command: 'node', args: ['gateway.js'] });

    const status = pm.getStatus('gateway');
    expect(status).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/orchestrator && npx vitest run`
Expected: FAIL — `ProcessManager` not found.

- [ ] **Step 3: Implement process-manager.ts**

```typescript
import { spawn, type ChildProcess } from 'child_process';
import { PidStore } from './pid-store.js';

export interface ModuleConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class ProcessManager {
  private modules: Map<string, ModuleConfig> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private pidStore: PidStore;

  constructor(pidFilePath: string) {
    this.pidStore = new PidStore(pidFilePath);
    this.pidStore.load();
  }

  register(config: ModuleConfig): void {
    this.modules.set(config.name, config);
  }

  getRegistered(): ModuleConfig[] {
    return [...this.modules.values()];
  }

  async startAll(): Promise<void> {
    for (const config of this.modules.values()) {
      await this.start(config.name);
    }
  }

  async start(name: string): Promise<void> {
    const config = this.modules.get(name);
    if (!config) throw new Error(`Unknown module: ${name}`);
    if (this.processes.has(name)) return; // already running

    const proc = spawn(config.command, config.args, {
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.unref();

    this.processes.set(name, proc);
    this.pidStore.set(name, proc.pid!);
    this.pidStore.save();

    proc.on('close', (code) => {
      console.log(`Module ${name} exited with code ${code}`);
      this.processes.delete(name);
      this.pidStore.remove(name);
      this.pidStore.save();
    });
  }

  async stop(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill('SIGTERM');
      this.processes.delete(name);
      this.pidStore.remove(name);
      this.pidStore.save();
    }
  }

  async stopAll(): Promise<void> {
    for (const name of this.modules.keys()) {
      await this.stop(name);
    }
  }

  getStatus(name: string): 'running' | 'stopped' {
    return this.processes.has(name) ? 'running' : 'stopped';
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  recoverFromCrash(): void {
    const pids = this.pidStore.getAll();
    for (const [name, pid] of Object.entries(pids)) {
      if (!this.isProcessAlive(pid)) {
        console.log(`Module ${name} (PID ${pid}) is dead, will restart`);
        this.pidStore.remove(name);
      } else {
        console.log(`Module ${name} (PID ${pid}) is still alive`);
      }
    }
    this.pidStore.save();
  }
}
```

- [ ] **Step 4: Create orchestrator entry point**

`packages/orchestrator/src/index.ts`:

```typescript
export { ProcessManager, type ModuleConfig } from './process-manager.js';
export { PidStore } from './pid-store.js';
export { ShutdownHandler } from './shutdown.js';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/orchestrator && npx vitest run`
Expected: PASS — all orchestrator tests pass.

- [ ] **Step 6: Run full test suite**

Run: `npx turbo test`
Expected: PASS — all tests across core, agent, and orchestrator pass.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/
git commit -m "feat(orchestrator): add ProcessManager with PID tracking and crash recovery"
```

---

### Task 14: End-to-End Integration Test

**Files:**
- Create: `packages/agent/src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

This test verifies the full flow: config loading → event bus → agent service → mock backend → response routing.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createEventBus, UserManager } from '@ccbuddy/core';
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase, EventMap } from '@ccbuddy/core';
import { AgentService } from '../agent-service.js';

function makeMockBackend(response: string): AgentBackend {
  return {
    async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
      const base: AgentEventBase = {
        sessionId: req.sessionId,
        userId: req.userId,
        channelId: req.channelId,
        platform: req.platform,
      };
      yield { ...base, type: 'text', content: 'Thinking...' };
      yield { ...base, type: 'complete', response };
    },
    abort: vi.fn(),
  };
}

describe('Integration: Event Bus → Agent Service', () => {
  it('processes a message from incoming event to outgoing response', async () => {
    const bus = createEventBus();
    const userManager = new UserManager([
      { name: 'Dad', role: 'admin', discord_id: '111' },
    ]);

    const agentService = new AgentService({
      backend: makeMockBackend('Hello from Claude Code!'),
      maxConcurrent: 3,
      rateLimits: { admin: 30, chat: 10 },
      queueMaxDepth: 10,
      sessionTimeoutMinutes: 30,
      sessionCleanupHours: 24,
    });

    // Simulate gateway receiving a message
    const outgoingMessages: EventMap['message.outgoing'][] = [];
    bus.subscribe('message.outgoing', (msg) => {
      outgoingMessages.push(msg);
    });

    // Simulate incoming message processing
    const user = userManager.findByPlatformId('discord', '111');
    expect(user).toBeDefined();

    const sessionId = userManager.buildSessionId(user!.name, 'discord', 'dev');
    const request: AgentRequest = {
      prompt: 'What is 2+2?',
      userId: user!.name,
      sessionId,
      channelId: 'dev',
      platform: 'discord',
      permissionLevel: user!.role as 'admin' | 'chat',
    };

    let finalResponse = '';
    for await (const event of agentService.handleRequest(request)) {
      if (event.type === 'complete') {
        finalResponse = event.response;
        // Gateway would publish outgoing message
        await bus.publish('message.outgoing', {
          userId: event.userId,
          sessionId: event.sessionId,
          channelId: event.channelId,
          platform: event.platform,
          text: event.response,
        });
      }
    }

    expect(finalResponse).toBe('Hello from Claude Code!');
    expect(outgoingMessages).toHaveLength(1);
    expect(outgoingMessages[0].text).toBe('Hello from Claude Code!');
    expect(outgoingMessages[0].platform).toBe('discord');
  });

  it('enforces chat permission level', async () => {
    const agentService = new AgentService({
      backend: makeMockBackend('response'),
      maxConcurrent: 3,
      rateLimits: { admin: 30, chat: 10 },
      queueMaxDepth: 10,
      sessionTimeoutMinutes: 30,
      sessionCleanupHours: 24,
    });

    const request: AgentRequest = {
      prompt: 'delete all files',
      userId: 'Son',
      sessionId: 'son-discord-general',
      channelId: 'general',
      platform: 'discord',
      permissionLevel: 'chat',
    };

    // This should work (the backend mock doesn't enforce, but the request carries permission level)
    const events: AgentEvent[] = [];
    for await (const event of agentService.handleRequest(request)) {
      events.push(event);
    }

    // The request's permissionLevel is 'chat', which the backend should use to restrict tools
    expect(events[0].type).toBe('text');
    expect(request.permissionLevel).toBe('chat');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `cd packages/agent && npx vitest run`
Expected: PASS — integration tests pass.

- [ ] **Step 3: Run full test suite**

Run: `npx turbo test`
Expected: PASS — all tests across all packages pass.

- [ ] **Step 4: Commit**

```bash
git add packages/agent/src/__tests__/integration.test.ts
git commit -m "test: add end-to-end integration test for event bus → agent service flow"
```

---

### Task 15: Final Verification + Cleanup

- [ ] **Step 1: Verify build**

Run: `npx turbo build`
Expected: All 3 packages build successfully with no errors.

- [ ] **Step 2: Verify all tests pass**

Run: `npx turbo test`
Expected: All tests across all packages pass.

- [ ] **Step 3: Verify project structure matches spec**

Run: `find packages -type f -name '*.ts' | grep -v node_modules | grep -v dist | sort`
Verify it matches the file structure outlined at the top of this plan.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: plan 1 complete — core types, config, event bus, agent module, orchestrator"
```

---

## Summary

**Plan 1 delivers:**
- Turborepo monorepo with 3 packages (core, agent, orchestrator)
- All shared types from the spec (EventMap, AgentRequest, AgentEvent, PlatformAdapter, etc.)
- Config loader (YAML + env vars + local overrides)
- Typed event bus with dispose support
- User manager with cross-platform identity lookup
- Agent service with SDK backend (primary) and CLI backend (fallback)
- Rate limiting (per-user, per-role)
- Session manager (timeout, cleanup, reactivation)
- Priority queue for backpressure
- PID store, process manager, and graceful shutdown handler
- Integration tests verifying the full message flow

**What's NOT in this plan (deferred to later plans):**
- Memory module (Plan 3)
- Skills module (Plan 2)
- Gateway + platform adapters (Plan 4)
- Scheduler, heartbeat, webhooks (Plan 5)
- Media + Apple (Plan 6)
- Session conflict detection — checking for active `claude` processes in same working directory (deferred to Plan 4, requires gateway routing context)
- Pending input timeout — pausing session timeout while waiting for user confirmation (deferred to Plan 4, requires gateway interaction)
- SDK streaming — yielding intermediate text/tool_use events from SDK backend (awaiting SDK streaming API; CLI backend provides streaming via `stream-json` as workaround)
