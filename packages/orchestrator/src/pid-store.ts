import { readFileSync, writeFileSync, existsSync } from 'fs';

type PidMap = Record<string, number>;

export class PidStore {
  private pids: PidMap = {};

  constructor(private readonly filePath: string) {}

  load(): void {
    if (!existsSync(this.filePath)) {
      this.pids = {};
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      this.pids = JSON.parse(raw) as PidMap;
    } catch {
      this.pids = {};
    }
  }

  save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.pids, null, 2), 'utf-8');
  }

  set(module: string, pid: number): void {
    this.pids[module] = pid;
  }

  get(module: string): number | undefined {
    return this.pids[module];
  }

  remove(module: string): void {
    delete this.pids[module];
  }

  getAll(): PidMap {
    return { ...this.pids };
  }
}
