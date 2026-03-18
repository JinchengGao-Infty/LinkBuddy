import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import type { ToolDescription } from '@ccbuddy/core';
import type {
  SkillDefinition,
  SkillMetadata,
  RegisteredSkill,
  RegistryFile,
  SkillSource,
} from './types.js';

export type { ToolDescription };

export class SkillRegistry {
  private skills: Map<string, RegisteredSkill> = new Map();
  private externalTools: Map<string, ToolDescription> = new Map();

  constructor(private readonly filePath: string) {}

  // ── Persistence ───────────────────────────────────────────────────────────

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.skills = new Map();
      return;
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = yamlLoad(raw) as RegistryFile | null | undefined;

      this.skills = new Map();
      if (parsed && Array.isArray(parsed.skills)) {
        for (const entry of parsed.skills) {
          if (entry?.definition?.name) {
            this.skills.set(entry.definition.name, entry);
          }
        }
      }
    } catch {
      // Corrupted YAML — start with empty registry
      this.skills = new Map();
    }
  }

  async save(): Promise<void> {
    const file: RegistryFile = { skills: Array.from(this.skills.values()) };
    writeFileSync(this.filePath, yamlDump(file), 'utf8');
  }

  // ── Skill CRUD ────────────────────────────────────────────────────────────

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
    if (!existing) {
      throw new Error(`Skill "${name}" not found`);
    }
    const updatedMetadata: SkillMetadata = {
      ...existing.metadata,
      updatedAt: new Date().toISOString(),
    };
    this.skills.set(name, { definition, metadata: updatedMetadata });
  }

  get(name: string): RegisteredSkill | undefined {
    return this.skills.get(name);
  }

  list(): RegisteredSkill[] {
    return Array.from(this.skills.values());
  }

  listBySource(source: SkillSource): RegisteredSkill[] {
    return this.list().filter(s => s.definition.source === source);
  }

  recordUsage(name: string): void {
    const entry = this.skills.get(name);
    if (!entry) return; // silent no-op

    const updatedMetadata: SkillMetadata = {
      ...entry.metadata,
      usageCount: entry.metadata.usageCount + 1,
      lastUsed: new Date().toISOString(),
    };
    this.skills.set(name, { definition: entry.definition, metadata: updatedMetadata });
  }

  // ── External Tool Registry ─────────────────────────────────────────────────

  registerExternalTool(tool: ToolDescription): void {
    this.externalTools.set(tool.name, tool);
  }

  unregisterExternalTool(name: string): void {
    this.externalTools.delete(name);
  }

  // ── Tool Descriptions (for Claude Code) ───────────────────────────────────

  getToolDescriptions(): ToolDescription[] {
    const skillTools: ToolDescription[] = Array.from(this.skills.values()).map(({ definition }) => ({
      name: `skill_${definition.name}`,
      description: definition.description,
      inputSchema: definition.inputSchema,
    }));

    const externalToolsList: ToolDescription[] = Array.from(this.externalTools.values());

    return [...skillTools, ...externalToolsList];
  }
}
