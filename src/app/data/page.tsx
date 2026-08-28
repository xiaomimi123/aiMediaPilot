import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildBaseline, BASELINE_YEAR_FROM } from '@/lib/works/model';
import { WorkList } from '@/components/data/work-list';

export const dynamic = 'force-dynamic';

/**
 * 数据(v5)。
 *
 * 两件事:
 * 1. **基线** —— 从抖音后台回采的真实作品, 回答「这个账号通常什么表现」
 * 2. **链路断点** —— 校准需要的是「预测分 vs 实际表现」的配对, 而这批作品没有一条
 *    是用本系统写的, 所以它们当不了校准样本。这一点必须写在页面上, 否则用户会以为
 *    有了数据校准就能跑。
 */
export default async function DataPage() {
  const user = await getOrCreateDefaultUser();
  const [works, scripts, films, published] = await Promise.all([
    prisma.publishedWork.findMany({
      where: { userId: user.id },
      orderBy: { publishedAt: 'desc' },
      select: {
        id: true, title: true, url: true, publishedAt: true, play: true,
        digg: true, comment: true, collect: true, counted: true, fetchedAt: true,
      },
    }),
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.videoProduction.count({ where: { userId: user.id, status: 'done' } }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
  ]);

  const baseline = buildBaseline(works.map((w) => ({ play: w.play, counted: w.counted })));
  const fetchedAt = works[0]?.fetchedAt ?? null;

  const chain = [
    { label: '写稿', count: scripts, note: '本系统里的六幕稿' },
    { label: '出片', count: films, note: '成功渲染的成片' },
    { label: '发布', count: published, note: '本系统追踪到的发布' },
    { label: '回采', count: works.length, note: '从抖音后台抓到的作品' },
  ];

  return (
    <PageShell title="数据" description="账号历史表现的基线，以及校准链路断在哪一环。">
      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">基线播放（中位数）</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {baseline.median === null ? '样本不足' : baseline.median.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">按计入的 {baseline.count} 条算</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">最高播放</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{baseline.max.toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">上限，不是常态</p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground">回采作品</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{works.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {fetchedAt ? `更新于 ${fetchedAt.toISOString().slice(0, 10)}` : '还没回采'}
          </p>
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">这批数据当不了校准样本</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          校准要的是「预测分 vs 实际表现」的<span className="font-medium">配对</span>，
          而这 {works.length} 条作品没有一条是用本系统写的——它们没有预测分。
          它们只能当基线：新发的片子跟这个中位数比。真正的校准要等本系统写的稿子发出去并回采。
        </p>
      </section>

      <div className="mb-6 grid grid-cols-4 gap-3">
        {chain.map((c, i) => {
          const broken = i > 0 && chain[i - 1].count > 0 && c.count === 0;
          return (
            <div
              key={c.label}
              className={`rounded-lg border p-4 ${broken ? 'border-destructive' : 'border-border'}`}
            >
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{c.count}</p>
              <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
              {broken ? <p className="mt-1 text-xs text-destructive">断在这里</p> : null}
            </div>
          );
        })}
      </div>

      <WorkList
        initial={works.map((w) => ({
          id: w.id,
          title: w.title,
          url: w.url,
          publishedAt: w.publishedAt.toISOString().slice(0, 10),
          play: w.play,
          digg: w.digg,
          comment: w.comment,
          collect: w.collect,
          counted: w.counted,
        }))}
        yearFrom={BASELINE_YEAR_FROM}
      />

      <Link href="/calibration" className="mt-4 inline-block text-xs underline underline-offset-4">
        去看三层反馈回路 →
      </Link>
    </PageShell>
  );
}
