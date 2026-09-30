import { describe, expect, it } from 'vitest';
import { bucketIndex, bucketsFor, centerOf, compositeOf, computePrediction, confidenceOf, DEFAULT_PARAMS, fmtViews, predictMetric, sigmaOf } from '@/lib/predict/formula';

const three = { hook: 3, pace: 3, ending: 3, interaction: 3, topic: 3 };

describe('predict formula', () => {
  it('moves a metric 15% per point, inverted for the 2s bounce rate', () => {
    expect(predictMetric('hook5s', 5, 0.5, DEFAULT_PARAMS)).toBeCloseTo(0.65);
    expect(predictMetric('hook2s', 5, 0.4, DEFAULT_PARAMS)).toBeCloseTo(0.28);
    expect(predictMetric('middle', 2, 20, DEFAULT_PARAMS)).toBeCloseTo(17);
    expect(predictMetric('like', 3, null, DEFAULT_PARAMS)).toBeNull();
    expect(predictMetric('like', 3, 0.02, { ...DEFAULT_PARAMS, metricOffset: { ...DEFAULT_PARAMS.metricOffset, like: -0.5 } })).toBeCloseTo(0.01);
  });
  it('weights the composite and adds the benchmark bonus', () => {
    expect(compositeOf(three, DEFAULT_PARAMS, false)).toEqual({ composite: 3, bonus: 0 });
    expect(compositeOf({ ...three, hook: 5 }, DEFAULT_PARAMS, true).composite).toBeCloseTo(3 + 0.6 + 0.3);
  });
  it('doubles the center per composite point', () => {
    expect(centerOf(2900, 3, DEFAULT_PARAMS)).toBe(2900);
    expect(centerOf(2900, 4, DEFAULT_PARAMS)).toBe(5800);
    expect(centerOf(2900, 3, { ...DEFAULT_PARAMS, viewOffset: -1 })).toBe(1450);
  });
  it('makes four buckets that add up to 100 and are flatter with fewer samples', () => {
    const low = bucketsFor(2900, 2900, sigmaOf('low'));
    expect(low.map((b) => b.label)).toEqual(['<1,450', '1,450–5,800', '5,800–1.5万', '≥1.5万']);
    expect(low.reduce((s, b) => s + b.prob, 0)).toBe(100);
    const high = bucketsFor(2900, 2900, sigmaOf('high'));
    expect(high[1].prob).toBeGreaterThan(low[1].prob);
    expect(bucketIndex(low, 6000)).toBe(2);
    expect(bucketIndex(low, 100000)).toBe(3);
  });
  it('grades confidence by calibrated samples', () => {
    expect([confidenceOf(0), confidenceOf(4), confidenceOf(5), confidenceOf(14), confidenceOf(15)]).toEqual(['low', 'low', 'mid', 'mid', 'high']);
  });
  it('formats views', () => {
    expect([fmtViews(1450), fmtViews(14500), fmtViews(125000)]).toEqual(['1,450', '1.5万', '12.5万']);
  });
  it('computes metrics with verdicts like the retro', () => {
    const r = computePrediction({ scores: { ...three, hook: 5, ending: 1 }, baselines: { hook2s: 0.4, hook5s: 0.5, ending: 0.1 }, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
    const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
    expect(m.hook2s.verdict).toBe('good');
    expect(m.ending.verdict).toBe('bad');
    expect(m.like).toMatchObject({ baseline: null, predicted: null, verdict: 'na' });
    expect(r.center).toBeGreaterThan(2900);
    expect(r.confidence).toBe('low');
  });
  it('gives no numbers without a view baseline', () => {
    const r = computePrediction({ scores: three, baselines: {}, baselineViews: null, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
    expect(r).toMatchObject({ baselineViews: null, center: null, buckets: [] });
    expect(r.metrics.every((x) => x.predicted === null)).toBe(true);
  });
});
