import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export * from './types.js';
export { SkillRegistry, type ToolDescription } from './registry.js';
export { SkillValidator, type ValidationResult } from './validator.js';
export {
  SkillGenerator,
  type CreateSkillRequest,
  type UpdateSkillRequest,
  type GeneratorResult,
} from './generator.js';
export { SkillRunner, type SkillRunnerOptions } from './runner.js';

export const MCP_SERVER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'mcp-server.js',
);
