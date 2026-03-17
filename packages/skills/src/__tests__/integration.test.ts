import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillRegistry } from '../registry.js';
import { SkillValidator } from '../validator.js';
import { SkillGenerator } from '../generator.js';
import { SkillRunner } from '../runner.js';

// ── Skill code snippets ──────────────────────────────────────────────────────

const ADDER_CODE = `export default async function(input) {
  return { success: true, result: input.a + input.b };
}`;

const ADDER_DOUBLED_CODE = `export default async function(input) {
  return { success: true, result: (input.a + input.b) * 2 };
}`;

// ── Test fixtures ────────────────────────────────────────────────────────────

let tmpDir: string;
let registry: SkillRegistry;
let validator: SkillValidator;
let generator: SkillGenerator;
let runner: SkillRunner;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'skill-integration-'));
  mkdirSync(join(tmpDir, 'generated'), { recursive: true });
  mkdirSync(join(tmpDir, 'bundled'), { recursive: true });
  mkdirSync(join(tmpDir, 'user'), { recursive: true });

  const registryPath = join(tmpDir, 'registry.yaml');
  registry = new SkillRegistry(registryPath);
  await registry.load();

  validator = new SkillValidator();
  generator = new SkillGenerator(registry, validator, tmpDir);
  runner = new SkillRunner({ timeoutMs: 5000 });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Full lifecycle integration test ─────────────────────────────────────────

describe('Skills full lifecycle', () => {
  it('create → register → execute → record usage → update → execute updated', async () => {
    // Step 1: Create skill via generator
    const createResult = await generator.createSkill({
      name: 'adder',
      description: 'Adds two numbers together',
      code: ADDER_CODE,
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First operand' },
          b: { type: 'number', description: 'Second operand' },
        },
        required: ['a', 'b'],
      },
      permissions: [],
      createdBy: 'admin-user',
      createdByRole: 'admin',
    });

    expect(createResult.success).toBe(true);
    expect(createResult.filePath).toBeDefined();

    // Step 2: Verify it's registered in the registry
    const registered = registry.get('adder');
    expect(registered).toBeDefined();
    expect(registered!.definition.name).toBe('adder');
    expect(registered!.definition.source).toBe('generated');
    expect(registered!.definition.enabled).toBe(true);
    expect(registered!.metadata.createdBy).toBe('admin-user');
    expect(registered!.metadata.usageCount).toBe(0);

    // Step 3: Execute it via runner — pass { a: 3, b: 4 }, expect result 7
    const output1 = await runner.run(createResult.filePath!, { a: 3, b: 4 });
    expect(output1.success).toBe(true);
    expect(output1.result).toBe(7);

    // Step 4: Record usage, verify count incremented
    registry.recordUsage('adder');
    const afterUsage = registry.get('adder');
    expect(afterUsage!.metadata.usageCount).toBe(1);
    expect(afterUsage!.metadata.lastUsed).toBeDefined();

    // Step 5: Update the skill (multiply result by 2)
    const updateResult = await generator.updateSkill('adder', {
      code: ADDER_DOUBLED_CODE,
    });
    expect(updateResult.success).toBe(true);

    // Step 6: Execute updated version — expect result 14
    const output2 = await runner.run(updateResult.filePath!, { a: 3, b: 4 });
    expect(output2.success).toBe(true);
    expect(output2.result).toBe(14);

    // Step 7: Verify tool descriptions are available
    const toolDescriptions = registry.getToolDescriptions();
    const adderTool = toolDescriptions.find(t => t.name === 'skill_adder');
    expect(adderTool).toBeDefined();
    expect(adderTool!.name).toBe('skill_adder');
    expect(adderTool!.description).toBe('Adds two numbers together');
    expect(adderTool!.inputSchema.type).toBe('object');
  }, 15000);
});
