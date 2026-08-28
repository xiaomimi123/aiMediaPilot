import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { TopicTabs } from '@/components/topics/topic-tabs';

export const dynamic = 'force-dynamic';

/**
 * 选题(v5 阶段 C)。
 *
 * 热点雷达与灵感库合成两个 tab —— 它们本来就是同一条管线的前后段(雷达条目
 * 采纳后写进灵感库), 旧版把它们做成两个并列的侧栏项, 心智上是断的。
 */
export default async function TopicsPage() {
  const user = await getOrCreateDefaultUser();

  const [radar, radarTotal, adoptedCount, inspirations] = await Promise.all([
    prisma.radarItem.findMany({
      where: { userId: user.id, status: 'new' },
      // 按采集时间倒序而不是热度: 103 条里 57 条都是 100 分, 按热度排和随机排没区别
      orderBy: { collectedAt: 'desc' },
      take: 40,
      select: {
        id: true, title: true, url: true, sourceSite: true,
        heatScore: true, aiAngle: true, aiSummary: true, collectedAt: true,
      },
    }),
    prisma.radarItem.count({ where: { userId: user.id } }),
    prisma.radarItem.count({ where: { userId: user.id, status: 'adopted' } }),
    prisma.cockpitInspiration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { id: true, text: true, createdAt: true, convertedContentIds: true },
    }),
  ]);

  return (
    <PageShell
      title="选题"
      description="AI 为每条热点拟好的中文选题角度。挑一个开条。"
    >
      <TopicTabs
        radar={radar.map((r) => ({
          id: r.id,
          title: r.title,
          url: r.url,
          source: r.sourceSite,
          heat: r.heatScore,
          angle: r.aiAngle,
          summary: r.aiSummary,
          collectedAt: new Date(r.collectedAt).toISOString().slice(0, 10),
        }))}
        radarTotal={radarTotal}
        adoptedCount={adoptedCount}
        inspirations={inspirations.map((i) => ({
          id: i.id,
          text: i.text,
          createdAt: i.createdAt.slice(0, 10),
          used: Array.isArray(i.convertedContentIds) ? i.convertedContentIds.length : 0,
        }))}
      />
    </PageShell>
  );
}
