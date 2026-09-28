import type { PrismaClient } from '@prisma/client';
import type { CollectStatus } from '@/lib/douyin/collect-log';

export interface AccountSummary {
  fans: number | null;
  fansDelta: number | null;
  works: number;
  publicWorks: number;
  /** 作品列表接口的播放数之和(与投稿分析口径不同) */
  totalPlay: number;
  /** 最近一条公开作品的发布时间 */
  lastPublishedAt: string | null;
  /** 近 90 天投稿分析; 窗口内没投稿时为 null(如实说明, 不显示一排 0) */
  recent90: { submissionCount: number; medianPlay: number; completionRate5s: number } | null;
  /** 有没有回采到过投稿分析; false 时不能说"没有投稿", 只能说"还没数据" */
  hasOverview: boolean;
  dataAt: string | null;
  collect: CollectStatus;
  /** 近 24 小时新判定的对标爆款数 */
  hits24h: number;
  scan: CollectStatus;
}

export async function buildAccountSummary(db: PrismaClient, collect: CollectStatus, scan: CollectStatus): Promise<AccountSummary> {
  const [fans, snapshot, works, publicWorks, agg, publicAgg, hits24h] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: 'fans' } }),
    db.douyinOverviewSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }),
    db.publishedWork.count(),
    db.publishedWork.count({ where: { isPrivate: false } }),
    db.publishedWork.aggregate({ _sum: { play: true } }),
    // 只看公开作品: 设成仅自己可见的作品不进抖音投稿分析, 混进来会和"近 90 天没有投稿"自相矛盾
    db.publishedWork.aggregate({ where: { isPrivate: false }, _max: { publishedAt: true } }),
    db.benchmarkVideo.count({ where: { hitAt: { gte: new Date(Date.now() - 86400_000) } } }),
  ]);
  return {
    fans: fans?.currentCount ?? null,
    fansDelta: fans?.lastPeriodIncr ?? null,
    works,
    publicWorks,
    totalPlay: agg._sum.play ?? 0,
    lastPublishedAt: publicAgg._max.publishedAt?.toISOString() ?? null,
    recent90:
      snapshot && snapshot.submissionCount > 0
        ? { submissionCount: snapshot.submissionCount, medianPlay: snapshot.medianPlay, completionRate5s: snapshot.completionRate5s }
        : null,
    hasOverview: snapshot !== null,
    dataAt: fans?.fetchedAt.toISOString() ?? null,
    collect,
    hits24h,
    scan,
  };
}
