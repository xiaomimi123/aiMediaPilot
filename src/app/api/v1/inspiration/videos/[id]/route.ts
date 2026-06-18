import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const v = await prisma.inspirationVideo.findUnique({ where: { id } });
  if (!v || v.userId !== user.id) return fail('视频不存在', 404);
  return ok({
    id: v.id,
    platform: v.platform,
    awemeId: v.awemeId,
    videoUrl: v.videoUrl,
    authorName: v.authorName,
    title: v.title,
    playCount: v.playCount?.toString() ?? null,
    likeCount: v.likeCount?.toString() ?? null,
    commentCount: v.commentCount?.toString() ?? null,
    shareCount: v.shareCount?.toString() ?? null,
    collectCount: v.collectCount?.toString() ?? null,
    duration: v.duration,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    thumbnailUrl: v.thumbnailUrl,
    userNote: v.userNote,
    fetchedAt: v.fetchedAt.toISOString(),
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { userNote?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }
  const note = typeof body.userNote === 'string' ? body.userNote.trim() : null;

  const user = await getOrCreateDefaultUser();
  const v = await prisma.inspirationVideo.findUnique({ where: { id }, select: { userId: true } });
  if (!v || v.userId !== user.id) return fail('视频不存在', 404);

  try {
    await prisma.inspirationVideo.update({
      where: { id },
      data: { userNote: note || null },
    });
    return ok({ updated: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const v = await prisma.inspirationVideo.findUnique({ where: { id }, select: { userId: true } });
  if (!v || v.userId !== user.id) return fail('视频不存在', 404);
  try {
    await prisma.inspirationVideo.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`删除失败: ${msg}`, 500);
  }
}
