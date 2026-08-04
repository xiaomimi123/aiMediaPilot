import { prisma } from '@/lib/prisma';
import { readPredictedPlaysRange } from '../json-readers';
import type { CockpitExtras } from './extras-types';

/**
 * L1 预测对比: 遍历用户所有关联了 analysisId 的 CockpitContent, 从对应
 * ContentAnalysis.report 里读预测区间 (predictedPlaysRange), 从最新一条
 * ActualMetric (按 snapshotAt 倒序取第一条) 读实际播放量。
 *
 * 缺省语义 (均不抛错, 直接跳过该条目):
 *  - 无 analysisId → 不出现在 predictions 里 (已被 where 条件过滤)
 *  - report 里没有合法 predictedPlaysRange → 跳过
 *  - 有区间但没有 ActualMetric → actualPlays: null (仍然出现, 因为预测本身有意义)
 *
 * 查询形状: 一次 findMany 拿到有 analysisId 的 content, 一次 findMany 批量拿
 * 对应 analysis + 其最新 metric, 避免逐条查询的 N+1。
 */
export async function loadExtras(userId: string): Promise<CockpitExtras> {
  const contents = await prisma.cockpitContent.findMany({
    where: { userId, analysisId: { not: null } },
    select: { id: true, analysisId: true },
  });
  if (contents.length === 0) return { predictions: {} };

  const analysisIds = contents
    .map((c) => c.analysisId)
    .filter((id): id is string => Boolean(id));

  const analyses = await prisma.contentAnalysis.findMany({
    where: { id: { in: analysisIds } },
    select: {
      id: true,
      report: true,
      actualMetrics: {
        orderBy: { snapshotAt: 'desc' },
        take: 1,
        select: { plays: true },
      },
    },
  });
  const byAnalysisId = new Map(analyses.map((a) => [a.id, a]));

  const predictions: CockpitExtras['predictions'] = {};
  for (const content of contents) {
    if (!content.analysisId) continue;
    const analysis = byAnalysisId.get(content.analysisId);
    if (!analysis) continue;
    const range = readPredictedPlaysRange(analysis.report);
    if (!range) continue;
    const latest = analysis.actualMetrics[0];
    predictions[content.id] = {
      ...range,
      actualPlays: latest ? Number(latest.plays) : null,
    };
  }
  return { predictions };
}
