import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 两件独立的事, 都是「改判」:
 * - counted: 这条算不算进赛道基线
 * - scriptDraftId: 这条是用哪份稿子发的(校准配对的唯一来源, 平台不返回这层关系)
 *
 * 都可选, 但至少要给一个 —— 空补丁静默返回 200 会让调用方以为改成功了。
 * scriptDraftId 传 null = 解除关联。
 */
const PatchSchema = z
  .object({
    counted: z.boolean().optional(),
    scriptDraftId: z.string().nullable().optional(),
  })
  .refine((v) => v.counted !== undefined || v.scriptDraftId !== undefined, {
    message: '至少要改一个字段',
  });

/** 改判一条作品算不算进基线。 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '补丁不合法', 400);

  const user = await getOrCreateDefaultUser();
  const w = await prisma.publishedWork.findUnique({ where: { id }, select: { userId: true } });
  if (!w || w.userId !== user.id) return fail('作品不存在', 404);

  // 关联的稿子必须是自己的 —— 不校验就等于给了一个跨用户读稿子的口子
  if (parsed.data.scriptDraftId) {
    const d = await prisma.scriptDraft.findUnique({
      where: { id: parsed.data.scriptDraftId },
      select: { userId: true },
    });
    if (!d || d.userId !== user.id) return fail('稿子不存在', 404);
  }

  const updated = await prisma.publishedWork.update({
    where: { id },
    data: {
      ...(parsed.data.counted !== undefined ? { counted: parsed.data.counted } : {}),
      ...(parsed.data.scriptDraftId !== undefined ? { scriptDraftId: parsed.data.scriptDraftId } : {}),
    },
  });
  return ok({ id: updated.id, counted: updated.counted, scriptDraftId: updated.scriptDraftId });
}
