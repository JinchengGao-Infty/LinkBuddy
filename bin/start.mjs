#!/usr/bin/env node
import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const LOG_DIR = join(PROJECT_ROOT, 'data', 'logs');
const LOG = join(LOG_DIR, 'link-buddy.log');

mkdirSync(LOG_DIR, { recursive: true });

const log = (msg) => appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);

const origLog = console.log;
const origErr = console.error;
console.log = (...a) => { log(a.join(' ')); origLog(...a); };
console.error = (...a) => { log('ERR: ' + a.join(' ')); origErr(...a); };
process.on('unhandledRejection', (err) => { log('UNHANDLED: ' + (err?.stack || err)); });

log('Starting Link Buddy...');
const { bootstrap } = await import('../packages/main/dist/bootstrap.js');
const result = await bootstrap(join(PROJECT_ROOT, 'config'));
log('Link Buddy running');

process.on('SIGTERM', async () => { log('SIGTERM received'); await result.stop(); process.exit(0); });
process.on('SIGINT', async () => { log('SIGINT received'); await result.stop(); process.exit(0); });
log('Link Buddy is ready.');
