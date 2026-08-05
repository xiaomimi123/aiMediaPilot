import { ok, fail } from '@/lib/api';
import { autoSyncQueue } from '@/jobs/queue';

const ADD_TIMEOUT_MS = 4000;

/**
 * ioredis 默认走「离线队列」: 断线时命令不会立即报错, 而是先排队等重连,
 * 所以 redis 不可用时 `autoSyncQueue.add()` 既不 resolve 也不 reject ——
 * 这里给它一个赛跑的超时, 谁先 settle 用谁, 输的一方(通常是 add) 被丢弃,
 * 避免这条请求无限期挂起。settle 后清掉定时器, 不留着占用事件循环。
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
 * 手动"立即同步"入口 (goals 视图账号状态条)。 只负责把一次性 job 塞进
 * auto-sync 队列——真正的抓取逻辑复用 auto-sync-worker.ts 里已有的
 * runAutoSync, worker 侧不区分这是手动触发还是 12h 自动 tick。
 *
 * jobId 加时间戳前缀 (manual-<ts>) 而非固定值: 允许用户短时间内重复点击
 * 排队多次, 不因为 BullMQ 按 jobId 去重而互相顶替。
 */
export async function POST() {
  try {
    await withTimeout(
      autoSyncQueue.add('auto-sync', {}, { jobId: `manual-${Date.now()}` }),
      ADD_TIMEOUT_MS,
    );
    return ok({ queued: true });
  } catch (e) {
    console.error('[POST douyin/auto-sync/trigger]', e);
    return fail('任务队列不可用，请确认 worker 已启动', 503);
  }
}
