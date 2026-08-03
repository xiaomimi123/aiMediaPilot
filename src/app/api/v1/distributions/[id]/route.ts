import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const dist = await prisma.distribution.findUnique({
    where: { id },
    select: { id: true, scriptDraft: { select: { userId: true } } },
  });
  if (!dist || dist.scriptDraft.userId !== user.id) return fail('分发记录不存在', 404);

  await prisma.distribution.delete({ where: { id } });
  return ok({ id });
}
