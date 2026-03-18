import { describe, it, expect } from 'vitest';
import type { SkillDefinition, SkillMetadata, SkillInput, SkillOutput } from '../types.js';

describe('Skill Types', () => {
  it('SkillDefinition captures all required fields', () => {
    const skill: SkillDefinition = {
      name: 'weather-lookup',
      description: 'Look up current weather for a city',
      version: '1.0.0',
      source: 'generated',
      filePath: 'skills/generated/weather-lookup.mjs',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
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
      filePath: 'skills/user/file-processor.mjs',
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
