import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { MATERIAL_KINDS } from '@/lib/materials/model';

const CreateSchema = z.object({
  kind: z.enum(MATERIAL_KINDS),
  content: z.string().min(2).max(4000),
  source: z.string().max(300).default(''),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
});

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const materials = await prisma.material.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return ok({ materials });
}

/**
 * 记一条素材。
 *
 * source 不强制填, 但**数据类和书摘类没有出处基本等于不能用** —— 这一点在界面上
 * 说清楚就够了, 不做成硬校验: 随手记的时候被拦住, 人就干脆不记了, 那才是真的损失。
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) return fail(`素材不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const material = await prisma.material.create({
    data: { ...parsed.data, userId: user.id },
  });
  return ok({ material });
}
