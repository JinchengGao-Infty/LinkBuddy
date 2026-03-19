# Apple Calendar Integration Design

## Overview

Add Calendar CRUD operations to CCBuddy via a Swift CLI binary using EventKit, exposed as MCP tools through a new `@ccbuddy/apple` package. First piece of the Apple ecosystem module — designed so Reminders, Notes, and Shortcuts can be added as sibling modules later.

## Swift CLI Binary

**Location:** `swift-helper/` (Swift Package Manager project)
**Binary name:** `ccbuddy-helper`
**Build:** `swift build -c release` → `.build/release/ccbuddy-helper`

### Subcommands

```
ccbuddy-helper calendar list --from <ISO8601> --to <ISO8601>
ccbuddy-helper calendar search --query <string>
ccbuddy-helper calendar create --title <string> --start <ISO8601> --end <ISO8601> [--calendar <name>] [--location <string>] [--notes <string>] [--all-day]
ccbuddy-helper calendar update --id <string> [--title <string>] [--start <ISO8601>] [--end <ISO8601>] [--calendar <name>] [--location <string>] [--notes <string>]
ccbuddy-helper calendar delete --id <string>
```

### Implementation

- Uses EventKit framework (`EKEventStore`) for direct Calendar access
- `EKEventStore.requestFullAccessToEvents()` for one-time TCC permission
- All output is JSON to stdout, errors as JSON to stderr
- Event IDs use `calendarItemExternalIdentifier` (stable across syncs)
- Date parsing: ISO 8601 format

### JSON Output Format

**Success (list/search):**
```json
{
  "success": true,
  "events": [
    {
      "id": "ABC123",
      "title": "Team standup",
      "startDate": "2026-03-20T09:00:00-05:00",
      "endDate": "2026-03-20T09:30:00-05:00",
      "calendar": "Work",
      "location": "Zoom",
      "notes": "",
      "isAllDay": false
    }
  ]
}
```

**Success (create/update):**
```json
{
  "success": true,
  "event": { ... }
}
```

**Success (delete):**
```json
{
  "success": true
}
```

**Error:**
```json
{
  "success": false,
  "error": "Event not found"
}
```

### Swift Package Structure

```
swift-helper/
├── Package.swift
└── Sources/
    └── CCBuddyHelper/
        ├── main.swift           (argument parsing, dispatch to subcommands)
        ├── CalendarCommands.swift (list, search, create, update, delete)
        └── JSONOutput.swift      (Codable structs for output)
```

Dependencies: Swift ArgumentParser for CLI subcommands.

## `@ccbuddy/apple` Package

**Location:** `packages/apple/src/`

### SwiftBridge

```typescript
class SwiftBridge {
  constructor(helperPath: string)
  exec(args: string[]): Promise<{ success: boolean; [key: string]: unknown }>
}
```

- Calls `ccbuddy-helper` binary via `child_process.execFile`
- Parses JSON stdout
- 10 second timeout
- Throws clear error if binary not found

### AppleCalendarService

```typescript
class AppleCalendarService {
  constructor(bridge: SwiftBridge)
  listEvents(from: string, to: string): Promise<CalendarEvent[]>
  searchEvents(query: string): Promise<CalendarEvent[]>
  createEvent(params: CreateEventParams): Promise<CalendarEvent>
  updateEvent(id: string, params: UpdateEventParams): Promise<CalendarEvent>
  deleteEvent(id: string): Promise<void>
  getToolDefinitions(): ToolDescription[]
}
```

### Tool Definitions

Five tools registered as external tools on the skill registry:

| Tool Name | Description | Key Inputs |
|-----------|-------------|------------|
| `apple_calendar_list` | List events in a date range | `from`, `to` (ISO 8601) |
| `apple_calendar_search` | Search events by keyword | `query` |
| `apple_calendar_create` | Create a calendar event | `title`, `start`, `end`, `calendar?`, `location?`, `notes?`, `allDay?` |
| `apple_calendar_update` | Update an existing event | `id`, `title?`, `start?`, `end?`, `calendar?`, `location?`, `notes?` |
| `apple_calendar_delete` | Delete a calendar event | `id` |

### CalendarEvent Type

```typescript
interface CalendarEvent {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  calendar: string;
  location: string;
  notes: string;
  isAllDay: boolean;
}
```

## Config Schema

Update `AppleConfig` in `packages/core/src/config/schema.ts`:

```typescript
export interface AppleConfig {
  enabled: boolean;
  helper_path?: string;  // override path to ccbuddy-helper binary
}
```

Default: `enabled: false`. Helper path auto-detected from `swift-helper/.build/release/ccbuddy-helper` relative to project root.

## Bootstrap Wiring

In `packages/main/src/bootstrap.ts`, after skill registry setup:

1. If `config.apple.enabled`:
   - Resolve helper path (config override or default)
   - Create `SwiftBridge` with helper path
   - Create `AppleCalendarService` with bridge
   - Register each tool definition with `skillRegistry.registerExternalTool()`

No MCP server changes needed — external tools are already exposed.

## Testing Strategy

### Swift CLI
- Manual test against real Calendar with a dedicated "CCBuddy Test" calendar
- Create → list → verify → update → verify → delete → verify gone
- Not in CI (requires macOS + TCC permission)

### SwiftBridge (unit, vitest)
- Mock `child_process.execFile`
- Verify correct args for each operation
- Test JSON parse error handling
- Test timeout behavior
- Test binary-not-found error

### AppleCalendarService (unit, vitest)
- Mock SwiftBridge
- Verify each method calls `exec()` with correct subcommand/args
- Test result mapping

### Integration
- Manual smoke test via Discord
- Verify morning briefing can list today's events
