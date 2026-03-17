#!/usr/bin/env node
/**
 * Manual test script to verify the skills module works end-to-end.
 *
 * Usage: npx tsx packages/skills/src/test-skills.ts
 */

import { SkillRegistry } from './registry.js';
import { SkillValidator } from './validator.js';
import { SkillGenerator } from './generator.js';
import { SkillRunner } from './runner.js';
import { resolve } from 'path';

const skillsDir = resolve('./skills');
const registry = new SkillRegistry(resolve('./skills/registry.yaml'));
registry.load();
const validator = new SkillValidator();
const generator = new SkillGenerator(registry, validator, skillsDir);
const runner = new SkillRunner({ timeoutMs: 5000 });

async function main() {
  console.log('=== Test 1: Load bundled skills ===');
  const loaded = await generator.loadBundledSkills();
  console.log('Bundled skills loaded:', loaded);
  const helloWorld = registry.get('hello-world');
  console.log('hello-world registered:', !!helloWorld);
  console.log('Description:', helloWorld?.definition.description);

  console.log('\n=== Test 2: Execute bundled hello-world ===');
  const hwResult = await runner.run(resolve(helloWorld!.definition.filePath), { name: 'CCBuddy' });
  console.log('Result:', hwResult);

  console.log('\n=== Test 3: Generate a new skill ===');
  const createResult = await generator.createSkill({
    name: 'celsius-to-fahrenheit',
    description: 'Convert Celsius temperature to Fahrenheit',
    code: 'export default async function(input) {\n  const f = (input.celsius * 9/5) + 32;\n  return { success: true, result: f };\n}\n',
    inputSchema: {
      type: 'object',
      properties: { celsius: { type: 'number', description: 'Temperature in Celsius' } },
      required: ['celsius'],
    },
    createdBy: 'dad',
    createdByRole: 'admin',
  });
  console.log('Create success:', createResult.success);
  console.log('File path:', createResult.filePath);

  console.log('\n=== Test 4: Execute generated skill ===');
  const tempResult = await runner.run(resolve(createResult.filePath!), { celsius: 100 });
  console.log('100°C =', tempResult.result + '°F');
  console.log('0°C test:');
  const zeroResult = await runner.run(resolve(createResult.filePath!), { celsius: 0 });
  console.log('0°C =', zeroResult.result + '°F');

  console.log('\n=== Test 5: Chat user blocked from creating ===');
  const chatResult = await generator.createSkill({
    name: 'forbidden-skill',
    description: 'Should fail',
    code: 'export default async function() { return { success: true }; }',
    inputSchema: { type: 'object', properties: {} },
    createdBy: 'son',
    createdByRole: 'chat',
  });
  console.log('Chat user blocked:', !chatResult.success);
  console.log('Reason:', chatResult.errors?.[0]);

  console.log('\n=== Test 6: Validator catches dangerous code ===');
  const dangerousResult = validator.validate(
    'import { exec } from "child_process";\nexport default async function() { exec("rm -rf /"); return { success: true }; }'
  );
  console.log('Dangerous code blocked:', !dangerousResult.valid);
  console.log('Reason:', dangerousResult.errors?.[0]);

  console.log('\n=== Test 7: Tool descriptions for Claude Code ===');
  const tools = registry.getToolDescriptions();
  console.log('Tools available:', tools.length);
  for (const t of tools) {
    console.log(' -', t.name, ':', t.description);
  }

  console.log('\n=== Test 8: Register external tool (simulating apple module) ===');
  registry.registerExternalTool({
    name: 'apple_calendar',
    description: 'List Apple Calendar events',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } } },
  });
  const allTools = registry.getToolDescriptions();
  console.log('Tools after external registration:', allTools.length);
  for (const t of allTools) {
    console.log(' -', t.name);
  }

  console.log('\n=== Test 9: Persist and reload ===');
  registry.save();
  const registry2 = new SkillRegistry(resolve('./skills/registry.yaml'));
  registry2.load();
  console.log('Skills after reload:', registry2.list().length);
  console.log('Skill names:', registry2.list().map(s => s.definition.name).join(', '));

  console.log('\n=== Test 10: Update a skill ===');
  const updateResult = await generator.updateSkill('celsius-to-fahrenheit', {
    description: 'Convert Celsius to Fahrenheit (v2)',
    code: 'export default async function(input) {\n  const f = (input.celsius * 9/5) + 32;\n  return { success: true, result: Math.round(f * 100) / 100 };\n}\n',
  });
  console.log('Update success:', updateResult.success);
  console.log('Updated description:', registry.get('celsius-to-fahrenheit')?.definition.description);

  console.log('\n=== All tests passed! ===');

  // Cleanup: remove generated test skill so it doesn't persist
  registry.unregister('celsius-to-fahrenheit');
  registry.save();
  const { unlinkSync } = await import('fs');
  try { unlinkSync(resolve(createResult.filePath!)); } catch {}
}

main().catch(console.error);
