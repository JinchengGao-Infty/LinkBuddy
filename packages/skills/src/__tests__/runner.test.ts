import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SkillRunner } from '../runner.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'skill-runner-test-'));
});

describe('SkillRunner', () => {
  it('executes a simple skill and returns result', async () => {
    const skillPath = join(tmpDir, 'simple.mjs');
    await writeFile(
      skillPath,
      `export default async function(input) {
        return { success: true, result: { greeting: 'hello ' + input.name } };
      }`,
    );

    const runner = new SkillRunner({ timeoutMs: 5000 });
    const output = await runner.run(skillPath, { name: 'world' });

    expect(output.success).toBe(true);
    expect(output.result).toEqual({ greeting: 'hello world' });
  }, 10000);

  it('returns error for skill that throws', async () => {
    const skillPath = join(tmpDir, 'throws.mjs');
    await writeFile(
      skillPath,
      `export default async function(input) {
        throw new Error('something went wrong');
      }`,
    );

    const runner = new SkillRunner({ timeoutMs: 5000 });
    const output = await runner.run(skillPath, {});

    expect(output.success).toBe(false);
    expect(output.error).toBe('something went wrong');
  }, 10000);

  it('times out long-running skills', async () => {
    const skillPath = join(tmpDir, 'slow.mjs');
    await writeFile(
      skillPath,
      `export default async function(input) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return { success: true, result: 'done' };
      }`,
    );

    const runner = new SkillRunner({ timeoutMs: 200 });
    const output = await runner.run(skillPath, {});

    expect(output.success).toBe(false);
    expect(output.error).toContain('timeout');
  }, 10000);

  it('handles skill that returns non-standard output (plain string)', async () => {
    const skillPath = join(tmpDir, 'plain-string.mjs');
    await writeFile(
      skillPath,
      `export default async function(input) {
        return 'just a string';
      }`,
    );

    const runner = new SkillRunner({ timeoutMs: 5000 });
    const output = await runner.run(skillPath, {});

    expect(output.success).toBe(true);
    expect(output.result).toBe('just a string');
  }, 10000);
});
