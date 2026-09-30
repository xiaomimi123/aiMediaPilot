import { verdictOf, type MetricKey, type Verdict } from '@/lib/retro/diagnose';

export const DIMS = ['hook', 'pace', 'ending', 'interaction', 'topic'] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_LABEL: Record<Dim, string> = { hook: '开头钩子', pace: '节奏与信息密度', ending: '结尾收束', interaction: '互动引子', topic: '选题与受众' };

export const METRIC_KEYS: MetricKey[] = ['hook2s', 'hook5s', 'middle', 'ending', 'like', 'favorite', 'share', 'subscribe'];
export const METRIC_DIM: Record<MetricKey, Dim> = { hook2s: 'hook', hook5s: 'hook', middle: 'pace', ending: 'ending', like: 'interaction', favorite: 'interaction', share: 'interaction', subscribe: 'interaction' };

export interface FormulaParams {
  k: number;
  metricOffset: Record<MetricKey, number>;
  weights: Record<Dim, number>;
  viewBase: number;
  viewOffset: number;
  benchmarkBonus: number;
}

export const DEFAULT_PARAMS: FormulaParams = {
  k: 0.15,
  metricOffset: { hook2s: 0, hook5s: 0, middle: 0, ending: 0, like: 0, favorite: 0, share: 0, subscribe: 0 },
  weights: { hook: 0.3, topic: 0.2, pace: 0.2, ending: 0.15, interaction: 0.15 },
  viewBase: 2,
  viewOffset: 0,
  benchmarkBonus: 0.3,
};

export interface MetricPrediction {
  key: MetricKey;
  baseline: number | null;
  predicted: number | null;
  verdict: Verdict;
}
export interface Bucket {
  label: string;
  lo: number;
  hi: number | null;
  prob: number;
}
export type Confidence = 'low' | 'mid' | 'high';
export interface PredictionResult {
  metrics: MetricPrediction[];
  composite: number;
  benchmarkBonus: number;
  baselineViews: number | null;
  center: number | null;
  buckets: Bucket[];
  confidence: Confidence;
  calibratedCount: number;
  /** 有播放数据的公开作品数(不足 3 条时提示还差几条) */
  publicWorks?: number;
}

export function predictMetric(key: MetricKey, score: number, baseline: number | null, p: FormulaParams): number | null {
  if (baseline === null) return null;
  const dir = key === 'hook2s' ? -1 : 1; // 跳出率越低越好
  return baseline * (1 + dir * p.k * (score - 3)) * (1 + p.metricOffset[key]);
}

export function compositeOf(scores: Record<Dim, number>, p: FormulaParams, benchmarkHit: boolean) {
  const base = DIMS.reduce((s, d) => s + p.weights[d] * scores[d], 0);
  const bonus = benchmarkHit ? p.benchmarkBonus : 0;
  return { composite: Math.round((base + bonus) * 1000) / 1000, bonus };
}

export const centerOf = (baselineViews: number, composite: number, p: FormulaParams) => Math.round(baselineViews * p.viewBase ** (composite - 3 + p.viewOffset));

export const confidenceOf = (n: number): Confidence => (n < 5 ? 'low' : n < 15 ? 'mid' : 'high');
export const sigmaOf = (c: Confidence) => Math.log(c === 'low' ? 3 : c === 'mid' ? 2 : 1.6);

export function fmtViews(n: number): string {
  if (n < 10000) return Math.round(n).toLocaleString('en-US');
  return `${(Math.round(n / 1000) / 10).toString()}万`;
}

// Abramowitz–Stegun 7.1.26
function erf(x: number) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

const EDGES = [0, 0.5, 2, 5];

export function bucketsFor(baselineViews: number, center: number, sigma: number): Bucket[] {
  const cdf = (v: number | null) => (v === null ? 1 : v <= 0 ? 0 : phi((Math.log(v) - Math.log(center)) / sigma));
  const raw = EDGES.map((e, i) => {
    const lo = e * baselineViews;
    const hi = i + 1 < EDGES.length ? EDGES[i + 1] * baselineViews : null;
    return { lo, hi, p: cdf(hi) - cdf(lo) };
  });
  const probs = raw.map((r) => Math.round(r.p * 100));
  const fix = 100 - probs.reduce((s, x) => s + x, 0);
  probs[probs.indexOf(Math.max(...probs))] += fix;
  return raw.map((r, i) => ({
    label: r.lo === 0 ? `<${fmtViews(r.hi!)}` : r.hi === null ? `≥${fmtViews(r.lo)}` : `${fmtViews(r.lo)}–${fmtViews(r.hi)}`,
    lo: Math.round(r.lo),
    hi: r.hi === null ? null : Math.round(r.hi),
    prob: probs[i],
  }));
}

export const bucketIndex = (buckets: Bucket[], views: number) => buckets.findIndex((b) => views >= b.lo && (b.hi === null || views < b.hi));

export function computePrediction(i: {
  scores: Record<Dim, number>;
  baselines: Partial<Record<MetricKey, number>>;
  baselineViews: number | null;
  benchmarkHit: boolean;
  calibratedCount: number;
  params: FormulaParams;
  publicWorks?: number;
}): PredictionResult {
  const { composite, bonus } = compositeOf(i.scores, i.params, i.benchmarkHit);
  const confidence = confidenceOf(i.calibratedCount);
  const noViews = i.baselineViews === null;
  const metrics = METRIC_KEYS.map((key): MetricPrediction => {
    const baseline = noViews ? null : i.baselines[key] ?? null;
    const predicted = predictMetric(key, i.scores[METRIC_DIM[key]], baseline, i.params);
    return { key, baseline, predicted, verdict: verdictOf(key, predicted, baseline) };
  });
  const center = noViews ? null : centerOf(i.baselineViews!, composite, i.params);
  return {
    metrics,
    composite,
    benchmarkBonus: bonus,
    baselineViews: i.baselineViews,
    center,
    buckets: center === null ? [] : bucketsFor(i.baselineViews!, center, sigmaOf(confidence)),
    confidence,
    calibratedCount: i.calibratedCount,
    ...(i.publicWorks !== undefined ? { publicWorks: i.publicWorks } : {}),
  };
}
