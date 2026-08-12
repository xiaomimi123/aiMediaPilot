import { ok, fail } from '@/lib/api';
import { radarQueue } from '@/jobs/queue';

const ADD_TIMEOUT_MS = 4000;

/**
 * ioredis 离线队列超时兜底 — 与 `douyin/auto-sync/trigger` 同一先例
 * (见该文件注释): redis 不可用时 `.add()` 既不 resolve 也不 reject,
 * 用赛跑超时防止请求无限期挂起。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`超时 (${ms}ms)`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * 手动"立即扫描"入口 (雷达视图)。 只负责把一次性 job 塞进 radar 队列 ——
 * 真正的采集逻辑复用 radar-worker.ts 里已有的 runRadarScan, worker 侧
 * 不区分这是手动触发还是每日 tick。
 *
 * jobId 加时间戳前缀 (manual-<ts>) 而非固定值: 允许用户短时间内重复点击
 * 排队多次, 不因为 BullMQ 按 jobId 去重而互相顶替。
 */
export async function POST() {
  try {
    await withTimeout(
      radarQueue.add('radar-scan', {}, { jobId: `manual-${Date.now()}` }),
      ADD_TIMEOUT_MS,
    );
    return ok({ queued: true });
  } catch (e) {
    console.error('[POST radar/trigger]', e);
    return fail('任务队列不可用，请确认 worker 已启动', 503);
  }
}
