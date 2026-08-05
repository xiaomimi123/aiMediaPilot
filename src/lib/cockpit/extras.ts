import { prisma } from '@/lib/prisma';
import { readPredictedPlaysRange } from '../json-readers';
import { computeRetroStats } from '@/lib/settings/baseline-stats';
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
async function loadPredictions(userId: string): Promise<CockpitExtras['predictions']> {
  const contents = await prisma.cockpitContent.findMany({
    where: { userId, analysisId: { not: null } },
    select: { id: true, analysisId: true },
  });
  if (contents.length === 0) return {};

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
  return predictions;
}

/**
 * 账号状态条 (goals 视图) 用: 用户绑定的第一个 active 平台账号
 * (findFirst + orderBy createdAt asc, 与既有"取主账号"约定一致), 无绑定 → null。
 * lastAutoSyncAt 挂在 User 上 (全局一次自动同步的时间, 不区分账号), 拼进同一个对象
 * 方便前端一次性展示, 但只在确实有绑定账号时才返回非 null——未绑定时状态条只需
 * "未绑定" 文案, 不需要展示自动同步时间。
 */
async function loadAccount(userId: string): Promise<CockpitExtras['account']> {
  const account = await prisma.platformAccount.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { nickname: true, loginStatus: true, followerCount: true, lastSyncAt: true },
  });
  if (!account) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastAutoSyncAt: true },
  });

  return {
    nickname: account.nickname,
    loginStatus: account.loginStatus,
    followerCount: account.followerCount,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
    lastAutoSyncAt: user?.lastAutoSyncAt ? user.lastAutoSyncAt.toISOString() : null,
  };
}

/** 设置视图「内容基准」卡: baseline 当前值 (BigInt → string) + retro median 提示。 */
async function loadSettings(userId: string): Promise<CockpitExtras['settings']> {
  const [user, metrics] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { baselinePlays: true } }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId } },
      select: { plays: true },
    }),
  ]);
  const { retroMedian, retroCount } = computeRetroStats(metrics.map((m) => Number(m.plays)));
  return {
    baselinePlays: user?.baselinePlays?.toString() ?? null,
    retroMedian,
    retroCount,
  };
}

export async function loadExtras(userId: string): Promise<CockpitExtras> {
  const [predictions, account, settings] = await Promise.all([
    loadPredictions(userId),
    loadAccount(userId),
    loadSettings(userId),
  ]);
  return { predictions, account, settings };
}
