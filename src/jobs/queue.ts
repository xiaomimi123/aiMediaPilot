import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  BIND: 'bind-session',
  SYNC: 'sync',
  ANALYZE: 'content-analyze',
  RETRO: 'content-retro',
  AUTO_SYNC: 'auto-sync',
  RADAR: 'radar',
  VIDEO_PRODUCTION: 'video-production',
} as const;

export const bindQueue = new Queue(QUEUES.BIND, { connection: redis });
export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
export const analyzeQueue = new Queue(QUEUES.ANALYZE, { connection: redis });
export const retroQueue = new Queue(QUEUES.RETRO, { connection: redis });
export const autoSyncQueue = new Queue(QUEUES.AUTO_SYNC, { connection: redis });
export const radarQueue = new Queue(QUEUES.RADAR, { connection: redis });
export const videoProductionQueue = new Queue(QUEUES.VIDEO_PRODUCTION, { connection: redis });
