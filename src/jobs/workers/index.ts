import 'dotenv/config';
import { startBindWorker } from './bind-worker';
import { closeAll } from '@/crawler/browser-pool';

const bind = startBindWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await bind.close();
  await closeAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: bind');
