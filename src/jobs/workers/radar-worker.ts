import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES, radarQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';
import { runRadarScan } from '@/lib/radar/run';

const REPEAT_EVERY_MS = 24 * 60 * 60 * 1000; // 每日一次
const REPEAT_JOB_NAME = 'tick';

/**
 * 确保每日 repeat job 只有一份 — 模式与 auto-sync-worker 完全一致
 * (见该文件注释): 清掉与期望不符的残留 repeatable job, 再幂等 add 一份。
 */
async function ensureRepeatSchedule(): Promise<void> {
  try {
    const existing = await radarQueue.getRepeatableJobs();
    const expectedEvery = String(REPEAT_EVERY_MS);
    for (const job of existing) {
      if (job.name !== REPEAT_JOB_NAME || job.every !== expectedEvery) {
        await radarQueue.removeRepeatableByKey(job.key);
        console.log('[radar-worker] removed stale repeat job', job.key);
      }
    }
    await radarQueue.add(
      REPEAT_JOB_NAME,
      {},
      { repeat: { every: REPEAT_EVERY_MS }, removeOnComplete: true },
    );
  } catch (err) {
    console.error('[radar-worker] ensureRepeatSchedule failed', err);
  }
}

export function startRadarWorker() {
  const worker = new Worker(
    QUEUES.RADAR,
    async () => {
      const user = await getOrCreateDefaultUser();
      try {
        const stats = await runRadarScan(user.id);
        console.log('[radar-worker] tick', stats ?? '(未启用或未配置, 跳过)');
      } catch (err) {
        console.error('[radar-worker] failed', err);
      }
    },
    { connection: redis },
  );

  // fire-and-forget: schedule 是启动辅助, 不能阻塞 worker 返回。 内部已 try/catch。
  void ensureRepeatSchedule();

  // 开发调试时可置 RADAR_BOOT_TICK=true 触发立即扫描一次 (先例见 AUTO_SYNC_BOOT_TICK);
  // 生产默认不 boot-tick, 避免每次重启都消耗 Tavily/DeepSeek 配额。
  if (process.env.RADAR_BOOT_TICK === 'true') {
    void radarQueue
      .add('boot-tick', {}, { removeOnComplete: true })
      .catch((err) => console.error('[radar-worker] boot-tick add failed', err));
  }

  return worker;
}
