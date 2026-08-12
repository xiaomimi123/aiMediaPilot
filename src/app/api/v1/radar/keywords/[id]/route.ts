import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const STATUSES = ['active', 'candidate', 'ignored'] as const;
type KeywordStatus = (typeof STATUSES)[number];

/**
 * 状态机 (brief 明确): candidate 只能作为起点 (→ active | ignored)，
 * active/ignored 互相可逆 (⇄)，但都不能回到 candidate。
 */
const TRANSITIONS: Record<KeywordStatus, KeywordStatus[]> = {
  candidate: ['active', 'ignored'],
  active: ['ignored'],
  ignored: ['active'],
};

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const nextStatus = body.status;
  if (!STATUSES.includes(nextStatus as KeywordStatus)) return fail('status 不合法', 400);

  const user = await getOrCreateDefaultUser();
  const keyword = await prisma.radarKeyword.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true },
  });
  if (!keyword || keyword.userId !== user.id) return fail('关键词不存在', 404);

  const currentStatus = keyword.status as KeywordStatus;
  if (!TRANSITIONS[currentStatus]?.includes(nextStatus as KeywordStatus)) {
    return fail(`不允许从 ${currentStatus} 迁移到 ${nextStatus}`, 400);
  }

  await prisma.radarKeyword.update({ where: { id }, data: { status: nextStatus as string } });
  return ok({ id, status: nextStatus });
}
