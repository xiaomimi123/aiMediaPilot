import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  return ok({
    id: draft.id,
    topic: draft.topic,
    niche: draft.niche,
    output: draft.output,
    createdAt: draft.createdAt.toISOString(),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { userId: true } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  try {
    await prisma.scriptDraft.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`删除失败: ${msg}`, 500);
  }
}
