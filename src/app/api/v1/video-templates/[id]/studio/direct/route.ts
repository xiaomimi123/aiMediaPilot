import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { buildStyleSection } from '@/lib/video-production/style-guard';
import { SPEAKING_CHARS_PER_SEC } from '@/lib/script/act-plan';

/**
 * 模板试做台 · 文案切分(二十三期)。
 *
 * 把一段文案交给「导演」切成镜头, **不进出片队列**。调模板效果需要的是几十秒一轮
 * 的迭代, 而完整出片要三分多钟 —— 那个节奏下没人会去调模板。
 *
 * 同步跑而不是入队: 一次 DeepSeek 调用, 而入队意味着要 worker 在跑 —— 这个项目
 * 已经因为 worker 静默不跑吃过大亏。
 */

const BodySchema = z.object({
  text: z.string().trim().min(20).max(4000),
});

/**
 * 把纯文案切成 SRT 喂给导演。
 *
 * 导演的契约是「用 SRT 的整数毫秒作为时间真相」, 所以必须先有时间轴。这里按
 * **朗读速度**估时间(和写稿页的时长估算同一个常量), 按句号切行 —— 试做台上人贴
 * 进来的是一段白话, 不是配好音的字幕。
 *
 * 这个时间轴是估的, 不是真实录音的。所以试做台上出来的分镜时长和真出片会有出入,
 * 界面上得说明这件事。
 */
function textToSrt(text: string): string {
  const stamp = (ms: number): string => {
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0');
    const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
    return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
  };

  const lines = text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let at = 0;
  return lines
    .map((line, i) => {
      const chars = line.replace(/[\s，。、；：！？,.;:!?—…""'']/g, '').length;
      const dur = Math.max(800, Math.round((chars / SPEAKING_CHARS_PER_SEC) * 1000));
      const start = at;
      at += dur;
      return `${i + 1}\n${stamp(start)} --> ${stamp(at)}\n${line}\n`;
    })
    .join('\n');
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail('文案至少 20 字、最多 4000 字', 400);

  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  const srt = textToSrt(parsed.data.text);
  const styleSection = buildStyleSection({
    visualTone: (t.visualTone as 'light' | 'dark' | undefined) ?? 'dark',
    shotPaceSec: t.shotPaceSec ?? null,
  });

  try {
    const llm = new DeepSeekTextLLM({ apiKey, defaultModel: 'deepseek-reasoner' });
    const out = await llm.callStructured({
      systemPrompt: DIRECTOR.buildSystemPrompt(undefined, styleSection, undefined),
      userMessage: DIRECTOR.buildUserMessage(srt),
      responseSchema: DIRECTOR.responseSchema,
    });
    return ok({ direction: out.result, srt });
  } catch (e) {
    console.error('[studio/direct]', e);
    return fail(`切分失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
