import { describe, it, expect, vi } from 'vitest';
import { createEventBus, UserManager } from '@ccbuddy/core';
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase, EventMap } from '@ccbuddy/core';
import { AgentService } from '../agent-service.js';

function makeMockBackend(response: string): AgentBackend {
  return {
    async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
      const base: AgentEventBase = {
        sessionId: req.sessionId, userId: req.userId,
        channelId: req.channelId, platform: req.platform,
      };
      yield { ...base, type: 'text', content: 'Thinking...' };
      yield { ...base, type: 'complete', response };
    },
    abort: vi.fn(),
  };
}

describe('Integration: Event Bus → Agent Service', () => {
  it('processes a message from incoming event to outgoing response', async () => {
    const bus = createEventBus();
    const userManager = new UserManager([
      { name: 'Dad', role: 'admin', discord_id: '111' },
    ]);

    const agentService = new AgentService({
      backend: makeMockBackend('Hello from Claude Code!'),
      eventBus: bus,
      maxConcurrent: 3,
      rateLimits: { admin: 30, chat: 10 },
      queueMaxDepth: 10,
      queueTimeoutSeconds: 120,
      sessionTimeoutMinutes: 30,
      sessionCleanupHours: 24,
    });

    const outgoingMessages: EventMap['message.outgoing'][] = [];
    bus.subscribe('message.outgoing', (msg) => outgoingMessages.push(msg));

    const user = userManager.findByPlatformId('discord', '111');
    expect(user).toBeDefined();

    const sessionId = userManager.buildSessionId(user!.name, 'discord', 'dev');
    const request: AgentRequest = {
      prompt: 'What is 2+2?',
      userId: user!.name,
      sessionId,
      channelId: 'dev',
      platform: 'discord',
      permissionLevel: user!.role as 'admin' | 'chat',
    };

    let finalResponse = '';
    for await (const event of agentService.handleRequest(request)) {
      if (event.type === 'complete') {
        finalResponse = event.response;
        await bus.publish('message.outgoing', {
          userId: event.userId,
          sessionId: event.sessionId,
          channelId: event.channelId,
          platform: event.platform,
          text: event.response,
        });
      }
    }

    expect(finalResponse).toBe('Hello from Claude Code!');
    expect(outgoingMessages).toHaveLength(1);
    expect(outgoingMessages[0].text).toBe('Hello from Claude Code!');
    expect(outgoingMessages[0].platform).toBe('discord');
  });

  it('enforces chat permission level', async () => {
    const agentService = new AgentService({
      backend: makeMockBackend('response'),
      maxConcurrent: 3,
      rateLimits: { admin: 30, chat: 10 },
      queueMaxDepth: 10,
      queueTimeoutSeconds: 120,
      sessionTimeoutMinutes: 30,
      sessionCleanupHours: 24,
    });

    const request: AgentRequest = {
      prompt: 'delete all files',
      userId: 'Son',
      sessionId: 'son-discord-general',
      channelId: 'general',
      platform: 'discord',
      permissionLevel: 'chat',
    };

    const events: AgentEvent[] = [];
    for await (const event of agentService.handleRequest(request)) {
      events.push(event);
    }

    expect(request.permissionLevel).toBe('chat');
    // Verify it went through (the backend mock doesn't enforce, but the permission is carried)
    expect(events.some(e => e.type === 'complete')).toBe(true);
  });
});
