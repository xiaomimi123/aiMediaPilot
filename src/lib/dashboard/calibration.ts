import type {
  AccuracyDistribution,
  AccuracyVerdict,
  CalibrationData,
  RetroReportLike,
} from './types';

const MIN_SAMPLES = 3;

const ACCURACY_VALUES: AccuracyVerdict[] = ['on-target', 'over-estimated', 'under-estimated', 'unknown'];

const DIM_LABELS: Record<string, string> = {
  hookGap: '钩子',
  retentionGap: '完播',
  titleCaptionGap: '标题/文案',
  coverGap: '封面',
};

function emptyDist(): AccuracyDistribution {
  return {
    onTarget: 0,
    overEstimated: 0,
    underEstimated: 0,
    unknown: 0,
    total: 0,
    worstBucket: null,
  };
}

function normalize(acc: string | undefined): AccuracyVerdict {
  if (acc && (ACCURACY_VALUES as string[]).includes(acc)) return acc as AccuracyVerdict;
  return 'unknown';
}

function addToDist(dist: AccuracyDistribution, verdict: AccuracyVerdict): void {
  switch (verdict) {
    case 'on-target': dist.onTarget++; break;
    case 'over-estimated': dist.overEstimated++; break;
    case 'under-estimated': dist.underEstimated++; break;
    case 'unknown': dist.unknown++; break;
  }
  dist.total++;
}

function finalizeWorstBucket(dist: AccuracyDistribution): void {
  const buckets: Array<{ key: AccuracyVerdict; count: number }> = [
    { key: 'over-estimated', count: dist.overEstimated },
    { key: 'under-estimated', count: dist.underEstimated },
  ];
  buckets.sort((a, b) => b.count - a.count);
  dist.worstBucket = buckets[0].count > 0 ? buckets[0].key : null;
}

export function computeCalibration(reports: RetroReportLike[]): CalibrationData | null {
  if (reports.length < MIN_SAMPLES) return null;

  const matrix = {
    hookGap: emptyDist(),
    retentionGap: emptyDist(),
    titleCaptionGap: emptyDist(),
    coverGap: emptyDist(),
  };

  for (const r of reports) {
    addToDist(matrix.hookGap, normalize(r.hookGap?.accuracy));
    addToDist(matrix.retentionGap, normalize(r.retentionGap?.accuracy));
    addToDist(matrix.titleCaptionGap, normalize(r.titleCaptionGap?.accuracy));
    addToDist(matrix.coverGap, normalize(r.coverGap?.accuracy));
  }

  for (const dim of Object.values(matrix)) {
    finalizeWorstBucket(dim);
  }

  return {
    sampleCount: reports.length,
    matrix,
    insight: generateInsight(matrix),
  };
}

export function generateInsight(matrix: CalibrationData['matrix']): string {
  type DimKey = keyof typeof matrix;

  const totals = (Object.values(matrix) as AccuracyDistribution[]);
  const totalSamples = totals.reduce((sum, d) => sum + d.total, 0);
  const totalUnknown = totals.reduce((sum, d) => sum + d.unknown, 0);
  if (totalSamples > 0 && totalUnknown / totalSamples > 0.6) {
    return '多数维度准确率未知, 数据积累后将显示校准趋势。';
  }

  const overRanking = (Object.entries(matrix) as Array<[DimKey, AccuracyDistribution]>)
    .map(([dim, dist]) => ({ dim, pct: dist.total > 0 ? dist.overEstimated / dist.total : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const worst = overRanking[0];
  if (worst.pct >= 0.4) {
    return `你的"${DIM_LABELS[worst.dim]}"预测系统性偏乐观 (${Math.round(worst.pct * 100)}% 实际表现低于预期), 后续可调低评分基线。`;
  }

  const underRanking = (Object.entries(matrix) as Array<[DimKey, AccuracyDistribution]>)
    .map(([dim, dist]) => ({ dim, pct: dist.total > 0 ? dist.underEstimated / dist.total : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const best = underRanking[0];
  if (best.pct >= 0.4) {
    return `你的"${DIM_LABELS[best.dim]}"预测系统性偏保守 (${Math.round(best.pct * 100)}% 实际优于预期), 可放心提升评分自信。`;
  }

  return '各维度预测整体校准良好, 继续保持。';
}
