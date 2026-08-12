import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 最近一次雷达运行摘要 — T6 雷达视图底部「上轮运行摘要」一行的数据源。
 *
 * 挑轻的方案（见 task-6-brief）：独立小路由而非并进 `radar/config` GET —— 后者是
 * `RadarConfigSafe` 的稳定契约 (hasKey/dailyLimit/enabled), 混入运行统计会让那个
 * 响应形状承担两个不相关的关注点; 独立路由让两边都保持单一职责，成本只是多一次
 * fetch（雷达视图本来就要并发拉 items/keywords/config，多一个不增加往返轮数）。
 *
 * 无任何历史 run（从未跑过一次扫描）→ `{run: null}`，前端据此展示引导文案而非
 * 一行全零的摘要。
 */
export async function GET() {
  const user = await getOrCreateDefaultUser();
  const run = await prisma.radarRun.findFirst({
    where: { userId: user.id },
    orderBy: { startedAt: 'desc' },
  });

  if (!run) return ok({ run: null });

  const keywordsUsed = Array.isArray(run.keywordsUsed) ? (run.keywordsUsed as unknown[]) : [];
  const errors = Array.isArray(run.errors) ? (run.errors as unknown[]) : [];

  return ok({
    run: {
      id: run.id,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      keywordsCount: keywordsUsed.length,
      searched: run.searched,
      read: run.read,
      kept: run.kept,
      errorsCount: errors.length,
    },
  });
}
