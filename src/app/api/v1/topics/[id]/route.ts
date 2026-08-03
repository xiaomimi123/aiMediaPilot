import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const STATUSES = ['POOL', 'ADOPTED', 'DISCARDED'] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { status?: unknown; scriptDraftId?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const data: { status?: string; scriptDraftId?: string; note?: string } = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as (typeof STATUSES)[number])) return fail('status 不合法', 400);
    data.status = body.status as string;
  }
  if (typeof body.scriptDraftId === 'string' && body.scriptDraftId) data.scriptDraftId = body.scriptDraftId;
  if (typeof body.note === 'string') data.note = body.note.trim();
  if (Object.keys(data).length === 0) return fail('无可更新字段', 400);

  const user = await getOrCreateDefaultUser();
  const idea = await prisma.topicIdea.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!idea || idea.userId !== user.id) return fail('选题不存在', 404);

  await prisma.topicIdea.update({ where: { id }, data });
  return ok({ id });
}
