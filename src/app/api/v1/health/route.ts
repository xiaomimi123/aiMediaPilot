import { ok } from '@/lib/api';
import { redis } from '@/lib/redis';
import {
  analyzeQueue,
  autoSyncQueue,
  radarQueue,
  retroQueue,
  syncQueue,
  videoProductionQueue,
} from '@/jobs/queue';

/**
 * **必须动态。** 健康检查被静态预渲染就等于把构建时的快照当成实时状态 —— 页面上
 * 会永远显示构建那一刻 worker 在不在, 而不是现在在不在。
 *
 * 还有个更直接的后果: 构建时会去连 Redis, Redis 没起的话 ioredis 一直重试,
 * 整个 next build 卡死在这一页(实测就是这么挂的)。
 */
export const dynamic = 'force-dynamic';


/**
 * 运行时健康检查(前端重建 · 阶段 5.1)。
 *
 * 动因: 后台 worker 需要手动 `npm run worker:dev` 启动, 不启动时任务照常入队然后
 * 静静躺着 —— 实测一条任务从晚上 21:58 停到第二天凌晨, 界面上没有一个字的解释。
 * 「视频任务 9 次 / 成功出片 0 次」的直接原因就是这个。
 *
 * 契约: **任何发起异步任务的界面, 必须先读这里**。`ready` 为 false 时禁用按钮
 * 并把 `hint` 原样显示给用户, 不要让人点一个什么都不会发生的按钮。
 *
 * 永远返回 200: 这是给界面读的状态, 不是给编排系统的存活探针。前端只看 `ready`,
 * 用 HTTP 码表达不健康反而会让 fetch 分支变复杂。
 */

const QUEUES = {
  'video-production': videoProductionQueue,
  'content-analyze': analyzeQueue,
  'content-retro': retroQueue,
  radar: radarQueue,
  'auto-sync': autoSyncQueue,
  sync: syncQueue,
};

/** BullMQ 的 getJobCounts() 返回的是 `{ [k: string]: number }`, 这里只取用到的四个。 */
type QueueCounts = Record<string, number>;

async function pingRedis(): Promise<'up' | 'down'> {
  try {
    await redis.ping();
    return 'up';
  } catch {
    return 'down';
  }
}

/**
 * worker 在线数与最小空闲秒数。
 *
 * BullMQ 的 getWorkers() 读 Redis CLIENT LIST, `idle` 是该连接空闲的秒数 ——
 * 用最小值当作「最近一次心跳距今多久」: 只要有一个 worker 刚活动过, 整体就是活的。
 */
async function readWorkers(): Promise<{ online: number; minIdleSec: number | null }> {
  try {
    const clients = (await videoProductionQueue.getWorkers()) as Array<{ idle?: string | number }>;
    if (clients.length === 0) return { online: 0, minIdleSec: null };
    const idles = clients
      .map((c) => Number(c.idle))
      .filter((n) => Number.isFinite(n));
    return { online: clients.length, minIdleSec: idles.length ? Math.min(...idles) : null };
  } catch {
    return { online: 0, minIdleSec: null };
  }
}

export async function GET() {
  const [redisStatus, workers] = await Promise.all([pingRedis(), readWorkers()]);

  // 单条队列查询失败不该让整个健康检查瞎掉 —— 那一条记 null, 其余照常报
  const entries = await Promise.all(
    Object.entries(QUEUES).map(async ([name, q]) => {
      try {
        const c = (await q.getJobCounts()) as QueueCounts;
        return [name, { waiting: c.waiting, active: c.active, delayed: c.delayed, failed: c.failed }];
      } catch {
        return [name, null];
      }
    }),
  );

  const ready = redisStatus === 'up' && workers.online > 0;

  return ok({
    ready,
    redis: redisStatus,
    workers,
    queues: Object.fromEntries(entries),
    hint: ready
      ? null
      : redisStatus === 'down'
        ? 'Redis 连不上，后台任务无法排队。检查 REDIS_URL，或先启动 redis（docker compose up -d redis）。'
        : '后台处理进程没在运行，任务会排队但没人处理。在项目目录执行 npm run worker:dev。',
  });
}
