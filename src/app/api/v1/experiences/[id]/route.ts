import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { validateExperienceKind } from '@/lib/persona/voice';

/**
 * 经历条目编辑/删除 (十二期 T3)。
 *
 * keywords 可人工编辑是刻意设计: AI 提取的检索词质量不稳, 而 keywords 直接决定
 * matchExperiences 的召回 —— 给用户留一个修正入口比堆检索算法便宜得多 (spec §6)。
 */
const PatchSchema = z.object({
  content: z.string().trim().min(1).max(500).optional(),
  topic: z.string().max(20).optional(),
  kind: z.unknown().optional(),
  keywords: z.array(z.string().min(1).max(12)).max(5).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return fail(`经历数据不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  const existing = await prisma.creatorExperience.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return fail('经历不存在', 404);

  const data: Record<string, unknown> = {};
  if (parsed.data.content !== undefined) data.content = parsed.data.content;
  if (parsed.data.topic !== undefined) data.topic = parsed.data.topic;
  if (parsed.data.kind !== undefined) data.kind = validateExperienceKind(parsed.data.kind);
  if (parsed.data.keywords !== undefined) data.keywords = parsed.data.keywords;
  if (Object.keys(data).length === 0) return fail('没有可更新的字段', 400);

  await prisma.creatorExperience.update({ where: { id: params.id }, data });
  return ok({ updated: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const existing = await prisma.creatorExperience.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return fail('经历不存在', 404);
  await prisma.creatorExperience.delete({ where: { id: params.id } });
  return ok({ deleted: true });
}
