import { describe, it, expect } from 'vitest';
import { ProcessManager } from '../process-manager.js';

describe('ProcessManager', () => {
  it('registers modules', () => {
    const pm = new ProcessManager('/tmp/test-pids.json');
    pm.register({ name: 'gateway', command: 'node', args: ['gateway.js'] });
    pm.register({ name: 'agent', command: 'node', args: ['agent.js'] });
    expect(pm.getRegistered()).toHaveLength(2);
    expect(pm.getRegistered().map((m) => m.name)).toEqual(['gateway', 'agent']);
  });

  it('reports module status', () => {
    const pm = new ProcessManager('/tmp/test-pids.json');
    pm.register({ name: 'gateway', command: 'node', args: ['gateway.js'] });
    expect(pm.getStatus('gateway')).toBe('stopped');
  });
});
