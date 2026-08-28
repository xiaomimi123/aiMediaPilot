import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { importWorks } from '@/lib/works/import';

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

/** 导入回采到的作品。入库规则见 lib/works/import.ts。 */
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
  const result = await importWorks(prisma, user.id, parsed.data.platform, parsed.data.works);
  return ok(result);
}
