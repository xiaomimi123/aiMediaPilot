import 'dotenv/config';
import { startContentAnalyzeWorker } from './content-analyze-worker';
import { startContentRetroWorker } from './content-retro-worker';
import { startAutoSyncWorker } from './auto-sync-worker';
import { startRadarWorker } from './radar-worker';
import { startVideoProductionWorker } from './video-production-worker';

const analyze = startContentAnalyzeWorker();
const retro = startContentRetroWorker();
const autoSync = startAutoSyncWorker();
const radar = startRadarWorker();
const videoProduction = startVideoProductionWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await analyze.close();
  await retro.close();
  await autoSync.close();
  await radar.close();
  await videoProduction.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: analyze, retro, auto-sync, radar, video-production');
