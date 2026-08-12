import { ok, fail } from '@/lib/api';
import { radarQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';
import { getRadarConfig } from '@/lib/radar/config';

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
 *
 * T6 前置就绪检查 (T4 Important 遗留闭合, 见 progress.md「Task 4」): `runRadarScan`
 * 本身在 enabled=false / 无 Tavily key / 无 DEEPSEEK_API_KEY 时静默返回 null 不创建
 * RadarRun —— worker 每日 tick 场景下这是对的 (无人值守, 不该报错吵人), 但手动点击
 * 「立即扫描」时同样的静默会让用户排了队却永远等不到任何反馈, 不知道是队列卡住还是
 * 配置不对。因此在入队前重复一次 `runRadarScan` 内部已有的判断, 提前挡掉并给出
 * 明确文案 —— 两处判断逻辑不同步的风险可接受: 这里只影响"要不要提前拒绝", 真正的
 * 单一事实来源 (跑不跑、怎么跑) 仍在 `runRadarScan`。
 */
export async function POST() {
  const user = await getOrCreateDefaultUser();
  const config = await getRadarConfig(user.id);
  if (!config.enabled || !config.hasKey) {
    return fail('雷达未启用或未配置 Tavily key，请到设置完成配置', 400);
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    return fail('服务端未配置 DEEPSEEK_API_KEY', 503);
  }

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
