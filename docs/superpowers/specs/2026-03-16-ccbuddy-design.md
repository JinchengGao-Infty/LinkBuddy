# CCBuddy — Design Specification

**Date:** 2026-03-16
**Status:** Draft
**Author:** flyingchickens + Claude

## 1. Overview

CCBuddy is a personal AI assistant that runs on a Mac Mini and is accessible via Discord, Telegram, and future messaging platforms. It uses **Claude Code (unmodified)** as its core agent, routing all tasks — chat, coding, system operations, and maintenance — through Claude Code for intelligent processing.

### Core Principles

1. **Claude Code is the brain.** Every operation goes through CC. No dumb scripts bypassing it.
2. **Claude Code is unmodified.** CCBuddy wraps around CC via its official SDK/CLI. CC updates never break CCBuddy.
3. **Modular architecture.** Each module (gateway, memory, scheduler, etc.) is independent, replaceable, and communicates only through an event bus.
4. **All tunables are configurable.** Every threshold, interval, and limit has a sensible default and can be overridden via config.
5. **Designed for future extensibility.** New platforms, storage backends, retrieval strategies, and features plug in without modifying existing modules.

### Key Constraints

- Uses Claude Max subscription (no API costs). Both SDK and CLI use Max auth.
- Must not violate Anthropic usage policies. This is a personal assistant on user's own hardware.
- Local Claude Code usage must coexist without interference from CCBuddy.

## 2. System Architecture

Monorepo with independent module packages, orchestrated by a process manager, communicating through an abstract event bus.

```
                    ┌─────────────────────────────────────┐
                    │            Orchestrator              │
                    │  (process manager, startup/shutdown) │
                    └──────────────┬──────────────────────┘
                                   │ manages
        ┌──────────┬───────────┬───┴────┬──────────┬──────────┐
        ▼          ▼           ▼        ▼          ▼          ▼
   ┌─────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Gateway │ │ Agent  │ │ Memory │ │Scheduler│ │Heartbeat│ │Webhooks│
   └────┬────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
        │                        ▲
        │          Event Bus (pub/sub)
        │    ◄─────────────────────────────────────────────────►
        │
   ┌────┴──────────────┐
   │  Platform Adapters │
   ├────────┬───────────┤
   │Discord │ Telegram  │  (+ future: WhatsApp, iMessage, etc.)
   └────────┴───────────┘
```

### Message Flow (Incoming Chat)

1. Discord/Telegram adapter receives message
2. Adapter normalizes it into a standard `IncomingMessage` format
3. Gateway identifies the user (via platform account mapping), resolves permissions
4. Gateway publishes `message.incoming` event on the event bus
5. Memory module retrieves relevant context for this user
6. Agent module invokes Claude Code SDK with the message + memory context
7. Agent publishes `message.outgoing` event with CC's response
8. Gateway routes the response back through the originating platform adapter

### Event Bus

No module directly imports or calls another. All communication goes through the event bus.

```typescript
// --- Typed Event Catalog ---
interface EventMap {
  'message.incoming': IncomingMessageEvent
  'message.outgoing': OutgoingMessageEvent
  'session.conflict': SessionConflictEvent
  'alert.health': HealthAlertEvent
  'webhook.received': WebhookEvent
  'heartbeat.status': HeartbeatStatusEvent
  'agent.progress': AgentProgressEvent
}

interface EventBus {
  publish<K extends keyof EventMap>(event: K, payload: EventMap[K]): Promise<void>
  subscribe<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): Disposable
  // subscribe returns a Disposable for cleanup during shutdown/hot-reload
}

interface Disposable {
  dispose(): void
}
```

Each event payload type carries its own routing metadata (userId, sessionId, channelId, platform) so downstream consumers can route without ambient state.

**Implementation:** Start with in-process IPC (Node.js `EventEmitter` across worker threads) for simplicity. No external dependencies. If scaling demands it later, swap to Redis pub/sub or NATS — the `EventBus` interface stays identical.

**Fallback alerting:** If the event bus itself is down, the heartbeat module falls back to direct process signals (SIGUSR1) or filesystem-based alerts (write to a watchfile) to reach the orchestrator, which can then send alerts via platform adapters directly.

- Future upgrade path: swap to NATS/RabbitMQ for distributed deployment without changing module code

### Orchestrator & Crash Recovery

The orchestrator is managed by macOS `launchd` as a system daemon.

```
launchd (macOS built-in, always running)
  └── watches & restarts ──► Orchestrator
                                └── watches & restarts ──► all modules
```

Recovery behavior:
- Orchestrator writes child process PIDs and module state to a state file on disk
- Child processes are spawned in **detached mode** (`{ detached: true }`) with `child.unref()` so they survive parent crashes
- On restart, orchestrator reads the PID file, checks which children are still alive (via `process.kill(pid, 0)`), and reconnects
- Dead children are restarted; surviving children re-establish event bus subscriptions automatically
- Worst case (full reboot): launchd starts orchestrator, orchestrator starts all modules from scratch. Discord buffers missed messages natively; for Telegram, use long-polling mode (not webhooks) so messages are re-fetched on reconnect.

### Graceful Shutdown

When CCBuddy is intentionally stopped (e.g., for updates):
1. Orchestrator sends SIGTERM to all module processes
2. Each module enters drain mode: finishes in-flight work (configurable timeout, default 30s)
3. Platform adapters send a "going offline" status indicator where supported
4. Agent module waits for active Claude Code sessions to complete (or aborts after timeout)
5. Memory module flushes pending writes and closes SQLite connections
6. Orchestrator exits cleanly after all modules confirm shutdown

The orchestrator is kept as thin as possible (start, monitor, stop processes) to minimize crash surface.

## 3. Agent Module

Abstraction layer over Claude Code with swappable backends.

### Interface

```typescript
interface AgentBackend {
  execute(request: AgentRequest): AsyncGenerator<AgentEvent>
  abort(sessionId: string): Promise<void>
}

interface AgentRequest {
  prompt: string
  userId: string
  sessionId: string
  channelId: string
  platform: string
  workingDirectory?: string
  allowedTools?: string[]
  systemPrompt?: string
  memoryContext?: string
  attachments?: Attachment[]
  permissionLevel: 'admin' | 'chat'
}

interface Attachment {
  type: 'image' | 'file' | 'voice'
  mimeType: string
  data: Buffer
  filename?: string
  transcript?: string          // populated by STT for voice attachments
}

// All events carry full routing metadata for consistent gateway routing
interface AgentEventBase {
  sessionId: string
  userId: string
  channelId: string
  platform: string
}

type AgentEvent =
  | AgentEventBase & { type: 'text', content: string }
  | AgentEventBase & { type: 'tool_use', tool: string }
  | AgentEventBase & { type: 'complete', response: string }
  | AgentEventBase & { type: 'error', error: string }
```

All `AgentEvent` variants carry full routing metadata (`sessionId`, `userId`, `channelId`, `platform`) so the gateway can route any event — streaming progress, final responses, and errors — without parsing session IDs or maintaining ambient state.

### Backends

**Primary — SDK Backend:**
- Uses `@anthropic-ai/claude-code` SDK
- Streams events in real-time
- In-process, no shell spawning overhead after initial setup

**Fallback — CLI Backend:**
- Spawns `claude -p <prompt> --session-id <id> --output-format stream-json`
- Parses streaming JSON into same `AgentEvent` stream
- Swappable with one config change

### Permission Enforcement

| Role | Capabilities |
|---|---|
| `admin` | All tools, all working directories, full filesystem/bash access |
| `chat` | No bash, no file edit, no file read. Text conversation only |
| `system` | Internal role for maintenance jobs (memory consolidation, etc.). Access to memory module internal APIs and read-only system metrics. No user-facing tools, no bash/filesystem unless explicitly required by the specific job. Cross-user memory access is permitted for consolidation — this is a privileged internal operation. |

### Session Lifecycle

- **Session ID format:** `{userId}-{platform}-{channelId}` (e.g., `dad-discord-dev`, `son-telegram-dm`). DMs on different platforms create separate sessions but share the same user memory DAG.
- **Creation:** A session is created on first message in a channel. The agent module creates a Claude Code session with the corresponding ID.
- **Timeout:** After `session_timeout_minutes` (configurable, default 30) of inactivity, the session is marked idle. The Claude Code process is released, but session state (CC's session ID) is preserved so it can be resumed.
- **Resumption:** If a user sends a message to an idle session, the agent restarts the CC session with the same session ID, restoring conversation continuity.
- **Cleanup:** Sessions idle for longer than `session_cleanup_hours` (configurable, default 24) are fully cleaned up — CC session state is released.
- **Pending user input:** If a session is waiting for user input (e.g., session conflict resolution), the timeout clock pauses. After a longer timeout (configurable, default 10 minutes), the pending request is cancelled and the user is notified.

### Rate Limiting & Queuing

- **Per-user rate limits:** Configurable `max_requests_per_minute` per role (default: admin=30, chat=10). Excess requests receive a friendly "slow down" message.
- **Global concurrency cap:** `max_concurrent_sessions` (configurable, default 3). When hit, requests enter a priority queue:
  - Admin requests take priority over chat requests
  - Within the same priority, FIFO ordering
  - Max queue depth: configurable (default 10). Beyond this, requests are rejected with "CCBuddy is busy, try again shortly."
  - Queue timeout: configurable (default 120s). Queued requests that wait too long are cancelled with notification.

### Session Conflict Detection

Before executing a write-capable request, the agent module checks for active `claude` processes in the target working directory.

- **Read-only tasks:** proceed without checking
- **Write tasks with conflict detected:** publish `session.conflict` event → gateway notifies admin via chat with options: (1) proceed anyway, (2) work in a worktree, (3) queue until done

### Concurrency

Multiple agent sessions can run in parallel (different users, different projects). Max concurrent sessions is configurable to respect Max plan rate limits.

## 4. Memory Module

LCM-inspired (Lossless Claw) DAG-based memory system. The most critical module.

### Storage Schema

```
SQLite Database
├── messages              # every raw message, never deleted
│   ├── id
│   ├── user_id
│   ├── session_id
│   ├── platform          # discord, telegram, local
│   ├── content
│   ├── role              # user, assistant
│   ├── attachments       # media references
│   ├── timestamp
│   └── tokens            # token count for budget tracking
│
├── summary_nodes         # DAG nodes
│   ├── id
│   ├── user_id
│   ├── depth             # 0=leaf, 1=condensed, 2=higher...
│   ├── content           # the summary text
│   ├── source_ids        # messages or nodes this summarizes
│   ├── tokens
│   └── timestamp
│
└── user_profiles         # persistent per-user facts
    ├── user_id
    ├── key
    ├── value
    └── updated_at
```

### DAG Summarization Flow

```
Raw messages accumulate
        │
        ▼  (threshold reached: configurable, default 75% of token budget)
Leaf summarization
  Group older messages into chunks → Claude Code summarizes each
  Result: depth-0 summary nodes linking to source messages
        │
        ▼  (enough leaf nodes accumulate)
Condensation sweep
  Group leaf summaries → Claude Code condenses into depth-1 nodes
  Depth-aware prompts: leaves keep concrete details, higher levels capture patterns
        │
        ▼  (repeats as needed)
Higher-level condensation (depth-2, 3, ...)
```

### Context Assembly (Per Message)

1. Retrieve user profile (persistent facts/preferences)
2. Retrieve fresh tail (last N raw messages from current session, configurable, default 32)
3. Retrieve relevant summary nodes (recency + keyword relevance)
4. Calculate combined token count
5. Under budget → assemble and pass to agent module
6. Over budget → trigger compaction, reassemble

### Retrieval Tools (Injected into Claude Code)

| Tool | Purpose |
|---|---|
| `memory_grep` | Full-text search across stored messages and summaries for this user |
| `memory_describe` | Summarize a specific time range or topic from history |
| `memory_expand` | Drill into a summary node to recover original details |

These let Claude Code actively search memory when it needs context beyond what passive assembly provides.

### Per-User Isolation

All queries scoped to `user_id`. Each family member has fully separate conversation history, summary DAGs, and user profiles.

### Cross-Platform Continuity

Messages from all platforms go into the same table with the same `user_id`. The DAG doesn't distinguish platforms. Conversation started on Discord is seamlessly continued on Telegram.

### Session vs Memory Model

- **Memory (per-user, unified):** Long-term knowledge — preferences, facts, past topics. One DAG per user across all platforms.
- **Session context (per-channel):** Active working context for this conversation thread. Keeps unrelated conversations from polluting each other.
- When starting a new session, Claude Code queries the memory DAG for relevant context, providing continuity without merging unrelated threads.

### Consolidation

A scheduled cron job (configurable, default daily at 3am) where Claude Code reviews the DAG: merges duplicates, updates stale facts, prunes contradicted information. CC is the brain for memory housekeeping. Runs as the `system` role (see Section 3).

### Error Handling & Data Integrity

**Summarization failures:** All DAG mutations (leaf creation, condensation) run inside SQLite transactions. If Claude Code fails mid-summarization (rate limit, network error, context overflow), the transaction rolls back — no orphaned nodes or partially linked entries. The failed batch is retried on the next compaction cycle.

**Retry strategy:** Failed summarization retries up to 3 times with exponential backoff (configurable). After max retries, the batch is skipped and an `alert.health` event is published so the admin is notified.

**Integrity checks:** A periodic integrity scan (part of the consolidation cron) validates the DAG: ensures all `source_ids` reference existing nodes/messages, no orphaned summaries exist, and token counts are consistent. Corruption is auto-repaired where possible (re-summarize broken nodes) or flagged for admin review.

### Data Management & Backup

- **WAL mode:** SQLite runs in WAL (Write-Ahead Logging) mode for concurrent read/write safety
- **Backups:** Daily automated backup via SQLite `.backup` command (configurable schedule). Stored in `backup_dir` with rotation (default: keep last 7).
- **Size monitoring:** Heartbeat module tracks database file size. Alert when exceeding configurable threshold (default: 5GB).
- **Archival:** Raw messages older than a configurable threshold (default: 365 days) that have been fully summarized can be moved to a cold storage SQLite file. The DAG retains summary nodes; `memory_expand` can still recover originals from cold storage when needed.

### Future Extensibility

- Storage backend interface: swap SQLite for PostgreSQL
- Retrieval strategy interface: add vector/semantic search (RAG) alongside keyword search
- Summary strategy interface: experiment with different summarization approaches

## 5. Gateway & Platform Adapters

### Gateway

Central message router handling user identification, permissions, session resolution, and activation mode.

1. Identify user via platform account mapping
2. Check permission level (admin/chat)
3. Resolve session context (per-channel, with unified user memory)
4. Check activation mode (all messages vs @mention only)
5. Publish to event bus

### Platform Adapter Interface

```typescript
interface PlatformAdapter {
  readonly platform: string

  start(): Promise<void>
  stop(): Promise<void>

  onMessage(handler: (msg: IncomingMessage) => void): void

  sendText(channelId: string, text: string): Promise<void>
  sendImage(channelId: string, image: Buffer, caption?: string): Promise<void>
  sendFile(channelId: string, file: Buffer, filename: string): Promise<void>

  setTypingIndicator(channelId: string, active: boolean): Promise<void>
}

interface IncomingMessage {
  platform: string
  platformUserId: string
  channelId: string
  channelType: 'dm' | 'group'
  text: string
  attachments: Attachment[]
  isMention: boolean
  replyToMessageId?: string
  raw: any
}
```

### Adding a New Platform

Requires only:
1. New adapter implementing `PlatformAdapter`
2. Platform user IDs added to user config
3. Adapter registered with gateway

No changes to any other module.

### Response Handling

- Long responses auto-chunked to platform limits (Discord: 2000 chars, Telegram: 4096 chars — configurable)
- Typing indicator shown while Claude Code processes
- Streaming progress for admin: "Analyzing code..." → "Running tests..." → final response
- Errors formatted gracefully for end users

### Activation Modes (Per-Channel Config)

```yaml
channels:
  discord:
    "family-general":
      mode: "mention"     # only respond when @CCBuddy
    "dev":
      mode: "all"         # respond to all messages
```

### Unknown Users

Messages from unmapped accounts are ignored by default. Optionally replies with "I don't recognize you. Ask the admin to add you."

## 6. User Management & Access Control

### User Config

```yaml
users:
  - name: "Dad"
    role: admin
    discord_id: "123456789"
    telegram_id: "987654321"
  - name: "Son"
    role: chat
    discord_id: "234567890"
    telegram_id: "876543210"
```

### Cross-Platform Identity

Platform accounts map to a single user identity. CCBuddy recognizes "Dad" whether messaging from Discord or Telegram, and maintains the same memory DAG.

### Permission Tiers

| Role | Chat | File/Code Access | Bash/System | Apple Tools | Skill Creation |
|---|---|---|---|---|---|
| `admin` | Full | Full | Full | Full | Full |
| `chat` | Full | None | None | Configurable per tool | Restricted sandbox |
| `system` | N/A (internal) | Read-only metrics | None (unless job-specific) | None | None |

The `system` role is internal-only, used for maintenance jobs like memory consolidation. It has cross-user memory access for DAG housekeeping but no user-facing tools.

## 7. Scheduler Module

All scheduled tasks are prompts to Claude Code.

### Job Configuration

```yaml
jobs:
  - name: "morning-briefing-dad"
    cron: "0 8 * * *"
    user: "dad"
    prompt: "Check my GitHub notifications, calendar for today, and any pending reminders. Summarize."
    deliver_to: "telegram:dad-dm"

  - name: "disk-health-check"
    cron: "0 */6 * * *"
    user: "dad"
    prompt: "Check disk usage, CPU, memory on this Mac Mini. Alert me if anything looks concerning."
    deliver_to: "telegram:dad-dm"
    only_if_notable: true

  - name: "memory-consolidation"
    cron: "0 3 * * *"
    user: "system"
    prompt: "Review all users' memory DAGs. Merge duplicates, update stale facts, prune contradictions."
    internal: true
```

### Features

- `only_if_notable` — CC evaluates whether the result is worth reporting. Suppresses "all clear" noise.
- `internal` — maintenance jobs with no user-facing output
- Jobs manageable via config file AND via chat ("CCBuddy, remind me every Monday to review PRs")
- Each execution is a fresh agent session with the specified user's permissions and memory

## 8. Heartbeat Module

Monitors CCBuddy's own health.

### Health Checks (configurable interval, default 60s)

- Is each platform adapter connected?
- Is the event bus responsive?
- Is the agent module able to reach Claude Code?
- Is SQLite (memory DB) accessible?
- Mac Mini system resources (CPU/memory/disk)

### Alerting

- Check failure → publish `alert.health` event → deliver to admin's configured channel
- Escalation: consecutive failures increase alert frequency (configurable intervals, default: 60s, 300s, 900s)
- Claude Code unreachable: reported directly by heartbeat without waiting for CC to evaluate

### Queryable

"CCBuddy, how are you doing?" or `/status` returns a health summary.

## 9. Webhooks Module

HTTP server accepting inbound webhooks, converting them into event bus messages for Claude Code to process.

### Flow

```
External service → HTTP POST → Webhooks Module → validate secret →
normalize payload → publish webhook.received event → Gateway →
Agent (CC interprets payload and decides action)
```

### Handler Config

```yaml
webhooks:
  port: 18800
  handlers:
    - name: "github"
      path: "/hooks/github"
      secret: "${GITHUB_WEBHOOK_SECRET}"
      user: "dad"
      prompt_template: "GitHub event received: {{payload}}. Analyze and take appropriate action."

    - name: "sentry"
      path: "/hooks/sentry"
      secret: "${SENTRY_WEBHOOK_SECRET}"
      user: "dad"
      prompt_template: "Sentry alert: {{payload}}. Investigate the error, find root cause, and suggest a fix."
```

### Security

- Per-handler secrets for signature validation
- Timestamp-based replay protection: reject requests with timestamps older than configurable window (default: 5 minutes), matching GitHub's webhook security model
- Request body size limit: configurable (default: 1MB) to prevent abuse
- Rate limiting on the HTTP endpoint: configurable per-handler (default: 30 requests/minute)
- Exposed to internet via Tailscale Funnel or Cloudflare Tunnel (not direct port forwarding)

## 10. Media Module

Handles inbound media (images, files, voice) and outbound image generation.

### Inbound Processing

| Type | Handling |
|---|---|
| Images | Pass through to Claude Code (native image support) |
| Files (PDF, code, text) | Extract content, pass as text to CC |
| Voice messages | STT preprocessing → transcript text → CC |
| Large files | Store separately with summary in memory (configurable threshold, default 25000 tokens) |

### STT Interface

```typescript
interface STTBackend {
  transcribe(audio: Buffer, format: string): Promise<string>
}
```

- Primary: local Whisper (free, private, no network)
- Fallback: OpenAI Whisper API or AssemblyAI
- Swappable via config

### Image Generation

```typescript
interface ImageGenerationBackend {
  generate(prompt: string): Promise<Buffer>
}
```

- Registered as a custom tool (`generate_image`) available to Claude Code
- CC decides when to use it based on user request
- Backend swappable: DALL-E API, Stable Diffusion API, or local model

### Temp File Lifecycle

- Inbound files saved to temp directory with configurable TTL (default 24 hours)
- Cleanup runs as a scheduled maintenance task

## 11. Apple Ecosystem Module

Native macOS integrations exposed as custom tools for Claude Code.

### Tools

```
├── apple_calendar     (list_events, create_event, delete_event)
├── apple_reminders    (list_reminders, create_reminder, complete_reminder)
├── apple_notes        (search_notes, read_note, create_note, update_note)
└── apple_shortcuts    (list_shortcuts, run_shortcut)
```

### Implementation

- Uses `osascript` (AppleScript/JXA) under the hood
- Each tool is a thin wrapper: validate input → execute AppleScript → parse result → return
- Apple Shortcuts bridge unlocks HomeKit, Focus modes, app automation

### Permission Scoping

- Admin: full access to all Apple tools
- Chat-only users: configurable per tool (e.g., read calendar but not create events)

## 12. Self-Evolving Skills Module (High Priority)

When Claude Code encounters a task it can't handle, it creates a new tool. This is a high-priority module — implement early after core foundation.

### Skill Lifecycle

1. **Creation** — CC writes tool code + metadata (name, description, input schema)
2. **Validation** — skills module checks syntax, dangerous imports, sandboxing
3. **Registration** — added to `registry.yaml`, available in future sessions
4. **Usage** — CC calls it like any other tool
5. **Evolution** — CC can update existing skills if they break or need improvement

### Directory Structure

```
skills/
├── registry.yaml          # manifest of all installed skills
├── bundled/               # ships with CCBuddy
├── generated/             # created by Claude Code at runtime
└── user/                  # manually added by user
```

### Safety Guardrails

- **Sandboxing approach:** Generated skills run as separate Node.js worker threads with restricted API surface. Skills cannot access `child_process`, `fs` (outside designated skill data dirs), or `net` modules unless explicitly granted elevated permissions. This is not OS-level sandboxing — it's a restricted execution context. For stronger isolation, macOS `sandbox-exec` profiles can be layered on as a future enhancement.
- **Code review gate:** Before a generated skill is registered, Claude Code reviews its own generated code for security issues (injection, data exfiltration, unbounded resource usage). This is a pragmatic rather than cryptographic security boundary.
- Admin approval required for skills requesting elevated permissions (network, filesystem, shell)
- Chat-only user skill creation: restricted sandbox (configurable, default: disabled for chat users)
- All generated skills committed to git for audit trail

### Unified Tool Registry

All modules (apple, media, memory, etc.) register their tools through the same skill registry. One unified system for both built-in and generated tools.

## 13. Configuration System

### Config Structure

```yaml
ccbuddy:
  data_dir: "./data"
  log_level: "info"

  users: [...]

  agent:
    backend: "sdk"                     # "sdk" or "cli"
    max_concurrent_sessions: 3
    default_working_directory: "~"
    admin_skip_permissions: true
    session_timeout_minutes: 30
    session_cleanup_hours: 24
    pending_input_timeout_minutes: 10
    queue_max_depth: 10
    queue_timeout_seconds: 120
    rate_limits:
      admin: 30                        # max requests per minute
      chat: 10
    graceful_shutdown_timeout_seconds: 30

  memory:
    db_path: "./data/memory.sqlite"
    max_context_tokens: 100000       # total token budget for context assembly
    context_threshold: 0.75          # trigger compaction at 75% of max_context_tokens
    fresh_tail_count: 32
    leaf_chunk_tokens: 20000
    leaf_target_tokens: 1200
    condensed_target_tokens: 2000
    max_expand_tokens: 4000
    consolidation_cron: "0 3 * * *"
    backup_cron: "0 4 * * *"         # daily SQLite backup
    backup_dir: "./data/backups"
    max_backups: 7                   # keep last 7 daily backups

  gateway:
    unknown_user_reply: true

  platforms:
    discord:
      enabled: true
      token: "${DISCORD_BOT_TOKEN}"
      channels: { ... }
    telegram:
      enabled: true
      token: "${TELEGRAM_BOT_TOKEN}"
      channels: { ... }

  scheduler:
    jobs: [...]

  heartbeat:
    interval_seconds: 60
    alert_channel: "telegram:dad-dm"
    escalation_intervals: [60, 300, 900]

  webhooks:
    enabled: true
    port: 18800
    max_body_size_bytes: 1048576       # 1MB
    replay_window_seconds: 300         # 5 minutes
    rate_limit_per_minute: 30
    handlers: [...]

  media:
    stt_backend: "local-whisper"
    temp_dir: "./data/temp"
    temp_ttl_hours: 24
    large_file_token_threshold: 25000

  image_generation:
    backend: "dall-e"
    api_key: "${IMAGE_GEN_API_KEY}"

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

### Config Loading Priority (Highest to Lowest)

1. Environment variables (`CCBUDDY_AGENT_BACKEND=cli`)
2. `config/local.yaml` (git-ignored, personal overrides)
3. `config/default.yaml` (committed, sensible defaults)

## 14. Project Structure

```
ccbuddy/
├── packages/
│   ├── core/              # shared types, interfaces, config loader, event bus
│   ├── agent/             # Claude Code SDK/CLI abstraction
│   ├── memory/            # DAG storage, summarization, retrieval tools
│   ├── gateway/           # message routing, user identification, session mgmt
│   ├── platforms/
│   │   ├── discord/       # Discord.js bot adapter
│   │   └── telegram/      # grammY bot adapter
│   ├── scheduler/         # cron job management
│   ├── heartbeat/         # health monitoring
│   ├── webhooks/          # inbound webhook HTTP server
│   ├── media/             # image/file/voice processing, image generation
│   ├── skills/            # self-evolving skill system, tool registry
│   ├── apple/             # Calendar, Reminders, Notes, Shortcuts
│   └── orchestrator/      # process manager, launchd integration
├── skills/
│   ├── bundled/           # built-in tools
│   ├── generated/         # CC-created tools (git tracked)
│   └── user/              # manually added tools
├── config/
│   ├── default.yaml
│   └── local.yaml         # git-ignored
├── data/                  # runtime data (git-ignored)
│   ├── memory.sqlite
│   ├── temp/
│   └── pids/
├── package.json
├── turbo.json
└── tsconfig.json
```

## 15. Future Feature Backlog

Designed to plug in as new modules without modifying existing ones:

- Morning/evening briefings (daily digest per family member)
- Headless browser automation (Chromium CDP)
- PR review bot
- Shared shopping list
- Package tracking
- Usage tracking & cost reporting
- `/status` command
- Smart home control (Home Assistant / Hue)
- iMessage bridge
- Music/media control (Spotify/Sonos)
- WebChat UI
- Web page fetch & summarize
- Network monitoring
- Automatic backup orchestration
- Pairing codes for new/guest users
- Audit logging
- Multi-repo monitoring

## 16. Technology Stack

| Component | Technology |
|---|---|
| Language | TypeScript |
| Monorepo | Turborepo |
| Runtime | Node.js |
| Agent (primary) | `@anthropic-ai/claude-code` SDK |
| Agent (fallback) | Claude Code CLI (`claude -p`) |
| Database | SQLite (via better-sqlite3 or drizzle) |
| Discord | discord.js |
| Telegram | grammY |
| Event Bus | In-process EventEmitter (upgradeable to Redis/NATS/RabbitMQ) |
| STT | Local Whisper (fallback: OpenAI/AssemblyAI) |
| Image Gen | DALL-E API (swappable) |
| Apple Integration | osascript (AppleScript/JXA) |
| Process Manager | Custom orchestrator, managed by macOS launchd |
| Config | YAML + environment variables |
