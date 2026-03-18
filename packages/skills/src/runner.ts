import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import type { SkillOutput } from './types.js';

export interface SkillRunnerOptions {
  timeoutMs: number;
}

export class SkillRunner {
  private options: SkillRunnerOptions;

  constructor(options: SkillRunnerOptions) {
    this.options = options;
  }

  run(skillPath: string, input: Record<string, unknown>): Promise<SkillOutput> {
    return new Promise((resolve) => {
      // Resolve worker path — works in both src (vitest) and dist (production)
      const currentDir = dirname(fileURLToPath(import.meta.url));
      let workerFile = join(currentDir, 'worker.js');
      // Fallback: if running from src/ (vitest), look in dist/
      if (!existsSync(workerFile)) {
        workerFile = join(currentDir, '..', 'dist', 'worker.js');
      }

      let settled = false;

      const worker = new Worker(workerFile, {
        workerData: { skillPath, input },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          worker.terminate();
          resolve({ success: false, error: `Skill execution timeout after ${this.options.timeoutMs}ms` });
        }
      }, this.options.timeoutMs);

      worker.on('message', (msg: SkillOutput) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(msg); }
      });

      worker.on('error', (err) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ success: false, error: err.message }); }
      });

      worker.on('exit', (code) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve({ success: false, error: `Worker exited with code ${code}` }); }
      });
    });
  }
}
