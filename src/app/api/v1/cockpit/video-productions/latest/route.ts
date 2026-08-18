import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 按 contentId 查最新一条成片生成记录 (十八期 T8) — 供前端打开"生成成片"面板时
 * 首次加载已有进度用。查不到返回 ok({data:null}) 而非 404: "还没生成过"是合法状态,
 * 不是错误。
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contentId = searchParams.get('contentId');
  if (!contentId) return fail('contentId 必填', 400);

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findFirst({
    where: { contentId, userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!vp) return ok(null);

  return ok({
    id: vp.id,
    status: vp.status,
    previewPath: vp.previewPath,
    masterPath: vp.masterPath,
    errorMessage: vp.errorMessage,
  });
}
