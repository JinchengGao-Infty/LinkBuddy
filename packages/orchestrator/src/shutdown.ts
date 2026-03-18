type ShutdownCallback = () => Promise<void | unknown>;

interface ShutdownEntry {
  name: string;
  callback: ShutdownCallback;
}

export class ShutdownHandler {
  private readonly entries: ShutdownEntry[] = [];

  constructor(private readonly timeoutMs: number) {}

  register(name: string, callback: ShutdownCallback): void {
    this.entries.push({ name, callback });
  }

  async execute(): Promise<void> {
    const timeout = (name: string): Promise<void> =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.warn(`[ShutdownHandler] Timeout waiting for '${name}'`);
          resolve();
        }, this.timeoutMs)
      );

    const runOne = async (entry: ShutdownEntry): Promise<void> => {
      try {
        await Promise.race([entry.callback(), timeout(entry.name)]);
      } catch (err) {
        console.error(`[ShutdownHandler] Error in '${entry.name}':`, err);
      }
    };

    await Promise.all(this.entries.map(runOne));
  }
}
