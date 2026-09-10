import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { PageShell } from '@/components/layout/page-shell';
import { buildPipeline, buildTodos } from '@/lib/cockpit/overview';
import { isUnwritten, readActsFromDraftOutput, scoreHardDimensions } from '@/lib/cockpit/script-score';
import { buildActPlan } from '@/lib/script/act-plan';
import { HealthBanner } from '@/components/layout/health-banner';
import { PipelineFunnel } from '@/components/overview/pipeline-funnel';
import { TodoList } from '@/components/overview/todo-list';
import { ScoreTrend } from '@/components/overview/score-trend';
import { LoopStatus } from '@/components/overview/loop-status';
import { QueuePreview } from '@/components/overview/queue-preview';
import { buildLoopStatus } from '@/lib/cockpit/feedback-loop';
import { dayIndexFor, localDateString } from '@/lib/content-plan/day-index';
import { cn } from '@/lib/utils';

/** 服务器本地日期 "YYYY-MM-DD"(与 `/plan` 页面同一份算法, 避免 UTC 边界漂移)。 */

/** 指标卡的状态徽章色调 → 样式类, 对照设计稿 `.badge` 的 warn/bad/ok/info。 */
const BADGE_CLASS: Record<'warn' | 'bad', string> = {
  warn: 'bg-warn-subtle text-warn',
  bad: 'bg-bad-subtle text-bad',
};

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

  const [drafts, draftTotal, radarCount, adoptedCount, productions, publishedCount, activePlan] = await Promise.all([
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
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, createdAt: true, mode: true, contentId: true },
    }),
    prisma.cockpitContent.count({ where: { userId: user.id, publicationStatus: 'published' } }),
    prisma.contentPlan.findFirst({ where: { userId: user.id, status: 'active' } }),
  ]);

  // 三十八期: 有活跃规划且今天的 Day 存在且还是 pending → 待办里提醒「今天的内容还没写」。
  let todayPlanDayPending = false;
  if (activePlan) {
    const today = localDateString();
    const todayIndex = dayIndexFor(activePlan.startDate, today, activePlan.totalDays);
    if (todayIndex !== null) {
      const todayDay = await prisma.contentPlanDay.findUnique({
        where: { planId_dayIndex: { planId: activePlan.id, dayIndex: todayIndex } },
        select: { status: true },
      });
      todayPlanDayPending = todayDay?.status === 'pending';
    }
  }

  // 出片队列预览(右栏)只要最近几条 + 标题 —— 标题不在 videoProduction 表上,
  // 单独按 contentId 查一批, 与成片页(/films)取标题的方式一致。
  const queuePreviewRows = productions.slice(0, 5);
  const queueContents = await prisma.cockpitContent.findMany({
    where: { id: { in: queuePreviewRows.map((p) => p.contentId) } },
    select: { id: true, title: true },
  });
  const queueTitleOf = new Map(queueContents.map((c) => [c.id, c.title]));

  // 逐份稿子现算硬指标 —— 纯函数, 不需要落库也不需要缓存
  const scored = drafts.map((d) => {
    const acts = readActsFromDraftOutput(d.output);
    if (!acts) return null;
    // 还没写的骨架稿不参与统计 —— 它在时长偏差、简洁度上天生满分, 进了平均分
    // 就是个假数字; 而「有超时的幕」这类判断对空稿子也不成立。
    if (isUnwritten(acts)) return null;
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
    todayPlanDayPending,
  });

  // 回采数据当前没有任何来源, 如实按 0 算
  const loopLayers = buildLoopStatus({
    scriptCount: scored.length,
    publishedCount,
    measuredCount: 0,
  });

  // 雷达堆积的判断阈值与 buildTodos 里给「雷达堆积」待办的阈值(50)保持一致 ——
  // 同一件事在两处各定一个数字必然漂移。
  const radarBacklogged = radarCount > 50;
  // 慢回路没转起来 = 当前均分还没被真实发布数据校准过, 是「待处理」而不是定论。
  const hardScoreUncalibrated = loopLayers.find((l) => l.key === 'slow')?.state !== 'running';

  const stats: {
    label: string;
    value: string;
    hint: string;
    badge?: { tone: 'warn' | 'bad'; text: string };
  }[] = [
    {
      label: '稿子总数',
      value: String(draftTotal),
      // 只有六幕结构的稿子能打分, 早期的 sections 稿打不了 —— 说清楚, 免得两个页面数字对不上
      hint: `其中 ${scored.length} 份是六幕结构、能打分`,
    },
    {
      label: '平均硬指标',
      value: `${avgHard}/35`,
      hint: `按能打分的 ${scored.length} 份算`,
      badge: hardScoreUncalibrated ? { tone: 'warn', text: '待处理' } : undefined,
    },
    {
      label: '雷达待处理',
      value: String(radarCount),
      hint: `已采纳 ${adoptedCount} 条`,
      badge: radarBacklogged ? { tone: 'warn', text: '堆积' } : undefined,
    },
    {
      label: '出片积压',
      value: String(queued.length),
      hint: doneFilms ? `已完成 ${doneFilms}` : '成功出片 0 次',
      badge: queued.length > 0 ? { tone: 'bad', text: '断' } : undefined,
    },
  ];

  return (
    <PageShell title="总览" description="今天该做什么，以及哪条链路断了。">
      <HealthBanner />

      {/* 指标卡一行 4 个: 顶行(t-label + 状态徽章) + 大号等宽数字 + 说明 */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-line-subtle bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="t-label flex-1">{s.label}</span>
              {s.badge ? (
                <span className={cn('badge-base', BADGE_CLASS[s.badge.tone])}>{s.badge.text}</span>
              ) : null}
            </div>
            {/* 数字一律走 Mono, 保证表格和指标对齐 */}
            <p className="mt-1.5 font-mono text-[28px] font-semibold leading-none tabular-nums text-fg">
              {s.value}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-fg-3">{s.hint}</p>
          </div>
        ))}
      </div>

      {/* 双栏: 主栏放管线/待办/反馈回路/评分走势, 右栏固定 360px 放账号表现/出片队列 */}
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <PipelineFunnel stages={pipeline} />
          <TodoList todos={todos} />
          <LoopStatus layers={loopLayers} />
          <ScoreTrend
            rows={scored.slice(0, 12).reverse().map((s) => ({
              id: s.id,
              topic: s.topic,
              hard: s.hard.total,
              hardMax: s.hard.max,
            }))}
          />
        </div>

        <div className="flex w-[360px] shrink-0 flex-col gap-4">
          <section className="rounded-lg border border-line-subtle bg-surface p-4">
            <div className="mb-3.5 flex items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold text-fg">账号表现</h2>
              {publishedCount === 0 ? <span className="badge-base bg-elevated text-fg-3">无数据源</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {['累计播放', '完播率', '互动率', '净涨粉'].map((k) => (
                <div key={k} className="rounded-lg border border-line-subtle bg-inset p-3">
                  <p className="text-[11px] text-fg-3">{k}</p>
                  <p className="mt-1 font-mono text-lg text-fg-4">—</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-fg-3">
              这些指标来自发布后的回采。当前发布 {publishedCount} 条，所以还没有数据源。
              链路修通并发布第一条之后，这一区会自动填充，并用来校准写稿的评分模型。
            </p>
            <Link href="/data" className="mt-3 inline-block text-xs text-brand hover:text-brand-hover">
              看链路断在哪一环 →
            </Link>
          </section>

          <QueuePreview
            rows={queuePreviewRows.map((p) => ({
              id: p.id,
              title: queueTitleOf.get(p.contentId) ?? '(内容已删除)',
              mode: p.mode,
              status: p.status,
              createdAt: new Date(p.createdAt).toISOString().slice(0, 10),
            }))}
          />
        </div>
      </div>
    </PageShell>
  );
}
