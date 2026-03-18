import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentService } from '../agent-service.js';
import { createEventBus } from '@ccbuddy/core';
import type { AgentBackend, AgentRequest, AgentEvent, AgentEventBase } from '@ccbuddy/core';

function makeBackend(response: string, delayMs = 0): AgentBackend {
  return {
    async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
      const base: AgentEventBase = {
        sessionId: req.sessionId, userId: req.userId,
        channelId: req.channelId, platform: req.platform,
      };
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { ...base, type: 'complete', response };
    },
    abort: vi.fn(),
  };
}

function makeRequest(overrides: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'Hello', userId: 'dad', sessionId: 'dad-discord-dev',
    channelId: 'dev', platform: 'discord', permissionLevel: 'admin',
    ...overrides,
  };
}

const defaultOpts = {
  maxConcurrent: 3,
  rateLimits: { admin: 30, chat: 10 },
  queueMaxDepth: 10,
  queueTimeoutSeconds: 5,
  sessionTimeoutMinutes: 30,
  sessionCleanupHours: 24,
};

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe('AgentService', () => {
  it('routes request to backend and returns events', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('Hello!') });
    const events = await collectEvents(service.handleRequest(makeRequest()));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');
  });

  it('rate limits excessive requests', async () => {
    const service = new AgentService({
      ...defaultOpts, backend: makeBackend('ok'), rateLimits: { admin: 1, chat: 1 },
    });
    const events1 = await collectEvents(service.handleRequest(makeRequest()));
    expect(events1[0].type).toBe('complete');
    const events2 = await collectEvents(service.handleRequest(makeRequest()));
    expect(events2[0].type).toBe('error');
    expect((events2[0] as any).error).toContain('rate limit');
  });

  it('rejects when concurrency cap AND queue are full', async () => {
    const service = new AgentService({
      ...defaultOpts, backend: makeBackend('ok', 100), maxConcurrent: 1, queueMaxDepth: 0,
    });
    const gen1 = service.handleRequest(makeRequest({ sessionId: 's1' }));
    const p1 = collectEvents(gen1);
    const events2 = await collectEvents(service.handleRequest(makeRequest({ sessionId: 's2' })));
    expect(events2[0].type).toBe('error');
    expect((events2[0] as any).error).toContain('busy');
    await p1;
  });

  it('publishes agent.progress events to event bus', async () => {
    const bus = createEventBus();
    const progressEvents: any[] = [];
    bus.subscribe('agent.progress', (e) => progressEvents.push(e));

    const streamingBackend: AgentBackend = {
      async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
        const base: AgentEventBase = {
          sessionId: req.sessionId, userId: req.userId,
          channelId: req.channelId, platform: req.platform,
        };
        yield { ...base, type: 'text', content: 'Thinking...' };
        yield { ...base, type: 'tool_use', tool: 'bash' };
        yield { ...base, type: 'complete', response: 'Done' };
      },
      abort: vi.fn(),
    };

    const service = new AgentService({ ...defaultOpts, backend: streamingBackend, eventBus: bus });
    await collectEvents(service.handleRequest(makeRequest()));
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0].type).toBe('text');
    expect(progressEvents[1].type).toBe('tool_use');
  });

  it('uses session manager to track sessions', async () => {
    const service = new AgentService({ ...defaultOpts, backend: makeBackend('ok') });
    await collectEvents(service.handleRequest(makeRequest({ sessionId: 'sess-1' })));
    await collectEvents(service.handleRequest(makeRequest({ sessionId: 'sess-2' })));
    expect(service.getActiveSessions()).toHaveLength(2);
  });

  it('abort kills the backend session', async () => {
    const backend = makeBackend('ok');
    const service = new AgentService({ ...defaultOpts, backend });
    await service.abort('test-session');
    expect(backend.abort).toHaveBeenCalledWith('test-session');
  });

  it('queue timeout: timed-out item is removed from queue and resolves false', async () => {
    vi.useFakeTimers();

    // Backend takes a long time — keeps the slot occupied
    const backend: AgentBackend = {
      async *execute(req: AgentRequest): AsyncGenerator<AgentEvent> {
        const base: AgentEventBase = {
          sessionId: req.sessionId, userId: req.userId,
          channelId: req.channelId, platform: req.platform,
        };
        // never resolves during the test
        await new Promise(() => {});
        yield { ...base, type: 'complete', response: '' };
      },
      abort: vi.fn(),
    };

    const service = new AgentService({
      ...defaultOpts,
      backend,
      maxConcurrent: 1,
      queueMaxDepth: 5,
      queueTimeoutSeconds: 2,
      rateLimits: { admin: 1000, chat: 1000 },
    });

    // Start the first request — it occupies the single slot indefinitely
    const p1 = collectEvents(service.handleRequest(makeRequest({ sessionId: 's1' })));
    // Give the first request time to enter the backend
    await vi.advanceTimersByTimeAsync(0);

    // Enqueue a second request (it will wait in the queue)
    const p2Promise = collectEvents(service.handleRequest(makeRequest({ sessionId: 's2' })));

    // The second request should be in the queue
    expect(service.queueSize).toBe(1);

    // Advance time past the queue timeout
    await vi.advanceTimersByTimeAsync(2500);

    // The queued request should have been removed from the queue and returned an error
    expect(service.queueSize).toBe(0);
    const events2 = await p2Promise;
    expect(events2[0].type).toBe('error');
    expect((events2[0] as any).error).toContain('busy');

    vi.useRealTimers();
    // Clean up p1 — abort it
    await service.abort('s1');
    // p1 never resolves without help, so we don't await it
  });
});
