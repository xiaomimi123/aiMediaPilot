import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';

export function startContentAnalyzeWorker() {
  const worker = new Worker(
    QUEUES.ANALYZE,
    async () => {
      throw new Error('content-analyze-worker not yet implemented (Task 12-13)');
    },
    { connection: redis }
  );
  return worker;
}
