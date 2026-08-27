import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const m = await prisma.material.findUnique({ where: { id }, select: { userId: true } });
  if (!m || m.userId !== user.id) return fail('素材不存在', 404);
  await prisma.material.delete({ where: { id } });
  return ok({ deleted: true });
}
