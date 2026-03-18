import { describe, it, expect, vi } from 'vitest';
import { ShutdownHandler } from '../shutdown.js';

describe('ShutdownHandler', () => {
  it('calls registered callbacks on shutdown', async () => {
    const handler = new ShutdownHandler(5000);
    const cb1 = vi.fn().mockResolvedValue(undefined);
    const cb2 = vi.fn().mockResolvedValue(undefined);
    handler.register('module1', cb1);
    handler.register('module2', cb2);
    await handler.execute();
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('respects timeout', async () => {
    const handler = new ShutdownHandler(100);
    const slowCb = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 5000)));
    handler.register('slow', slowCb);
    const start = Date.now();
    await handler.execute();
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('continues if one callback throws', async () => {
    const handler = new ShutdownHandler(5000);
    const failCb = vi.fn().mockRejectedValue(new Error('oops'));
    const okCb = vi.fn().mockResolvedValue(undefined);
    handler.register('fail', failCb);
    handler.register('ok', okCb);
    await handler.execute();
    expect(failCb).toHaveBeenCalledOnce();
    expect(okCb).toHaveBeenCalledOnce();
  });
});
