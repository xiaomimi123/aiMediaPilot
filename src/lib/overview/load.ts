import type { PrismaClient } from '@prisma/client';
import { toProjectView } from '@/lib/project/view';
import { latestForDisplay } from '@/lib/cli/commands/predict';
import { stepsOf, type WorkCardData } from './steps';
import { readCollectStatus, readScanStatus } from '@/lib/douyin/collect-log';
import { buildAccountSummary } from '@/lib/account/summary';
import { findCandidate } from '@/lib/retro/match';
import { findLagging } from '@/lib/predict/lag';
import { loadTrend, snapshotDays } from '@/lib/account/daily';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { computeBaseline, metricValues, verdictOf, type Verdict } from '@/lib/retro/diagnose';
import { toMetricSet } from '@/lib/retro/generate';
import { median } from '@/lib/benchmark/rules';
import { buildToday, type InProgressItem, type TodoItem } from './today';

export async function loadWorkCards(db: PrismaClient): Promise<WorkCardData[]> {
  const rows = await db.project.findMany({ orderBy: { updatedAt: 'desc' }, include: { retro: { select: { id: true } }, publishedWorks: { orderBy: { publishedAt: 'desc' }, take: 1 } } });
  const out: WorkCardData[] = [];
  for (const p of rows) {
    const v = toProjectView(p);
    const w = p.publishedWorks[0] ?? null;
    const pred = w ? null : await latestForDisplay(db, p.id);
    out.push({
      id: p.id,
      title: p.title,
      stage: p.stage,
      steps: stepsOf({ stage: p.stage, hasBenchmark: !!p.benchmarkVideoId, hasScript: !!v.script, published: !!w, hasRetro: !!p.retro }),
      durationSec: v.report ? v.report.totalSec : null,
      center: pred?.result.center ?? null,
      views: w ? w.viewCount ?? w.play : null,
      updatedAt: v.updatedAt,
    });
  }
  return out;
}

export interface WorkRow {
  id: string;
  title: string;
  href: string;
  external: boolean;
  views: number | null;
  hook5s: number | null;
  avgViewSec: number | null;
  likeRate: number | null;
  verdicts: { views: Verdict; hook5s: Verdict; middle: Verdict; like: Verdict };
}

export interface OverviewData {
  todos: TodoItem[];
  inProgress: InProgressItem[];
  empty: boolean;
  hits: { author: string; ratio: number | null; topic: string }[];
  following: number;
  metrics: { fans: number | null; fansDelta: number | null; likes: number | null; works: number; views: number; calib: { count: number; avgError: number | null } };
  trend: { day: string; fans: number | null; likes: number | null; views: number | null }[];
  trendDays: number;
  works: WorkRow[];
}

export async function loadOverview(db: PrismaClient, now: Date): Promise<OverviewData> {
  const [collect, scan] = await Promise.all([readCollectStatus(now), readScanStatus(now)]);
  const sum = await buildAccountSummary(db, collect, scan);
  const works = await loadWorkCards(db);
  const finals = await db.project.findMany({ where: { stage: 'final' }, select: { id: true, title: true } });
  const pendingLinks: { projectId: string; title: string }[] = [];
  for (const p of finals) if (await findCandidate(db, p.id)) pendingLinks.push({ projectId: p.id, title: p.title });
  const notes = await db.noteProposal.findMany({ where: { status: 'pending' }, include: { project: { select: { title: true } } } });
  const lagging = await findLagging(db, now).catch(() => []);
  const today = buildToday({
    failingTasks: [collect, scan].filter((s) => s.state !== 'ok'),
    pendingLinks,
    lessonCandidates: await db.writingLesson.count({ where: { status: 'candidate' } }),
    pendingNotes: notes.map((n) => ({ projectId: n.projectId, title: n.project.title })),
    lagging: lagging.map((l) => ({ projectId: l.projectId, title: l.title })),
    formulaProposed: !!(await db.predictionFormula.findFirst({ where: { status: 'proposed' } })),
    works,
  });

  const hitRows = await db.benchmarkVideo.findMany({ where: { hitAt: { gte: new Date(now.getTime() - 86400_000) }, status: { not: 'ignored' } }, include: { account: true }, orderBy: { ratio: 'desc' }, take: 3 });
  const hits = hitRows.map((h) => {
    const a = AnalysisSchema.safeParse(h.analysis);
    return { author: h.account.nickname, ratio: h.ratio, topic: a.success ? a.data.topic : h.desc.replace(/#\S+/g, '').trim().slice(0, 24) };
  });

  const checks = await db.predictionCheck.findMany({ select: { viewRatio: true } });
  const ratios = checks.map((c) => c.viewRatio).filter((r): r is number => r !== null && r > 0);
  const avgError = ratios.length ? Math.round(Math.exp(ratios.reduce((s, r) => s + Math.abs(Math.log(r)), 0) / ratios.length) * 10) / 10 : null;

  const pub = await db.publishedWork.findMany({ where: { isPrivate: false }, orderBy: { publishedAt: 'desc' } });
  const sets = pub.map(toMetricSet);
  const base = computeBaseline(sets);
  const viewsList = pub.map((w) => w.viewCount ?? w.play).filter((v): v is number => v !== null && v > 0);
  const viewBase = viewsList.length >= 3 ? median(viewsList.slice(0, 10)) : null;
  const rows: WorkRow[] = pub.map((w, i) => {
    const v = metricValues(sets[i]);
    const views = w.viewCount ?? w.play;
    return {
      id: w.id,
      title: (w.title || w.caption || '').slice(0, 40) || '（无标题）',
      href: w.projectId ? `/projects/${w.projectId}` : w.url,
      external: !w.projectId,
      views,
      hook5s: v.hook5s,
      avgViewSec: v.middle,
      likeRate: v.like,
      verdicts: {
        views: verdictOf('like', views, viewBase),
        hook5s: verdictOf('hook5s', v.hook5s, base.medians.hook5s ?? null),
        middle: verdictOf('middle', v.middle, base.medians.middle ?? null),
        like: verdictOf('like', v.like, base.medians.like ?? null),
      },
    };
  });

  return {
    ...today,
    hits,
    following: await db.benchmarkAccount.count({ where: { status: 'following' } }),
    metrics: { fans: sum.fans, fansDelta: sum.fansDelta, likes: sum.likes, works: sum.publicWorks, views: sum.publicPlay, calib: { count: ratios.length, avgError } },
    trend: await loadTrend(db, 30, now),
    trendDays: await snapshotDays(db),
    works: rows,
  };
}
