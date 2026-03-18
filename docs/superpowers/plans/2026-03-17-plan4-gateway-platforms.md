# Plan 4: Gateway + Platform Adapters — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gateway (central message router) and platform adapters (Discord, Telegram) so messages flow from chat platforms through Claude Code and back — making CCBuddy actually usable.

**Architecture:** The Gateway receives normalized `IncomingMessage` from platform adapters, identifies users via `UserManager`, checks activation modes, assembles memory context, executes agent requests via `AgentService`, and routes chunked responses back. Platform adapters implement `PlatformAdapter` (defined in core) and handle platform-specific normalization and delivery. A bootstrap module wires all packages together and provides the main entry point. All dependencies are injected — the gateway depends only on `@ccbuddy/core` types; concrete implementations come from the bootstrap.

**Tech Stack:** TypeScript, discord.js v14, grammY v1, `@ccbuddy/core` (types, config, event bus, user manager), Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-ccbuddy-design.md` — Sections 5, 6

**Depends on:** Plan 1 (core, agent), Plan 2 (skills), Plan 3 (memory)

---

## Scope Decisions

**In scope (this plan):**
- Config schema updates (GatewayConfig, PlatformAdapterConfig with activation modes)
- Gateway package: message routing, user identification, activation mode checking, response chunking
- Discord adapter: discord.js bot, message normalization, text/image/file send, typing indicator
- Telegram adapter: grammY bot (long-polling), message normalization, text/image/file send, typing indicator
- Bootstrap/main package: wire all packages, start/stop lifecycle, session tick interval
- Root workspace and vitest config updates for new packages

**Out of scope (deferred):**
- Attachment content downloading (adapters record attachment metadata with empty `data` buffer; download is a follow-up)
- Streaming progress display to users (AgentService publishes `agent.progress` events; rendering them in chat is a follow-up)
- Code block–aware chunking (v1 splits on newline boundaries; code block preservation is a follow-up)
- Voice message / STT processing (Media module, future plan)
- Webhook delivery for scheduled jobs (`deliver_to` routing, Scheduler plan)

---

## File Structure

```
Modified:
  packages/core/src/config/schema.ts            — GatewayConfig + PlatformAdapterConfig
  packages/core/src/config/__tests__/loader.test.ts — update for new defaults
  package.json                                   — add "packages/platforms/*" workspace
  vitest.workspace.ts                            — add platforms path

New — packages/gateway/:
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                                   — barrel export
  src/chunker.ts                                 — split text to platform char limits
  src/activation.ts                              — activation mode checking
  src/gateway.ts                                 — Gateway class, GatewayDeps interface
  src/__tests__/chunker.test.ts
  src/__tests__/activation.test.ts
  src/__tests__/gateway.test.ts

New — packages/platforms/discord/:
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                                   — barrel export
  src/discord-adapter.ts                         — DiscordAdapter class
  src/__tests__/discord-adapter.test.ts

New — packages/platforms/telegram/:
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts                                   — barrel export
  src/telegram-adapter.ts                        — TelegramAdapter class
  src/__tests__/telegram-adapter.test.ts

New — packages/main/:
  package.json, tsconfig.json
  src/index.ts                                   — entry point
  src/bootstrap.ts                               — wire all services
  src/__tests__/bootstrap.test.ts
```

---

## Chunk 1: Config Schema Updates + Root Config

### Task 1: Update GatewayConfig and PlatformConfig types

**Files:**
- Modify: `packages/core/src/config/schema.ts`
- Test: `packages/core/src/config/__tests__/loader.test.ts`

- [ ] **Step 1: Verify nothing depends on gateway.host / gateway.port**

Run: `grep -r 'gateway\.host\|gateway\.port' packages/ --include='*.ts' -l`
Expected: Only `packages/core/src/config/schema.ts` (the type definition and `DEFAULT_CONFIG`). If other files reference these, update them first.

- [ ] **Step 2: Update the config schema types**

In `packages/core/src/config/schema.ts`:

1. **Delete** the `PlatformChannelConfig` interface entirely (lines 33-39).
2. **Add** these new types in its place:

```typescript
export type ActivationMode = 'all' | 'mention';

export interface ChannelActivationConfig {
  mode: ActivationMode;
}

export interface PlatformAdapterConfig {
  enabled?: boolean;
  token?: string;
  channels?: Record<string, ChannelActivationConfig>;
}
```

3. **Update** `PlatformConfig` to use the new type:

```typescript
export interface PlatformConfig {
  discord?: PlatformAdapterConfig;
  telegram?: PlatformAdapterConfig;
  [key: string]: PlatformAdapterConfig | undefined;
}
```

4. **Replace** `GatewayConfig` (remove `host`/`port`, add `unknown_user_reply`):

```typescript
export interface GatewayConfig {
  unknown_user_reply: boolean;
}
```

5. **Update** `DEFAULT_CONFIG` gateway field (replace `{ host: '127.0.0.1', port: 18900 }` with):

```typescript
gateway: {
  unknown_user_reply: true,
},
```

**Note:** The new types (`ActivationMode`, `ChannelActivationConfig`, `PlatformAdapterConfig`) are automatically exported via the existing `export type * from './schema.js'` in `config/index.ts` — no barrel update needed.

- [ ] **Step 3: Update the config loader test**

Add a test for the new gateway config default:

```typescript
it('has correct gateway defaults', () => {
  const emptyDir = join(tmpDir, 'gateway-test');
  mkdirSync(emptyDir);
  const config = loadConfig(emptyDir);
  expect(config.gateway.unknown_user_reply).toBe(true);
});
```

- [ ] **Step 3: Run tests**

Run: `cd packages/core && npx vitest run`
Expected: All tests pass including the new one.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/config/schema.ts packages/core/src/config/__tests__/loader.test.ts
git commit -m "feat(core): update GatewayConfig and PlatformAdapterConfig for Plan 4"
```

### Task 2: Update root workspace and vitest config

**Files:**
- Modify: `package.json` (root)
- Modify: `vitest.workspace.ts`

- [ ] **Step 1: Update root package.json workspaces**

Change `"workspaces": ["packages/*"]` to:
```json
"workspaces": ["packages/*", "packages/platforms/*"]
```

- [ ] **Step 2: Update vitest workspace**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',
  'packages/platforms/*/vitest.config.ts',
]);
```

- [ ] **Step 3: Verify build still works**

Run: `npm install && npx turbo build`
Expected: All existing packages build cleanly. The new workspace paths don't break anything (no packages exist there yet).

- [ ] **Step 4: Commit**

```bash
git add package.json vitest.workspace.ts
git commit -m "chore: add platforms workspace path for Plan 4 packages"
```

---

## Chunk 2: Gateway Package

> **Requires:** Chunk 1 complete — `GatewayConfig` must have `unknown_user_reply` and `PlatformConfig` must use `PlatformAdapterConfig` with `channels`/`enabled` fields.

### Task 3: Gateway package scaffold

**Files:**
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/vitest.config.ts`
- Create: `packages/gateway/src/index.ts`

- [ ] **Step 1: Create package files**

`packages/gateway/package.json`:
```json
{
  "name": "@ccbuddy/gateway",
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
    "@ccbuddy/core": "*"
  },
  "devDependencies": {
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

`packages/gateway/tsconfig.json`:
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

`packages/gateway/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

`packages/gateway/src/index.ts`:
```typescript
export { Gateway, type GatewayDeps, type StoreMessageParams } from './gateway.js';
export { chunkMessage } from './chunker.js';
export { shouldRespond } from './activation.js';
```

- [ ] **Step 2: Install dependencies**

Run: `npm install` (from repo root)

- [ ] **Step 3: Verify build**

Run: `cd packages/gateway && npx tsc --noEmit`
Expected: No errors (empty barrel is valid)

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/
git commit -m "chore: scaffold @ccbuddy/gateway package"
```

### Task 4: Message chunker

**Files:**
- Create: `packages/gateway/src/chunker.ts`
- Create: `packages/gateway/src/__tests__/chunker.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/gateway/src/__tests__/chunker.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { chunkMessage } from '../chunker.js';

describe('chunkMessage', () => {
  it('returns empty array for empty string', () => {
    expect(chunkMessage('', 100)).toEqual([]);
  });

  it('returns single chunk when text fits', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  it('splits on newline boundaries', () => {
    const text = 'line one\nline two\nline three';
    const chunks = chunkMessage(text, 18);
    expect(chunks).toEqual(['line one\nline two', 'line three']);
  });

  it('hard-splits lines exceeding max length', () => {
    const text = 'a'.repeat(15);
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(5)]);
  });

  it('combines short lines after hard split remainder', () => {
    const text = 'a'.repeat(15) + '\nshort';
    const chunks = chunkMessage(text, 10);
    expect(chunks).toEqual(['a'.repeat(10), 'a'.repeat(5) + '\nshort']);
  });

  it('handles multiple newlines correctly', () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line${i}`);
    const text = lines.join('\n');
    // Each line is 5 chars, with newlines: "line0\nline1" = 11 chars
    const chunks = chunkMessage(text, 11);
    expect(chunks).toEqual(['line0\nline1', 'line2\nline3', 'line4']);
  });

  it('handles exact boundary fit', () => {
    const text = 'ab\ncd';
    expect(chunkMessage(text, 5)).toEqual(['ab\ncd']);
  });

  it('handles discord 2000 char limit', () => {
    const text = 'a'.repeat(2500);
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(2000);
    expect(chunks[1].length).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway && npx vitest run`
Expected: FAIL — `chunker.js` does not exist

- [ ] **Step 3: Implement the chunker**

`packages/gateway/src/chunker.ts`:
```typescript
export function chunkMessage(text: string, maxLength: number): string[] {
  if (!text) return [];
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    const withLine = current ? current + '\n' + line : line;

    if (withLine.length <= maxLength) {
      current = withLine;
    } else if (!current) {
      let remaining = line;
      while (remaining.length > maxLength) {
        chunks.push(remaining.slice(0, maxLength));
        remaining = remaining.slice(maxLength);
      }
      current = remaining;
    } else {
      chunks.push(current);
      if (line.length > maxLength) {
        let remaining = line;
        while (remaining.length > maxLength) {
          chunks.push(remaining.slice(0, maxLength));
          remaining = remaining.slice(maxLength);
        }
        current = remaining;
      } else {
        current = line;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/gateway && npx vitest run`
Expected: All 8 chunker tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/chunker.ts packages/gateway/src/__tests__/chunker.test.ts
git commit -m "feat(gateway): add message chunker utility"
```

### Task 5: Activation mode checker

**Files:**
- Create: `packages/gateway/src/activation.ts`
- Create: `packages/gateway/src/__tests__/activation.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/gateway/src/__tests__/activation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { shouldRespond } from '../activation.js';
import type { IncomingMessage, PlatformConfig } from '@ccbuddy/core';

function makeMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'discord',
    platformUserId: '123',
    channelId: 'ch1',
    channelType: 'group',
    text: 'hello',
    attachments: [],
    isMention: false,
    raw: null,
    ...overrides,
  };
}

describe('shouldRespond', () => {
  it('always responds to DMs', () => {
    expect(shouldRespond(makeMsg({ channelType: 'dm' }), {})).toBe(true);
  });

  it('responds to mentions when no channel config exists', () => {
    expect(shouldRespond(makeMsg({ isMention: true }), {})).toBe(true);
  });

  it('ignores non-mentions when no channel config exists', () => {
    expect(shouldRespond(makeMsg({ isMention: false }), {})).toBe(false);
  });

  it('responds to all messages when channel mode is "all"', () => {
    const config: PlatformConfig = {
      discord: { channels: { ch1: { mode: 'all' } } },
    };
    expect(shouldRespond(makeMsg(), config)).toBe(true);
  });

  it('only responds to mentions when channel mode is "mention"', () => {
    const config: PlatformConfig = {
      discord: { channels: { ch1: { mode: 'mention' } } },
    };
    expect(shouldRespond(makeMsg({ isMention: false }), config)).toBe(false);
    expect(shouldRespond(makeMsg({ isMention: true }), config)).toBe(true);
  });

  it('defaults to mention-only for channels not in config', () => {
    const config: PlatformConfig = {
      discord: { channels: { other: { mode: 'all' } } },
    };
    expect(shouldRespond(makeMsg({ isMention: false }), config)).toBe(false);
    expect(shouldRespond(makeMsg({ isMention: true }), config)).toBe(true);
  });

  it('defaults to mention-only when platform has no channels config', () => {
    const config: PlatformConfig = { discord: { enabled: true } };
    expect(shouldRespond(makeMsg({ isMention: false }), config)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway && npx vitest run src/__tests__/activation.test.ts`
Expected: FAIL — `activation.js` does not exist

- [ ] **Step 3: Implement activation checker**

`packages/gateway/src/activation.ts`:
```typescript
import type { IncomingMessage, PlatformConfig } from '@ccbuddy/core';

export function shouldRespond(msg: IncomingMessage, platformsConfig: PlatformConfig): boolean {
  if (msg.channelType === 'dm') return true;

  const platformConfig = platformsConfig[msg.platform];
  if (!platformConfig?.channels) return msg.isMention;

  const channelConfig = platformConfig.channels[msg.channelId];
  if (!channelConfig) return msg.isMention;

  return channelConfig.mode === 'all' || msg.isMention;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/gateway && npx vitest run`
Expected: All activation + chunker tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/activation.ts packages/gateway/src/__tests__/activation.test.ts
git commit -m "feat(gateway): add activation mode checker"
```

### Task 6: Gateway class — types, constructor, adapter registration

**Files:**
- Create: `packages/gateway/src/gateway.ts`
- Create: `packages/gateway/src/__tests__/gateway.test.ts`

- [ ] **Step 1: Write the failing tests for constructor + registration**

`packages/gateway/src/__tests__/gateway.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Gateway, type GatewayDeps } from '../gateway.js';
import type { IncomingMessage, PlatformAdapter, AgentEvent, AgentRequest } from '@ccbuddy/core';

// ── Test Helpers ──────────────────────────────────────────────────────────────

function createMockDeps(overrides: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    eventBus: {
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    findUser: vi.fn().mockReturnValue({
      name: 'Dad',
      role: 'admin' as const,
      platformIds: { discord: '123' },
    }),
    buildSessionId: vi.fn().mockReturnValue('dad-discord-ch1'),
    executeAgentRequest: vi.fn().mockImplementation(async function* () {
      yield {
        type: 'complete' as const,
        response: 'Hello!',
        sessionId: 'dad-discord-ch1',
        userId: 'Dad',
        channelId: 'ch1',
        platform: 'discord',
      } satisfies AgentEvent;
    }),
    assembleContext: vi.fn().mockReturnValue('memory context'),
    storeMessage: vi.fn(),
    gatewayConfig: { unknown_user_reply: true },
    platformsConfig: {},
    ...overrides,
  };
}

function createMockAdapter(platform = 'discord') {
  let messageHandler: ((msg: IncomingMessage) => void) | undefined;

  const adapter: PlatformAdapter & {
    simulateMessage: (msg: IncomingMessage) => Promise<void>;
  } = {
    platform,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn().mockImplementation((handler: (msg: IncomingMessage) => void) => {
      messageHandler = handler;
    }),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendImage: vi.fn().mockResolvedValue(undefined),
    sendFile: vi.fn().mockResolvedValue(undefined),
    setTypingIndicator: vi.fn().mockResolvedValue(undefined),
    simulateMessage: async (msg: IncomingMessage) => {
      if (messageHandler) {
        await (messageHandler(msg) as unknown as Promise<void>);
      }
    },
  };
  return adapter;
}

function makeIncomingMsg(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'discord',
    platformUserId: '123',
    channelId: 'ch1',
    channelType: 'dm',
    text: 'Hello CCBuddy',
    attachments: [],
    isMention: false,
    raw: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Gateway', () => {
  let deps: GatewayDeps;
  let gateway: Gateway;
  let adapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    deps = createMockDeps();
    gateway = new Gateway(deps);
    adapter = createMockAdapter();
  });

  describe('registerAdapter', () => {
    it('stores adapter and wires onMessage handler', () => {
      gateway.registerAdapter(adapter);
      expect(adapter.onMessage).toHaveBeenCalledOnce();
      expect(gateway.getAdapter('discord')).toBe(adapter);
    });

    it('supports multiple adapters', () => {
      const telegram = createMockAdapter('telegram');
      gateway.registerAdapter(adapter);
      gateway.registerAdapter(telegram);
      expect(gateway.getAdapter('discord')).toBe(adapter);
      expect(gateway.getAdapter('telegram')).toBe(telegram);
    });
  });

  describe('start / stop', () => {
    it('starts all registered adapters', async () => {
      gateway.registerAdapter(adapter);
      await gateway.start();
      expect(adapter.start).toHaveBeenCalledOnce();
    });

    it('stops all registered adapters', async () => {
      gateway.registerAdapter(adapter);
      await gateway.start();
      await gateway.stop();
      expect(adapter.stop).toHaveBeenCalledOnce();
    });
  });
```

- [ ] **Step 2: Write the Gateway class skeleton**

`packages/gateway/src/gateway.ts`:
```typescript
import type {
  EventBus,
  User,
  IncomingMessage,
  AgentRequest,
  AgentEvent,
  PlatformAdapter,
  PlatformConfig,
  GatewayConfig,
  OutgoingMessageEvent,
  Disposable,
} from '@ccbuddy/core';
import { chunkMessage } from './chunker.js';
import { shouldRespond } from './activation.js';

export interface StoreMessageParams {
  userId: string;
  sessionId: string;
  platform: string;
  content: string;
  role: 'user' | 'assistant';
}

export interface GatewayDeps {
  eventBus: EventBus;
  findUser: (platform: string, platformId: string) => User | undefined;
  buildSessionId: (userName: string, platform: string, channelId: string) => string;
  executeAgentRequest: (request: AgentRequest) => AsyncGenerator<AgentEvent>;
  assembleContext: (userId: string, sessionId: string) => string;
  storeMessage: (params: StoreMessageParams) => void;
  gatewayConfig: GatewayConfig;
  platformsConfig: PlatformConfig;
}

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  discord: 2000,
  telegram: 4096,
};

const DEFAULT_CHAR_LIMIT = 2000;

export class Gateway {
  private adapters = new Map<string, PlatformAdapter>();

  constructor(private deps: GatewayDeps) {}

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
    adapter.onMessage((msg) => {
      this.handleIncomingMessage(msg).catch((err) => {
        console.error(`[Gateway] Error handling message on ${adapter.platform}:`, err);
      });
    });
  }

  getAdapter(platform: string): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  async start(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.start();
    }
  }

  async stop(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }

  private async handleIncomingMessage(_msg: IncomingMessage): Promise<void> {
    // Stub — filled in next task
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/gateway && npx vitest run`
Expected: All tests pass (constructor, registration, start/stop)

- [ ] **Step 4: Commit**

```bash
git add packages/gateway/src/gateway.ts packages/gateway/src/__tests__/gateway.test.ts
git commit -m "feat(gateway): add Gateway class with adapter registration"
```

### Task 7: Gateway — incoming message handling

**Files:**
- Modify: `packages/gateway/src/gateway.ts`
- Modify: `packages/gateway/src/__tests__/gateway.test.ts`

- [ ] **Step 1: Add incoming message tests to gateway.test.ts**

Append to the `describe('Gateway', ...)` block:

```typescript
  describe('incoming message handling', () => {
    beforeEach(() => {
      gateway.registerAdapter(adapter);
    });

    it('identifies known users and routes to agent', async () => {
      await adapter.simulateMessage(makeIncomingMsg());

      expect(deps.findUser).toHaveBeenCalledWith('discord', '123');
      expect(deps.buildSessionId).toHaveBeenCalledWith('Dad', 'discord', 'ch1');
      expect(deps.storeMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'Dad', role: 'user', content: 'Hello CCBuddy' }),
      );
      expect(deps.assembleContext).toHaveBeenCalledWith('Dad', 'dad-discord-ch1');
      expect(deps.executeAgentRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Hello CCBuddy',
          userId: 'Dad',
          sessionId: 'dad-discord-ch1',
          platform: 'discord',
          permissionLevel: 'admin',
          memoryContext: 'memory context',
        }),
      );
    });

    it('sends unknown user reply when enabled', async () => {
      (deps.findUser as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      await adapter.simulateMessage(makeIncomingMsg());

      expect(adapter.sendText).toHaveBeenCalledWith(
        'ch1',
        "I don't recognize you. Ask the admin to add you.",
      );
      expect(deps.executeAgentRequest).not.toHaveBeenCalled();
    });

    it('silently ignores unknown users when reply disabled', async () => {
      deps = createMockDeps({
        findUser: vi.fn().mockReturnValue(undefined),
        gatewayConfig: { unknown_user_reply: false },
      });
      gateway = new Gateway(deps);
      const newAdapter = createMockAdapter();
      gateway.registerAdapter(newAdapter);

      await newAdapter.simulateMessage(makeIncomingMsg());
      expect(newAdapter.sendText).not.toHaveBeenCalled();
    });

    it('checks activation mode and skips non-activated channels', async () => {
      deps = createMockDeps({
        platformsConfig: { discord: { channels: { ch1: { mode: 'mention' } } } },
      });
      gateway = new Gateway(deps);
      const newAdapter = createMockAdapter();
      gateway.registerAdapter(newAdapter);

      await newAdapter.simulateMessage(makeIncomingMsg({ channelType: 'group', isMention: false }));
      expect(deps.executeAgentRequest).not.toHaveBeenCalled();
    });

    it('publishes message.incoming event', async () => {
      await adapter.simulateMessage(makeIncomingMsg());

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'message.incoming',
        expect.objectContaining({
          userId: 'Dad',
          sessionId: 'dad-discord-ch1',
          platform: 'discord',
          text: 'Hello CCBuddy',
        }),
      );
    });

    it('maps chat role to chat permission level', async () => {
      (deps.findUser as ReturnType<typeof vi.fn>).mockReturnValue({
        name: 'Son',
        role: 'chat',
        platformIds: { discord: '456' },
      });

      await adapter.simulateMessage(makeIncomingMsg());
      expect(deps.executeAgentRequest).toHaveBeenCalledWith(
        expect.objectContaining({ permissionLevel: 'chat' }),
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway && npx vitest run`
Expected: FAIL — `handleIncomingMessage` is a no-op

- [ ] **Step 3: Implement handleIncomingMessage**

Replace the `handleIncomingMessage` method in `gateway.ts`:

```typescript
  private async handleIncomingMessage(msg: IncomingMessage): Promise<void> {
    // 1. Identify user
    const user = this.deps.findUser(msg.platform, msg.platformUserId);
    if (!user) {
      if (this.deps.gatewayConfig.unknown_user_reply) {
        const adapter = this.adapters.get(msg.platform);
        await adapter?.sendText(
          msg.channelId,
          "I don't recognize you. Ask the admin to add you.",
        );
      }
      return;
    }

    // 2. Check activation mode
    if (!shouldRespond(msg, this.deps.platformsConfig)) {
      return;
    }

    // 3. Build routing info
    const sessionId = this.deps.buildSessionId(user.name, msg.platform, msg.channelId);

    // 4. Publish incoming event
    await this.deps.eventBus.publish('message.incoming', {
      userId: user.name,
      sessionId,
      channelId: msg.channelId,
      platform: msg.platform,
      text: msg.text,
      attachments: msg.attachments,
      isMention: msg.isMention,
      replyToMessageId: msg.replyToMessageId,
      timestamp: Date.now(),
    });

    // 5. Store user message
    this.deps.storeMessage({
      userId: user.name,
      sessionId,
      platform: msg.platform,
      content: msg.text,
      role: 'user',
    });

    // 6. Assemble memory context
    const memoryContext = this.deps.assembleContext(user.name, sessionId);

    // 7. Build agent request
    const request: AgentRequest = {
      prompt: msg.text,
      userId: user.name,
      sessionId,
      channelId: msg.channelId,
      platform: msg.platform,
      memoryContext,
      attachments: msg.attachments.length > 0 ? msg.attachments : undefined,
      // UserConfig only allows 'admin' | 'chat' roles; 'system' is internal-only
      permissionLevel: user.role === 'admin' ? 'admin' : 'chat',
    };

    // 8. Execute and route response
    await this.executeAndRoute(request, msg);
  }

  private async executeAndRoute(_request: AgentRequest, _msg: IncomingMessage): Promise<void> {
    // Stub — filled in next task
  }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/gateway && npx vitest run`
Expected: All incoming message tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/gateway.ts packages/gateway/src/__tests__/gateway.test.ts
git commit -m "feat(gateway): add incoming message handling with user identification"
```

### Task 8: Gateway — agent execution + response routing

**Files:**
- Modify: `packages/gateway/src/gateway.ts`
- Modify: `packages/gateway/src/__tests__/gateway.test.ts`

- [ ] **Step 1: Add agent execution tests**

Append to the `describe('Gateway', ...)` block:

```typescript
  describe('agent execution and response routing', () => {
    beforeEach(() => {
      gateway.registerAdapter(adapter);
    });

    it('sends agent response to platform and stores it', async () => {
      await adapter.simulateMessage(makeIncomingMsg());

      expect(adapter.sendText).toHaveBeenCalledWith('ch1', 'Hello!');
      expect(deps.storeMessage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'Dad', role: 'assistant', content: 'Hello!' }),
      );
    });

    it('publishes message.outgoing event on complete', async () => {
      await adapter.simulateMessage(makeIncomingMsg());

      expect(deps.eventBus.publish).toHaveBeenCalledWith(
        'message.outgoing',
        expect.objectContaining({
          userId: 'Dad',
          platform: 'discord',
          text: 'Hello!',
        }),
      );
    });

    it('starts and stops typing indicator', async () => {
      await adapter.simulateMessage(makeIncomingMsg());

      expect(adapter.setTypingIndicator).toHaveBeenCalledWith('ch1', true);
      expect(adapter.setTypingIndicator).toHaveBeenCalledWith('ch1', false);
    });

    it('sends error message on agent error event', async () => {
      deps = createMockDeps({
        executeAgentRequest: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'error' as const,
            error: 'Rate limit exceeded',
            sessionId: 's1',
            userId: 'Dad',
            channelId: 'ch1',
            platform: 'discord',
          } satisfies AgentEvent;
        }),
      });
      gateway = new Gateway(deps);
      const newAdapter = createMockAdapter();
      gateway.registerAdapter(newAdapter);

      await newAdapter.simulateMessage(makeIncomingMsg());
      expect(newAdapter.sendText).toHaveBeenCalledWith(
        'ch1',
        'Sorry, something went wrong: Rate limit exceeded',
      );
    });

    it('sends generic error on generator throw', async () => {
      deps = createMockDeps({
        executeAgentRequest: vi.fn().mockImplementation(async function* () {
          throw new Error('Connection lost');
        }),
      });
      gateway = new Gateway(deps);
      const newAdapter = createMockAdapter();
      gateway.registerAdapter(newAdapter);

      await newAdapter.simulateMessage(makeIncomingMsg());
      expect(newAdapter.sendText).toHaveBeenCalledWith(
        'ch1',
        'Sorry, something went wrong processing your message.',
      );
    });

    it('chunks long responses for discord', async () => {
      const longResponse = 'a'.repeat(3000);
      deps = createMockDeps({
        executeAgentRequest: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'complete' as const,
            response: longResponse,
            sessionId: 's1',
            userId: 'Dad',
            channelId: 'ch1',
            platform: 'discord',
          } satisfies AgentEvent;
        }),
      });
      gateway = new Gateway(deps);
      const newAdapter = createMockAdapter();
      gateway.registerAdapter(newAdapter);

      await newAdapter.simulateMessage(makeIncomingMsg());
      // Discord limit is 2000: should be 2 chunks
      expect(newAdapter.sendText).toHaveBeenCalledTimes(2);
    });

    it('uses telegram char limit for telegram platform', async () => {
      const longResponse = 'b'.repeat(5000);
      deps = createMockDeps({
        executeAgentRequest: vi.fn().mockImplementation(async function* () {
          yield {
            type: 'complete' as const,
            response: longResponse,
            sessionId: 's1',
            userId: 'Dad',
            channelId: 'ch1',
            platform: 'telegram',
          } satisfies AgentEvent;
        }),
      });
      gateway = new Gateway(deps);
      const tgAdapter = createMockAdapter('telegram');
      gateway.registerAdapter(tgAdapter);

      await tgAdapter.simulateMessage(makeIncomingMsg({ platform: 'telegram' }));
      // Telegram limit is 4096: should be 2 chunks
      expect(tgAdapter.sendText).toHaveBeenCalledTimes(2);
    });
  });
}); // end describe('Gateway')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/gateway && npx vitest run`
Expected: FAIL — `executeAndRoute` is a no-op

- [ ] **Step 3: Implement executeAndRoute**

Replace the `executeAndRoute` stub in `gateway.ts`:

```typescript
  private async executeAndRoute(request: AgentRequest, msg: IncomingMessage): Promise<void> {
    const adapter = this.adapters.get(msg.platform);
    if (!adapter) return;

    await adapter.setTypingIndicator(msg.channelId, true);

    try {
      for await (const event of this.deps.executeAgentRequest(request)) {
        switch (event.type) {
          case 'complete': {
            this.deps.storeMessage({
              userId: request.userId,
              sessionId: request.sessionId,
              platform: request.platform,
              content: event.response,
              role: 'assistant',
            });

            await this.deps.eventBus.publish('message.outgoing', {
              userId: request.userId,
              sessionId: request.sessionId,
              channelId: request.channelId,
              platform: request.platform,
              text: event.response,
            });

            const limit = PLATFORM_CHAR_LIMITS[msg.platform] ?? DEFAULT_CHAR_LIMIT;
            const chunks = chunkMessage(event.response, limit);
            for (const chunk of chunks) {
              await adapter.sendText(msg.channelId, chunk);
            }
            break;
          }
          case 'error':
            await adapter.sendText(
              msg.channelId,
              `Sorry, something went wrong: ${event.error}`,
            );
            break;
          // text and tool_use progress events are published by AgentService directly
        }
      }
    } catch {
      await adapter.sendText(
        msg.channelId,
        'Sorry, something went wrong processing your message.',
      );
    } finally {
      await adapter.setTypingIndicator(msg.channelId, false);
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `cd packages/gateway && npx vitest run`
Expected: All gateway tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/gateway.ts packages/gateway/src/__tests__/gateway.test.ts
git commit -m "feat(gateway): add agent execution and response routing with chunking"
```

---

## Chunk 3: Discord Adapter

### Task 9: Discord package scaffold

**Files:**
- Create: `packages/platforms/discord/package.json`
- Create: `packages/platforms/discord/tsconfig.json`
- Create: `packages/platforms/discord/vitest.config.ts`
- Create: `packages/platforms/discord/src/index.ts`

- [ ] **Step 1: Create the platforms/discord directory and package files**

Run: `mkdir -p packages/platforms/discord/src/__tests__`

`packages/platforms/discord/package.json`:
```json
{
  "name": "@ccbuddy/platform-discord",
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
    "discord.js": "^14"
  },
  "devDependencies": {
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

`packages/platforms/discord/tsconfig.json`:
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

`packages/platforms/discord/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

`packages/platforms/discord/src/index.ts`:
```typescript
export { DiscordAdapter, type DiscordAdapterConfig } from './discord-adapter.js';
```

- [ ] **Step 2: Install dependencies**

Run: `npm install` (from repo root)

- [ ] **Step 3: Commit**

```bash
git add packages/platforms/discord/
git commit -m "chore: scaffold @ccbuddy/platform-discord package"
```

### Task 10: Discord adapter — message normalization + lifecycle

**Files:**
- Create: `packages/platforms/discord/src/discord-adapter.ts`
- Create: `packages/platforms/discord/src/__tests__/discord-adapter.test.ts`

- [ ] **Step 1: Write the tests**

`packages/platforms/discord/src/__tests__/discord-adapter.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock discord.js before importing the adapter
const mockSend = vi.fn().mockResolvedValue(undefined);
const mockSendTyping = vi.fn().mockResolvedValue(undefined);
const mockChannel = {
  isTextBased: () => true,
  send: mockSend,
  sendTyping: mockSendTyping,
};

const eventHandlers = new Map<string, Function>();
const mockLogin = vi.fn().mockResolvedValue('token');
const mockDestroy = vi.fn();

vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation((event: string, handler: Function) => {
      eventHandlers.set(event, handler);
    }),
    login: mockLogin,
    destroy: mockDestroy,
    user: { id: 'bot-user-id' },
    channels: {
      fetch: vi.fn().mockResolvedValue(mockChannel),
    },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 512,
    DirectMessages: 4096,
    MessageContent: 32768,
  },
  ChannelType: { DM: 1, GuildText: 0 },
  Partials: { Channel: 2 },
}));

import { DiscordAdapter } from '../discord-adapter.js';
import type { IncomingMessage } from '@ccbuddy/core';

function fakeDiscordMessage(overrides: Record<string, unknown> = {}) {
  return {
    author: { id: '123', bot: false },
    channelId: 'ch1',
    channel: { type: 0 }, // GuildText
    content: 'Hello!',
    mentions: { has: vi.fn().mockReturnValue(false) },
    attachments: new Map(),
    reference: null,
    ...overrides,
  };
}

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter;
  let receivedMessages: IncomingMessage[];

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    receivedMessages = [];
    adapter = new DiscordAdapter({ token: 'test-token' });
    adapter.onMessage((msg) => receivedMessages.push(msg));
  });

  describe('start / stop', () => {
    it('logs in with token on start', async () => {
      await adapter.start();
      expect(mockLogin).toHaveBeenCalledWith('test-token');
    });

    it('destroys client on stop', async () => {
      await adapter.start();
      await adapter.stop();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('message normalization', () => {
    it('normalizes a guild text message', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage());

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(
        expect.objectContaining({
          platform: 'discord',
          platformUserId: '123',
          channelId: 'ch1',
          channelType: 'group',
          text: 'Hello!',
          isMention: false,
        }),
      );
    });

    it('detects DM channel type', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ channel: { type: 1 } })); // DM type

      expect(receivedMessages[0].channelType).toBe('dm');
      expect(receivedMessages[0].isMention).toBe(true); // DMs are always treated as mentions
    });

    it('detects bot mention', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({
        mentions: { has: vi.fn().mockReturnValue(true) },
      }));

      expect(receivedMessages[0].isMention).toBe(true);
    });

    it('ignores bot messages', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ author: { id: '999', bot: true } }));

      expect(receivedMessages).toHaveLength(0);
    });

    it('captures reply reference', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      handler(fakeDiscordMessage({ reference: { messageId: 'ref-123' } }));

      expect(receivedMessages[0].replyToMessageId).toBe('ref-123');
    });

    it('normalizes attachments with metadata (data buffer deferred)', async () => {
      await adapter.start();
      const handler = eventHandlers.get('messageCreate')!;
      const attachments = new Map([
        ['att1', { contentType: 'image/png', name: 'photo.png' }],
        ['att2', { contentType: 'application/pdf', name: 'doc.pdf' }],
      ]);
      handler(fakeDiscordMessage({ attachments }));

      expect(receivedMessages[0].attachments).toHaveLength(2);
      expect(receivedMessages[0].attachments[0]).toEqual(
        expect.objectContaining({ type: 'image', mimeType: 'image/png', filename: 'photo.png' }),
      );
      expect(receivedMessages[0].attachments[1]).toEqual(
        expect.objectContaining({ type: 'file', mimeType: 'application/pdf', filename: 'doc.pdf' }),
      );
    });
  });

  describe('sending', () => {
    it('sends text to channel', async () => {
      await adapter.sendText('ch1', 'Reply');
      expect(mockSend).toHaveBeenCalledWith('Reply');
    });

    it('sends image with caption', async () => {
      const buf = Buffer.from('png');
      await adapter.sendImage('ch1', buf, 'My image');
      expect(mockSend).toHaveBeenCalledWith({
        content: 'My image',
        files: [{ attachment: buf, name: 'image.png' }],
      });
    });

    it('sends image without caption', async () => {
      const buf = Buffer.from('png');
      await adapter.sendImage('ch1', buf);
      expect(mockSend).toHaveBeenCalledWith({
        files: [{ attachment: buf, name: 'image.png' }],
      });
    });

    it('sends file', async () => {
      const buf = Buffer.from('data');
      await adapter.sendFile('ch1', buf, 'report.pdf');
      expect(mockSend).toHaveBeenCalledWith({
        files: [{ attachment: buf, name: 'report.pdf' }],
      });
    });

    it('sends typing indicator', async () => {
      await adapter.setTypingIndicator('ch1', true);
      expect(mockSendTyping).toHaveBeenCalled();
    });

    it('no-ops for typing indicator false', async () => {
      await adapter.setTypingIndicator('ch1', false);
      expect(mockSendTyping).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/platforms/discord && npx vitest run`
Expected: FAIL — `discord-adapter.js` does not exist

- [ ] **Step 3: Implement the Discord adapter**

`packages/platforms/discord/src/discord-adapter.ts`:
```typescript
import { Client, GatewayIntentBits, ChannelType, Partials } from 'discord.js';
import type { Message, TextBasedChannel } from 'discord.js';
import type { PlatformAdapter, IncomingMessage, Attachment } from '@ccbuddy/core';

export interface DiscordAdapterConfig {
  token: string;
}

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord';
  private client: Client;
  private messageHandler?: (msg: IncomingMessage) => void;

  constructor(private config: DiscordAdapterConfig) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    this.client.on('messageCreate', (msg: Message) => {
      if (msg.author.bot) return;
      if (!this.messageHandler) return;

      const normalized = this.normalizeMessage(msg);
      if (normalized) this.messageHandler(normalized);
    });

    await this.client.login(this.config.token);
  }

  async stop(): Promise<void> {
    this.client.destroy();
  }

  async sendText(channelId: string, text: string): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    if (channel) await channel.send(text);
  }

  async sendImage(channelId: string, image: Buffer, caption?: string): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    if (channel) {
      await channel.send({
        ...(caption ? { content: caption } : {}),
        files: [{ attachment: image, name: 'image.png' }],
      });
    }
  }

  async sendFile(channelId: string, file: Buffer, filename: string): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    if (channel) {
      await channel.send({
        files: [{ attachment: file, name: filename }],
      });
    }
  }

  async setTypingIndicator(channelId: string, active: boolean): Promise<void> {
    if (!active) return;
    const channel = await this.fetchTextChannel(channelId);
    if (channel) await channel.sendTyping();
  }

  private async fetchTextChannel(channelId: string): Promise<TextBasedChannel | null> {
    const channel = await this.client.channels.fetch(channelId);
    if (channel?.isTextBased()) return channel as TextBasedChannel;
    return null;
  }

  private normalizeMessage(msg: Message): IncomingMessage | null {
    const isDm = msg.channel?.type === ChannelType.DM;
    const isMention = msg.mentions.has(this.client.user!);

    const attachments: Attachment[] = [];
    for (const [, att] of msg.attachments) {
      attachments.push({
        type: att.contentType?.startsWith('image/') ? 'image' : 'file',
        mimeType: att.contentType ?? 'application/octet-stream',
        data: Buffer.alloc(0), // Attachment download deferred to media module
        filename: att.name ?? undefined,
      });
    }

    return {
      platform: 'discord',
      platformUserId: msg.author.id,
      channelId: msg.channelId,
      channelType: isDm ? 'dm' : 'group',
      text: msg.content ?? '',
      attachments,
      isMention: isDm || isMention,
      replyToMessageId: msg.reference?.messageId ?? undefined,
      raw: msg,
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/platforms/discord && npx vitest run`
Expected: All Discord adapter tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/platforms/discord/src/discord-adapter.ts packages/platforms/discord/src/__tests__/discord-adapter.test.ts
git commit -m "feat(platform-discord): add Discord adapter with normalization and send methods"
```

---

## Chunk 4: Telegram Adapter

> **Known gap:** The Telegram adapter only handles `message:text` events. Messages with only photos/documents/voice (no text) are silently dropped. This matches the scope decision to defer attachment content downloading. A follow-up task should add `message:photo`, `message:document`, `message:voice` handlers.
>
> grammY defaults to long-polling mode (matching spec Section 2 crash recovery requirements). No explicit mode configuration needed.

### Task 11: Telegram package scaffold

**Files:**
- Create: `packages/platforms/telegram/package.json`
- Create: `packages/platforms/telegram/tsconfig.json`
- Create: `packages/platforms/telegram/vitest.config.ts`
- Create: `packages/platforms/telegram/src/index.ts`

- [ ] **Step 1: Create the platforms/telegram directory and package files**

Run: `mkdir -p packages/platforms/telegram/src/__tests__`

`packages/platforms/telegram/package.json`:
```json
{
  "name": "@ccbuddy/platform-telegram",
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
    "grammy": "^1"
  },
  "devDependencies": {
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

`packages/platforms/telegram/tsconfig.json`:
```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

`packages/platforms/telegram/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

`packages/platforms/telegram/src/index.ts`:
```typescript
export { TelegramAdapter, type TelegramAdapterConfig } from './telegram-adapter.js';
```

- [ ] **Step 2: Install dependencies**

Run: `npm install` (from repo root)

- [ ] **Step 3: Commit**

```bash
git add packages/platforms/telegram/
git commit -m "chore: scaffold @ccbuddy/platform-telegram package"
```

### Task 12: Telegram adapter — normalization + lifecycle + send

**Files:**
- Create: `packages/platforms/telegram/src/telegram-adapter.ts`
- Create: `packages/platforms/telegram/src/__tests__/telegram-adapter.test.ts`

- [ ] **Step 1: Write the tests**

`packages/platforms/telegram/src/__tests__/telegram-adapter.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock grammY before importing the adapter
const textHandlers: Function[] = [];
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockSendPhoto = vi.fn().mockResolvedValue(undefined);
const mockSendDocument = vi.fn().mockResolvedValue(undefined);
const mockSendChatAction = vi.fn().mockResolvedValue(undefined);
const mockBotStart = vi.fn().mockResolvedValue(undefined);
const mockBotStop = vi.fn().mockResolvedValue(undefined);

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation((filter: string, handler: Function) => {
      if (filter === 'message:text') textHandlers.push(handler);
    }),
    start: mockBotStart,
    stop: mockBotStop,
    botInfo: { username: 'CCBuddyBot' },
    api: {
      sendMessage: mockSendMessage,
      sendPhoto: mockSendPhoto,
      sendDocument: mockSendDocument,
      sendChatAction: mockSendChatAction,
    },
  })),
  InputFile: vi.fn().mockImplementation((data: Buffer, filename: string) => ({
    data,
    filename,
  })),
}));

import { TelegramAdapter } from '../telegram-adapter.js';
import type { IncomingMessage } from '@ccbuddy/core';

function fakeTelegramCtx(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      from: { id: 456 },
      text: 'Hi there',
      reply_to_message: null,
      ...((overrides.message as Record<string, unknown>) ?? {}),
    },
    chat: {
      id: 789,
      type: 'group',
      ...((overrides.chat as Record<string, unknown>) ?? {}),
    },
  };
}

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;
  let receivedMessages: IncomingMessage[];

  beforeEach(() => {
    vi.clearAllMocks();
    textHandlers.length = 0;
    receivedMessages = [];
    adapter = new TelegramAdapter({ token: 'tg-token' });
    adapter.onMessage((msg) => receivedMessages.push(msg));
  });

  describe('start / stop', () => {
    it('starts the bot on start', async () => {
      await adapter.start();
      expect(mockBotStart).toHaveBeenCalled();
    });

    it('stops the bot on stop', async () => {
      await adapter.start();
      await adapter.stop();
      expect(mockBotStop).toHaveBeenCalled();
    });
  });

  describe('message normalization', () => {
    it('normalizes a group text message', async () => {
      await adapter.start();
      textHandlers[0](fakeTelegramCtx());

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(
        expect.objectContaining({
          platform: 'telegram',
          platformUserId: '456',
          channelId: '789',
          channelType: 'group',
          text: 'Hi there',
          isMention: false,
        }),
      );
    });

    it('detects private chat as DM', async () => {
      await adapter.start();
      textHandlers[0](fakeTelegramCtx({ chat: { id: 789, type: 'private' } }));

      expect(receivedMessages[0].channelType).toBe('dm');
      expect(receivedMessages[0].isMention).toBe(true);
    });

    it('detects bot mention in text', async () => {
      await adapter.start();
      textHandlers[0](fakeTelegramCtx({
        message: { from: { id: 456 }, text: 'Hey @CCBuddyBot check this', reply_to_message: null },
      }));

      expect(receivedMessages[0].isMention).toBe(true);
    });

    it('captures reply reference', async () => {
      await adapter.start();
      textHandlers[0](fakeTelegramCtx({
        message: {
          from: { id: 456 },
          text: 'reply',
          reply_to_message: { message_id: 42 },
        },
      }));

      expect(receivedMessages[0].replyToMessageId).toBe('42');
    });
  });

  describe('sending', () => {
    it('sends text message', async () => {
      await adapter.sendText('789', 'Hello');
      expect(mockSendMessage).toHaveBeenCalledWith(789, 'Hello');
    });

    it('sends image with caption', async () => {
      const buf = Buffer.from('png');
      await adapter.sendImage('789', buf, 'Photo');
      expect(mockSendPhoto).toHaveBeenCalledWith(
        789,
        expect.objectContaining({ data: buf }),
        { caption: 'Photo' },
      );
    });

    it('sends file', async () => {
      const buf = Buffer.from('data');
      await adapter.sendFile('789', buf, 'doc.pdf');
      expect(mockSendDocument).toHaveBeenCalledWith(
        789,
        expect.objectContaining({ data: buf }),
      );
    });

    it('sends typing action', async () => {
      await adapter.setTypingIndicator('789', true);
      expect(mockSendChatAction).toHaveBeenCalledWith(789, 'typing');
    });

    it('no-ops for typing indicator false', async () => {
      await adapter.setTypingIndicator('789', false);
      expect(mockSendChatAction).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/platforms/telegram && npx vitest run`
Expected: FAIL — `telegram-adapter.js` does not exist

- [ ] **Step 3: Implement the Telegram adapter**

`packages/platforms/telegram/src/telegram-adapter.ts`:
```typescript
import { Bot, InputFile } from 'grammy';
import type { PlatformAdapter, IncomingMessage } from '@ccbuddy/core';

export interface TelegramAdapterConfig {
  token: string;
}

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram';
  private bot: Bot;
  private messageHandler?: (msg: IncomingMessage) => void;

  constructor(private config: TelegramAdapterConfig) {
    this.bot = new Bot(config.token);
  }

  onMessage(handler: (msg: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async start(): Promise<void> {
    this.bot.on('message:text', (ctx) => {
      if (!this.messageHandler) return;

      const msg = ctx.message;
      const chat = ctx.chat;

      const isDm = chat.type === 'private';
      const botUsername = this.bot.botInfo?.username;
      const isMention = botUsername
        ? msg.text.includes(`@${botUsername}`)
        : false;

      const normalized: IncomingMessage = {
        platform: 'telegram',
        platformUserId: String(msg.from.id),
        channelId: String(chat.id),
        channelType: isDm ? 'dm' : 'group',
        text: msg.text,
        attachments: [],
        isMention: isDm || isMention,
        replyToMessageId: msg.reply_to_message?.message_id
          ? String(msg.reply_to_message.message_id)
          : undefined,
        raw: ctx,
      };

      this.messageHandler(normalized);
    });

    await this.bot.start();
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendText(channelId: string, text: string): Promise<void> {
    await this.bot.api.sendMessage(Number(channelId), text);
  }

  async sendImage(channelId: string, image: Buffer, caption?: string): Promise<void> {
    await this.bot.api.sendPhoto(
      Number(channelId),
      new InputFile(image, 'image.png'),
      { caption },
    );
  }

  async sendFile(channelId: string, file: Buffer, filename: string): Promise<void> {
    await this.bot.api.sendDocument(
      Number(channelId),
      new InputFile(file, filename),
    );
  }

  async setTypingIndicator(channelId: string, active: boolean): Promise<void> {
    if (!active) return;
    await this.bot.api.sendChatAction(Number(channelId), 'typing');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/platforms/telegram && npx vitest run`
Expected: All Telegram adapter tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/platforms/telegram/src/telegram-adapter.ts packages/platforms/telegram/src/__tests__/telegram-adapter.test.ts
git commit -m "feat(platform-telegram): add Telegram adapter with normalization and send methods"
```

---

## Chunk 5: Bootstrap + Integration

### Task 13: Main package scaffold

**Files:**
- Create: `packages/main/package.json`
- Create: `packages/main/tsconfig.json`
- Create: `packages/main/src/index.ts`

- [ ] **Step 1: Create package files**

`packages/main/package.json`:
```json
{
  "name": "@ccbuddy/main",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@ccbuddy/core": "*",
    "@ccbuddy/agent": "*",
    "@ccbuddy/memory": "*",
    "@ccbuddy/skills": "*",
    "@ccbuddy/gateway": "*",
    "@ccbuddy/platform-discord": "*",
    "@ccbuddy/platform-telegram": "*",
    "@ccbuddy/orchestrator": "*"
  },
  "devDependencies": {
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

`packages/main/tsconfig.json`:
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

`packages/main/src/index.ts`:
```typescript
import { bootstrap } from './bootstrap.js';

async function main(): Promise<void> {
  console.log('Starting CCBuddy...');

  const { stop } = await bootstrap();

  console.log('CCBuddy is running.');

  const shutdown = async () => {
    console.log('Shutting down...');
    await stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start CCBuddy:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Install dependencies**

Run: `npm install` (from repo root)

- [ ] **Step 3: Commit**

```bash
git add packages/main/
git commit -m "chore: scaffold @ccbuddy/main package with entry point"
```

### Task 14: Bootstrap function

**Files:**
- Create: `packages/main/src/bootstrap.ts`
- Create: `packages/main/vitest.config.ts`
- Create: `packages/main/src/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Write the bootstrap test**

`packages/main/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

`packages/main/src/__tests__/bootstrap.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all upstream packages to test wiring
vi.mock('@ccbuddy/core', () => ({
  loadConfig: vi.fn().mockReturnValue({
    data_dir: './data',
    log_level: 'info',
    agent: {
      backend: 'sdk',
      max_concurrent_sessions: 3,
      session_timeout_minutes: 30,
      queue_max_depth: 10,
      queue_timeout_seconds: 120,
      rate_limits: { admin: 30, chat: 10 },
      default_working_directory: '~',
      admin_skip_permissions: true,
      session_cleanup_hours: 24,
      pending_input_timeout_minutes: 10,
      graceful_shutdown_timeout_seconds: 30,
    },
    memory: {
      db_path: ':memory:',
      max_context_tokens: 100000,
      context_threshold: 0.75,
      fresh_tail_count: 32,
    },
    gateway: { unknown_user_reply: true },
    platforms: {
      discord: { enabled: true, token: 'discord-token' },
      telegram: { enabled: true, token: 'telegram-token' },
    },
    skills: { generated_dir: './skills/generated' },
    users: {
      dad: { name: 'Dad', role: 'admin', discord_id: '123' },
    },
  }),
  createEventBus: vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  }),
  UserManager: vi.fn().mockImplementation(() => ({
    findByPlatformId: vi.fn(),
    buildSessionId: vi.fn(),
  })),
}));

vi.mock('@ccbuddy/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    handleRequest: vi.fn(),
    tick: vi.fn(),
  })),
  SdkBackend: vi.fn(),
  CliBackend: vi.fn(),
}));

vi.mock('@ccbuddy/memory', () => ({
  MemoryDatabase: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
    close: vi.fn(),
  })),
  MessageStore: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
  })),
  SummaryStore: vi.fn(),
  ProfileStore: vi.fn(),
  ContextAssembler: vi.fn().mockImplementation(() => ({
    assemble: vi.fn().mockReturnValue({
      profile: '',
      messages: [],
      summaries: [],
      totalTokens: 0,
      needsCompaction: false,
    }),
    formatAsPrompt: vi.fn().mockReturnValue(''),
  })),
  RetrievalTools: vi.fn().mockImplementation(() => ({
    getToolDefinitions: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('@ccbuddy/skills', () => ({
  SkillRegistry: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    registerExternalTool: vi.fn(),
  })),
}));

vi.mock('@ccbuddy/gateway', () => ({
  Gateway: vi.fn().mockImplementation(() => ({
    registerAdapter: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@ccbuddy/platform-discord', () => ({
  DiscordAdapter: vi.fn().mockImplementation(() => ({
    platform: 'discord',
  })),
}));

vi.mock('@ccbuddy/platform-telegram', () => ({
  TelegramAdapter: vi.fn().mockImplementation(() => ({
    platform: 'telegram',
  })),
}));

vi.mock('@ccbuddy/orchestrator', () => ({
  ShutdownHandler: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { bootstrap } from '../bootstrap.js';
import { Gateway } from '@ccbuddy/gateway';
import { DiscordAdapter } from '@ccbuddy/platform-discord';
import { TelegramAdapter } from '@ccbuddy/platform-telegram';
import { AgentService, SdkBackend } from '@ccbuddy/agent';
import { MemoryDatabase } from '@ccbuddy/memory';

describe('bootstrap', () => {
  let result: Awaited<ReturnType<typeof bootstrap>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    result = await bootstrap('./config');
  });

  afterEach(async () => {
    await result.stop();
    vi.useRealTimers();
  });

  it('creates the agent service with SDK backend and skipPermissions', () => {
    expect(SdkBackend).toHaveBeenCalledWith({ skipPermissions: true });
    expect(AgentService).toHaveBeenCalledWith(
      expect.objectContaining({ maxConcurrent: 3 }),
    );
  });

  it('initializes the memory database', () => {
    const dbInstance = (MemoryDatabase as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(dbInstance.init).toHaveBeenCalled();
  });

  it('creates Discord and Telegram adapters', () => {
    expect(DiscordAdapter).toHaveBeenCalledWith({ token: 'discord-token' });
    expect(TelegramAdapter).toHaveBeenCalledWith({ token: 'telegram-token' });
  });

  it('registers adapters with gateway', () => {
    const gwInstance = (Gateway as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(gwInstance.registerAdapter).toHaveBeenCalledTimes(2);
  });

  it('starts the gateway', () => {
    const gwInstance = (Gateway as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(gwInstance.start).toHaveBeenCalled();
  });

  it('sets up session tick interval', () => {
    const agentInstance = (AgentService as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(agentInstance.tick).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(agentInstance.tick).toHaveBeenCalledOnce();
  });

  it('stop() invokes shutdown handler', async () => {
    await result.stop();
    // If we got here without error, shutdown completed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/main && npx vitest run`
Expected: FAIL — `bootstrap.js` does not exist

- [ ] **Step 3: Implement the bootstrap**

`packages/main/src/bootstrap.ts`:
```typescript
import { join, dirname } from 'node:path';
import { loadConfig, createEventBus, UserManager } from '@ccbuddy/core';
import type { UserConfig } from '@ccbuddy/core';
import { AgentService, SdkBackend, CliBackend } from '@ccbuddy/agent';
import {
  MemoryDatabase,
  MessageStore,
  SummaryStore,
  ProfileStore,
  ContextAssembler,
  RetrievalTools,
} from '@ccbuddy/memory';
import { SkillRegistry } from '@ccbuddy/skills';
import { Gateway } from '@ccbuddy/gateway';
import { DiscordAdapter } from '@ccbuddy/platform-discord';
import { TelegramAdapter } from '@ccbuddy/platform-telegram';
import { ShutdownHandler } from '@ccbuddy/orchestrator';

export interface BootstrapResult {
  gateway: Gateway;
  stop: () => Promise<void>;
}

export async function bootstrap(configDir?: string): Promise<BootstrapResult> {
  // 1. Load config
  const config = loadConfig(configDir ?? './config');

  // 2. Create event bus
  const eventBus = createEventBus();

  // 3. Create user manager
  const userConfigs: UserConfig[] = Object.values(config.users);
  const userManager = new UserManager(userConfigs);

  // 4. Create agent backend + service
  const backend = config.agent.backend === 'sdk'
    ? new SdkBackend({ skipPermissions: config.agent.admin_skip_permissions })
    : new CliBackend();

  const agentService = new AgentService({
    backend,
    eventBus,
    maxConcurrent: config.agent.max_concurrent_sessions,
    rateLimits: config.agent.rate_limits,
    queueMaxDepth: config.agent.queue_max_depth,
    queueTimeoutSeconds: config.agent.queue_timeout_seconds,
    sessionTimeoutMinutes: config.agent.session_timeout_minutes,
    sessionCleanupHours: config.agent.session_cleanup_hours,
  });

  // 5. Create memory stores
  const db = new MemoryDatabase(config.memory.db_path);
  db.init();
  const messageStore = new MessageStore(db);
  const summaryStore = new SummaryStore(db);
  const profileStore = new ProfileStore(db);
  const contextAssembler = new ContextAssembler(
    messageStore,
    summaryStore,
    profileStore,
    {
      maxContextTokens: config.memory.max_context_tokens,
      freshTailCount: config.memory.fresh_tail_count,
      contextThreshold: config.memory.context_threshold,
    },
  );
  const retrievalTools = new RetrievalTools(messageStore, summaryStore);

  // 6. Create skill registry and register retrieval tools
  const registryPath = join(dirname(config.skills.generated_dir), 'registry.yaml');
  const skillRegistry = new SkillRegistry(registryPath);
  await skillRegistry.load();
  for (const tool of retrievalTools.getToolDefinitions()) {
    skillRegistry.registerExternalTool(tool);
  }

  // 7. Create gateway
  const gateway = new Gateway({
    eventBus,
    findUser: (platform, platformId) =>
      userManager.findByPlatformId(platform, platformId),
    buildSessionId: (userName, platform, channelId) =>
      userManager.buildSessionId(userName, platform, channelId),
    executeAgentRequest: (request) =>
      agentService.handleRequest(request),
    assembleContext: (userId, sessionId) => {
      const context = contextAssembler.assemble(userId, sessionId);
      return contextAssembler.formatAsPrompt(context);
    },
    storeMessage: (params) => messageStore.add(params),
    gatewayConfig: config.gateway,
    platformsConfig: config.platforms,
  });

  // 8. Create and register platform adapters
  if (config.platforms.discord?.enabled && config.platforms.discord?.token) {
    const discord = new DiscordAdapter({ token: config.platforms.discord.token });
    gateway.registerAdapter(discord);
  }

  if (config.platforms.telegram?.enabled && config.platforms.telegram?.token) {
    const telegram = new TelegramAdapter({ token: config.platforms.telegram.token });
    gateway.registerAdapter(telegram);
  }

  // 9. Start session tick interval
  const tickInterval = setInterval(() => {
    agentService.tick();
  }, 10_000);

  // 10. Set up shutdown handler
  const shutdownHandler = new ShutdownHandler(
    config.agent.graceful_shutdown_timeout_seconds * 1000,
  );
  shutdownHandler.register('gateway', () => gateway.stop());
  shutdownHandler.register('database', async () => db.close());
  shutdownHandler.register('tick', async () => clearInterval(tickInterval));

  // 11. Start gateway (starts all platform adapters)
  await gateway.start();

  return {
    gateway,
    stop: () => shutdownHandler.execute(),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/main && npx vitest run`
Expected: All bootstrap tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/main/src/bootstrap.ts packages/main/vitest.config.ts packages/main/src/__tests__/bootstrap.test.ts
git commit -m "feat(main): add bootstrap function wiring all packages together"
```

### Task 15: Full test suite run

- [ ] **Step 1: Build all packages**

Run: `npx turbo build` (from repo root)
Expected: All packages build cleanly

- [ ] **Step 2: Run all tests**

Run: `npx turbo test` (from repo root)
Expected: All tests pass across all packages (existing 207 + new ~45)

- [ ] **Step 3: Final commit if any cleanup needed**

If any files needed cleanup, stage them individually:
```bash
git add <specific files>
git commit -m "chore: Plan 4 final cleanup — all tests passing"
```
