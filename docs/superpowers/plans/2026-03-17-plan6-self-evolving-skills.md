# Plan 6: Self-Evolving Skills — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable CCBuddy to use existing skills as native tools during conversations and to create new skills autonomously via an MCP server bridge.

**Architecture:** A stdio-based MCP server in `@ccbuddy/skills` wraps the existing SkillRegistry, SkillGenerator, and SkillRunner, exposing them as MCP tools (`list_skills`, `create_skill`, `skill_<name>`). The SDK and CLI backends pass this MCP server to Claude Code via native `mcpServers` support. Bootstrap injects the MCP server spec and a system prompt nudge into all agent requests.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` (MCP server), `@ccbuddy/skills` (registry, generator, validator, runner), Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-self-evolving-skills-design.md`

**Depends on:** Plans 1-5 (Core, Agent, Skills, Memory, Gateway, Platforms, Scheduler)

---

## File Structure

### Files to create:
- `packages/skills/src/mcp-server.ts` — MCP server entry point (standalone Node.js script)
- `packages/skills/src/__tests__/mcp-server.test.ts` — MCP server integration tests

### Files to modify:
- `packages/core/src/types/agent.ts` — add `mcpServers` to AgentRequest
- `packages/core/src/config/schema.ts` — add `mcp_server_path` to SkillsConfig
- `packages/agent/src/backends/sdk-backend.ts` — pass mcpServers to query options
- `packages/agent/src/backends/cli-backend.ts` — pass --mcp-config with temp file + cleanup
- `packages/main/src/bootstrap.ts` — build MCP server spec, inject into gateway + scheduler, system prompt nudge
- `packages/main/src/__tests__/bootstrap.test.ts` — update mocks for new wiring
- `packages/skills/src/index.ts` — export MCP server path constant
- `packages/skills/package.json` — add @modelcontextprotocol/sdk dependency

---

## Chunk 1: Core Type & Config Changes

### Task 1: Add mcpServers to AgentRequest and mcp_server_path to SkillsConfig

**Files:**
- Modify: `packages/core/src/types/agent.ts`
- Modify: `packages/core/src/config/schema.ts`

- [ ] **Step 1: Add mcpServers field to AgentRequest**

In `packages/core/src/types/agent.ts`, add after the existing `permissionLevel` field:

```typescript
  mcpServers?: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>;
```

- [ ] **Step 2: Add mcp_server_path to SkillsConfig**

In `packages/core/src/config/schema.ts`, add to `SkillsConfig`:

```typescript
export interface SkillsConfig {
  generated_dir: string;
  sandbox_enabled: boolean;
  require_admin_approval_for_elevated: boolean;
  auto_git_commit: boolean;
  mcp_server_path?: string;
}
```

No changes to `DEFAULT_CONFIG` needed — `mcp_server_path` is optional and auto-resolved in bootstrap.

- [ ] **Step 3: Build core to verify**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all core tests**

Run: `npx turbo test --filter=@ccbuddy/core`
Expected: All 20 tests pass

- [ ] **Step 5: Build all packages to check downstream**

Run: `npx turbo build`
Expected: All 10 packages build cleanly

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/agent.ts packages/core/src/config/schema.ts
git commit -m "feat(core): add mcpServers to AgentRequest and mcp_server_path to SkillsConfig"
```

---

## Chunk 2: MCP Server

### Task 2: Create the MCP server entry point

**Files:**
- Modify: `packages/skills/package.json` — add `@modelcontextprotocol/sdk` dependency
- Create: `packages/skills/src/mcp-server.ts`
- Modify: `packages/skills/src/index.ts` — export MCP server path

- [ ] **Step 1: Add @modelcontextprotocol/sdk dependency**

In `packages/skills/package.json`, add to `dependencies`:

```json
"@modelcontextprotocol/sdk": "^1"
```

Run: `npm install`

- [ ] **Step 2: Create mcp-server.ts**

Create `packages/skills/src/mcp-server.ts`:

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { SkillRegistry } from './registry.js';
import { SkillGenerator } from './generator.js';
import { SkillValidator } from './validator.js';
import { SkillRunner } from './runner.js';
import type { SkillPermission } from './types.js';

// Parse CLI args
function parseArgs(argv: string[]): { registry: string; skillsDir: string; requireApproval: boolean; autoGitCommit: boolean } {
  const args = argv.slice(2);
  let registry = '';
  let skillsDir = '';
  let requireApproval = true;
  let autoGitCommit = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--registry' && args[i + 1]) registry = args[++i];
    else if (args[i] === '--skills-dir' && args[i + 1]) skillsDir = args[++i];
    else if (args[i] === '--no-approval') requireApproval = false;
    else if (args[i] === '--no-git-commit') autoGitCommit = false;
  }

  if (!registry || !skillsDir) {
    console.error('Usage: mcp-server --registry <path> --skills-dir <path>');
    process.exit(1);
  }

  return { registry, skillsDir, requireApproval, autoGitCommit };
}

async function main() {
  const config = parseArgs(process.argv);

  // Initialize skills infrastructure
  const registry = new SkillRegistry(config.registry);
  await registry.load();

  const validator = new SkillValidator();
  const generator = new SkillGenerator(registry, validator, config.skillsDir);
  const runner = new SkillRunner({ timeoutMs: 30_000 });

  // Wire git commit hook
  if (config.autoGitCommit) {
    generator.onAfterSave = async (filePath: string, skillName: string) => {
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve) => {
        execFile('git', ['add', filePath], (err) => {
          if (err) { console.warn(`[Skills] git add failed for ${filePath}:`, err.message); resolve(); return; }
          execFile('git', ['commit', '-m', `skill: add ${skillName}`], (err2) => {
            if (err2) console.warn(`[Skills] git commit failed for ${skillName}:`, err2.message);
            resolve();
          });
        });
      });
    };
  }

  // Create MCP server
  const server = new Server(
    { name: 'ccbuddy-skills', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Handle list_tools — return all skill tools + meta-tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

    // Meta-tools
    tools.push({
      name: 'list_skills',
      description: 'List all available skills with their descriptions and usage counts',
      inputSchema: { type: 'object', properties: {} },
    });

    tools.push({
      name: 'create_skill',
      description: 'Create a reusable skill. Use when you solve a problem that could be a reusable tool.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Lowercase name with hyphens (e.g., "fetch-weather")' },
          description: { type: 'string', description: 'What the skill does' },
          code: { type: 'string', description: 'JavaScript async function body. Receives input object, returns { success, result } or { success: false, error }' },
          input_schema: { type: 'object', description: 'JSON Schema for skill input parameters' },
          permissions: {
            type: 'array',
            items: { type: 'string', enum: ['filesystem', 'network', 'shell', 'env'] },
            description: 'Required permissions. Omit for no-permission skills.',
          },
          approved: { type: 'boolean', description: 'Set to true if admin has approved elevated permissions' },
        },
        required: ['name', 'description', 'code', 'input_schema'],
      },
    });

    // Dynamic skill tools
    for (const skill of registry.list()) {
      if (!skill.definition.enabled) continue;
      tools.push({
        name: `skill_${skill.definition.name}`,
        description: skill.definition.description,
        inputSchema: skill.definition.inputSchema as Record<string, unknown>,
      });
    }

    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'list_skills') {
        return handleListSkills();
      }

      if (name === 'create_skill') {
        return await handleCreateSkill(args as Record<string, unknown>);
      }

      if (name.startsWith('skill_')) {
        const skillName = name.slice('skill_'.length);
        return await handleRunSkill(skillName, args as Record<string, unknown>);
      }

      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }) }] };
    } catch (err) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: (err as Error).message }) }] };
    }
  });

  function handleListSkills() {
    const skills = registry.list().map((s) => ({
      name: s.definition.name,
      description: s.definition.description,
      version: s.definition.version,
      source: s.definition.source,
      permissions: s.definition.permissions,
      usageCount: s.metadata.usageCount,
      enabled: s.definition.enabled,
    }));
    return { content: [{ type: 'text', text: JSON.stringify(skills, null, 2) }] };
  }

  async function handleCreateSkill(input: Record<string, unknown>) {
    const name = input.name as string;
    const description = input.description as string;
    const code = input.code as string;
    const inputSchema = input.input_schema as Record<string, unknown>;
    const permissions = (input.permissions as string[] | undefined) ?? [];
    const approved = input.approved as boolean | undefined;

    // Approval check for elevated permissions (before calling generator)
    if (config.requireApproval && permissions.length > 0) {
      const elevated = permissions.some((p) =>
        ['shell', 'filesystem', 'network', 'env'].includes(p),
      );
      if (elevated && !approved) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: `This skill requires elevated permissions (${permissions.join(', ')}). Ask the user to approve, then call create_skill again with approved: true`,
            }),
          }],
        };
      }
    }

    const result = await generator.createSkill({
      name,
      description,
      code,
      inputSchema: inputSchema as any,
      permissions: permissions as SkillPermission[],
      createdBy: 'agent',
      createdByRole: 'system',
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result),
      }],
    };
  }

  async function handleRunSkill(skillName: string, input: Record<string, unknown>) {
    const skill = registry.get(skillName);
    if (!skill) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Skill "${skillName}" not found` }) }] };
    }

    if (!skill.definition.enabled) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Skill "${skillName}" is disabled` }) }] };
    }

    registry.recordUsage(skillName);
    await registry.save(); // persist usage count before process exits

    const result = await runner.run(skill.definition.filePath, input);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed to start:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Export MCP server path from index.ts**

Add to `packages/skills/src/index.ts`:

```typescript
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const MCP_SERVER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'mcp-server.js',
);
```

- [ ] **Step 4: Build skills package**

Run: `npx turbo build --filter=@ccbuddy/skills`
Expected: Builds cleanly, `dist/mcp-server.js` exists

- [ ] **Step 5: Verify MCP server starts and responds**

Run: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node packages/skills/dist/mcp-server.js --registry skills/registry.yaml --skills-dir skills 2>/dev/null | head -1`

Expected: JSON response with server info (or at least no crash)

- [ ] **Step 6: Commit**

```bash
git add packages/skills/
git commit -m "feat(skills): implement MCP server for skill tools"
```

---

### Task 3: MCP server integration tests

**Files:**
- Create: `packages/skills/src/__tests__/mcp-server.test.ts`

- [ ] **Step 1: Write MCP server tests**

Create `packages/skills/src/__tests__/mcp-server.test.ts`.

**IMPORTANT:** The MCP protocol uses Content-Length header framing over stdio (not newline-delimited JSON). Use the `@modelcontextprotocol/sdk` `Client` and `StdioClientTransport` for the test client to handle framing correctly.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '..', '..', 'dist', 'mcp-server.js');

async function createClient(registryPath: string, skillsDir: string, extraArgs: string[] = []) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, '--registry', registryPath, '--skills-dir', skillsDir, ...extraArgs],
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

describe('MCP Server', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccbuddy-mcp-test-'));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists tools including meta-tools', async () => {
    const registryPath = join(tmpDir, 'reg1.yaml');
    const skillsDir = join(tmpDir, 'skills1');
    mkdirSync(join(skillsDir, 'generated'), { recursive: true });
    writeFileSync(registryPath, 'skills: []\n');

    const { client, transport } = await createClient(registryPath, skillsDir, ['--no-approval', '--no-git-commit']);
    try {
      const { tools } = await client.listTools();
      const names = tools.map(t => t.name);
      expect(names).toContain('list_skills');
      expect(names).toContain('create_skill');
    } finally {
      await transport.close();
    }
  });

  it('list_skills returns empty array when no skills registered', async () => {
    const registryPath = join(tmpDir, 'reg2.yaml');
    const skillsDir = join(tmpDir, 'skills2');
    mkdirSync(join(skillsDir, 'generated'), { recursive: true });
    writeFileSync(registryPath, 'skills: []\n');

    const { client, transport } = await createClient(registryPath, skillsDir, ['--no-approval', '--no-git-commit']);
    try {
      const result = await client.callTool({ name: 'list_skills', arguments: {} });
      const skills = JSON.parse((result.content as any)[0].text);
      expect(skills).toEqual([]);
    } finally {
      await transport.close();
    }
  });

  it('create_skill creates a skill and returns success', async () => {
    const registryPath = join(tmpDir, 'reg3.yaml');
    const skillsDir = join(tmpDir, 'skills3');
    mkdirSync(join(skillsDir, 'generated'), { recursive: true });
    writeFileSync(registryPath, 'skills: []\n');

    const { client, transport } = await createClient(registryPath, skillsDir, ['--no-approval', '--no-git-commit']);
    try {
      const result = await client.callTool({
        name: 'create_skill',
        arguments: {
          name: 'test-greet',
          description: 'Greets a person',
          code: 'export default async function(input) { return { success: true, result: `Hello ${input.name}` }; }',
          input_schema: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.success).toBe(true);
    } finally {
      await transport.close();
    }
  });

  it('create_skill rejects elevated permissions without approval', async () => {
    const registryPath = join(tmpDir, 'reg4.yaml');
    const skillsDir = join(tmpDir, 'skills4');
    mkdirSync(join(skillsDir, 'generated'), { recursive: true });
    writeFileSync(registryPath, 'skills: []\n');

    // No --no-approval flag → approval required
    const { client, transport } = await createClient(registryPath, skillsDir, ['--no-git-commit']);
    try {
      const result = await client.callTool({
        name: 'create_skill',
        arguments: {
          name: 'danger-skill',
          description: 'Dangerous',
          code: 'export default async function(input) { return { success: true }; }',
          input_schema: { type: 'object', properties: {} },
          permissions: ['shell'],
        },
      });
      const parsed = JSON.parse((result.content as any)[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('elevated permissions');
    } finally {
      await transport.close();
    }
  });
});
```

- [ ] **Step 2: Build and run tests**

Run: `npx turbo build --filter=@ccbuddy/skills && npx turbo test --filter=@ccbuddy/skills`
Expected: All existing + new tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/skills/src/__tests__/mcp-server.test.ts
git commit -m "test(skills): add MCP server integration tests"
```

---

## Chunk 3: Backend Changes

### Task 4: SDK backend — pass mcpServers to query options

**Files:**
- Modify: `packages/agent/src/backends/sdk-backend.ts`

- [ ] **Step 1: Add mcpServers handling after the existing options setup**

In `packages/agent/src/backends/sdk-backend.ts`, add after the `systemPrompt` setup (around line 36) and before the permission level checks:

```typescript
      if (request.mcpServers && request.mcpServers.length > 0) {
        options.mcpServers = Object.fromEntries(
          request.mcpServers.map(s => [s.name, { type: 'stdio' as const, command: s.command, args: s.args, env: s.env }])
        );
      }
```

- [ ] **Step 2: Build and run agent tests**

Run: `npx turbo build --filter=@ccbuddy/agent && npx turbo test --filter=@ccbuddy/agent`
Expected: All 38 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/backends/sdk-backend.ts
git commit -m "feat(agent): SDK backend passes mcpServers to query options"
```

---

### Task 5: CLI backend — pass --mcp-config with temp file

**Files:**
- Modify: `packages/agent/src/backends/cli-backend.ts`

- [ ] **Step 1: Add imports and temp file helper**

At the top of `packages/agent/src/backends/cli-backend.ts`, add:

```typescript
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
```

Add a helper method to the `CliBackend` class:

```typescript
  private writeTempMcpConfig(mcpServers: AgentRequest['mcpServers']): string {
    const config = {
      mcpServers: Object.fromEntries(
        (mcpServers ?? []).map(s => [s.name, { command: s.command, args: s.args, env: s.env }])
      ),
    };
    const configPath = join(tmpdir(), `ccbuddy-mcp-${Date.now()}.json`);
    writeFileSync(configPath, JSON.stringify(config));
    return configPath;
  }
```

- [ ] **Step 2: Add system prompt passthrough for all permission levels**

The CLI backend currently only passes `--system-prompt` for `chat` users. The skill nudge is injected via `request.systemPrompt` for all permission levels, so we need to pass it for `admin` and `system` too. Add before the `if (request.permissionLevel === 'chat')` block:

```typescript
    if (request.systemPrompt && request.permissionLevel !== 'chat') {
      args.push('--system-prompt', request.systemPrompt);
    }
```

This ensures the skill nudge reaches the CLI for admin/system requests. The chat path already handles systemPrompt (with the chat restriction appended).

- [ ] **Step 3: Add mcpServers handling in execute()**

In the `execute()` method, add after the working directory check and before the permission level check:

```typescript
    let mcpConfigPath: string | undefined;
    if (request.mcpServers && request.mcpServers.length > 0) {
      mcpConfigPath = this.writeTempMcpConfig(request.mcpServers);
      args.push('--mcp-config', mcpConfigPath);
    }
```

- [ ] **Step 4: Add cleanup in the existing try/catch**

Modify the existing `try/catch` block in `execute()` (around line 33-38) to add a `finally` clause for MCP config cleanup:

```typescript
    try {
      const result = await this.runClaude(args, request.sessionId);
      yield { ...base, type: 'complete', response: result };
    } catch (err) {
      yield { ...base, type: 'error', error: (err as Error).message };
    } finally {
      if (mcpConfigPath) {
        try { unlinkSync(mcpConfigPath); } catch { /* ignore cleanup errors */ }
      }
    }
```

- [ ] **Step 5: Build and run agent tests**

Run: `npx turbo build --filter=@ccbuddy/agent && npx turbo test --filter=@ccbuddy/agent`
Expected: All 38 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/backends/cli-backend.ts
git commit -m "feat(agent): CLI backend passes --mcp-config with temp file, system prompt, and cleanup"
```

---

## Chunk 4: Bootstrap Integration

### Task 6: Wire MCP server into bootstrap

**Files:**
- Modify: `packages/main/src/bootstrap.ts`
- Modify: `packages/main/src/__tests__/bootstrap.test.ts`

- [ ] **Step 1: Add import for MCP_SERVER_PATH**

At the top of `packages/main/src/bootstrap.ts`, add:

```typescript
import { MCP_SERVER_PATH } from '@ccbuddy/skills';
```

- [ ] **Step 2: Build MCP server spec and modify executeAgentRequest wrappers**

After the SkillRegistry setup (around line 74), add:

```typescript
  // Build skill MCP server spec
  const skillMcpServerPath = config.skills.mcp_server_path ?? MCP_SERVER_PATH;
  const skillMcpServer = {
    name: 'ccbuddy-skills',
    command: 'node',
    args: [
      skillMcpServerPath,
      '--registry', registryPath,
      '--skills-dir', dirname(config.skills.generated_dir),  // parent of generated_dir (e.g., './skills')
      ...(config.skills.require_admin_approval_for_elevated ? [] : ['--no-approval']),
      ...(config.skills.auto_git_commit ? [] : ['--no-git-commit']),
    ],
  };

  const skillNudge = 'You have access to reusable skills (prefixed skill_) and can create new ones with create_skill. When you solve a novel problem that could be reusable, consider creating a skill for it.';
```

Then modify the gateway's `executeAgentRequest` to inject mcpServers and the system prompt nudge:

```typescript
  executeAgentRequest: (request) => agentService.handleRequest({
    ...request,
    mcpServers: [skillMcpServer],
    systemPrompt: [request.systemPrompt, skillNudge].filter(Boolean).join('\n\n'),
  }),
```

Also update the scheduler's `executeAgentRequest` the same way:

```typescript
  executeAgentRequest: (request) => agentService.handleRequest({
    ...request,
    mcpServers: [skillMcpServer],
    systemPrompt: [request.systemPrompt, skillNudge].filter(Boolean).join('\n\n'),
  }),
```

- [ ] **Step 3: Update bootstrap test mocks**

In `packages/main/src/__tests__/bootstrap.test.ts`:

Add mock for `@ccbuddy/skills` MCP_SERVER_PATH:

```typescript
vi.mock('@ccbuddy/skills', () => ({
  SkillRegistry: function (this: unknown, ...args: unknown[]) {
    return mockSkillRegistry(...args);
  },
  MCP_SERVER_PATH: '/mock/mcp-server.js',
}));
```

(This replaces the existing `@ccbuddy/skills` mock to include the new export.)

- [ ] **Step 4: Build and run all tests**

Run: `npx turbo build && npx turbo test`
Expected: All tests pass across all 10 packages

- [ ] **Step 5: Commit**

```bash
git add packages/main/
git commit -m "feat(main): wire skill MCP server into bootstrap with system prompt nudge"
```

---

## Chunk 5: Verification

### Task 7: Full build, test, and smoke test

- [ ] **Step 1: Full build**

Run: `npx turbo build`
Expected: All 10 packages build cleanly

- [ ] **Step 2: Full test suite**

Run: `npx turbo test`
Expected: All tests pass (317 existing + new MCP server tests)

- [ ] **Step 3: Verify MCP server works standalone**

Run:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node packages/skills/dist/mcp-server.js --registry skills/registry.yaml --skills-dir skills --no-git-commit 2>/dev/null | head -1
```

Expected: JSON response with server capabilities

- [ ] **Step 4: Verify the bundled hello-world skill appears in tool list**

After initialize, send:
```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | ...
```

Expected: `skill_hello-world` appears in the tools list alongside `list_skills` and `create_skill`

- [ ] **Step 5: Commit any fixes needed**

```bash
git add -A
git commit -m "fix(skills): adjustments from smoke test"
```

(Skip if no changes needed.)
