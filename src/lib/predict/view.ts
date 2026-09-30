import type { MetricKey } from '@/lib/retro/diagnose';
import { DIM_LABEL, type PredictionResult } from './formula';
import type { DimScore } from './score';

export type PredictKind = 'draft' | 'final' | 'recorded';
export const KIND_LABEL: Record<PredictKind, string> = { draft: '草稿预测', final: '定稿预测', recorded: '录制后预测' };

export interface CheckView {
  dayN: number;
  ratios: Partial<Record<MetricKey, number>>;
  viewRatio: number | null;
  bucketHit: boolean | null;
  verdicts: Partial<Record<MetricKey, 'hit' | 'optimistic' | 'pessimistic'>>;
}
export interface PredictionView {
  id: string;
  kind: PredictKind;
  createdAt: string;
  formulaVersion: number;
  scores: DimScore[];
  result: PredictionResult;
  check: CheckView | null;
}

export function toPredictionView(r: { id: string; kind: string; createdAt: Date; formulaVersion: number; scores: unknown; result: unknown; check?: { dayN: number; ratios: unknown; viewRatio: number | null; bucketHit: boolean | null; verdicts: unknown } | null }): PredictionView {
  return {
    id: r.id,
    kind: r.kind as PredictKind,
    createdAt: r.createdAt.toISOString(),
    formulaVersion: r.formulaVersion,
    scores: r.scores as DimScore[],
    result: r.result as PredictionResult,
    check: r.check ? { dayN: r.check.dayN, ratios: r.check.ratios as CheckView['ratios'], viewRatio: r.check.viewRatio, bucketHit: r.check.bucketHit, verdicts: r.check.verdicts as CheckView['verdicts'] } : null,
  };
}

export const dragItems = (scores: DimScore[]) => [...scores].filter((s) => s.score <= 3).sort((a, b) => a.score - b.score).slice(0, 2);

const CONF: Record<string, string> = { low: '置信度低', mid: '置信度中', high: '置信度较高' };
const RANGE: Record<string, string> = { low: '实际可能是预测的 1/3 到 3 倍', mid: '实际可能是预测的 1/2 到 2 倍', high: '实际大概在预测的 0.6 到 1.6 倍之间' };
export const confidenceText = (r: PredictionResult) => `${CONF[r.confidence]}：已对过 ${r.calibratedCount} 次账，${RANGE[r.confidence]}`;

/** 没有播放基线时的说明 */
export const noNumbersText = (r: PredictionResult) =>
  r.publicWorks === undefined ? '公开作品少于 3 条，暂不预测数字' : `公开作品少于 3 条，再发 ${Math.max(1, 3 - r.publicWorks)} 条就能预测数字`;

const top = (r: PredictionResult) => r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a), r.buckets[0]);

export function summarize(kind: PredictKind, scores: DimScore[], r: PredictionResult): string {
  const drag = dragItems(scores);
  const dragText = drag.length ? `；拖后腿：${drag.map((d) => DIM_LABEL[d.dim]).join('、')}` : '';
  if (r.center === null) return `${KIND_LABEL[kind]}：${scores.map((s) => `${DIM_LABEL[s.dim]} ${s.score} 分`).join('，')}（${noNumbersText(r)}）${dragText}`;
  const t = top(r);
  return `${KIND_LABEL[kind]}：中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${t.label}（${t.prob}%）${dragText}`;
}

export function formatPrediction(p: PredictionView): string {
  const r = p.result;
  return [
    `${KIND_LABEL[p.kind]}（${new Date(p.createdAt).toLocaleString('zh-CN')}，公式 v${p.formulaVersion}）`,
    ...p.scores.map((s) => `${DIM_LABEL[s.dim]} ${s.score} 分：${s.reason}${s.fix ? `（建议：${s.fix}）` : ''}`),
    r.center === null ? `${noNumbersText(r)}。` : `播放中枢约 ${r.center.toLocaleString('en-US')}；${r.buckets.map((b) => `${b.label} ${b.prob}%`).join(' / ')}`,
    confidenceText(r),
  ].join('\n');
}
