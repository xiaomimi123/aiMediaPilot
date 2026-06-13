import { describe, expect, it } from 'vitest';
import { computeCalibration, generateInsight } from '@/lib/dashboard/calibration';
import type { RetroReportLike } from '@/lib/dashboard/types';

describe('computeCalibration', () => {
  it('< 3 样本返回 null', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    expect(computeCalibration(reports)).toBeNull();
  });

  it('3+ 样本: 算 4 维度 distribution + worstBucket', () => {
    const reports: RetroReportLike[] = [
      {
        hookGap: { accuracy: 'on-target' },
        retentionGap: { accuracy: 'over-estimated' },
        titleCaptionGap: { accuracy: 'on-target' },
        coverGap: { accuracy: 'unknown' },
      },
      {
        hookGap: { accuracy: 'on-target' },
        retentionGap: { accuracy: 'over-estimated' },
        titleCaptionGap: { accuracy: 'under-estimated' },
        coverGap: { accuracy: 'on-target' },
      },
      {
        hookGap: { accuracy: 'under-estimated' },
        retentionGap: { accuracy: 'on-target' },
        titleCaptionGap: { accuracy: 'on-target' },
        coverGap: { accuracy: 'on-target' },
      },
    ];
    const result = computeCalibration(reports);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(3);
    expect(result!.matrix.hookGap.onTarget).toBe(2);
    expect(result!.matrix.hookGap.underEstimated).toBe(1);
    expect(result!.matrix.hookGap.worstBucket).toBe('under-estimated');
    expect(result!.matrix.retentionGap.overEstimated).toBe(2);
    expect(result!.matrix.retentionGap.worstBucket).toBe('over-estimated');
  });

  it('缺字段算 unknown', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    const result = computeCalibration(reports);
    expect(result!.matrix.retentionGap.unknown).toBe(3);
    expect(result!.matrix.retentionGap.total).toBe(3);
  });

  it('worstBucket=null 当全部 on-target', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    const result = computeCalibration(reports);
    expect(result!.matrix.hookGap.worstBucket).toBeNull();
  });

  it('空数组返回 null', () => {
    expect(computeCalibration([])).toBeNull();
  });
});

describe('generateInsight', () => {
  const mkDist = (over: number, under: number, on: number, unk: number) => ({
    onTarget: on,
    overEstimated: over,
    underEstimated: under,
    unknown: unk,
    total: over + under + on + unk,
    worstBucket: null,
  });

  it('over-estimated >= 40% 触发"系统性偏乐观"', () => {
    const matrix = {
      hookGap: mkDist(0, 0, 5, 0),
      retentionGap: mkDist(3, 0, 2, 0),  // 60% over
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    const msg = generateInsight(matrix);
    expect(msg).toMatch(/完播.*偏乐观/);
  });

  it('under-estimated >= 40% 触发"系统性偏保守"', () => {
    const matrix = {
      hookGap: mkDist(0, 4, 1, 0),  // 80% under
      retentionGap: mkDist(0, 0, 5, 0),
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    const msg = generateInsight(matrix);
    expect(msg).toMatch(/钩子.*偏保守/);
  });

  it('全 on-target → 整体校准良好', () => {
    const matrix = {
      hookGap: mkDist(0, 0, 5, 0),
      retentionGap: mkDist(0, 0, 5, 0),
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    expect(generateInsight(matrix)).toMatch(/良好|整体校准/);
  });

  it('两者同时 >= 40%, over-estimated 优先', () => {
    const matrix = {
      hookGap: mkDist(0, 4, 1, 0),        // 80% under
      retentionGap: mkDist(3, 0, 2, 0),   // 60% over
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    const msg = generateInsight(matrix);
    expect(msg).toMatch(/完播.*偏乐观/);
  });

  it('多数 unknown → 提示数据未知', () => {
    const matrix = {
      hookGap: mkDist(0, 0, 0, 5),
      retentionGap: mkDist(0, 0, 0, 5),
      titleCaptionGap: mkDist(0, 0, 0, 5),
      coverGap: mkDist(0, 0, 0, 5),
    };
    expect(generateInsight(matrix)).toMatch(/未知|数据积累/);
  });
});
