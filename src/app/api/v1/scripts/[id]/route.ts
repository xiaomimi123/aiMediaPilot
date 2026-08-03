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
    platform: draft.platform,
    output: draft.output,
    picked: draft.picked,
    createdAt: draft.createdAt.toISOString(),
    analysisId: draft.analysisId,
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { archived?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  if (typeof body.archived !== 'boolean') return fail('archived 必须是布尔值', 400);

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { userId: true } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  await prisma.scriptDraft.update({
    where: { id },
    data: { archivedAt: body.archived ? new Date() : null },
  });
  return ok({ id });
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
