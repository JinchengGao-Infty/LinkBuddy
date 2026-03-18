import { describe, it, expect, vi } from 'vitest';
import { SdkBackend } from '../sdk-backend.js';
import type { AgentRequest } from '@ccbuddy/core';

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { query } from '@anthropic-ai/claude-agent-sdk';
const mockQuery = vi.mocked(query);

/** Create an async generator that yields the given messages */
async function* makeAsyncGen(...messages: any[]) {
  for (const msg of messages) yield msg;
}

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello',
    userId: 'dad',
    sessionId: 'dad-discord-dev',
    channelId: 'dev',
    platform: 'discord',
    permissionLevel: 'admin',
    ...overrides,
  };
}

describe('SdkBackend', () => {
  it('passes prompt and options to Claude Agent SDK', async () => {
    mockQuery.mockReturnValueOnce(
      makeAsyncGen({ type: 'result', subtype: 'success', result: 'Hello back!' }) as any,
    );
    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];
    for await (const event of backend.execute(makeRequest())) { events.push(event); }
    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0];
    expect(callArgs[0]).toMatchObject({ prompt: 'Hello' });
  });

  it('emits complete event with response', async () => {
    mockQuery.mockReturnValueOnce(
      makeAsyncGen({ type: 'result', subtype: 'success', result: 'The answer is 42' }) as any,
    );
    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];
    for await (const event of backend.execute(makeRequest())) { events.push(event); }
    const complete = events.find((e) => e.type === 'complete');
    expect(complete).toBeDefined();
    expect(complete.response).toContain('42');
  });

  it('emits error event on SDK failure', async () => {
    mockQuery.mockImplementationOnce(() => {
      throw new Error('SDK connection failed');
    });
    const backend = new SdkBackend({ skipPermissions: true });
    const events: any[] = [];
    for await (const event of backend.execute(makeRequest())) { events.push(event); }
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error.error).toContain('SDK connection failed');
  });

  it('includes routing metadata in all events', async () => {
    mockQuery.mockReturnValueOnce(
      makeAsyncGen({ type: 'result', subtype: 'success', result: 'reply' }) as any,
    );
    const backend = new SdkBackend({ skipPermissions: true });
    const request = makeRequest({ userId: 'dad', sessionId: 's1', channelId: 'c1', platform: 'discord' });
    const events: any[] = [];
    for await (const event of backend.execute(request)) { events.push(event); }
    for (const event of events) {
      expect(event.sessionId).toBe('s1');
      expect(event.userId).toBe('dad');
      expect(event.channelId).toBe('c1');
      expect(event.platform).toBe('discord');
    }
  });
});
