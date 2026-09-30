import type { PrismaClient } from '@prisma/client';

/**
 * 回采作品入库。按 (platform, externalId) upsert —— 播放量会随时间涨,
 * 每晚回采要更新同一条, 否则一个月后库里是 30 份同一条作品的快照。
 */

export interface IncomingWork {
  externalId: string;
  title: string;
  caption: string;
  hashtags: string[];
  isPrivate: boolean;
  url: string;
  /** 秒级 unix 时间戳 */
  createTime: number;
  durationSec: number;
  play: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
}

export async function importWorks(
  prisma: PrismaClient,
  platform: string,
  works: IncomingWork[],
): Promise<ImportResult> {
  let created = 0;
  let updated = 0;
  for (const w of works) {
    const data = {
      title: w.title,
      caption: w.caption,
      hashtags: w.hashtags,
      isPrivate: w.isPrivate,
      url: w.url,
      publishedAt: new Date(w.createTime * 1000),
      durationSec: w.durationSec,
      play: w.play,
      digg: w.digg,
      comment: w.comment,
      collect: w.collect,
      share: w.share,
      fetchedAt: new Date(),
    };
    const existing = await prisma.publishedWork.findUnique({
      where: { platform_externalId: { platform, externalId: w.externalId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.publishedWork.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.publishedWork.create({ data: { ...data, platform, externalId: w.externalId } });
      created += 1;
    }
  }
  return { created, updated, total: created + updated };
}
