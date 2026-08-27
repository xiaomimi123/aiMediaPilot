import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 按 contentId 查最新一条成片生成记录 (十八期 T8) — 供前端打开"生成成片"面板时
 * 首次加载已有进度用。查不到返回 ok({data:null}) 而非 404: "还没生成过"是合法状态,
 * 不是错误。
 */
/** 只认这三个合法交付方式, 其它一律忽略 —— 不把用户传的字符串直接当查询条件。 */
const MODES = ['ppt-narration', 'talking-head-broll', 'illustration-tts'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const contentId = searchParams.get('contentId');
  if (!contentId) return fail('contentId 必填', 400);

  // 二十二期修复: 可选 mode 过滤。内容的 deliveryMode 改过之后, 最新一条记录可能
  // 还是旧模式的 —— 上传出镜视频时复用它, upload-source 会直接 400
  // (「只有真人出镜模式需要上传视频」)。调用方带上当前模式, 查不到就去新建一条。
  const rawMode = searchParams.get('mode');
  const mode = rawMode && MODES.includes(rawMode) ? rawMode : undefined;

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findFirst({
    where: { contentId, userId: user.id, ...(mode ? { mode } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });
  if (!vp) return ok(null);

  return ok({
    id: vp.id,
    mode: vp.mode,
    status: vp.status,
    previewPath: vp.previewPath,
    masterPath: vp.masterPath,
    errorMessage: vp.errorMessage,
  });
}
