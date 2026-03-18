# CCBuddy Self-Evolving Skills Design Spec

**Date:** 2026-03-17
**Status:** Draft
**Depends on:** Plans 1-5 (Core, Agent, Skills, Memory, Gateway, Platforms, Scheduler)

## Overview

Enable CCBuddy to use existing skills as tools during conversations and to create new skills autonomously when it encounters reusable patterns. Skills are exposed to the agent via an MCP server that wraps the existing SkillRegistry, SkillGenerator, and SkillRunner. No new packages — all changes extend existing ones.

## Goals

1. Expose all registered skills as native tools the agent can invoke during conversations
2. Allow the agent to create new skills mid-conversation via a `create_skill` meta-tool
3. Gate elevated-permission skills behind user approval in chat
4. Allow users to explicitly request skill creation ("make a skill for X")
5. Gently nudge the agent to create skills proactively when it spots reusable patterns

## Non-Goals (v1)

- Hot-registering new skills mid-session (available next request instead)
- Relevance-based skill filtering (include all skills, let model choose)
- Async approval flow via separate admin channel (approval happens in-chat)
- Skill versioning or rollback
- Skill marketplace or sharing between CCBuddy instances
- Automatic skill deduplication or merging

---

## Architecture

### MCP Server Bridge

The core integration is a **stdio-based MCP server** (`mcp-server.ts`) in the `@ccbuddy/skills` package. It wraps the existing SkillRegistry, SkillGenerator, and SkillRunner and exposes them as MCP tools. The Claude Code SDK and CLI both support `mcpServers` natively, so skills become first-class tools without any gateway interception.

```
Agent Request
     |
     v
SDK/CLI query() ──> MCP Server (ccbuddy-skills)
     |                    |
     |              ┌─────┴─────┐
     |              │           │
     |         list_skills  create_skill  skill_<name>
     |              │           │              │
     |         Registry    Generator        Runner
     |              │           │           (worker thread)
     |              └─────┬─────┘              │
     |                    │                    │
     v                    v                    v
Agent Response     Registry YAML         Skill Output
                   + .mjs file
```

### Tool Set

Every agent request gets access to:

1. **All registered `skill_<name>` tools** — one per enabled skill, parameters match the skill's inputSchema, routed through SkillRunner
2. **`create_skill`** — meta-tool for generating new skills
3. **`list_skills`** — meta-tool for querying available skills

These are exposed via the MCP protocol — the SDK/CLI handles the full tool-use loop (call → result → continue) natively.

---

## MCP Server Design

### Location

`packages/skills/src/mcp-server.ts` — a standalone Node.js script that runs as a child process via stdio.

### Startup

1. Parse CLI args for `--registry <path>` and `--skills-dir <path>`
2. Load SkillRegistry from YAML
3. Create SkillGenerator with hooks (approval, git commit)
4. Create SkillRunner with configured timeout
5. Register tools with MCP protocol
6. Listen on stdio for JSON-RPC calls

### Tools Exposed

#### `list_skills`

```typescript
{
  name: 'list_skills',
  description: 'List all available skills with their descriptions and usage counts',
  inputSchema: { type: 'object', properties: {} },
}
```

Returns: array of `{ name, description, version, source, usageCount, permissions }` for all enabled skills.

#### `create_skill`

```typescript
{
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
}
```

Flow:
1. Validate via SkillGenerator (name format, code safety, permission checks)
2. If elevated permissions + `require_admin_approval_for_elevated` + no `approved: true`:
   - Return `{ success: false, error: "This skill requires elevated permissions (shell). Ask the user to approve, then call create_skill again with approved: true" }`
3. If approved or non-elevated:
   - Write `.mjs` file to `generated_dir`
   - Register in SkillRegistry
   - Run `onAfterSave` hook (git commit if `auto_git_commit`)
   - Return `{ success: true, name, filePath }`

#### `skill_<name>` (dynamic)

One tool per registered enabled skill. Parameters match the skill's `inputSchema`. On call:

1. Look up skill in registry
2. Record usage (`registry.recordUsage(name)`)
3. Run via SkillRunner (worker thread with timeout)
4. Return `SkillOutput` (`{ success, result }` or `{ success: false, error }`)

### Process Lifecycle

Each SDK `query()` call can spawn a fresh MCP server process. This means:
- New skills created in a previous conversation are automatically available (registry is re-read on startup)
- No need for hot-reload — process lifecycle handles it
- If the MCP server crashes, the agent loses skill tools for that session but the conversation continues

---

## Core Type Changes

### AgentRequest (expand)

```typescript
interface AgentRequest {
  // ...existing fields...
  mcpServers?: Array<{ name: string; command: string; args: string[]; env?: Record<string, string> }>;
}
```

### SkillsConfig (expand)

```typescript
interface SkillsConfig {
  generated_dir: string;
  sandbox_enabled: boolean;
  require_admin_approval_for_elevated: boolean;
  auto_git_commit: boolean;
  mcp_server_path?: string;  // NEW — auto-resolved if not set
}
```

---

## Backend Changes

### SDK Backend (`sdk-backend.ts`)

Pass MCP servers to the `query()` options. The SDK expects `mcpServers` as a flat `Record<string, McpServerConfig>`, not an array:

```typescript
if (request.mcpServers && request.mcpServers.length > 0) {
  options.mcpServers = Object.fromEntries(
    request.mcpServers.map(s => [s.name, { command: s.command, args: s.args, env: s.env }])
  );
}
```

### CLI Backend (`cli-backend.ts`)

Pass MCP config via the `--mcp-config` flag. Write a temp JSON config file in the format `{ "mcpServers": { "<name>": { "command": "...", "args": [...] } } }`, pass the path as a CLI arg, and clean up after the process exits:

```typescript
if (request.mcpServers && request.mcpServers.length > 0) {
  const mcpConfig = {
    mcpServers: Object.fromEntries(
      request.mcpServers.map(s => [s.name, { command: s.command, args: s.args, env: s.env }])
    ),
  };
  const configPath = writeTempMcpConfig(mcpConfig); // writes JSON to os.tmpdir()
  args.push('--mcp-config', configPath);
  // Clean up temp file in proc.on('close') handler
}
```

The `writeTempMcpConfig` helper writes to `os.tmpdir()` and the cleanup happens in the existing `proc.on('close')` handler in `runClaude()`.

---

## Bootstrap Integration

In `bootstrap.ts`, build the MCP server spec and inject it into agent requests:

```typescript
// Resolve skill MCP server path
// MCP server is compiled to packages/skills/dist/mcp-server.js
const skillMcpServerPath = config.skills.mcp_server_path
  ?? join(resolvedConfigDir, 'node_modules', '@ccbuddy', 'skills', 'dist', 'mcp-server.js');

const skillMcpServer = {
  name: 'ccbuddy-skills',
  command: 'node',
  args: [skillMcpServerPath, '--registry', registryPath, '--skills-dir', dirname(config.skills.generated_dir)],
};

// Inject into gateway's executeAgentRequest
const gateway = new Gateway({
  // ...existing deps...
  executeAgentRequest: (request) => agentService.handleRequest({
    ...request,
    mcpServers: [skillMcpServer],
  }),
});
```

The scheduler's `executeAgentRequest` gets the same treatment — cron jobs and webhook-triggered requests also have access to skills.

### System Prompt Nudge

Injected in `bootstrap.ts` alongside the `mcpServers` injection — the `executeAgentRequest` wrapper appends the nudge to `request.systemPrompt`:

```typescript
executeAgentRequest: (request) => agentService.handleRequest({
  ...request,
  mcpServers: [skillMcpServer],
  systemPrompt: [
    request.systemPrompt,
    'You have access to reusable skills (prefixed skill_) and can create new ones with create_skill. When you solve a novel problem that could be reusable, consider creating a skill for it.',
  ].filter(Boolean).join('\n\n'),
}),
```

This is consistent with the `mcpServers` injection point and ensures both gateway and scheduler agent requests get the nudge.

---

## Approval Flow

### Non-elevated skills (no permissions or safe ones)

Auto-approved. `create_skill` succeeds immediately.

### Elevated skills (shell, filesystem, network, env)

When `require_admin_approval_for_elevated` is true:

1. Agent calls `create_skill` with `permissions: ['shell']`
2. Generator's `onBeforeRegister` hook checks permissions
3. No `approved: true` flag → returns error: "Requires admin approval"
4. Agent tells user: "This skill needs shell access. Should I create it?"
5. User says "yes"
6. Agent calls `create_skill` again with `approved: true`
7. Hook sees `approved: true` → proceeds
8. Skill created, committed to git

This keeps approval conversational — no separate channel or async flow.

### Identity for Agent-Created Skills

The MCP server hard-codes `createdBy: 'agent'` and `createdByRole: 'system'` for all `create_skill` calls. This is because:
- The MCP server runs as a child process with no access to the `AgentRequest` context (user identity, permission level)
- The existing generator rejects `createdByRole === 'chat'` — using `'system'` bypasses this guard intentionally, since the agent (not the chat user) is the author
- Chat users can trigger skill creation indirectly by asking the agent, but the agent is the one calling `create_skill` with system-level identity
- The elevated permission approval flow (user says "yes") provides the human gate for dangerous skills regardless of role

---

## Approval & Hooks Wiring

### Approval Check (in MCP server, before calling generator)

The existing `onBeforeRegister` hook signature is `(name: string, code: string) => Promise<{ approved: boolean; reason?: string }>` — it does not accept permissions or approval flags. Rather than expanding the hook interface, the MCP server's `create_skill` handler performs the approval check **before** calling `generator.createSkill()`:

```typescript
// In MCP server create_skill handler:
async function handleCreateSkill(input: CreateSkillInput): Promise<ToolResult> {
  const { name, description, code, input_schema, permissions, approved } = input;

  // Check elevated permission approval before calling generator
  if (requireAdminApproval && permissions?.length) {
    const elevated = permissions.some(p => ['shell', 'filesystem', 'network', 'env'].includes(p));
    if (elevated && !approved) {
      return {
        success: false,
        error: 'This skill requires elevated permissions (' + permissions.join(', ') + '). Ask the user to approve, then call create_skill again with approved: true',
      };
    }
  }

  // Proceed with generator (existing hook signature unchanged)
  const result = await generator.createSkill({
    name,
    description,
    code,
    inputSchema: input_schema,
    permissions,
    createdBy: 'agent',
    createdByRole: 'system',
  });

  return result;
}
```

### `onAfterSave`

```typescript
onAfterSave: async (filePath, skillName) => {
  if (config.skills.auto_git_commit) {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('git', ['add', filePath], (err) => {
        if (err) { reject(err); return; }
        execFile('git', ['commit', '-m', `skill: add ${skillName}`], (err2) => {
          if (err2) { reject(err2); return; }
          resolve();
        });
      });
    });
  }
}
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Validation fails (bad name, unsafe code) | MCP returns error with details; agent can fix and retry |
| Duplicate skill name | Generator rejects; agent chooses different name |
| Skill execution timeout | Runner returns `{ success: false, error: "timeout" }`; MCP passes through |
| Skill execution throws | Runner catches, returns error; MCP passes through |
| MCP server crash | SDK/CLI handles — agent loses skill tools for that session, conversation continues |
| Registry YAML corruption | MCP server starts with empty registry, logs error |
| Elevated permissions without approval | Returns clear error message telling agent to ask user |

---

## Testing Strategy

- **MCP server integration tests**: Spawn server as child process, send JSON-RPC over stdio, verify tool listing, skill creation, skill execution
- **Backend unit tests**: Verify SDK backend passes mcpServers option, CLI backend generates --mcp-config
- **Generator hook tests**: Verify approval flow (elevated rejected without flag, approved with flag), git commit hook
- **End-to-end smoke test**: Send Discord message asking CCBuddy to create a skill, verify .mjs generated, skill appears in list_skills on next message, skill callable

---

## Config Example

```yaml
skills:
  generated_dir: "./skills/generated"
  sandbox_enabled: true
  require_admin_approval_for_elevated: true
  auto_git_commit: true
  # mcp_server_path: auto-resolved from generated_dir
```

No config changes needed for most users — the MCP server path is auto-resolved.

---

## Migration / Changes

1. **`AgentRequest`** — add optional `mcpServers` field (backward compatible)
2. **`SkillsConfig`** — add optional `mcp_server_path` field (backward compatible)
3. **`DEFAULT_CONFIG`** — no changes needed (mcp_server_path auto-resolves)
4. **SDK Backend** — pass mcpServers to query options
5. **CLI Backend** — pass --mcp-config with temp config file
6. **Bootstrap** — build MCP server spec, inject into gateway and scheduler executeAgentRequest wrappers
7. **System prompt** — append skill nudge

---

## Dependencies

**New npm dependency in `@ccbuddy/skills`:**
- `@modelcontextprotocol/sdk` (MIT) — MCP server implementation for stdio transport

**No new packages.** All changes extend existing ones.
