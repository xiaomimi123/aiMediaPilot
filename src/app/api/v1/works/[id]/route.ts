import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const PatchSchema = z.object({ counted: z.boolean() });

/** 改判一条作品算不算进基线。 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return fail('counted 必须是布尔值', 400);

  const user = await getOrCreateDefaultUser();
  const w = await prisma.publishedWork.findUnique({ where: { id }, select: { userId: true } });
  if (!w || w.userId !== user.id) return fail('作品不存在', 404);

  const updated = await prisma.publishedWork.update({
    where: { id },
    data: { counted: parsed.data.counted },
  });
  return ok({ id: updated.id, counted: updated.counted });
}
