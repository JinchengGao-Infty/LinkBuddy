import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../event-bus.js';
import type { EventMap } from '../../types/index.js';

describe('EventBus', () => {
  it('delivers published events to subscribers', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.subscribe('alert.health', handler);
    const payload: EventMap['alert.health'] = {
      module: 'agent', status: 'down', message: 'Claude Code unreachable', timestamp: Date.now(),
    };
    await bus.publish('alert.health', payload);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('supports multiple subscribers for same event', async () => {
    const bus = createEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.subscribe('alert.health', handler1);
    bus.subscribe('alert.health', handler2);
    await bus.publish('alert.health', { module: 'test', status: 'degraded', message: 'test', timestamp: Date.now() });
    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('dispose() removes the subscription', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const sub = bus.subscribe('alert.health', handler);
    sub.dispose();
    await bus.publish('alert.health', { module: 'test', status: 'down', message: 'test', timestamp: Date.now() });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not cross-deliver between event types', async () => {
    const bus = createEventBus();
    const healthHandler = vi.fn();
    const webhookHandler = vi.fn();
    bus.subscribe('alert.health', healthHandler);
    bus.subscribe('webhook.received', webhookHandler);
    await bus.publish('alert.health', { module: 'test', status: 'down', message: 'test', timestamp: Date.now() });
    expect(healthHandler).toHaveBeenCalledOnce();
    expect(webhookHandler).not.toHaveBeenCalled();
  });

  it('handles publish with no subscribers gracefully', async () => {
    const bus = createEventBus();
    await bus.publish('alert.health', { module: 'test', status: 'down', message: 'test', timestamp: Date.now() });
    // Should not throw
  });
});
