import type { PrismaClient } from '@prisma/client';
import type { CollectStatus } from '@/lib/douyin/collect-log';

export interface AccountSummary {
  fans: number | null;
  fansDelta: number | null;
  works: number;
  publicWorks: number;
  /** 作品列表接口的播放数之和(与投稿分析口径不同) */
  totalPlay: number;
  lastPublishedAt: string | null;
  /** 近 90 天投稿分析; 窗口内没投稿时为 null(如实说明, 不显示一排 0) */
  recent90: { submissionCount: number; medianPlay: number; completionRate5s: number } | null;
  dataAt: string | null;
  collect: CollectStatus;
}

export async function buildAccountSummary(db: PrismaClient, collect: CollectStatus): Promise<AccountSummary> {
  const [fans, snapshot, works, publicWorks, agg] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: 'fans' } }),
    db.douyinOverviewSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }),
    db.publishedWork.count(),
    db.publishedWork.count({ where: { isPrivate: false } }),
    db.publishedWork.aggregate({ _sum: { play: true }, _max: { publishedAt: true } }),
  ]);
  return {
    fans: fans?.currentCount ?? null,
    fansDelta: fans?.lastPeriodIncr ?? null,
    works,
    publicWorks,
    totalPlay: agg._sum.play ?? 0,
    lastPublishedAt: agg._max.publishedAt?.toISOString() ?? null,
    recent90:
      snapshot && snapshot.submissionCount > 0
        ? { submissionCount: snapshot.submissionCount, medianPlay: snapshot.medianPlay, completionRate5s: snapshot.completionRate5s }
        : null,
    dataAt: fans?.fetchedAt.toISOString() ?? null,
    collect,
  };
}
