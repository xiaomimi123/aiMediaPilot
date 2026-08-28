import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildPipeline, buildTodos } from '@/lib/cockpit/overview';
import { readActsFromDraftOutput, scoreHardDimensions } from '@/lib/cockpit/script-score';
import { buildActPlan } from '@/lib/script/act-plan';
import { HealthBanner } from '@/components/layout/health-banner';
import { PipelineFunnel } from '@/components/overview/pipeline-funnel';
import { TodoList } from '@/components/overview/todo-list';
import { ScoreTrend } from '@/components/overview/score-trend';
import { LoopStatus } from '@/components/overview/loop-status';
import { buildLoopStatus } from '@/lib/cockpit/feedback-loop';

export const dynamic = 'force-dynamic';

/**
 * 总览(v5 阶段 B)。
 *
 * 这一页只回答两个问题: **今天该做什么**, 和**哪条链路断了**。
 * 所有数字都从库里真取, 没有的如实报 0 并说明原因 —— 账号指标 0 条、发布 0 条
 * 是这个产品当前的真实状态, 补零凑好看只会让人以为链路是通的。
 */
export default async function OverviewPage() {
  const user = await getOrCreateDefaultUser();

  const [drafts, draftTotal, radarCount, adoptedCount, productions, publishedCount] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, topic: true, createdAt: true, output: true },
    }),
    prisma.scriptDraft.count({ where: { userId: user.id, archivedAt: null } }),
    prisma.radarItem.count({ where: { userId: user.id } }),
    prisma.topicIdea.count({ where: { userId: user.id, status: 'ADOPTED' } }),
    prisma.videoProduction.findMany({
      where: { userId: user.id },
      select: { status: true, createdAt: true },
    }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
  ]);

  // 逐份稿子现算硬指标 —— 纯函数, 不需要落库也不需要缓存
  const scored = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    if (!acts) return null;
    const durationSec = acts.reduce((n, a) => n + a.targetSec, 0);
    return {
      id: d.id,
      topic: d.topic,
      createdAt: d.createdAt,
      hard: scoreHardDimensions(acts, durationSec),
      plan: buildActPlan(acts, durationSec),
      lowFacts: acts.length,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const doneFilms = productions.filter((p) => p.status === 'done').length;
  const queued = productions.filter((p) => p.status === 'queued' || p.status === 'source_uploaded');
  const oldestQueuedDays = queued.length
    ? Math.floor(
        (Date.now() - Math.min(...queued.map((p) => new Date(p.createdAt).getTime()))) / 86_400_000,
      )
    : null;

  const pipeline = buildPipeline({
    radar: radarCount,
    adopted: adoptedCount,
    scripts: scored.length,
    films: doneFilms,
    published: publishedCount,
  });

  const overtimeScripts = scored.filter((s) => s.plan.rows.some((r) => r.warn)).length;
  const avgHard = scored.length
    ? Math.round(scored.reduce((n, s) => n + s.hard.total, 0) / scored.length)
    : 0;

  const todos = buildTodos({
    // worker 在不在由客户端的 HealthBanner 判断; 这里只按"有没有积压"给出待办
    workerOnline: queued.length === 0,
    queuedFilms: queued.length,
    oldestQueuedDays,
    overtimeScripts,
    lowConfidenceFacts: 0,
    radarBacklog: radarCount,
  });

  // 回采数据当前没有任何来源, 如实按 0 算
  const loopLayers = buildLoopStatus({
    scriptCount: scored.length,
    publishedCount,
    measuredCount: 0,
  });

  const stats = [
    {
      label: '稿子总数',
      value: String(draftTotal),
      // 只有六幕结构的稿子能打分, 早期的 sections 稿打不了 —— 说清楚, 免得两个页面数字对不上
      hint: `其中 ${scored.length} 份是六幕结构、能打分`,
    },
    { label: '平均硬指标', value: `${avgHard}/35`, hint: `按能打分的 ${scored.length} 份算` },
    { label: '雷达待处理', value: String(radarCount), hint: `已采纳 ${adoptedCount} 条` },
    { label: '出片积压', value: String(queued.length), hint: doneFilms ? `已完成 ${doneFilms}` : '成功出片 0 次' },
  ];

  return (
    <PageShell title="总览" description="今天该做什么，以及哪条链路断了。">
      <HealthBanner />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <PipelineFunnel stages={pipeline} />
        <TodoList todos={todos} />
      </div>

      <div className="mb-6">
        <LoopStatus layers={loopLayers} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ScoreTrend
          rows={scored.slice(0, 12).reverse().map((s) => ({
            id: s.id,
            topic: s.topic,
            hard: s.hard.total,
            hardMax: s.hard.max,
          }))}
        />

        <section className="rounded-lg border border-border p-4">
          <h2 className="text-sm font-medium">账号表现</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            播放、涨粉、互动这些指标来自发布后的回采。当前发布 {publishedCount} 条，
            所以还没有数据源。链路修通并发布第一条之后，这一区会自动填充，并用来校准写稿的评分模型。
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            {['累计播放', '完播率', '互动率', '净涨粉'].map((k) => (
              <div key={k} className="rounded border border-dashed border-border p-3">
                <p className="text-muted-foreground">{k}</p>
                <p className="mt-1 text-muted-foreground">—</p>
              </div>
            ))}
          </div>
          <Link href="/data" className="mt-3 inline-block text-xs underline underline-offset-4">
            看链路断在哪一环 →
          </Link>
        </section>
      </div>
    </PageShell>
  );
}
