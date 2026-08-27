import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const h = await prisma.hook.findUnique({ where: { id }, select: { userId: true } });
  if (!h || h.userId !== user.id) return fail('钩子不存在', 404);
  await prisma.hook.delete({ where: { id } });
  return ok({ deleted: true });
}
