import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  SYNC: 'sync',
  ANALYZE: 'content-analyze',
  RETRO: 'content-retro',
  AUTO_SYNC: 'auto-sync',
  RADAR: 'radar',
  VIDEO_PRODUCTION: 'video-production',
  TEARDOWN: 'teardown',
} as const;

export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
export const analyzeQueue = new Queue(QUEUES.ANALYZE, { connection: redis });
export const retroQueue = new Queue(QUEUES.RETRO, { connection: redis });
export const autoSyncQueue = new Queue(QUEUES.AUTO_SYNC, { connection: redis });
export const radarQueue = new Queue(QUEUES.RADAR, { connection: redis });
export const videoProductionQueue = new Queue(QUEUES.VIDEO_PRODUCTION, { connection: redis });
/** 二十三期: 对标视频上传 → 转写 → 拆解。拆解本身几秒钟能同步做完, 但 ASR 是分钟级的。 */
export const teardownQueue = new Queue(QUEUES.TEARDOWN, { connection: redis });
