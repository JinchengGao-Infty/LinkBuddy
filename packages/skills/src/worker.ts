import { workerData, parentPort } from 'worker_threads';

if (!parentPort) throw new Error('worker.ts must be run as a worker thread');

interface WorkerData {
  skillPath: string;
  input: Record<string, unknown>;
}

async function run() {
  const { skillPath, input } = workerData as WorkerData;
  try {
    const mod = await import(skillPath);
    const fn = mod.default ?? mod;
    if (typeof fn !== 'function') {
      parentPort!.postMessage({ success: false, error: 'Skill does not export a default function' });
      return;
    }
    const result = await fn(input);
    if (result && typeof result === 'object' && 'success' in result) {
      parentPort!.postMessage(result);
    } else {
      parentPort!.postMessage({ success: true, result });
    }
  } catch (err) {
    parentPort!.postMessage({ success: false, error: (err as Error).message });
  }
}

run();
