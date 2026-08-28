import { z } from 'zod';
import path from 'path';
import { promises as fs } from 'fs';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { BUILDER } from '@/lib/video-production/builder-prompt';
import { buildChapterNavSection } from '@/lib/video-production/style-guard';
import { buildPreviewHtml } from '@/lib/video-production/preview-html';

/**
 * 模板试做台 · 出画面(二十三期)。
 *
 * 只做**一个镜头**。调模板效果不需要整条片子 —— 一镜就够判断风格对不对, 而一镜
 * 是几十秒, 整片是三分多钟。
 *
 * 返回两份 HTML:
 * - `html`   Builder 的原始产物, 就是渲染时真正用的那份, 给人直接改
 * - `preview` 内联了 gsap、加了播放器的版本, 丢进 iframe 就能看
 *
 * 分开返回而不是只给预览版: 人改的应该是原始产物, 改预览版会把播放器脚本一起
 * 改进去, 那些东西不该进渲染管线。
 */

const ShotSchema = z.object({
  shotId: z.string(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  claim: z.string(),
  visualJob: z.string(),
  beats: z.array(z.object({ visibleState: z.string(), development: z.string() })).min(1),
});

const BodySchema = z.object({
  shot: ShotSchema,
  palette: z.array(z.string()).min(1).max(8),
  /** 直接给 HTML 时跳过模型, 只做预览包装 —— 手改完想马上看效果走这条。 */
  html: z.string().optional(),
});

async function gsapSource(): Promise<string> {
  return fs.readFile(
    path.join(process.cwd(), 'src', 'lib', 'video-production', 'assets', 'gsap.min.js'),
    'utf-8',
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail(`镜头数据不合法: ${parsed.error.issues[0]?.message ?? ''}`, 400);

  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  const { shot, palette } = parsed.data;
  const durationMs = Math.max(1, shot.endMs - shot.startMs);

  // 手改完只要重新包装, 不用再花一次模型钱
  if (parsed.data.html) {
    const { html, gsapInlined } = buildPreviewHtml(parsed.data.html, {
      gsapSource: await gsapSource(),
      durationMs,
    });
    return ok({ html: parsed.data.html, preview: html, gsapInlined, regenerated: false });
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  try {
    const llm = new DeepSeekTextLLM({
      apiKey,
      // 模板配的 builderModel 就是出片时真正用的那个 —— 试做台必须用同一个,
      // 否则调出来的效果和真出片对不上, 试做就没有意义了
      defaultModel: (t.builderModel as 'deepseek-chat' | 'deepseek-reasoner') ?? 'deepseek-chat',
    });
    const out = await llm.callStructured({
      systemPrompt: BUILDER.buildSystemPrompt(
        palette,
        (t.visualStyle as 'card' | 'illustration' | undefined) ?? 'card',
        undefined,
        // 试做台只做一镜, 没有六幕上下文 —— 章节进度条传空幕列表(它会自己空转),
        // 不硬造六个幕名塞进去
        buildChapterNavSection(t.showChapterNav ?? false, [], null),
      ),
      userMessage: BUILDER.buildUserMessage(shot),
      responseSchema: BUILDER.responseSchema,
    });
    const { html, gsapInlined } = buildPreviewHtml(out.result.html, {
      gsapSource: await gsapSource(),
      durationMs,
    });
    return ok({ html: out.result.html, preview: html, gsapInlined, regenerated: true });
  } catch (e) {
    console.error('[studio/build]', e);
    return fail(`出画面失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
