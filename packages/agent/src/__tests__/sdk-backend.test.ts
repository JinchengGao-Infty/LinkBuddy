import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SdkBackend } from '../backends/sdk-backend.js';
import type { AgentRequest } from '@ccbuddy/core';

// Mock @anthropic-ai/claude-agent-sdk
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = query as ReturnType<typeof vi.fn>;

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello',
    userId: 'user1',
    sessionId: 'sess-1',
    channelId: 'general',
    platform: 'discord',
    permissionLevel: 'admin',
    ...overrides,
  };
}

async function* successGenerator() {
  yield { type: 'result', subtype: 'success', result: 'Hello back!' };
}

describe('SdkBackend', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockQuery.mockReturnValue(successGenerator());
  });

  it('passes through admin requests without chat restriction', async () => {
    const backend = new SdkBackend({ skipPermissions: false });
    const events = [];
    for await (const event of backend.execute(makeRequest({ permissionLevel: 'admin' }))) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');

    const callArg = mockQuery.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    const callOptions = callArg.options;
    // No chat restriction for admin
    expect(callOptions['systemPrompt'] ?? '').not.toContain('chat-only mode');
  });

  it('adds system prompt restriction for chat users', async () => {
    const backend = new SdkBackend();
    const events = [];
    for await (const event of backend.execute(makeRequest({ permissionLevel: 'chat' }))) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');

    const callArg = mockQuery.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    const callOptions = callArg.options;
    expect(callOptions['allowedTools']).toEqual([]);
    expect(callOptions['systemPrompt'] as string).toContain('chat-only mode');
    expect(callOptions['systemPrompt'] as string).toContain('Do NOT use any tools');
  });

  it('prepends existing system prompt with chat restriction for chat users', async () => {
    const backend = new SdkBackend();
    const events = [];
    for await (const event of backend.execute(
      makeRequest({ permissionLevel: 'chat', systemPrompt: 'You are a helpful assistant.' })
    )) {
      events.push(event);
    }

    const callArg = mockQuery.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    const callOptions = callArg.options;
    const sp = callOptions['systemPrompt'] as string;
    expect(sp).toContain('You are a helpful assistant.');
    expect(sp).toContain('chat-only mode');
    // Original prompt should come first
    const idx1 = sp.indexOf('You are a helpful assistant.');
    const idx2 = sp.indexOf('chat-only mode');
    expect(idx1).toBeLessThan(idx2);
  });

  it('sets bypassPermissions for admin with skipPermissions=true', async () => {
    const backend = new SdkBackend({ skipPermissions: true });
    for await (const _event of backend.execute(makeRequest({ permissionLevel: 'admin' }))) {}

    const callArg = mockQuery.mock.calls[0][0] as { prompt: string; options: Record<string, unknown> };
    const callOptions = callArg.options;
    expect(callOptions['permissionMode']).toBe('bypassPermissions');
    expect(callOptions['allowDangerouslySkipPermissions']).toBe(true);
  });
});
