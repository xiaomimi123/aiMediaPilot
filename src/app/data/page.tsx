import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';

export const dynamic = 'force-dynamic';

/**
 * 数据(v5 阶段 B)。当前整条回采链路是断的, 这一页的职责就是**说清楚断在哪**。
 */
export default async function DataPage() {
  const user = await getOrCreateDefaultUser();
  const [scripts, films, published, distributions] = await Promise.all([
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.videoProduction.count({ where: { userId: user.id, status: 'done' } }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
    prisma.distribution.count(),
  ]);

  const chain = [
    { label: '写稿', count: scripts },
    { label: '出片', count: films },
    { label: '发布', count: published },
    { label: '回采', count: distributions },
  ];
  const brokenAt = chain.findIndex((c, i) => i > 0 && chain[i - 1].count > 0 && c.count === 0);

  return (
    <PageShell title="数据" description="发布后回采曝光、互动与涨粉，用来校准写稿评分。">
      <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">
          数据链路断在第 {brokenAt < 0 ? '—' : brokenAt + 1} 环
        </p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          评分校准需要「预测分 vs 实际表现」的对照。整条链路只有第一环通了，后面每一环都在等前一环。
        </p>
      </section>

      <div className="mt-4 grid grid-cols-4 gap-3">
        {chain.map((c, i) => (
          <div
            key={c.label}
            className={`rounded-lg border p-4 ${i === brokenAt ? 'border-destructive' : 'border-border'}`}
          >
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{c.count}</p>
          </div>
        ))}
      </div>

      <Link href="/films" className="mt-4 inline-block text-xs underline underline-offset-4">
        去看出片队列 →
      </Link>
    </PageShell>
  );
}
