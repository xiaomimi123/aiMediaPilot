import type { PrismaClient } from '@prisma/client';
import { PROFILE_METRICS } from '@/lib/douyin/profile';

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 每晚回采后记一条; 同一天再跑覆盖, 但读不到的数不把已有值覆盖成空 */
export async function recordDailySnapshot(db: PrismaClient, now: Date): Promise<{ day: string }> {
  const day = dayKey(now);
  const [fans, likes, agg] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.followers } }),
    db.douyinMetricSummary.findUnique({ where: { metric: PROFILE_METRICS.totalLikes } }),
    db.publishedWork.aggregate({ where: { isPrivate: false }, _count: { _all: true }, _sum: { play: true } }),
  ]);
  const data = {
    ...(fans ? { fans: fans.currentCount } : {}),
    ...(likes ? { likes: likes.currentCount } : {}),
    works: agg._count._all,
    views: agg._sum.play ?? 0,
  };
  await db.accountDailySnapshot.upsert({ where: { day }, create: { day, ...data }, update: data });
  return { day };
}

export async function loadTrend(db: PrismaClient, days: number, now: Date) {
  const since = dayKey(new Date(now.getTime() - (days - 1) * 86400_000));
  const rows = await db.accountDailySnapshot.findMany({ where: { day: { gte: since } }, orderBy: { day: 'asc' } });
  return rows.map((r) => ({ day: r.day, fans: r.fans, likes: r.likes, views: r.views }));
}

export const snapshotDays = (db: PrismaClient) => db.accountDailySnapshot.count();
