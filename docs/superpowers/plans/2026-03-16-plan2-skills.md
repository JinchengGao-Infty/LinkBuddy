# Plan 2: Self-Evolving Skills Module — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the skills module — a unified tool registry where Claude Code can discover, use, create, validate, and evolve tools at runtime, making CCBuddy progressively more capable through natural usage.

**Architecture:** New `packages/skills` package providing: (1) a `SkillRegistry` that manages bundled, user, generated, AND external module tools through a common `SkillDefinition` interface (the "Unified Tool Registry" from the spec); (2) a `SkillGenerator` that creates new skills from Claude Code output as `.mjs` files (directly importable by worker threads); (3) a `SkillValidator` that checks syntax and dangerous patterns (pragmatic boundary, not cryptographic); (4) a `SkillRunner` that executes skills in isolated worker threads with configurable timeout. Skills are persisted as `.mjs` files with a YAML manifest (`registry.yaml`).

**Tech Stack:** TypeScript, Node.js `worker_threads`, Vitest, `js-yaml`, `esbuild` (for `.ts` → `.mjs` transpilation), `@ccbuddy/core` (types, config, event bus)

**Important design notes:**
- Skills are written/stored as `.mjs` (ESM JavaScript) so worker threads can import them natively without a TypeScript compilation step. The generator transpiles CC-produced TypeScript to `.mjs` before saving.
- The validator does static regex analysis — it catches common dangerous patterns but can be bypassed by obfuscation. The spec acknowledges this: "This is a pragmatic rather than cryptographic security boundary."
- Other modules (apple, media, memory) register their tools through `registerExternalTool()` on the same registry — fulfilling the spec's "Unified Tool Registry" requirement.
- The spec's "code review gate" (CC reviews its own generated code) is stubbed as a hook point; the actual AI review integration needs the agent module wired in (deferred to Plan 4).
- Git auto-commit of generated skills is stubbed as a hook; actual git integration is deferred.

**Spec:** `docs/superpowers/specs/2026-03-16-ccbuddy-design.md` — Section 12

**Depends on:** Plan 1 (core + agent packages must be built)

---

## File Structure

```
packages/
└── skills/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── index.ts                          # barrel export
        ├── types.ts                          # SkillDefinition, SkillInput/Output, SkillMetadata
        ├── registry.ts                       # SkillRegistry — load, register, unregister, list, get
        ├── generator.ts                      # SkillGenerator — create skill files from CC output
        ├── validator.ts                      # SkillValidator — syntax check, dangerous pattern detection
        ├── runner.ts                         # SkillRunner — execute skills in worker threads
        ├── worker.ts                         # worker thread entry point (runs inside worker)
        ├── transpiler.ts                     # transpile .ts skill code → .mjs via esbuild
        └── __tests__/
            ├── registry.test.ts
            ├── generator.test.ts
            ├── validator.test.ts
            └── runner.test.ts

skills/                                       # project-root skills directory
├── registry.yaml                             # manifest of all installed skills
├── bundled/                                  # ships with CCBuddy (e.g., example skills)
│   └── hello-world.ts                        # example bundled skill
├── generated/                                # created by Claude Code at runtime
└── user/                                     # manually added by user
```

---

## Chunk 1: Package Setup + Types + Registry

### Task 1: Initialize Skills Package

> **TDD exception:** Scaffolding task — no behavioral code to test.

**Files:**
- Create: `packages/skills/package.json`
- Create: `packages/skills/tsconfig.json`
- Create: `packages/skills/vitest.config.ts`
- Create: `packages/skills/src/index.ts`
- Create: `skills/registry.yaml`
- Create: `skills/bundled/.gitkeep`
- Create: `skills/generated/.gitkeep`
- Create: `skills/user/.gitkeep`

- [ ] **Step 1: Create packages/skills/package.json**

```json
{
  "name": "@ccbuddy/skills",
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
    "js-yaml": "^4.1.0",
    "esbuild": "^0.25"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create packages/skills/tsconfig.json**

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

- [ ] **Step 3: Create packages/skills/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create placeholder barrel**

`packages/skills/src/index.ts`:
```typescript
export {};
```

- [ ] **Step 5: Create skills directory structure at project root**

```bash
mkdir -p skills/bundled skills/generated skills/user
touch skills/bundled/.gitkeep skills/generated/.gitkeep skills/user/.gitkeep
```

Create `skills/registry.yaml`:
```yaml
# CCBuddy Skill Registry
# Skills are registered here with their metadata.
# Do not edit manually — managed by the skills module.
skills: []
```

- [ ] **Step 6: Install deps and verify build**

```bash
npm install
npx turbo build
```

- [ ] **Step 7: Commit**

```bash
git add packages/skills/ skills/
git commit -m "feat(skills): initialize skills package and directory structure"
```

---

### Task 2: Skill Types

**Files:**
- Create: `packages/skills/src/types.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write tests for skill types**

Create `packages/skills/src/__tests__/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SkillDefinition, SkillMetadata, SkillInput, SkillOutput } from '../types.js';

describe('Skill Types', () => {
  it('SkillDefinition captures all required fields', () => {
    const skill: SkillDefinition = {
      name: 'weather-lookup',
      description: 'Look up current weather for a city',
      version: '1.0.0',
      source: 'generated',
      filePath: 'skills/generated/weather-lookup.ts',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
      permissions: [],
      enabled: true,
    };
    expect(skill.name).toBe('weather-lookup');
    expect(skill.source).toBe('generated');
  });

  it('SkillDefinition supports elevated permissions', () => {
    const skill: SkillDefinition = {
      name: 'file-processor',
      description: 'Process files on disk',
      version: '1.0.0',
      source: 'user',
      filePath: 'skills/user/file-processor.ts',
      inputSchema: { type: 'object', properties: {} },
      permissions: ['filesystem', 'network'],
      enabled: true,
      requiresApproval: true,
    };
    expect(skill.permissions).toContain('filesystem');
    expect(skill.requiresApproval).toBe(true);
  });

  it('SkillMetadata captures creation context', () => {
    const meta: SkillMetadata = {
      createdBy: 'dad',
      createdAt: '2026-03-16T10:00:00Z',
      updatedAt: '2026-03-16T12:00:00Z',
      usageCount: 5,
      lastUsed: '2026-03-16T11:30:00Z',
    };
    expect(meta.usageCount).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: FAIL — imports not found.

- [ ] **Step 3: Implement types.ts**

```typescript
/**
 * JSON Schema-like input schema for a skill.
 */
export interface SkillInputSchema {
  type: 'object';
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * Permission types a skill can request.
 */
export type SkillPermission = 'filesystem' | 'network' | 'shell' | 'env';

/**
 * Where the skill came from.
 */
export type SkillSource = 'bundled' | 'generated' | 'user';

/**
 * Core definition of a skill — what it does, where it lives, what it needs.
 */
export interface SkillDefinition {
  name: string;
  description: string;
  version: string;
  source: SkillSource;
  filePath: string;
  inputSchema: SkillInputSchema;
  permissions: SkillPermission[];
  enabled: boolean;
  requiresApproval?: boolean;
}

/**
 * Runtime metadata tracked per skill.
 */
export interface SkillMetadata {
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsed?: string;
}

/**
 * A registered skill combines definition + metadata.
 */
export interface RegisteredSkill {
  definition: SkillDefinition;
  metadata: SkillMetadata;
}

/**
 * Input passed to a skill at execution time.
 */
export interface SkillInput {
  [key: string]: unknown;
}

/**
 * Output returned from a skill execution.
 */
export interface SkillOutput {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Format of skills/registry.yaml.
 */
export interface RegistryFile {
  skills: Array<RegisteredSkill>;
}
```

- [ ] **Step 4: Update barrel export**

`packages/skills/src/index.ts`:
```typescript
export * from './types.js';
```

- [ ] **Step 5: Run tests**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/skills/src/types.ts packages/skills/src/__tests__/types.test.ts packages/skills/src/index.ts
git commit -m "feat(skills): add skill type definitions (SkillDefinition, SkillMetadata, SkillInput/Output)"
```

---

### Task 3: Skill Registry

**Files:**
- Create: `packages/skills/src/registry.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write tests for registry**

Create `packages/skills/src/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillRegistry } from '../registry.js';
import type { SkillDefinition, SkillMetadata } from '../types.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeSkill(name: string, source: 'bundled' | 'generated' | 'user' = 'generated'): SkillDefinition {
  return {
    name,
    description: `Test skill: ${name}`,
    version: '1.0.0',
    source,
    filePath: `skills/${source}/${name}.ts`,
    inputSchema: { type: 'object', properties: {} },
    permissions: [],
    enabled: true,
  };
}

function makeMeta(createdBy = 'test'): SkillMetadata {
  const now = new Date().toISOString();
  return { createdBy, createdAt: now, updatedAt: now, usageCount: 0 };
}

describe('SkillRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-skills-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // Write empty registry
    writeFileSync(join(tmpDir, 'registry.yaml'), 'skills: []\n');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads from empty registry file', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    expect(reg.list()).toHaveLength(0);
  });

  it('registers a skill', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('weather')).toBeDefined();
    expect(reg.get('weather')!.definition.name).toBe('weather');
  });

  it('persists skills to YAML file', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    reg.save();

    // Reload from disk
    const reg2 = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg2.load();
    expect(reg2.list()).toHaveLength(1);
    expect(reg2.get('weather')).toBeDefined();
  });

  it('unregisters a skill', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    reg.unregister('weather');
    expect(reg.get('weather')).toBeUndefined();
    expect(reg.list()).toHaveLength(0);
  });

  it('prevents duplicate skill names', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    expect(() => reg.register(makeSkill('weather'), makeMeta())).toThrow(/already registered/);
  });

  it('updates an existing skill', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    const updated = makeSkill('weather');
    updated.version = '2.0.0';
    reg.update('weather', updated);
    expect(reg.get('weather')!.definition.version).toBe('2.0.0');
  });

  it('filters by source', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('a', 'bundled'), makeMeta());
    reg.register(makeSkill('b', 'generated'), makeMeta());
    reg.register(makeSkill('c', 'user'), makeMeta());
    expect(reg.listBySource('bundled')).toHaveLength(1);
    expect(reg.listBySource('generated')).toHaveLength(1);
  });

  it('tracks usage count', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    reg.recordUsage('weather');
    reg.recordUsage('weather');
    expect(reg.get('weather')!.metadata.usageCount).toBe(2);
    expect(reg.get('weather')!.metadata.lastUsed).toBeDefined();
  });

  it('generates tool descriptions for Claude Code', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    const skill = makeSkill('weather');
    skill.description = 'Look up weather';
    skill.inputSchema = {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    };
    reg.register(skill, makeMeta());
    const tools = reg.getToolDescriptions();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('skill_weather');
    expect(tools[0].description).toBe('Look up weather');
    expect(tools[0].inputSchema).toEqual(skill.inputSchema);
  });

  // --- Unified Tool Registry: external tools from other modules ---

  it('registers external tools from other modules (apple, memory, etc.)', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.registerExternalTool({
      name: 'apple_calendar',
      description: 'List calendar events',
      inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
    });
    const tools = reg.getToolDescriptions();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('apple_calendar');
  });

  it('includes both skill-based and external tools in descriptions', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.register(makeSkill('weather'), makeMeta());
    reg.registerExternalTool({
      name: 'memory_grep',
      description: 'Search memory',
      inputSchema: { type: 'object', properties: {} },
    });
    const tools = reg.getToolDescriptions();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name).sort()).toEqual(['memory_grep', 'skill_weather']);
  });

  // --- Edge cases ---

  it('update on non-existent skill throws', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    expect(() => reg.update('nonexistent', makeSkill('nonexistent'))).toThrow(/not found/);
  });

  it('handles corrupted registry file gracefully', () => {
    writeFileSync(join(tmpDir, 'registry.yaml'), '{{invalid yaml');
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load(); // should not throw
    expect(reg.list()).toHaveLength(0);
  });

  it('recordUsage on non-existent skill is a silent no-op', () => {
    const reg = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    reg.load();
    reg.recordUsage('nonexistent'); // should not throw
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: FAIL — `SkillRegistry` not found.

- [ ] **Step 3: Implement registry.ts**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import type {
  RegisteredSkill,
  SkillDefinition,
  SkillMetadata,
  SkillSource,
  RegistryFile,
} from './types.js';

export interface ToolDescription {
  name: string;
  description: string;
  inputSchema: SkillDefinition['inputSchema'];
}

export class SkillRegistry {
  private filePath: string;
  private skills: Map<string, RegisteredSkill> = new Map();
  private externalTools: Map<string, ToolDescription> = new Map();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const data = yaml.load(content) as RegistryFile | null;
      this.skills.clear();
      if (data?.skills) {
        for (const entry of data.skills) {
          this.skills.set(entry.definition.name, entry);
        }
      }
    } catch {
      this.skills.clear();
    }
  }

  save(): void {
    const data: RegistryFile = {
      skills: [...this.skills.values()],
    };
    writeFileSync(this.filePath, yaml.dump(data, { lineWidth: 120 }));
  }

  register(definition: SkillDefinition, metadata: SkillMetadata): void {
    if (this.skills.has(definition.name)) {
      throw new Error(`Skill "${definition.name}" is already registered`);
    }
    this.skills.set(definition.name, { definition, metadata });
  }

  unregister(name: string): void {
    this.skills.delete(name);
  }

  update(name: string, definition: SkillDefinition): void {
    const existing = this.skills.get(name);
    if (!existing) throw new Error(`Skill "${name}" not found`);
    existing.definition = definition;
    existing.metadata.updatedAt = new Date().toISOString();
  }

  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  list(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  listBySource(source: SkillSource): RegisteredSkill[] {
    return this.list().filter((s) => s.definition.source === source);
  }

  recordUsage(name: string): void {
    const skill = this.skills.get(name);
    if (skill) {
      skill.metadata.usageCount++;
      skill.metadata.lastUsed = new Date().toISOString();
    }
  }

  /**
   * Register a tool from another module (apple, memory, media, etc.).
   * These are NOT file-based skills — they're in-process tool implementations
   * registered so Claude Code sees a unified tool list.
   */
  registerExternalTool(tool: ToolDescription): void {
    this.externalTools.set(tool.name, tool);
  }

  unregisterExternalTool(name: string): void {
    this.externalTools.delete(name);
  }

  /**
   * Generate tool descriptions for Claude Code.
   * Includes both file-based skills (prefixed `skill_`) and external module tools.
   */
  getToolDescriptions(): ToolDescription[] {
    const skillTools = this.list()
      .filter((s) => s.definition.enabled)
      .map((s) => ({
        name: `skill_${s.definition.name}`,
        description: s.definition.description,
        inputSchema: s.definition.inputSchema,
      }));

    return [...skillTools, ...this.externalTools.values()];
  }
}
```

- [ ] **Step 4: Update barrel**

`packages/skills/src/index.ts`:
```typescript
export * from './types.js';
export { SkillRegistry, type ToolDescription } from './registry.js';
```

- [ ] **Step 5: Run tests**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: PASS — all registry tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/skills/src/registry.ts packages/skills/src/__tests__/registry.test.ts packages/skills/src/index.ts
git commit -m "feat(skills): add SkillRegistry with YAML persistence, tool descriptions, and usage tracking"
```

---

## Chunk 2: Validator + Generator

### Task 4: Skill Validator

**Files:**
- Create: `packages/skills/src/validator.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write tests for validator**

Create `packages/skills/src/__tests__/validator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { SkillValidator, type ValidationResult } from '../validator.js';

describe('SkillValidator', () => {
  const validator = new SkillValidator();

  it('accepts valid skill code', () => {
    const code = `
export default async function(input) {
  return { success: true, result: input.city + " weather: sunny" };
}
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects code with child_process import', () => {
    const code = `
import { exec } from 'child_process';
export default async function(input) {
  return { success: true, result: exec('ls') };
}
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('child_process'))).toBe(true);
  });

  it('rejects code with require("child_process")', () => {
    const code = `
const { exec } = require('child_process');
export default async function(input) { return { success: true }; }
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
  });

  it('rejects code with fs access outside allowed dirs', () => {
    const code = `
import { readFileSync } from 'fs';
export default async function(input) {
  return { success: true, result: readFileSync('/etc/passwd', 'utf-8') };
}
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('fs'))).toBe(true);
  });

  it('rejects code with net/http imports', () => {
    const code = `
import http from 'http';
export default async function(input) { return { success: true }; }
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
  });

  it('rejects code with eval or Function constructor', () => {
    const code = `
export default async function(input) {
  return { success: true, result: eval(input.code) };
}
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('eval'))).toBe(true);
  });

  it('rejects code with process.env access', () => {
    const code = `
export default async function(input) {
  return { success: true, result: process.env.SECRET };
}
`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
  });

  it('allows fetch when network permission is granted', () => {
    const code = `
export default async function(input) {
  const res = await fetch(input.url);
  return { success: true, result: await res.text() };
}
`;
    const withoutPerm = validator.validate(code);
    expect(withoutPerm.valid).toBe(false);

    const withPerm = validator.validate(code, ['network']);
    expect(withPerm.valid).toBe(true);
  });

  it('allows fs when filesystem permission is granted', () => {
    const code = `
import { readFileSync } from 'fs';
export default async function(input) { return { success: true }; }
`;
    const withPerm = validator.validate(code, ['filesystem']);
    expect(withPerm.valid).toBe(true);
  });

  it('rejects empty or non-function exports', () => {
    const code = `export const x = 5;`;
    const result = validator.validate(code);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('default'))).toBe(true);
  });

  // Acknowledge: regex validation is pragmatic, not cryptographic.
  // Obfuscated patterns can bypass it. This test documents the limitation.
  it('acknowledges dynamic import bypass (known limitation)', () => {
    const code = `
export default async function(input) {
  const m = 'child_' + 'process';
  const mod = await import(m);
  return { success: true };
}
`;
    // This WILL pass validation — dynamic imports are not caught by regex.
    // The spec acknowledges this as a pragmatic boundary.
    const result = validator.validate(code);
    expect(result.valid).toBe(true); // known limitation
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: FAIL.

- [ ] **Step 3: Implement validator.ts**

```typescript
import type { SkillPermission } from './types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const DANGEROUS_MODULES: Record<string, SkillPermission | null> = {
  'child_process': 'shell',
  'fs': 'filesystem',
  'fs/promises': 'filesystem',
  'path': null, // always allowed
  'net': 'network',
  'http': 'network',
  'https': 'network',
  'dgram': 'network',
  'tls': 'network',
};

const DANGEROUS_PATTERNS = [
  { pattern: /\beval\s*\(/, message: 'eval() is not allowed — use explicit logic instead' },
  { pattern: /\bnew\s+Function\s*\(/, message: 'new Function() is not allowed — use explicit logic instead' },
  { pattern: /\bprocess\.env\b/, message: 'process.env access is not allowed — use skill input parameters instead' },
  { pattern: /\bprocess\.exit\b/, message: 'process.exit() is not allowed' },
  { pattern: /\brequire\s*\(\s*['"]child_process['"]/, message: 'child_process is restricted (requires shell permission)' },
];

export class SkillValidator {
  validate(code: string, grantedPermissions: SkillPermission[] = []): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for default export (function)
    if (!code.match(/export\s+default\s+(async\s+)?function/)) {
      errors.push('Skill must have a default export that is an async function');
    }

    // Check module imports
    const importMatches = [
      ...code.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g),
      ...code.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ];

    for (const match of importMatches) {
      const moduleName = match[1];
      if (moduleName in DANGEROUS_MODULES) {
        const requiredPerm = DANGEROUS_MODULES[moduleName];
        if (requiredPerm !== null && !grantedPermissions.includes(requiredPerm)) {
          errors.push(
            `Module "${moduleName}" requires "${requiredPerm}" permission. ` +
            `Grant it via permissions: ["${requiredPerm}"]`
          );
        }
      }
    }

    // Check for fetch/network usage
    if (code.match(/\bfetch\s*\(/) && !grantedPermissions.includes('network')) {
      errors.push('fetch() requires "network" permission');
    }

    // Check dangerous patterns
    for (const { pattern, message } of DANGEROUS_PATTERNS) {
      if (pattern.test(code)) {
        // Check if a granted permission covers it
        if (message.includes('child_process') && grantedPermissions.includes('shell')) continue;
        errors.push(message);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
```

- [ ] **Step 4: Update barrel**

Add to `packages/skills/src/index.ts`:
```typescript
export { SkillValidator, type ValidationResult } from './validator.js';
```

- [ ] **Step 5: Run tests**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/skills/src/validator.ts packages/skills/src/__tests__/validator.test.ts packages/skills/src/index.ts
git commit -m "feat(skills): add SkillValidator with dangerous pattern detection and permission gating"
```

---

### Task 5: Skill Generator

**Files:**
- Create: `packages/skills/src/generator.ts`
- Create: `skills/bundled/hello-world.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write tests for generator**

Create `packages/skills/src/__tests__/generator.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillGenerator } from '../generator.js';
import { SkillRegistry } from '../registry.js';
import { SkillValidator } from '../validator.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SkillGenerator', () => {
  let tmpDir: string;
  let registry: SkillRegistry;
  let validator: SkillValidator;
  let generator: SkillGenerator;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-gen-test-${Date.now()}`);
    mkdirSync(join(tmpDir, 'generated'), { recursive: true });
    mkdirSync(join(tmpDir, 'bundled'), { recursive: true });
    mkdirSync(join(tmpDir, 'user'), { recursive: true });

    const registryPath = join(tmpDir, 'registry.yaml');
    registry = new SkillRegistry(registryPath);
    registry.load();
    validator = new SkillValidator();
    generator = new SkillGenerator(registry, validator, tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a skill file as .mjs and registers it', () => {
    const code = `
export default async function(input) {
  return { success: true, result: "Hello " + input.name };
}
`;
    const result = generator.createSkill({
      name: 'greeter',
      description: 'Greet someone by name',
      code,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name to greet' } },
        required: ['name'],
      },
      createdBy: 'dad',
      createdByRole: 'admin',
    });

    expect(result.success).toBe(true);
    expect(existsSync(join(tmpDir, 'generated', 'greeter.mjs'))).toBe(true);
    expect(registry.get('greeter')).toBeDefined();
  });

  it('rejects invalid skill code', () => {
    const code = `
import { exec } from 'child_process';
export default async function(input) { exec('rm -rf /'); return { success: true }; }
`;
    const result = generator.createSkill({
      name: 'bad-skill',
      description: 'Bad skill',
      code,
      inputSchema: { type: 'object', properties: {} },
      createdBy: 'dad',
      createdByRole: 'admin',
    });

    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(existsSync(join(tmpDir, 'generated', 'bad-skill.mjs'))).toBe(false);
  });

  it('rejects skill creation from chat users', () => {
    const code = `export default async function(input) { return { success: true }; }`;
    const result = generator.createSkill({
      name: 'forbidden',
      description: 'Should not be created',
      code,
      inputSchema: { type: 'object', properties: {} },
      createdBy: 'son',
      createdByRole: 'chat',
    });
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('Chat users');
  });

  it('rejects invalid skill names (path traversal, special chars)', () => {
    const code = `export default async function(input) { return { success: true }; }`;
    const badNames = ['../../etc', 'UPPERCASE', 'with spaces', '', '.hidden'];
    for (const name of badNames) {
      const result = generator.createSkill({
        name,
        description: 'test',
        code,
        inputSchema: { type: 'object', properties: {} },
        createdBy: 'dad',
        createdByRole: 'admin',
      });
      expect(result.success).toBe(false);
    }
  });

  it('updates an existing skill', () => {
    const code1 = `export default async function(input) { return { success: true, result: "v1" }; }`;
    generator.createSkill({
      name: 'evolving',
      description: 'v1',
      code: code1,
      inputSchema: { type: 'object', properties: {} },
      createdBy: 'dad',
      createdByRole: 'admin',
    });

    const code2 = `export default async function(input) { return { success: true, result: "v2" }; }`;
    const result = generator.updateSkill('evolving', {
      description: 'v2',
      code: code2,
    });

    expect(result.success).toBe(true);
    expect(registry.get('evolving')!.definition.description).toBe('v2');
    const fileContent = readFileSync(join(tmpDir, 'generated', 'evolving.mjs'), 'utf-8');
    expect(fileContent).toContain('v2');
  });

  it('loads bundled skills from bundled/ directory', () => {
    const bundledCode = `export default async function(input) { return { success: true, result: "hello" }; }`;
    writeFileSync(join(tmpDir, 'bundled', 'hello-world.mjs'), bundledCode);
    writeFileSync(join(tmpDir, 'bundled', 'hello-world.json'), JSON.stringify({
      name: 'hello-world',
      description: 'A simple hello world skill',
      version: '1.0.0',
      inputSchema: { type: 'object', properties: {} },
      permissions: [],
    }));

    const loaded = generator.loadBundledSkills();
    expect(loaded).toBeGreaterThanOrEqual(1);
    expect(registry.get('hello-world')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: FAIL.

- [ ] **Step 3: Implement generator.ts**

```typescript
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import type { SkillDefinition, SkillInputSchema, SkillPermission, SkillMetadata } from './types.js';
import type { SkillRegistry } from './registry.js';
import type { SkillValidator, ValidationResult } from './validator.js';

export interface CreateSkillRequest {
  name: string;
  description: string;
  code: string;
  inputSchema: SkillInputSchema;
  permissions?: SkillPermission[];
  createdBy: string;
  createdByRole: 'admin' | 'chat' | 'system';
}

export interface UpdateSkillRequest {
  description?: string;
  code?: string;
  inputSchema?: SkillInputSchema;
  permissions?: SkillPermission[];
}

export interface GeneratorResult {
  success: boolean;
  errors?: string[];
  filePath?: string;
}

export class SkillGenerator {
  private registry: SkillRegistry;
  private validator: SkillValidator;
  private skillsDir: string;

  constructor(registry: SkillRegistry, validator: SkillValidator, skillsDir: string) {
    this.registry = registry;
    this.validator = validator;
    this.skillsDir = skillsDir;
  }

  /** Hook: called before registration for AI-powered code review. Override to integrate with agent. */
  onBeforeRegister?: (name: string, code: string) => Promise<{ approved: boolean; reason?: string }>;

  /** Hook: called after a skill is created/updated for git auto-commit. Override to integrate with git. */
  onAfterSave?: (filePath: string, skillName: string) => Promise<void>;

  createSkill(request: CreateSkillRequest): GeneratorResult {
    // Check role-based creation permission
    if (request.createdByRole === 'chat') {
      return { success: false, errors: ['Chat users cannot create skills. Contact an admin.'] };
    }

    // Validate skill name (prevent path traversal, special chars)
    if (!request.name.match(/^[a-z0-9][a-z0-9-]*$/)) {
      return { success: false, errors: ['Skill name must be lowercase alphanumeric with hyphens only (e.g., "weather-lookup")'] };
    }

    // Validate code
    const validation = this.validator.validate(request.code, request.permissions ?? []);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Write skill file as .mjs (directly importable by worker threads)
    const generatedDir = join(this.skillsDir, 'generated');
    if (!existsSync(generatedDir)) {
      mkdirSync(generatedDir, { recursive: true });
    }
    const filePath = join(generatedDir, `${request.name}.mjs`);
    writeFileSync(filePath, request.code);

    // Register
    const definition: SkillDefinition = {
      name: request.name,
      description: request.description,
      version: '1.0.0',
      source: 'generated',
      filePath,
      inputSchema: request.inputSchema,
      permissions: request.permissions ?? [],
      enabled: true,
      requiresApproval: (request.permissions?.length ?? 0) > 0,
    };

    const metadata: SkillMetadata = {
      createdBy: request.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      usageCount: 0,
    };

    this.registry.register(definition, metadata);
    this.registry.save();

    return { success: true, filePath };
  }

  updateSkill(name: string, updates: UpdateSkillRequest): GeneratorResult {
    const existing = this.registry.get(name);
    if (!existing) return { success: false, errors: [`Skill "${name}" not found`] };

    const code = updates.code ?? readFileSync(existing.definition.filePath, 'utf-8');
    const permissions = updates.permissions ?? existing.definition.permissions;

    if (updates.code) {
      const validation = this.validator.validate(code, permissions);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }
      writeFileSync(existing.definition.filePath, code);
    }

    const updatedDef: SkillDefinition = {
      ...existing.definition,
      description: updates.description ?? existing.definition.description,
      inputSchema: updates.inputSchema ?? existing.definition.inputSchema,
      permissions,
    };

    this.registry.update(name, updatedDef);
    this.registry.save();

    return { success: true, filePath: existing.definition.filePath };
  }

  /**
   * Scan bundled/ directory for skill files with companion .json metadata.
   * Returns number of skills loaded.
   */
  loadBundledSkills(): number {
    const bundledDir = join(this.skillsDir, 'bundled');
    if (!existsSync(bundledDir)) return 0;

    let count = 0;
    for (const file of readdirSync(bundledDir)) {
      if (!file.endsWith('.mjs') && !file.endsWith('.js')) continue;
      const name = basename(file).replace(/\.(mjs|js)$/, '');
      if (this.registry.get(name)) continue; // already registered

      const metaPath = join(bundledDir, `${name}.json`);
      if (!existsSync(metaPath)) continue;

      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        const definition: SkillDefinition = {
          name: meta.name ?? name,
          description: meta.description ?? '',
          version: meta.version ?? '1.0.0',
          source: 'bundled',
          filePath: join(bundledDir, file),
          inputSchema: meta.inputSchema ?? { type: 'object', properties: {} },
          permissions: meta.permissions ?? [],
          enabled: true,
        };

        this.registry.register(definition, {
          createdBy: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          usageCount: 0,
        });
        count++;
      } catch {
        // Skip malformed bundled skills
      }
    }

    return count;
  }
}
```

- [ ] **Step 4: Create the bundled hello-world skill**

`skills/bundled/hello-world.mjs`:
```javascript
export default async function (input) {
  const name = input.name ?? 'World';
  return { success: true, result: `Hello, ${name}!` };
}
```

`skills/bundled/hello-world.json`:
```json
{
  "name": "hello-world",
  "description": "A simple greeting skill — says hello to the given name",
  "version": "1.0.0",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "Name to greet (defaults to 'World')" }
    }
  },
  "permissions": []
}
```

- [ ] **Step 5: Update barrel**

Add to `packages/skills/src/index.ts`:
```typescript
export { SkillGenerator, type CreateSkillRequest, type UpdateSkillRequest, type GeneratorResult } from './generator.js';
```

- [ ] **Step 6: Run tests**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/skills/src/generator.ts packages/skills/src/__tests__/generator.test.ts packages/skills/src/index.ts skills/bundled/
git commit -m "feat(skills): add SkillGenerator for creating, updating, and loading bundled skills"
```

---

## Chunk 3: Runner + Integration

### Task 6: Skill Runner (Worker Thread Execution)

**Files:**
- Create: `packages/skills/src/runner.ts`
- Create: `packages/skills/src/worker.ts`
- Modify: `packages/skills/src/index.ts`

- [ ] **Step 1: Write tests for runner**

Create `packages/skills/src/__tests__/runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillRunner } from '../runner.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SkillRunner', () => {
  let tmpDir: string;
  let runner: SkillRunner;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-runner-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    runner = new SkillRunner({ timeoutMs: 5000 });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executes a simple skill and returns result', async () => {
    const skillPath = join(tmpDir, 'greet.mjs');
    writeFileSync(skillPath, `
      export default async function(input) {
        return { success: true, result: "Hello " + input.name };
      }
    `);

    const output = await runner.run(skillPath, { name: 'World' });
    expect(output.success).toBe(true);
    expect(output.result).toBe('Hello World');
  });

  it('returns error for skill that throws', async () => {
    const skillPath = join(tmpDir, 'bad.mjs');
    writeFileSync(skillPath, `
      export default async function(input) {
        throw new Error("Something broke");
      }
    `);

    const output = await runner.run(skillPath, {});
    expect(output.success).toBe(false);
    expect(output.error).toContain('Something broke');
  });

  it('times out long-running skills', async () => {
    const skillPath = join(tmpDir, 'slow.mjs');
    writeFileSync(skillPath, `
      export default async function(input) {
        await new Promise(r => setTimeout(r, 30000));
        return { success: true };
      }
    `);

    const shortRunner = new SkillRunner({ timeoutMs: 200 });
    const output = await shortRunner.run(skillPath, {});
    expect(output.success).toBe(false);
    expect(output.error).toContain('timeout');
  }, 10000);

  it('handles skill that returns non-standard output', async () => {
    const skillPath = join(tmpDir, 'weird.mjs');
    writeFileSync(skillPath, `
      export default async function(input) {
        return "just a string";
      }
    `);

    const output = await runner.run(skillPath, {});
    expect(output.success).toBe(true);
    expect(output.result).toBe('just a string');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: FAIL.

- [ ] **Step 3: Implement worker.ts (worker thread entry point)**

```typescript
import { workerData, parentPort } from 'worker_threads';

if (!parentPort) {
  throw new Error('worker.ts must be run as a worker thread');
}

interface WorkerData {
  skillPath: string;
  input: Record<string, unknown>;
}

async function run() {
  const { skillPath, input } = workerData as WorkerData;

  try {
    const mod = await import(skillPath);
    const fn = mod.default ?? mod;

    if (typeof fn !== 'function') {
      parentPort!.postMessage({
        success: false,
        error: 'Skill does not export a default function',
      });
      return;
    }

    const result = await fn(input);

    // Normalize output
    if (result && typeof result === 'object' && 'success' in result) {
      parentPort!.postMessage(result);
    } else {
      parentPort!.postMessage({ success: true, result });
    }
  } catch (err) {
    parentPort!.postMessage({
      success: false,
      error: (err as Error).message,
    });
  }
}

run();
```

- [ ] **Step 4: Implement runner.ts**

```typescript
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { SkillOutput } from './types.js';

export interface SkillRunnerOptions {
  timeoutMs: number;
}

export class SkillRunner {
  private options: SkillRunnerOptions;

  constructor(options: SkillRunnerOptions) {
    this.options = options;
  }

  run(skillPath: string, input: Record<string, unknown>): Promise<SkillOutput> {
    return new Promise((resolve) => {
      const workerPath = join(
        dirname(fileURLToPath(import.meta.url)),
        'worker.js',
      );

      let settled = false;

      const worker = new Worker(workerPath, {
        workerData: { skillPath, input },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          worker.terminate();
          resolve({ success: false, error: `Skill execution timeout after ${this.options.timeoutMs}ms` });
        }
      }, this.options.timeoutMs);

      worker.on('message', (msg: SkillOutput) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(msg);
        }
      });

      worker.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ success: false, error: err.message });
        }
      });

      worker.on('exit', (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ success: false, error: `Worker exited with code ${code}` });
        }
      });
    });
  }
}
```

- [ ] **Step 5: Update barrel**

Add to `packages/skills/src/index.ts`:
```typescript
export { SkillRunner, type SkillRunnerOptions } from './runner.js';
```

- [ ] **Step 6: Run tests**

Run: `npx turbo build && cd packages/skills && npx vitest run`
Expected: PASS — all runner tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/skills/src/runner.ts packages/skills/src/worker.ts packages/skills/src/__tests__/runner.test.ts packages/skills/src/index.ts
git commit -m "feat(skills): add SkillRunner executing skills in worker threads with timeout"
```

---

### Task 7: Integration Test + Final Verification

**Files:**
- Create: `packages/skills/src/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SkillRegistry } from '../registry.js';
import { SkillValidator } from '../validator.js';
import { SkillGenerator } from '../generator.js';
import { SkillRunner } from '../runner.js';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Skills Integration', () => {
  let tmpDir: string;
  let registry: SkillRegistry;
  let generator: SkillGenerator;
  let runner: SkillRunner;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `ccbuddy-skills-int-${Date.now()}`);
    mkdirSync(join(tmpDir, 'generated'), { recursive: true });
    mkdirSync(join(tmpDir, 'bundled'), { recursive: true });
    mkdirSync(join(tmpDir, 'user'), { recursive: true });

    registry = new SkillRegistry(join(tmpDir, 'registry.yaml'));
    registry.load();
    const validator = new SkillValidator();
    generator = new SkillGenerator(registry, validator, tmpDir);
    runner = new SkillRunner({ timeoutMs: 5000 });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full lifecycle: create → register → execute → update → re-execute', async () => {
    // 1. Create a skill
    const createResult = generator.createSkill({
      name: 'adder',
      description: 'Add two numbers',
      code: `export default async function(input) {\n  return { success: true, result: input.a + input.b };\n}\n`,
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
      createdBy: 'dad',
      createdByRole: 'admin',
    });
    expect(createResult.success).toBe(true);

    // 2. Verify it's registered
    const skill = registry.get('adder');
    expect(skill).toBeDefined();
    expect(skill!.definition.description).toBe('Add two numbers');

    // 3. Execute it — files are already .mjs, directly importable by worker threads
    const output = await runner.run(createResult.filePath!, { a: 3, b: 4 });
    expect(output.success).toBe(true);
    expect(output.result).toBe(7);

    // 4. Record usage
    registry.recordUsage('adder');
    expect(registry.get('adder')!.metadata.usageCount).toBe(1);

    // 5. Update the skill
    const updateResult = generator.updateSkill('adder', {
      description: 'Add two numbers (v2)',
      code: `export default async function(input) {\n  return { success: true, result: (input.a + input.b) * 2 };\n}\n`,
    });
    expect(updateResult.success).toBe(true);

    // 6. Execute updated version (file was updated in-place by updateSkill)
    const output2 = await runner.run(createResult.filePath!, { a: 3, b: 4 });
    expect(output2.success).toBe(true);
    expect(output2.result).toBe(14);

    // 7. Tool descriptions available for Claude Code
    const tools = registry.getToolDescriptions();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('skill_adder');
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `npx turbo build && npx turbo test`
Expected: ALL pass across core, agent, orchestrator, AND skills packages.

- [ ] **Step 3: Final verification**

Run: `npx turbo build` — all 4 packages compile.
Run: `npx turbo test` — all tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/skills/src/__tests__/integration.test.ts
git commit -m "test(skills): add full lifecycle integration test for create → execute → update flow"
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git status  # verify nothing unexpected
git commit -m "chore: plan 2 complete — skills module with registry, validator, generator, and runner"
```

---

## Summary

**Plan 2 delivers:**
- `@ccbuddy/skills` package with 4 components:
  - **SkillRegistry** — YAML-persisted skill manifest with tool description generation for Claude Code
  - **SkillValidator** — static analysis for dangerous patterns (child_process, fs, net, eval, process.env) with permission-gated exceptions
  - **SkillGenerator** — creates and updates skill files on disk, validates before registration
  - **SkillRunner** — executes skills in isolated worker threads with configurable timeout
- Bundled hello-world example skill
- Project-root `skills/` directory (bundled, generated, user)
- Full lifecycle integration test

**What's NOT in this plan (deferred):**
- Git auto-commit of generated skills — hook point exists (`onAfterSave`), actual git integration needs orchestrator (Plan 5)
- Claude Code tool registration — wiring skills as CC tools needs gateway (Plan 4); `getToolDescriptions()` is ready
- AI-powered code review gate — hook point exists (`onBeforeRegister`), actual CC review needs agent integration (Plan 4)
- Admin approval flow for elevated permissions — needs gateway UI for user confirmation (Plan 4)
- OS-level sandboxing via `sandbox-exec` (future enhancement beyond v1)
- Updating `SkillsConfig` in core schema — the existing schema has `directory` and `auto_reload`; adding `sandbox_enabled`, `require_admin_approval_for_elevated`, `auto_git_commit` should be done when those features are actually wired in
- Event bus integration (skill.created, skill.executed events) — deferred until gateway exists to consume them
