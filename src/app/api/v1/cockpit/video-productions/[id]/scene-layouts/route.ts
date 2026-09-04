import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { SCENE_LAYOUTS } from '@/lib/video/scene-layout';

/**
 * 保存逐场景版面(二十三期)。
 *
 * 编辑台里选的版面必须落到 production 上, 否则调了也传不到出片 —— 那正是这个
 * 项目一再要避免的「界面在撒谎」。
 *
 * **只允许在开工之前改。** 一旦进入渲染, 改版面等于让已经渲好的镜头和新版面
 * 对不上; 而中途改又不重渲的话, 成片会是两种版面混着的。要改就重新开始。
 */
const BodySchema = z.object({
  layouts: z
    .array(z.object({ shotId: z.string().min(1), layout: z.enum(SCENE_LAYOUTS) }))
    .max(200),
});

/** 还没开工或已失败 —— 这些状态下改版面是安全的。 */
const EDITABLE = new Set(['queued', 'source_uploaded', 'failed', 'preview_ready']);

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail(`版面数据不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);
  if (!EDITABLE.has(vp.status)) {
    return fail(`当前状态(${vp.status})正在渲染, 改版面会让成片混着两种版面。要改请重新开始。`, 400);
  }

  await prisma.videoProduction.update({
    where: { id },
    data: {
      sceneLayouts: parsed.data.layouts as unknown as Prisma.InputJsonValue,
      updatedAt: new Date().toISOString(),
    },
  });
  return ok({ saved: parsed.data.layouts.length });
}
