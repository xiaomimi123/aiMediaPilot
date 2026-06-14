import { describe, expect, it } from 'vitest';
import {
  scoreMultiplier,
  calibrationFactor,
  computePrediction,
  formatPlays,
} from '@/lib/prediction/formula';
import type { CalibrationData } from '@/lib/dashboard/types';

describe('scoreMultiplier', () => {
  it('锚点表: score 50 → 1.0×', () => {
    expect(scoreMultiplier(50)).toBeCloseTo(1.0, 2);
  });
  it('锚点表: score 80 → ~2.7×', () => {
    expect(scoreMultiplier(80)).toBeCloseTo(2.72, 1);
  });
  it('锚点表: score 100 → ~5.3×', () => {
    expect(scoreMultiplier(100)).toBeCloseTo(5.29, 1);
  });
  it('锚点表: score 30 → ~0.51×', () => {
    expect(scoreMultiplier(30)).toBeCloseTo(0.51, 1);
  });
  it('锚点表: score 0 → ~0.19×', () => {
    expect(scoreMultiplier(0)).toBeCloseTo(0.19, 1);
  });
});

describe('calibrationFactor', () => {
  const mkDist = (over: number, under: number, on: number, unk: number) => ({
    onTarget: on,
    overEstimated: over,
    underEstimated: under,
    unknown: unk,
    total: over + under + on + unk,
    worstBucket: null as null,
  });
  const mkCal = (over: number, under: number, on: number): CalibrationData => ({
    sampleCount: over + under + on,
    matrix: {
      hookGap: mkDist(over, under, on, 0),
      retentionGap: mkDist(over, under, on, 0),
      titleCaptionGap: mkDist(over, under, on, 0),
      coverGap: mkDist(over, under, on, 0),
    },
    insight: '',
  });

  it('null → 1.0', () => {
    expect(calibrationFactor(null)).toBe(1.0);
  });
  it('整体偏乐观 (over ≥ 40%) → 0.7', () => {
    expect(calibrationFactor(mkCal(3, 1, 1))).toBe(0.7);
  });
  it('整体偏保守 (under ≥ 40%) → 1.3', () => {
    expect(calibrationFactor(mkCal(1, 3, 1))).toBe(1.3);
  });
  it('全 on-target → 1.0', () => {
    expect(calibrationFactor(mkCal(0, 0, 5))).toBe(1.0);
  });
  it('over 与 under 都 ≥ 40%, over 优先', () => {
    expect(calibrationFactor(mkCal(2, 2, 1))).toBe(0.7);
  });
});

describe('computePrediction', () => {
  it('典型 case: baseline=1000, score=75, cal=null, retroCount=0', () => {
    const result = computePrediction({
      overallScore: 75,
      baseline: 1000,
      calibration: null,
      retroSampleCount: 0,
      basisSource: 'onboarding',
    });
    expect(result.predicted).toBeGreaterThanOrEqual(2200);
    expect(result.predicted).toBeLessThanOrEqual(2400);
    expect(result.lower).toBe(Math.round(result.predicted * 0.5));
    expect(result.upper).toBe(Math.round(result.predicted * 2));
    expect(result.confidence).toBe('low');
    expect(result.basisSource).toBe('onboarding');
    expect(result.basisValue).toBe(1000);
  });

  it('confidence: 0/3/10 retro → low/medium/high', () => {
    const base = {
      overallScore: 50,
      baseline: 1000,
      calibration: null,
      basisSource: 'onboarding' as const,
    };
    expect(computePrediction({ ...base, retroSampleCount: 0 }).confidence).toBe('low');
    expect(computePrediction({ ...base, retroSampleCount: 2 }).confidence).toBe('low');
    expect(computePrediction({ ...base, retroSampleCount: 3 }).confidence).toBe('medium');
    expect(computePrediction({ ...base, retroSampleCount: 9 }).confidence).toBe('medium');
    expect(computePrediction({ ...base, retroSampleCount: 10 }).confidence).toBe('high');
  });

  it('overflow clamp: baseline=1e9, score=100 → predicted ≤ 5e8 (upper ≤ 1e9)', () => {
    const result = computePrediction({
      overallScore: 100,
      baseline: 1e9,
      calibration: null,
      retroSampleCount: 0,
      basisSource: 'onboarding',
    });
    expect(result.predicted).toBeLessThanOrEqual(5e8);
    expect(result.upper).toBeLessThanOrEqual(1e9);
    expect(result.upper).toBe(result.predicted * 2);
  });

  it('calibration 影响最终值 (偏乐观时下移)', () => {
    const baseInput = {
      overallScore: 80,
      baseline: 1000,
      retroSampleCount: 5,
      basisSource: 'retro-median' as const,
    };
    const without = computePrediction({ ...baseInput, calibration: null });
    const withOver = computePrediction({
      ...baseInput,
      calibration: {
        sampleCount: 5,
        matrix: {
          hookGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          retentionGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          titleCaptionGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          coverGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
        },
        insight: '',
      },
    });
    expect(withOver.predicted).toBeCloseTo(without.predicted * 0.7, 0);
  });
});

describe('formatPlays', () => {
  it('< 1000 → 原数字符串', () => {
    expect(formatPlays(0)).toBe('0');
    expect(formatPlays(850)).toBe('850');
    expect(formatPlays(999)).toBe('999');
  });
  it('1k-10k → "X.Xk"', () => {
    expect(formatPlays(1000)).toBe('1.0k');
    expect(formatPlays(1234)).toBe('1.2k');
    expect(formatPlays(9940)).toBe('9.9k');
  });
  it('≥ 10k → "X.Xw"', () => {
    expect(formatPlays(10000)).toBe('1.0w');
    expect(formatPlays(9950)).toBe('1.0w');  // boundary: snaps to w-band
    expect(formatPlays(15234)).toBe('1.5w');
    expect(formatPlays(123456)).toBe('12.3w');
  });
});
