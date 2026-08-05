import { ok, fail } from '@/lib/api';
import { autoSyncQueue } from '@/jobs/queue';

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
    await autoSyncQueue.add('auto-sync', {}, { jobId: `manual-${Date.now()}` });
    return ok({ queued: true });
  } catch (e) {
    console.error('[POST douyin/auto-sync/trigger]', e);
    return fail('任务队列不可用，请确认 worker 已启动', 503);
  }
}
