import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { PIP_POSITIONS, PIP_SCALE_MIN, PIP_SCALE_MAX } from '@/lib/video/pip-layout';
import { CAPTION_FONT_WHITELIST, defaultCaptionStyle } from '@/lib/video-template/model';

/**
 * 只更新版面(字幕 + 口播小窗)。
 *
 * 为什么不复用 `PUT /video-templates/[id]`: 那条收的是**整份配置**, 而试做台上
 * 只在调版面 —— 让它提交整份配置意味着试做台得持有全部字段, 一旦模板在别处被改过,
 * 保存版面会顺手把那些改动覆盖回去。窄接口只碰它该碰的。
 *
 * 字体不在这里改: 字体是可读性问题不是版面问题, 而且换字体要考虑系统里装没装,
 * 留在模板配置页。
 */
const BodySchema = z.object({
  captionOn: z.boolean(),
  fontSize: z.number().int().min(12).max(200),
  marginV: z.number().int().min(0).max(500),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  outlineColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  outlineWidth: z.number().min(0).max(10),
  pipOn: z.boolean(),
  pipPosition: z.enum(PIP_POSITIONS),
  pipScale: z.number().min(PIP_SCALE_MIN).max(PIP_SCALE_MAX),
  pipMargin: z.number().int().min(0).max(400),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail(`版面不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  const v = parsed.data;
  // 关掉字幕 = captionStyle 置 null(那是「不烧字幕」的语义), 不是把字号写成 0
  const existing = (t.captionStyle as Record<string, unknown> | null) ?? null;
  const fontFamily = CAPTION_FONT_WHITELIST.includes(existing?.fontFamily as never)
    ? (existing!.fontFamily as string)
    : defaultCaptionStyle().fontFamily;

  await prisma.videoTemplate.update({
    where: { id },
    data: {
      captionStyle: v.captionOn
        ? {
            fontFamily,
            fontSize: v.fontSize,
            primaryColor: v.primaryColor,
            outlineColor: v.outlineColor,
            outlineWidth: v.outlineWidth,
            marginV: v.marginV,
          }
        : undefined,
      ...(v.captionOn ? {} : { captionStyle: undefined }),
      talkingHeadLayout: v.pipOn ? 'pip' : 'cutaway',
      pipPosition: v.pipPosition,
      pipScale: v.pipScale,
      pipMargin: v.pipMargin,
      updatedAt: new Date().toISOString(),
    },
  });

  return ok({ saved: true });
}
