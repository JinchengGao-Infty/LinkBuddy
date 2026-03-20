import { execFile } from 'node:child_process';

export class SwiftBridge {
  private readonly helperPath: string;
  private readonly timeoutMs: number;

  constructor(helperPath: string, timeoutMs = 10000) {
    this.helperPath = helperPath;
    this.timeoutMs = timeoutMs;
  }

  exec(args: string[]): Promise<{ success: boolean; [key: string]: unknown }> {
    return new Promise((resolve, reject) => {
      execFile(
        this.helperPath,
        args,
        { timeout: this.timeoutMs },
        (err, stdout, _stderr) => {
          if (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              reject(new Error(
                `ccbuddy-helper not compiled — run 'swift build -c release' in swift-helper/`
              ));
              return;
            }
            reject(err);
            return;
          }

          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch {
            reject(new Error(`Failed to parse ccbuddy-helper output: ${stdout.slice(0, 200)}`));
          }
        },
      );
    });
  }
}
