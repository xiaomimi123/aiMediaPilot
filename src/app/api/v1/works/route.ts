import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { shouldCountByDefault } from '@/lib/works/model';

const WorkSchema = z.object({
  externalId: z.string().min(1).max(64),
  title: z.string().max(300).default(''),
  caption: z.string().max(4000).default(''),
  hashtags: z.array(z.string().max(60)).max(30).default([]),
  isPrivate: z.boolean().default(false),
  url: z.string().max(500).default(''),
  /** 秒级 unix 时间戳(抖音接口的 create_time) */
  createTime: z.number().int().positive(),
  durationSec: z.number().int().min(0).default(0),
  play: z.number().int().min(0).default(0),
  digg: z.number().int().min(0).default(0),
  comment: z.number().int().min(0).default(0),
  collect: z.number().int().min(0).default(0),
  share: z.number().int().min(0).default(0),
});

const ImportSchema = z.object({
  platform: z.string().max(20).default('douyin'),
  works: z.array(WorkSchema).min(1).max(500),
});

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const works = await prisma.publishedWork.findMany({
    where: { userId: user.id },
    orderBy: { publishedAt: 'desc' },
  });
  return ok({ works });
}

/**
 * 导入回采到的作品。
 *
 * **按 externalId upsert 而不是新增**: 播放量会随时间涨, 重复回采要更新同一条而不是
 * 堆出多份快照。已有记录的 `counted` 不覆盖 —— 那是用户的判断, 回采不该把它冲掉。
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsed = ImportSchema.safeParse(raw);
  if (!parsed.success) return fail(`作品数据不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const { platform, works } = parsed.data;

  let created = 0;
  let updated = 0;

  for (const w of works) {
    const publishedAt = new Date(w.createTime * 1000);
    const metrics = {
      title: w.title, caption: w.caption, hashtags: w.hashtags, isPrivate: w.isPrivate,
      url: w.url, publishedAt, durationSec: w.durationSec,
      play: w.play, digg: w.digg, comment: w.comment, collect: w.collect, share: w.share,
      fetchedAt: new Date(),
    };
    const existing = await prisma.publishedWork.findUnique({
      where: { userId_platform_externalId: { userId: user.id, platform, externalId: w.externalId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.publishedWork.update({ where: { id: existing.id }, data: metrics });
      updated += 1;
    } else {
      await prisma.publishedWork.create({
        data: {
          ...metrics,
          userId: user.id,
          platform,
          externalId: w.externalId,
          // 隐藏作品不进分析: 它们 0 播放不是内容问题, 混进来会把中位数拽到 0
          counted:
            !w.isPrivate &&
            shouldCountByDefault({ title: `${w.title} ${w.caption}`, play: w.play, publishedAt }),
        },
      });
      created += 1;
    }
  }

  return ok({ created, updated, total: created + updated });
}
