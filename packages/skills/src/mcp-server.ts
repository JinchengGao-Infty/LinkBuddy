#!/usr/bin/env node
/**
 * MCP server entry point for CCBuddy skills.
 *
 * Wraps SkillRegistry, SkillGenerator, SkillValidator, and SkillRunner
 * and exposes skills as MCP tools via stdio transport.
 *
 * CLI args:
 *   --registry <path>   Path to registry YAML file
 *   --skills-dir <path> Parent directory for skills (generator appends /generated/)
 *   --no-approval       Disable approval requirement for elevated permissions
 *   --no-git-commit     Disable automatic git commit after skill creation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { SkillRegistry } from './registry.js';
import { SkillGenerator } from './generator.js';
import { SkillValidator } from './validator.js';
import { SkillRunner } from './runner.js';
import type { SkillPermission } from './types.js';

// ── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  registryPath: string;
  skillsDir: string;
  requireApproval: boolean;
  autoGitCommit: boolean;
} {
  let registryPath = '';
  let skillsDir = '';
  let requireApproval = true;
  let autoGitCommit = true;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--registry':
        registryPath = argv[++i] ?? '';
        break;
      case '--skills-dir':
        skillsDir = argv[++i] ?? '';
        break;
      case '--no-approval':
        requireApproval = false;
        break;
      case '--no-git-commit':
        autoGitCommit = false;
        break;
    }
  }

  if (!registryPath) {
    console.error('Error: --registry <path> is required');
    process.exit(1);
  }
  if (!skillsDir) {
    console.error('Error: --skills-dir <path> is required');
    process.exit(1);
  }

  return { registryPath, skillsDir, requireApproval, autoGitCommit };
}

// ── Elevated permission check ───────────────────────────────────────────────

const ELEVATED_PERMISSIONS: Set<SkillPermission> = new Set([
  'filesystem',
  'network',
  'shell',
  'env',
]);

function hasElevatedPermissions(permissions: SkillPermission[]): boolean {
  return permissions.some((p) => ELEVATED_PERMISSIONS.has(p));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // 1. Load registry
  const registry = new SkillRegistry(args.registryPath);
  await registry.load();

  // 2. Create validator, generator, runner
  const validator = new SkillValidator();
  const generator = new SkillGenerator(registry, validator, args.skillsDir);
  const runner = new SkillRunner({ timeoutMs: 30_000 });

  // 3. Wire git commit hook if enabled
  if (args.autoGitCommit) {
    generator.onAfterSave = async (filePath, skillName) => {
      const { execFile } = await import('node:child_process');
      await new Promise<void>((resolve) => {
        execFile('git', ['add', filePath], (err) => {
          if (err) {
            console.warn(`[Skills] git add failed: ${err.message}`);
            resolve();
            return;
          }
          execFile(
            'git',
            ['commit', '-m', `skill: add ${skillName}`],
            (err2) => {
              if (err2)
                console.warn(`[Skills] git commit failed: ${err2.message}`);
              resolve();
            },
          );
        });
      });
    };
  }

  // 4. Create MCP server
  const server = new Server(
    { name: 'ccbuddy-skills', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // 5. ListTools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }> = [];

    // Static tools
    tools.push({
      name: 'list_skills',
      description:
        'List all registered skills with their metadata (name, description, version, source, permissions, usageCount, enabled)',
      inputSchema: { type: 'object', properties: {} },
    });

    tools.push({
      name: 'create_skill',
      description:
        'Create a new skill. Provide name, description, code (JS/TS with export default async function), input_schema, and optional permissions/approved flag.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill name (lowercase, alphanumeric, hyphens)' },
          description: { type: 'string', description: 'What the skill does' },
          code: { type: 'string', description: 'Skill source code with export default async function' },
          input_schema: {
            type: 'object',
            description: 'JSON Schema for skill input',
          },
          permissions: {
            type: 'array',
            items: { type: 'string', enum: ['filesystem', 'network', 'shell', 'env'] },
            description: 'Required permissions (optional)',
          },
          approved: {
            type: 'boolean',
            description:
              'Set to true if user has approved elevated permissions',
          },
        },
        required: ['name', 'description', 'code', 'input_schema'],
      },
    });

    // Dynamic tools — one per enabled registered skill
    for (const { definition } of registry.list()) {
      if (!definition.enabled) continue;
      tools.push({
        name: `skill_${definition.name}`,
        description: definition.description,
        inputSchema: definition.inputSchema as unknown as Record<string, unknown>,
      });
    }

    return { tools };
  });

  // 6. CallTool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const toolArgs = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
    // ── list_skills ───────────────────────────────────────────────────────
    if (name === 'list_skills') {
      const skills = registry.list().map(({ definition, metadata }) => ({
        name: definition.name,
        description: definition.description,
        version: definition.version,
        source: definition.source,
        permissions: definition.permissions,
        usageCount: metadata.usageCount,
        enabled: definition.enabled,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(skills) }],
      };
    }

    // ── create_skill ──────────────────────────────────────────────────────
    if (name === 'create_skill') {
      const skillName = toolArgs.name as string;
      const description = toolArgs.description as string;
      const code = toolArgs.code as string;
      const inputSchema = toolArgs.input_schema as {
        type: 'object';
        properties: Record<string, { type: string; description?: string }>;
        required?: string[];
      };
      const permissions = (toolArgs.permissions ?? []) as SkillPermission[];
      const approved = (toolArgs.approved ?? false) as boolean;

      // Check if elevated permissions require approval
      if (
        hasElevatedPermissions(permissions) &&
        args.requireApproval &&
        !approved
      ) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error:
                  'This skill requires elevated permissions (' +
                  permissions.join(', ') +
                  '). Please get user approval and retry with approved: true.',
              }),
            },
          ],
        };
      }

      const result = await generator.createSkill({
        name: skillName,
        description,
        code,
        inputSchema,
        permissions,
        createdBy: 'agent',
        createdByRole: 'system',
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }

    // ── skill_<name> (dynamic) ────────────────────────────────────────────
    if (name.startsWith('skill_')) {
      const skillName = name.slice('skill_'.length);
      const skill = registry.get(skillName);

      if (!skill) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: `Skill "${skillName}" not found` }),
            },
          ],
        };
      }

      if (!skill.definition.enabled) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: `Skill "${skillName}" is disabled`,
              }),
            },
          ],
        };
      }

      // Record usage and persist
      registry.recordUsage(skillName);
      await registry.save();

      // Run skill
      const output = await runner.run(skill.definition.filePath, toolArgs);

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
      };
    }

    // ── Unknown tool ──────────────────────────────────────────────────────
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }),
        },
      ],
    };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: (err as Error).message }),
          },
        ],
      };
    }
  });

  // 7. Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error in MCP skills server:', err);
  process.exit(1);
});
