export type AccuracyVerdict = 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown';

export interface AccuracyDistribution {
  onTarget: number;
  overEstimated: number;
  underEstimated: number;
  unknown: number;
  total: number;
  worstBucket: AccuracyVerdict | null;
}

export interface CalibrationData {
  sampleCount: number;
  matrix: {
    hookGap: AccuracyDistribution;
    retentionGap: AccuracyDistribution;
    titleCaptionGap: AccuracyDistribution;
    coverGap: AccuracyDistribution;
  };
  insight: string;
}

export interface TrendPoint {
  id: string;
  videoFilename: string;
  completedAt: string;
  overallScore: number | null;
  inferredActualScore: number | null;
  // 部分维度未完成时 (worker P3-18 兜底), 打点仍显示但前端可以打星号 / 变浅色区分
  partial: boolean;
}

export interface NicheRow {
  niche: string;
  label: string;
  count: number;
  avgOverallScore: number | null;
}

export interface TopPerformer {
  id: string;
  videoFilename: string;
  plays: string;  // BigInt serialized
  overallScore: number | null;
}

export interface BiggestMiss {
  id: string;
  videoFilename: string;
  predicted: number;
  inferred: number;
  gap: number;  // predicted - inferred
}

export interface DashboardSummary {
  stats: {
    totalAnalyses: number;
    totalSpendUSD: number;
    last7dCount: number;
    retroedCount: number;
  };
  trend: TrendPoint[];
  calibration: CalibrationData | null;
  nicheDistribution: NicheRow[];
  topPerformers: TopPerformer[];
  biggestMisses: BiggestMiss[];
  predictionAccuracy: PredictionAccuracySummary | null;
  workflowQueue: WorkflowQueue;
}

export interface WorkflowQueue {
  unpublishedAnalyses: number;
  awaitingRetro: number;
  savedScripts: number;
}

export type PredictionVerdict = 'in-range' | 'over' | 'under';

export interface PredictionAccuracyEntry {
  id: string;
  videoFilename: string;
  completedAt: string;
  predicted: number;
  lower: number;
  upper: number;
  actual: number;
  verdict: PredictionVerdict;
  deltaPct: number;
}

export interface PredictionAccuracySummary {
  totalSamples: number;
  inRangeCount: number;
  overCount: number;
  underCount: number;
  recent: PredictionAccuracyEntry[];
}

/**
 * retroReport JSONB shape — 跟 RetroGapResponse 一致, 这里精简到 calibration 关心的字段
 */
export interface RetroReportLike {
  hookGap?: { accuracy?: string };
  retentionGap?: { accuracy?: string };
  titleCaptionGap?: { accuracy?: string };
  coverGap?: { accuracy?: string };
  predictedOverallScore?: number | null;
  inferredActualScore?: number | null;
}
