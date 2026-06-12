import 'dotenv/config';
import { startBindWorker } from './bind-worker';
import { startContentAnalyzeWorker } from './content-analyze-worker';
import { startContentRetroWorker } from './content-retro-worker';
import { closeAll } from '@/crawler/browser-pool';

const bind = startBindWorker();
const analyze = startContentAnalyzeWorker();
const retro = startContentRetroWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await bind.close();
  await analyze.close();
  await retro.close();
  await closeAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: bind, analyze, retro');
