import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  BIND: 'bind-session',
  SYNC: 'sync',
  ANALYZE: 'content-analyze',
} as const;

export const bindQueue = new Queue(QUEUES.BIND, { connection: redis });
export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
export const analyzeQueue = new Queue(QUEUES.ANALYZE, { connection: redis });
