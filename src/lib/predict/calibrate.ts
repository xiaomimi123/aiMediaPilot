import { Prisma, type PrismaClient } from '@prisma/client';
import type { Diagnosis, MetricKey, Verdict } from '@/lib/retro/diagnose';
import { bucketIndex, centerOf, compositeOf, METRIC_DIM, METRIC_KEYS, predictMetric, type Dim, type FormulaParams, type PredictionResult } from './formula';
import { ensureActiveFormula } from './store';
import type { CheckView } from './view';
import type { DimScore } from './score';

export type Target = MetricKey | 'views';
const LABELS: Record<MetricKey, string> = { hook2s: '开头 2 秒跳出率', hook5s: '前 5 秒完播率', middle: '平均观看', ending: '完播率', like: '点赞率', favorite: '收藏率', share: '分享率', subscribe: '吸粉率' };
export const TARGET_LABEL: Record<Target, string> = { ...LABELS, views: '播放量' };
const RANK: Record<string, number> = { bad: 0, even: 1, good: 2 };
const MISS = 1.2;
const CAP = 0.3;

export function buildCheck(
  result: PredictionResult,
  actual: { values: Partial<Record<MetricKey, number | null>>; verdicts: Partial<Record<MetricKey, Verdict>>; views: number | null },
): Omit<CheckView, 'dayN'> {
  const ratios: CheckView['ratios'] = {};
  const verdicts: CheckView['verdicts'] = {};
  for (const m of result.metrics) {
    const a = actual.values[m.key];
    if (m.predicted === null || a === null || a === undefined) continue;
    if (m.predicted > 0) ratios[m.key] = a / m.predicted;
    const av = actual.verdicts[m.key];
    if (m.verdict === 'na' || !av || av === 'na') continue;
    verdicts[m.key] = m.verdict === av ? 'hit' : RANK[m.verdict] > RANK[av] ? 'optimistic' : 'pessimistic';
  }
  const hasViews = result.center !== null && actual.views !== null;
  const top = result.buckets.reduce((best, b, i) => (b.prob > result.buckets[best].prob ? i : best), 0);
  return {
    ratios,
    viewRatio: hasViews ? actual.views! / result.center! : null,
    bucketHit: hasViews && result.buckets.length ? bucketIndex(result.buckets, actual.views!) === top : null,
    verdicts,
  };
}

export interface Sample {
  /** 锁定预测的 id(用于判断提议是否基于新样本) */
  id?: string;
  scores: Record<Dim, number>;
  result: PredictionResult;
  check: Omit<CheckView, 'dayN'>;
}

/** 同一指标、同一最新样本已经提议过(无论采纳还是不要)就不再提; 要等新样本 */
export const shouldPropose = (target: Target, newest: string, history: { target: string; newest?: string }[]) =>
  !history.some((h) => h.target === target && h.newest === newest);

const ratioOf = (s: Sample, t: Target) => (t === 'views' ? s.check.viewRatio : s.check.ratios[t] ?? null);

export function detectBias(recent: Sample[], target: Target): 'optimistic' | 'pessimistic' | null {
  const last = recent.slice(-3).map((s) => ratioOf(s, target));
  if (last.length < 3 || last.some((r) => r === null)) return null;
  // 跳出率: 实际比预测高 = 预测偏乐观; 其余: 实际比预测低 = 偏乐观
  const inverted = target === 'hook2s';
  const optimistic = last.every((r) => (inverted ? r! > MISS : r! < 1 / MISS));
  const pessimistic = last.every((r) => (inverted ? r! < 1 / MISS : r! > MISS));
  return optimistic ? 'optimistic' : pessimistic ? 'pessimistic' : null;
}

const geomean = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function proposeParams(p: FormulaParams, target: Target, recent: Sample[]): FormulaParams {
  const rs = recent.slice(-3).map((s) => ratioOf(s, target)!).filter((r) => r > 0);
  const g = geomean(rs);
  if (target === 'views') {
    // viewOffset 以 viewBase 为底: 单次最多让中枢变 30%
    const cap = Math.log(1 + CAP) / Math.log(p.viewBase);
    const d = clamp(Math.log(g) / Math.log(p.viewBase), -cap, cap);
    return { ...p, viewOffset: p.viewOffset + d };
  }
  const old = p.metricOffset[target];
  // 下限 -0.9: 再怎么调也不会把预测压成 0 或负数
  const next = clamp(clamp((1 + old) * g - 1, old - CAP, old + CAP), -0.9, 3);
  return { ...p, metricOffset: { ...p.metricOffset, [target]: next } };
}

export function backtestError(p: FormulaParams, samples: Sample[], target: Target): number | null {
  const errs: number[] = [];
  for (const s of samples) {
    const r = ratioOf(s, target);
    if (r === null) continue;
    if (target === 'views') {
      const b = s.result.baselineViews;
      if (b === null || s.result.center === null) continue;
      const actual = r * s.result.center;
      const { composite } = compositeOf(s.scores, p, s.result.benchmarkBonus > 0);
      errs.push(Math.abs(Math.log(actual / centerOf(b, composite, p))));
    } else {
      const m = s.result.metrics.find((x) => x.key === target);
      if (!m || m.predicted === null || m.baseline === null) continue;
      const actual = r * m.predicted;
      const pred = predictMetric(target, s.scores[METRIC_DIM[target]], m.baseline, p)!;
      if (actual > 0 && pred > 0) errs.push(Math.abs(Math.log(actual / pred)));
    }
  }
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
}

const toMap = (scores: unknown) => Object.fromEntries((scores as DimScore[]).map((s) => [s.dim, s.score])) as Record<Dim, number>;

export async function recordChecks(db: PrismaClient, projectId: string, dayN: number, diagnosis: Diagnosis, views: number | null): Promise<void> {
  const values = Object.fromEntries(diagnosis.stages.map((s) => [s.key, s.value]));
  const verdicts = Object.fromEntries(diagnosis.stages.map((s) => [s.key, s.verdict]));
  for (const kind of ['final', 'recorded']) {
    const p = await db.prediction.findFirst({ where: { projectId, kind }, orderBy: { createdAt: 'desc' } });
    if (!p) continue;
    const c = buildCheck(p.result as unknown as PredictionResult, { values, verdicts, views });
    const data = { dayN, ratios: c.ratios as Prisma.InputJsonValue, viewRatio: c.viewRatio, bucketHit: c.bucketHit, verdicts: c.verdicts as Prisma.InputJsonValue };
    await db.predictionCheck.upsert({ where: { predictionId: p.id }, update: data, create: { predictionId: p.id, ...data } });
  }
  await maybeProposeFormula(db);
}

/** 每个已对账项目一条: 有录制后版用录制后版, 否则定稿版; 按发布时间旧→新 */
async function loadSamples(db: PrismaClient): Promise<Sample[]> {
  const rows = await db.prediction.findMany({ where: { kind: { in: ['final', 'recorded'] }, check: { isNot: null } }, include: { check: true, project: { include: { publishedWorks: { orderBy: { publishedAt: 'asc' }, take: 1 } } } } });
  const byProject = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = byProject.get(r.projectId);
    if (!cur || (cur.kind === 'final' && r.kind === 'recorded') || (cur.kind === r.kind && r.createdAt > cur.createdAt)) byProject.set(r.projectId, r);
  }
  return [...byProject.values()]
    .sort((a, b) => (a.project.publishedWorks[0]?.publishedAt.getTime() ?? 0) - (b.project.publishedWorks[0]?.publishedAt.getTime() ?? 0))
    .map((r) => ({ id: r.id, scores: toMap(r.scores), result: r.result as unknown as PredictionResult, check: { ratios: r.check!.ratios as CheckView['ratios'], viewRatio: r.check!.viewRatio, bucketHit: r.check!.bucketHit, verdicts: r.check!.verdicts as CheckView['verdicts'] } }));
}

export async function maybeProposeFormula(db: PrismaClient): Promise<number | null> {
  if (await db.predictionFormula.findFirst({ where: { status: 'proposed' } })) return null;
  const active = await ensureActiveFormula(db);
  const samples = await loadSamples(db);
  const newest = samples.at(-1)?.id ?? '';
  const history = (await db.predictionFormula.findMany({ where: { reason: { not: Prisma.DbNull } }, select: { reason: true } })).map((f) => f.reason as { target: string; newest?: string });
  for (const target of [...METRIC_KEYS, 'views'] as Target[]) {
    const direction = detectBias(samples, target);
    if (!direction || !shouldPropose(target, newest, history)) continue;
    const next = proposeParams(active.params, target, samples);
    const oldError = backtestError(active.params, samples, target);
    const newError = backtestError(next, samples, target);
    if (oldError === null || newError === null || newError >= oldError) continue;
    const max = await db.predictionFormula.findFirst({ orderBy: { version: 'desc' } });
    const version = (max?.version ?? 0) + 1;
    await db.predictionFormula.create({
      data: { version, params: next as unknown as Prisma.InputJsonValue, status: 'proposed', reason: { target, label: TARGET_LABEL[target], direction, samples: samples.length, oldError, newError, newest } },
    });
    return version;
  }
  return null;
}

export async function decideFormula(db: PrismaClient, version: number, action: 'accept' | 'reject'): Promise<void> {
  const f = await db.predictionFormula.findUnique({ where: { version } });
  if (!f || f.status !== 'proposed') throw new Error('这个建议已经处理过了');
  if (action === 'reject') {
    await db.predictionFormula.update({ where: { version }, data: { status: 'rejected', decidedAt: new Date() } });
    return;
  }
  await db.$transaction([
    db.predictionFormula.updateMany({ where: { status: 'active' }, data: { status: 'retired' } }),
    db.predictionFormula.update({ where: { version }, data: { status: 'active', decidedAt: new Date() } }),
  ]);
}
