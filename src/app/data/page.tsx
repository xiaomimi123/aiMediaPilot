import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildBaseline, BASELINE_YEAR_FROM } from '@/lib/works/model';
import { buildHypotheses, adviseNextVideo } from '@/lib/works/insight';
import { WorkList } from '@/components/data/work-list';
import { WorkInsight } from '@/components/data/work-insight';
import { OverviewCards } from '@/components/data/overview-cards';
import { PlayBars, CompletionScatter } from '@/components/data/play-charts';
import { TrendCharts } from '@/components/data/trend-charts';
import { isUnwritten, readActsFromDraftOutput } from '@/lib/cockpit/script-score';

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
        id: true, title: true, caption: true, hashtags: true, url: true, publishedAt: true,
        play: true, digg: true, comment: true, collect: true, counted: true, scriptDraftId: true,
        durationSec: true, isPrivate: true, fetchedAt: true,
        anaPlay: true, completionRate5s: true, bounceRate2s: true, avgPlayDurationSec: true,
      },
    }),
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.videoProduction.count({ where: { userId: user.id, status: 'done' } }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
  ]);

  // 账号级投稿分析快照。取最新一份 —— 窗口是平台定的, 我们只能记下它覆盖哪一段。
  const snapshot = await prisma.douyinOverviewSnapshot.findFirst({
    where: { userId: user.id },
    orderBy: { fetchedAt: 'desc' },
  });

  // 账号逐日趋势。序列按日期升序, 图才是从左到右往后走的。
  const [summaries, daily] = await Promise.all([
    prisma.douyinMetricSummary.findMany({ where: { userId: user.id } }),
    prisma.douyinDailyMetric.findMany({
      where: { userId: user.id },
      orderBy: { date: 'asc' },
      select: { metric: true, date: true, count: true },
    }),
  ]);
  const seriesOf = new Map<string, { date: string; value: number }[]>();
  for (const d of daily) {
    const arr = seriesOf.get(d.metric) ?? [];
    arr.push({ date: d.date, value: d.count });
    seriesOf.set(d.metric, arr);
  }
  const trends = summaries.map((s) => ({
    metric: s.metric,
    currentCount: s.currentCount,
    lastPeriodIncr: s.lastPeriodIncr,
    series: seriesOf.get(s.metric) ?? [],
  }));

  const baseline = buildBaseline(works.map((w) => ({ play: w.play, counted: w.counted })));

  // 可认领的稿子。打不出分的也列出来但标注 —— 藏起来会让人以为"这份稿子不见了"
  const drafts = await prisma.scriptDraft.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: { id: true, topic: true, output: true },
  });
  const draftOptions = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    return { id: d.id, topic: d.topic, scorable: acts !== null && !isUnwritten(acts) };
  });
  const fetchedAt = works[0]?.fetchedAt ?? null;
  const hiddenCount = works.filter((w) => w.isPrivate).length;

  // 只拿计入分析的(AI 类公开作品)去做文案 × 流量分析
  const analysed = works
    .filter((w) => w.counted)
    .map((w) => ({
      id: w.id,
      caption: w.caption,
      hashtags: Array.isArray(w.hashtags) ? (w.hashtags as string[]) : [],
      play: w.play,
      digg: w.digg,
      collect: w.collect,
      durationSec: w.durationSec,
      publishedAt: w.publishedAt,
    }));
  const hypotheses = buildHypotheses(analysed);
  const advice = adviseNextVideo(analysed);

  const chain = [
    { label: '写稿', count: scripts, note: '本系统里的六幕稿' },
    { label: '出片', count: films, note: '成功渲染的成片' },
    { label: '发布', count: published, note: '本系统追踪到的发布' },
    { label: '回采', count: works.length, note: '从抖音后台抓到的作品' },
  ];

  return (
    <PageShell
      title="数据"
      description="抖音后台的真实表现：账号总览、逐条作品，以及校准链路断在哪一环。"
    >
      <OverviewCards
        snapshot={
          snapshot
            ? {
                windowStart: snapshot.windowStart,
                windowEnd: snapshot.windowEnd,
                submissionCount: snapshot.submissionCount,
                medianPlay: snapshot.medianPlay,
                avgLike: snapshot.avgLike,
                avgComment: snapshot.avgComment,
                avgShare: snapshot.avgShare,
                avgPlayDurationSec: snapshot.avgPlayDurationSec,
                bounceRate2s: snapshot.bounceRate2s,
                completionRate5s: snapshot.completionRate5s,
                coverClickRate: snapshot.coverClickRate,
                verticals: Array.isArray(snapshot.verticals) ? (snapshot.verticals as string[]) : [],
                fetchedAt: snapshot.fetchedAt.toISOString(),
              }
            : null
        }
      />

      <TrendCharts trends={trends} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-base font-semibold">计入基线的作品播放量</h2>
          <p className="mt-1 text-xs text-muted-foreground">作品列表口径。</p>
          <div className="mt-3">
            <PlayBars
              rows={works
                .filter((w) => w.counted)
                .slice(0, 14)
                .reverse()
                .map((w) => ({ id: w.id, label: w.title || '(无标题)', value: w.play }))}
              median={baseline.median ?? 0}
            />
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="text-base font-semibold">完播率 × 播放量</h2>
          <p className="mt-1 text-xs text-muted-foreground">只有分析窗口内的作品有完播率。</p>
          <div className="mt-3">
            <CompletionScatter
              rows={works
                .filter((w) => w.completionRate5s !== null)
                .map((w) => ({
                  id: w.id,
                  label: w.title || '(无标题)',
                  play: w.anaPlay ?? w.play,
                  completion: w.completionRate5s as number,
                }))}
            />
          </div>
        </section>
      </div>

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">基线播放（中位数）</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {baseline.median === null ? '样本不足' : baseline.median.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">按计入的 {baseline.count} 条算</p>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">最高播放</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{baseline.max.toLocaleString()}</p>
          <p className="mt-1 text-xs text-muted-foreground">上限，不是常态</p>
        </div>
        <div className="rounded-md border border-border bg-card p-4">
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
          它们能做的是另一件事：分析文案特征和流量的关系，给下一条视频提假设。
          真正的校准要等本系统写的稿子发出去并回采。
        </p>
        {hiddenCount > 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {works.length} 条里有 {hiddenCount} 条是隐藏/仅自己可见的，已排除出分析——
            它们 0 播放不是内容问题。
          </p>
        ) : null}
      </section>

      <WorkInsight works={analysed} hypotheses={hypotheses} advice={advice} />

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
          scriptDraftId: w.scriptDraftId,
          completionRate5s: w.completionRate5s,
        }))}
        yearFrom={BASELINE_YEAR_FROM}
        drafts={draftOptions}
      />

      <Link href="/calibration" className="mt-4 inline-block text-xs underline underline-offset-4">
        去看三层反馈回路 →
      </Link>
    </PageShell>
  );
}
