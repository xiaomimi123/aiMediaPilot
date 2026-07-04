import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES, autoSyncQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';
import { runAutoSync } from '@/lib/douyin/auto-sync';

const REPEAT_EVERY_MS = 12 * 60 * 60 * 1000; // 12h
const REPEAT_JOB_NAME = 'tick';

/**
 * 确保 12h repeat job 只有一份。 每次 worker boot 时:
 * 1. 拉当前已存在的 repeatable jobs, 清掉除本次期望之外的所有 (防旧 config 残留)
 * 2. 幂等 add 一份 (BullMQ 用 name + repeatOpts 去重, 但清残留更稳)
 */
async function ensureRepeatSchedule(): Promise<void> {
  try {
    const existing = await autoSyncQueue.getRepeatableJobs();
    const expectedEvery = String(REPEAT_EVERY_MS);
    for (const job of existing) {
      if (job.name !== REPEAT_JOB_NAME || job.every !== expectedEvery) {
        await autoSyncQueue.removeRepeatableByKey(job.key);
        console.log('[auto-sync-worker] removed stale repeat job', job.key);
      }
    }
    await autoSyncQueue.add(
      REPEAT_JOB_NAME,
      {},
      { repeat: { every: REPEAT_EVERY_MS }, removeOnComplete: true },
    );
  } catch (err) {
    console.error('[auto-sync-worker] ensureRepeatSchedule failed', err);
  }
}

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

  // fire-and-forget: schedule 是启动辅助, 不能阻塞 worker 返回。 内部已 try/catch。
  void ensureRepeatSchedule();

  // 开发调试时可置 AUTO_SYNC_BOOT_TICK=true 触发立即抓一次;
  // 生产默认不 boot-tick — 之前每次 worker 重启都会打真实 douyin 抓取,
  // 频繁重启会被平台风控 + 有账号误用风险 (小号策略见 memory)。
  if (process.env.AUTO_SYNC_BOOT_TICK === 'true') {
    void autoSyncQueue
      .add('boot-tick', {}, { removeOnComplete: true })
      .catch((err) => console.error('[auto-sync-worker] boot-tick add failed', err));
  }

  return worker;
}
