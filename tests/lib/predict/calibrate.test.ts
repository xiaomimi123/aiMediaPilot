import { describe, expect, it } from 'vitest';
import { backtestError, buildCheck, detectBias, proposeParams, shouldPropose, type Sample } from '@/lib/predict/calibrate';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

const scores = { hook: 3, pace: 3, ending: 3, interaction: 3, topic: 3 };
const result = computePrediction({ scores, baselines: { hook5s: 0.5, hook2s: 0.4 }, baselineViews: 2000, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
const sample = (hook5s: number, views: number): Sample => ({ scores, result, check: buildCheck(result, { values: { hook5s, hook2s: 0.4 }, verdicts: { hook5s: hook5s > 0.6 ? 'good' : hook5s < 0.4 ? 'bad' : 'even', hook2s: 'even' }, views }) });

describe('prediction checks', () => {
  it('computes ratios, verdict hits and the bucket hit', () => {
    const c = buildCheck(result, { values: { hook5s: 0.3, hook2s: 0.4 }, verdicts: { hook5s: 'bad', hook2s: 'even' }, views: 1500 });
    expect(c.ratios.hook5s).toBeCloseTo(0.6);
    expect(c.verdicts).toEqual({ hook5s: 'optimistic', hook2s: 'hit' });
    expect(c.viewRatio).toBeCloseTo(0.75);
    expect(c.bucketHit).toBe(true);
  });
  it('skips metrics without a prediction', () => {
    const c = buildCheck(result, { values: { like: 0.05 }, verdicts: { like: 'good' }, views: null });
    expect(c.ratios.like).toBeUndefined();
    expect(c.verdicts.like).toBeUndefined();
    expect(c.viewRatio).toBeNull();
    expect(c.bucketHit).toBeNull();
  });
});

describe('calibration', () => {
  it('needs three same-direction misses beyond 20%', () => {
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.3, 2000)], 'hook5s')).toBe('optimistic');
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.7, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.45, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.5, 500), sample(0.5, 600), sample(0.5, 700)], 'views')).toBe('optimistic');
  });
  it('treats a higher actual bounce rate as optimistic', () => {
    const s = (b: number): Sample => ({ scores, result, check: buildCheck(result, { values: { hook2s: b }, verdicts: {}, views: null }) });
    expect(detectBias([s(0.6), s(0.6), s(0.6)], 'hook2s')).toBe('optimistic');
  });
  it('caps a single adjustment at 30%', () => {
    const p = proposeParams(DEFAULT_PARAMS, 'hook5s', [sample(0.1, 2000), sample(0.1, 2000), sample(0.1, 2000)]);
    expect(p.metricOffset.hook5s).toBeCloseTo(-0.3);
    const v = proposeParams(DEFAULT_PARAMS, 'views', [sample(0.5, 100), sample(0.5, 100), sample(0.5, 100)]);
    expect(v.viewOffset).toBeCloseTo(-Math.log2(1.3));
  });
  it('backtests with locked scores and baselines', () => {
    const samples = [sample(0.3, 2000), sample(0.3, 2000), sample(0.3, 2000)];
    const better = proposeParams(DEFAULT_PARAMS, 'hook5s', samples);
    expect(backtestError(better, samples, 'hook5s')!).toBeLessThan(backtestError(DEFAULT_PARAMS, samples, 'hook5s')!);
    expect(backtestError(DEFAULT_PARAMS, samples, 'like')).toBeNull();
  });
});

describe('proposal history', () => {
  it('does not re-propose from the same newest sample once decided', () => {
    expect(shouldPropose('views', 'pr9', [])).toBe(true);
    expect(shouldPropose('views', 'pr9', [{ target: 'views', newest: 'pr9' }])).toBe(false);
    expect(shouldPropose('views', 'pr10', [{ target: 'views', newest: 'pr9' }])).toBe(true);
    expect(shouldPropose('hook5s', 'pr9', [{ target: 'views', newest: 'pr9' }])).toBe(true);
  });
});

describe('adjustment bounds', () => {
  it('never lets a metric offset reach zero predictions', () => {
    let p = DEFAULT_PARAMS;
    for (let i = 0; i < 6; i++) p = proposeParams(p, 'hook5s', [sample(0.1, 2000), sample(0.1, 2000), sample(0.1, 2000)]);
    expect(p.metricOffset.hook5s).toBeGreaterThanOrEqual(-0.9);
  });
  it('caps the view shift by 30% whatever the view base is', () => {
    const v = proposeParams({ ...DEFAULT_PARAMS, viewBase: 3 }, 'views', [sample(0.5, 100), sample(0.5, 100), sample(0.5, 100)]);
    expect(3 ** v.viewOffset).toBeCloseTo(1 / 1.3);
  });
});
