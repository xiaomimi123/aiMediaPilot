import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const t = await prisma.teardown.findUnique({ where: { id }, select: { userId: true } });
  if (!t || t.userId !== user.id) return fail('拆解不存在', 404);
  await prisma.teardown.delete({ where: { id } });
  return ok({ deleted: true });
}
