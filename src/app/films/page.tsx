import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { FilmQueue } from '@/components/overview/film-queue';
import type { FreezeReport } from '@/lib/video/freeze-check';

export const dynamic = 'force-dynamic';

/**
 * 成片(v5 阶段 B)。
 *
 * 这一页要回答的是「我的片子在哪、卡在哪」。队列状态与 worker 是否在跑由客户端
 * 读 /api/v1/health 判断 —— 那是**运行时**状态, 服务端渲染的一刻拿到的可能已经过期。
 */
export default async function FilmsPage() {
  const user = await getOrCreateDefaultUser();
  const productions = await prisma.videoProduction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true, mode: true, status: true, createdAt: true, contentId: true, errorMessage: true,
      freezeReport: true,
    },
  });

  const contents = await prisma.cockpitContent.findMany({
    where: { id: { in: productions.map((p) => p.contentId) } },
    select: { id: true, title: true },
  });
  const titleOf = new Map(contents.map((c) => [c.id, c.title]));

  return (
    <PageShell title="成片" description="出片队列与成片。">
      <FilmQueue
        rows={productions.map((p) => ({
          id: p.id,
          title: titleOf.get(p.contentId) ?? '(内容已删除)',
          mode: p.mode,
          status: p.status,
          createdAt: new Date(p.createdAt).toISOString().slice(0, 10),
          errorMessage: p.errorMessage,
          // 只把列表要用的两个数拆出来 —— 整份报告(含最长几段)是详情页才需要的
          freezeOk: (p.freezeReport as FreezeReport | null)?.ok ?? null,
          freezeRatio: (p.freezeReport as FreezeReport | null)?.ratio ?? null,
        }))}
      />
    </PageShell>
  );
}
