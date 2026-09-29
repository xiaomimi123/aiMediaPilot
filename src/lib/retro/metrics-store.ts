import type { PrismaClient } from '@prisma/client';
import type { WorkMetricRow } from './work-list';

export const SNAPSHOT_DAYS = 30;

export function localDay(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/** 写最新指标到作品表; 发布 30 天内的公开作品另记当天快照(同一天覆盖) */
export async function saveWorkMetrics(db: PrismaClient, rows: WorkMetricRow[], now: Date): Promise<{ updated: number; snapshots: number }> {
  const works = await db.publishedWork.findMany({
    where: { platform: 'douyin', externalId: { in: rows.map((r) => r.awemeId) } },
    select: { id: true, externalId: true, isPrivate: true, publishedAt: true },
  });
  const byExt = new Map(works.map((w) => [w.externalId, w]));
  const day = localDay(now);
  let updated = 0;
  let snapshots = 0;
  for (const r of rows) {
    const w = byExt.get(r.awemeId);
    if (!w) continue; // 还没被作品列表回采到的, 等下一晚
    const m = r.metrics;
    await db.publishedWork.update({
      where: { id: w.id },
      data: {
        viewCount: m.viewCount,
        likeCount: m.likeCount,
        commentCount: m.commentCount,
        shareCount: m.shareCount,
        favoriteCount: m.favoriteCount,
        subscribeCount: m.subscribeCount,
        homepageVisitCount: m.homepageVisitCount,
        completionRate: m.completionRate,
        completionRate5sWl: m.completionRate5s,
        bounceRate2sWl: m.bounceRate2s,
        avgViewSec: m.avgViewSec,
        avgViewProportion: m.avgViewProportion,
        fanViewProportion: m.fanViewProportion,
        metricsUpdatedAt: m.metricsUpdatedAt,
      },
    });
    updated++;
    const ageDays = (now.getTime() - w.publishedAt.getTime()) / 86400_000;
    if (w.isPrivate || ageDays > SNAPSHOT_DAYS) continue;
    const snap = {
      viewCount: m.viewCount,
      likeCount: m.likeCount,
      commentCount: m.commentCount,
      shareCount: m.shareCount,
      favoriteCount: m.favoriteCount,
      subscribeCount: m.subscribeCount,
      completionRate: m.completionRate,
      completionRate5s: m.completionRate5s,
      bounceRate2s: m.bounceRate2s,
      avgViewSec: m.avgViewSec,
      avgViewProportion: m.avgViewProportion,
      metricsUpdatedAt: m.metricsUpdatedAt,
    };
    await db.workMetricSnapshot.upsert({
      where: { workId_day: { workId: w.id, day } },
      update: { ...snap, takenAt: now },
      create: { workId: w.id, day, ...snap, takenAt: now },
    });
    snapshots++;
  }
  return { updated, snapshots };
}
