import { bootstrap } from './bootstrap.js';

async function main(): Promise<void> {
  console.log('Starting CCBuddy...');
  const { stop } = await bootstrap();
  console.log('CCBuddy is running.');

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; // Prevent double-shutdown on rapid signals
    shuttingDown = true;
    console.log('Shutting down...');
    await stop();
    // Allow event loop to drain naturally; force exit after 5s if something hangs
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start CCBuddy:', err);
  process.exit(1);
});
