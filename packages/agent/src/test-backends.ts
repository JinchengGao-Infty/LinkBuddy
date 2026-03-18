#!/usr/bin/env node
/**
 * Manual test script to verify SDK and CLI backends work with your Claude setup.
 *
 * Usage:
 *   npx tsx packages/agent/src/test-backends.ts sdk "What is 2+2?"
 *   npx tsx packages/agent/src/test-backends.ts cli "What is 2+2?"
 *   npx tsx packages/agent/src/test-backends.ts both "What is 2+2?"
 *
 * Prerequisites:
 *   - For SDK: CLAUDE_CODE_OAUTH_TOKEN env var (run `claude setup-token` to get it)
 *   - For CLI: `claude` command available in PATH
 */

import { SdkBackend } from './backends/sdk-backend.js';
import { CliBackend } from './backends/cli-backend.js';
import type { AgentRequest } from '@ccbuddy/core';

const [,, mode = 'both', ...promptParts] = process.argv;
const prompt = promptParts.join(' ') || 'What is 2+2? Reply with just the number.';

import { randomUUID } from 'crypto';

const request: AgentRequest = {
  prompt,
  userId: 'test',
  sessionId: randomUUID(),
  channelId: 'test',
  platform: 'test',
  permissionLevel: 'admin',
};

async function testBackend(name: string, backend: { execute: (req: AgentRequest) => AsyncGenerator<any> }) {
  console.log(`\n--- Testing ${name} backend ---`);
  console.log(`Prompt: "${prompt}"`);
  console.log('Waiting for response...\n');

  const start = Date.now();
  try {
    for await (const event of backend.execute(request)) {
      console.log(`[${event.type}]`, event.type === 'complete' ? event.response : event.type === 'error' ? event.error : event);
    }
    console.log(`\nCompleted in ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
  }
}

async function main() {
  if (mode === 'sdk' || mode === 'both') {
    await testBackend('SDK', new SdkBackend({ skipPermissions: true }));
  }
  if (mode === 'cli' || mode === 'both') {
    await testBackend('CLI', new CliBackend());
  }
}

main().catch(console.error);
