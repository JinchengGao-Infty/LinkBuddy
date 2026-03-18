import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { PidStore } from './pid-store.js';

export interface ModuleConfig {
  name: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

type ProcessStatus = 'running' | 'stopped';

export class ProcessManager {
  private readonly pidStore: PidStore;
  private readonly modules: ModuleConfig[] = [];

  constructor(pidFilePath: string) {
    this.pidStore = new PidStore(pidFilePath);
    if (existsSync(pidFilePath)) {
      this.pidStore.load();
    }
  }

  register(config: ModuleConfig): void {
    this.modules.push(config);
  }

  getRegistered(): ModuleConfig[] {
    return [...this.modules];
  }

  getStatus(name: string): ProcessStatus {
    const pid = this.pidStore.get(name);
    if (pid !== undefined && this.isProcessAlive(pid)) {
      return 'running';
    }
    return 'stopped';
  }

  isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  start(name: string): void {
    const config = this.modules.find((m) => m.name === name);
    if (!config) {
      throw new Error(`No module registered with name '${name}'`);
    }

    const child = spawn(config.command, config.args, {
      detached: true,
      stdio: 'ignore',
      cwd: config.cwd,
      env: config.env ?? process.env,
    });

    child.unref();

    if (child.pid !== undefined) {
      this.pidStore.set(name, child.pid);
      this.pidStore.save();
    }
  }

  startAll(): void {
    for (const config of this.modules) {
      this.start(config.name);
    }
  }

  stop(name: string): void {
    const pid = this.pidStore.get(name);
    if (pid === undefined) return;

    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may already be gone
    }

    this.pidStore.remove(name);
    this.pidStore.save();
  }

  stopAll(): void {
    for (const config of this.modules) {
      this.stop(config.name);
    }
  }

  recoverFromCrash(): void {
    for (const config of this.modules) {
      const pid = this.pidStore.get(config.name);
      if (pid !== undefined && !this.isProcessAlive(pid)) {
        console.log(`[ProcessManager] '${config.name}' crashed (pid ${pid}), restarting...`);
        this.pidStore.remove(config.name);
        this.start(config.name);
      }
    }
  }
}
