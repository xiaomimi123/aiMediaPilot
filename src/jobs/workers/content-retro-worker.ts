import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';

export function startContentRetroWorker() {
  const worker = new Worker(
    QUEUES.RETRO,
    async () => {
      throw new Error('content-retro-worker not yet implemented (Task 6)');
    },
    { connection: redis }
  );
  worker.on('failed', (job, err) => {
    console.error('[content-retro-worker] failed', job?.id, err);
  });
  return worker;
}
