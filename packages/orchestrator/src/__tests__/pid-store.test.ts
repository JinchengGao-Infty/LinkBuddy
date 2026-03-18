import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PidStore } from '../pid-store.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PidStore', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = join(tmpdir(), `ccbuddy-pid-test-${Date.now()}`); mkdirSync(tmpDir, { recursive: true }); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('saves and loads PIDs', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('gateway', 1234);
    store.set('agent', 5678);
    store.save();
    const store2 = new PidStore(join(tmpDir, 'pids.json'));
    store2.load();
    expect(store2.get('gateway')).toBe(1234);
    expect(store2.get('agent')).toBe(5678);
  });

  it('removes a PID', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('gateway', 1234);
    store.remove('gateway');
    expect(store.get('gateway')).toBeUndefined();
  });

  it('handles missing file gracefully', () => {
    const store = new PidStore(join(tmpDir, 'nonexistent.json'));
    store.load();
    expect(store.getAll()).toEqual({});
  });

  it('lists all PIDs', () => {
    const store = new PidStore(join(tmpDir, 'pids.json'));
    store.set('a', 1);
    store.set('b', 2);
    expect(store.getAll()).toEqual({ a: 1, b: 2 });
  });
});
