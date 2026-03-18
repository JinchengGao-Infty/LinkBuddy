import { bootstrap } from './bootstrap.js';

async function main(): Promise<void> {
  console.log('Starting CCBuddy...');
  const { stop } = await bootstrap();
  console.log('CCBuddy is running.');

  const shutdown = async () => {
    console.log('Shutting down...');
    await stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start CCBuddy:', err);
  process.exit(1);
});
