import { describe, expect, it } from 'vitest';
import { dragItems, formatPrediction, summarize } from '@/lib/predict/view';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

const s = (dim: string, score: number, fix = '') => ({ dim, score, reason: `${dim} 理由`, quote: '', segmentId: null, fix }) as never;
const scores = [s('hook', 2, '开头直接说结果'), s('pace', 3), s('ending', 1, '结尾回收开头的问题'), s('interaction', 4), s('topic', 3)];
const result = computePrediction({ scores: { hook: 2, pace: 3, ending: 1, interaction: 4, topic: 3 }, baselines: {}, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });

describe('prediction view', () => {
  it('picks at most two lowest scores at or below 3', () => {
    expect(dragItems(scores).map((x) => x.dim)).toEqual(['ending', 'hook']);
  });
  it('summarizes the center and the most likely bucket', () => {
    const t = summarize('final', scores, result);
    expect(t).toMatch(/^定稿预测：中枢约 [\d,]+，最可能 .+（\d+%）/);
    expect(t).toContain('拖后腿：结尾收束、开头钩子');
  });
  it('formats a multi-line view', () => {
    const t = formatPrediction({ id: 'x', kind: 'draft', createdAt: '2026-09-30T00:00:00.000Z', formulaVersion: 1, scores, result, check: null });
    expect(t).toContain('草稿预测');
    expect(t).toContain('开头钩子 2 分：hook 理由');
    expect(t).toContain('置信度低');
  });
  it('says how many more works are needed for numbers', () => {
    const none = computePrediction({ scores: { hook: 2, pace: 3, ending: 1, interaction: 4, topic: 3 }, baselines: {}, baselineViews: null, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS, publicWorks: 0 });
    expect(summarize('draft', scores, none)).toContain('再发 3 条就能预测数字');
  });
});
