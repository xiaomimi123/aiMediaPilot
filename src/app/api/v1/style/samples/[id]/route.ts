import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const sample = await prisma.styleSample.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!sample || sample.userId !== user.id) return fail('风格样本不存在', 404);

  await prisma.styleSample.delete({ where: { id } });
  return ok({ id });
}
