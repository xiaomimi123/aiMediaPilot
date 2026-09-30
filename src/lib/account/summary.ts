import type { PrismaClient } from '@prisma/client';
import type { CollectStatus } from '@/lib/douyin/collect-log';
import { PROFILE_METRICS } from '@/lib/douyin/profile';

export interface AccountSummary {
  /** 粉丝数(「我的资料」口径, 与主页一致) */
  fans: number | null;
  /** 与上次回采相比 */
  fansDelta: number | null;
  /** 获赞(主页显示的口径) */
  likes: number | null;
  /** 只算公开作品; 仅自己可见的不显示 */
  publicWorks: number;
  /** 公开作品的播放合计(作品列表接口口径) */
  publicPlay: number;
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
  const [fans, likes, snapshot, publicWorks, publicAgg, hits24h] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.followers } }),
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.totalLikes } }),
    db.douyinOverviewSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }),
    db.publishedWork.count({ where: { isPrivate: false } }),
    // 只看公开作品: 仅自己可见的不展示, 也不进抖音投稿分析(混进来会和"近 90 天没有投稿"自相矛盾)
    db.publishedWork.aggregate({ where: { isPrivate: false }, _sum: { play: true }, _max: { publishedAt: true } }),
    db.benchmarkVideo.count({ where: { hitAt: { gte: new Date(Date.now() - 86400_000) } } }),
  ]);
  return {
    fans: fans?.currentCount ?? null,
    fansDelta: fans?.lastPeriodIncr ?? null,
    likes: likes?.currentCount ?? null,
    publicWorks,
    publicPlay: publicAgg._sum.play ?? 0,
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
