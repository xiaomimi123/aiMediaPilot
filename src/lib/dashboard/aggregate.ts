import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { KNOWN_NICHES } from '@/lib/llm/prompts';
import { computeCalibration } from './calibration';
import { verdictOf, deltaPct } from './prediction-accuracy';
import {
  readOverallScore,
  readOverallScoreWithMeta,
  readPredictedPlaysRange,
  readRetroReport,
} from '@/lib/json-readers';
import type {
  DashboardSummary,
  RetroReportLike,
  TrendPoint,
  NicheRow,
  TopPerformer,
  BiggestMiss,
  PredictionAccuracyEntry,
  PredictionAccuracySummary,
} from './types';

const TREND_LIMIT = 10;
const TOP_LIMIT = 3;
// predictionAccuracy 只算最近 200 条 — 后面 recent[] 只 slice(0,5),
// 全量拉取的成本会随分析总数无上限增长
const PREDICTION_ACCURACY_LIMIT = 200;

const nicheLabelMap = new Map(KNOWN_NICHES.map((n) => [n.key, n.label]));

function labelForNiche(niche: string): string {
  return nicheLabelMap.get(niche) ?? niche;
}

export async function aggregateDashboard(userId: string): Promise<DashboardSummary> {
  const last7dCutoff = new Date(Date.now() - 7 * 86400_000);

  const [
    totalAnalyses,
    last7dCount,
    retroedCount,
    trendRows,
    retroSourceRows,
    nicheRows,
    topPerformerRows,
    missCandidateRows,
    predictionAccuracyRows,
  ] = await Promise.all([
    prisma.contentAnalysis.count({ where: { userId } }),
    prisma.contentAnalysis.count({ where: { userId, createdAt: { gte: last7dCutoff } } }),
    prisma.contentAnalysis.count({ where: { userId, retroStatus: 'COMPLETED' } }),
    prisma.contentAnalysis.findMany({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: TREND_LIMIT,
      select: {
        id: true,
        videoFilename: true,
        completedAt: true,
        report: true,
        retroReport: true,
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, retroStatus: 'COMPLETED' },
      select: { retroReport: true },
    }),
    // 单次 GROUP BY 拿 niche + count + avgScore, 替原来的 groupBy + 每 niche 一次 $queryRaw AVG (N+1)
    // AVG 只统计 4 维全通过的分数 (partial IS NOT TRUE), 避免 partial 拉低 / 拉高 niche 均值。
    // COUNT(*) 仍算全部, 保留活跃度信号。
    prisma.$queryRaw<{ niche: string; count: number; avg: number | null }[]>`
      SELECT "niche",
             COUNT(*)::int AS count,
             AVG(("report"->>'overallScore')::float)
               FILTER (WHERE ("report"->>'partial')::boolean IS NOT TRUE)
               ::float AS avg
      FROM "ContentAnalysis"
      WHERE "userId" = ${userId} AND "status" = 'COMPLETED'
      GROUP BY "niche"
    `,
    prisma.actualMetric.findMany({
      where: { analysis: { userId } },
      orderBy: { plays: 'desc' },
      take: TOP_LIMIT,
      select: {
        plays: true,
        analysis: {
          select: { id: true, videoFilename: true, report: true },
        },
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, retroStatus: 'COMPLETED', retroReport: { not: Prisma.JsonNull } },
      select: { id: true, videoFilename: true, retroReport: true },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: PREDICTION_ACCURACY_LIMIT,
      select: {
        id: true,
        videoFilename: true,
        completedAt: true,
        report: true,
        actualMetrics: {
          select: { plays: true },
          orderBy: { snapshotAt: 'desc' },
          take: 1,
        },
      },
    }),
  ]);

  const spendRaw = await prisma.$queryRaw<{ total: number | null }[]>`
    SELECT COALESCE(SUM(("llmUsage"->'total'->>'estCostUSD')::float), 0)::float AS total
    FROM "ContentAnalysis" WHERE "userId" = ${userId}
  `;
  const totalSpendUSD = spendRaw[0]?.total ?? 0;

  // workflow queue: actionable counts shown at top of Dashboard
  const [unpublishedAnalyses, awaitingRetro, savedScripts] = await Promise.all([
    prisma.contentAnalysis.count({
      where: { userId, status: 'COMPLETED', douyinAwemeId: null },
    }),
    prisma.contentAnalysis.count({
      where: {
        userId,
        douyinAwemeId: { not: null },
        OR: [{ retroStatus: null }, { retroStatus: { in: ['SCHEDULED', 'FAILED'] } }],
      },
    }),
    prisma.scriptDraft.count({ where: { userId, analysisId: null } }),
  ]);

  // completedAt is always set when status='COMPLETED' (set by content-analyze-worker)
  // trend 允许 partial (让用户能看到 "在拍" 的进度), 但要标出来
  const trend: TrendPoint[] = trendRows
    .map((r) => {
      const meta = readOverallScoreWithMeta(r.report);
      return {
        id: r.id,
        videoFilename: r.videoFilename,
        completedAt: r.completedAt!.toISOString(),
        overallScore: meta?.score ?? null,
        inferredActualScore: readRetroReport(r.retroReport)?.inferredActualScore ?? null,
        partial: meta?.partial ?? false,
      };
    })
    .reverse();

  const retroReports: RetroReportLike[] = (retroSourceRows as any[])
    .map((r: any) => r.retroReport as RetroReportLike | null)
    .filter((r: RetroReportLike | null): r is RetroReportLike => r !== null);
  const calibration = computeCalibration(retroReports);

  const nicheDistribution: NicheRow[] = nicheRows
    .map((row) => ({
      niche: row.niche,
      label: labelForNiche(row.niche),
      count: Number(row.count),
      avgOverallScore: row.avg ?? null,
    }))
    .sort((a, b) => b.count - a.count);

  const topPerformers: TopPerformer[] = topPerformerRows.map((r) => ({
    id: r.analysis.id,
    videoFilename: r.analysis.videoFilename,
    plays: r.plays.toString(),
    overallScore: readOverallScore(r.analysis.report),
  }));

  const missesAll: BiggestMiss[] = missCandidateRows
    .map((r) => {
      const rr = readRetroReport(r.retroReport);
      const predicted = rr?.predictedOverallScore;
      const inferred = rr?.inferredActualScore;
      if (typeof predicted !== 'number' || typeof inferred !== 'number') return null;
      return {
        id: r.id,
        videoFilename: r.videoFilename,
        predicted,
        inferred,
        gap: predicted - inferred,
      };
    })
    .filter((m): m is BiggestMiss => m !== null && m.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP_LIMIT);

  // ---- predictionAccuracy: JOIN report.predictedPlaysRange × ActualMetric.plays ----
  const predictionAccuracyEntries: PredictionAccuracyEntry[] = predictionAccuracyRows
    .map((r) => {
      const range = readPredictedPlaysRange(r.report);
      const metric = r.actualMetrics[0];
      if (!range || !metric) return null;
      const actual = Number(metric.plays);
      return {
        id: r.id,
        videoFilename: r.videoFilename,
        // completedAt is always set when status='COMPLETED' (set by content-analyze-worker)
        completedAt: r.completedAt!.toISOString(),
        predicted: range.predicted,
        lower: range.lower,
        upper: range.upper,
        actual,
        verdict: verdictOf(actual, range),
        deltaPct: deltaPct(actual, range.predicted),
      };
    })
    .filter((e): e is PredictionAccuracyEntry => e !== null);

  const predictionAccuracy: PredictionAccuracySummary | null =
    predictionAccuracyEntries.length === 0
      ? null
      : {
          totalSamples: predictionAccuracyEntries.length,
          inRangeCount: predictionAccuracyEntries.filter((e) => e.verdict === 'in-range').length,
          overCount: predictionAccuracyEntries.filter((e) => e.verdict === 'over').length,
          underCount: predictionAccuracyEntries.filter((e) => e.verdict === 'under').length,
          recent: [...predictionAccuracyEntries]
            .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
            .slice(0, 5),
        };

  return {
    stats: {
      totalAnalyses,
      totalSpendUSD,
      last7dCount,
      retroedCount,
    },
    trend,
    calibration,
    nicheDistribution,
    topPerformers,
    biggestMisses: missesAll,
    predictionAccuracy,
    workflowQueue: {
      unpublishedAnalyses,
      awaitingRetro,
      savedScripts,
    },
  };
}
