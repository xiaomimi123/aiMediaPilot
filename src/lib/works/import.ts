import type { PrismaClient } from '@prisma/client';
import { shouldCountByDefault } from './model';

/**
 * 回采作品的入库逻辑。
 *
 * 抽成共享模块是因为有两个消费方: `POST /api/v1/works`(手工导入)与
 * `scripts/collect-douyin.ts`(每晚定时回采)。各写一份必然漂移 —— 而这段逻辑里
 * 有两条不能错的规则。
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

/**
 * 按 externalId upsert。两条规则:
 *
 * 1. **更新而不是新增** —— 播放量会随时间涨, 每晚回采要更新同一条, 否则一个月后
 *    库里是 30 份同一条作品的快照。
 * 2. **不覆盖 counted** —— 那是用户的判断(这条算不算 AI 类), 回采不该把它冲掉。
 *    只有新建时才用 shouldCountByDefault 给默认值。
 */
export async function importWorks(
  prisma: PrismaClient,
  userId: string,
  platform: string,
  works: IncomingWork[],
): Promise<ImportResult> {
  let created = 0;
  let updated = 0;

  for (const w of works) {
    const publishedAt = new Date(w.createTime * 1000);
    const metrics = {
      title: w.title,
      caption: w.caption,
      hashtags: w.hashtags,
      isPrivate: w.isPrivate,
      url: w.url,
      publishedAt,
      durationSec: w.durationSec,
      play: w.play,
      digg: w.digg,
      comment: w.comment,
      collect: w.collect,
      share: w.share,
      fetchedAt: new Date(),
    };

    const existing = await prisma.publishedWork.findUnique({
      where: { userId_platform_externalId: { userId, platform, externalId: w.externalId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.publishedWork.update({ where: { id: existing.id }, data: metrics });
      updated += 1;
    } else {
      await prisma.publishedWork.create({
        data: {
          ...metrics,
          userId,
          platform,
          externalId: w.externalId,
          // 隐藏作品不进分析: 它们 0 播放不是内容问题
          counted:
            !w.isPrivate &&
            shouldCountByDefault({ title: `${w.title} ${w.caption}`, play: w.play, publishedAt }),
        },
      });
      created += 1;
    }
  }

  return { created, updated, total: created + updated };
}
