import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

import { SwiftBridge } from '../swift-bridge.js';

describe('SwiftBridge', () => {
  let bridge: SwiftBridge;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge = new SwiftBridge('/path/to/ccbuddy-helper');
  });

  it('calls execFile with correct binary path and args', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({ success: true, events: [] }), '');
    });

    await bridge.exec(['calendar', 'list', '--from', '2026-01-01', '--to', '2026-01-02']);

    expect(mockExecFile).toHaveBeenCalledWith(
      '/path/to/ccbuddy-helper',
      ['calendar', 'list', '--from', '2026-01-01', '--to', '2026-01-02'],
      expect.objectContaining({ timeout: 10000 }),
      expect.any(Function),
    );
  });

  it('parses JSON stdout on success', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({ success: true, events: [{ id: '1', title: 'Test' }] }), '');
    });

    const result = await bridge.exec(['calendar', 'list']);
    expect(result.success).toBe(true);
    expect((result as any).events).toHaveLength(1);
  });

  it('parses JSON error from stdout', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, JSON.stringify({ success: false, error: 'Event not found' }), '');
    });

    const result = await bridge.exec(['calendar', 'delete', '--id', 'bad']);
    expect(result.success).toBe(false);
    expect((result as any).error).toBe('Event not found');
  });

  it('throws on non-JSON stdout', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, 'not json', '');
    });

    await expect(bridge.exec(['calendar', 'list'])).rejects.toThrow('Failed to parse');
  });

  it('throws on execFile error with ENOENT', async () => {
    const err = new Error('spawn ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(err, '', '');
    });

    await expect(bridge.exec(['calendar', 'list'])).rejects.toThrow('ccbuddy-helper not compiled');
  });

  it('throws on generic execFile error', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error('timeout'), '', '');
    });

    await expect(bridge.exec(['calendar', 'list'])).rejects.toThrow('timeout');
  });
});
