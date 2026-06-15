import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES, autoSyncQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';
import { runAutoSync } from '@/lib/douyin/auto-sync';

const REPEAT_EVERY_MS = 12 * 60 * 60 * 1000; // 12h

export function startAutoSyncWorker() {
  const worker = new Worker(
    QUEUES.AUTO_SYNC,
    async () => {
      const user = await getOrCreateDefaultUser();
      try {
        const stats = await runAutoSync(user.id);
        console.log('[auto-sync-worker] tick', stats);
      } catch (err) {
        console.error('[auto-sync-worker] failed', err);
      }
    },
    { connection: redis },
  );

  autoSyncQueue.add('tick', {}, { repeat: { every: REPEAT_EVERY_MS }, removeOnComplete: true });
  autoSyncQueue.add('boot-tick', {}, { removeOnComplete: true });

  return worker;
}
