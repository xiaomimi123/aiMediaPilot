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

/**
 * 删除一份稿子。
 *
 * **先解引用再删**: `CockpitContent` / `PublishedWork` / `TopicIdea` 的
 * `scriptDraftId` 都是没有外键约束的裸字段, 直接删稿子会在它们身上留下指向不存在
 * 记录的 id —— 数据库不报错, 但校准会数出一条「稿子已删除」的假配对, 内容页会
 * 指向一个 404。留悬空 id 比删干净难查得多。
 *
 * `Distribution` 有 onDelete: Cascade, 会跟着一起没 —— 这一点在界面上会先告诉用户。
 *
 * 整段放进事务: 解引用解到一半失败而稿子还在, 会留下一堆莫名其妙断了链接的记录。
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { userId: true } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const [works, contents, ideas] = await Promise.all([
        tx.publishedWork.updateMany({ where: { scriptDraftId: id }, data: { scriptDraftId: null } }),
        tx.cockpitContent.updateMany({ where: { scriptDraftId: id }, data: { scriptDraftId: null } }),
        tx.topicIdea.updateMany({ where: { scriptDraftId: id }, data: { scriptDraftId: null } }),
      ]);
      await tx.scriptDraft.delete({ where: { id } });
      return { works: works.count, contents: contents.count, topicIdeas: ideas.count };
    });
    return ok({ deleted: true, unlinked: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[DELETE script]', e);
    return fail(`删除失败: ${msg}`, 500);
  }
}
