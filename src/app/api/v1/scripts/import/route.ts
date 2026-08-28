import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_IMPORT, type ScriptImportResponse, checkImportFidelity } from '@/lib/llm/prompts/script-import';
import { allocateActSeconds } from '@/lib/script/six-act';

/**
 * 导入自己写的稿子(二十三期)。
 *
 * 在这之前, 你手上有稿子却**进不来** —— 评分、改写度、出片全用不上, 因为系统
 * 只认自己生成的六幕结构。这是纯粹的入口缺失。
 *
 * 模型在这里只做切分, **一个字都不改**(见 SCRIPT_IMPORT 的说明)。切完还要
 * `checkImportFidelity` 逐字核一遍 —— 只靠 prompt 里那句话是不够的, 模型的默认
 * 倾向就是顺手润色, 而润色过的稿子肉眼几乎看不出差别。
 *
 * **核不过就整个拒绝, 不落库。** 悄悄存一份被改过的稿子, 比报错严重得多: 用户
 * 会以为那还是他写的东西, 而「改写度」会拿它当基线, 整条评估链就都建在假的上面。
 */
const BodySchema = z.object({
  topic: z.string().trim().min(1).max(120),
  text: z.string().trim().min(50).max(8000),
  durationSec: z.number().int().min(15).max(600).default(60),
});

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail('标题必填; 稿子至少 50 字、最多 8000 字', 400);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  const { topic, text, durationSec } = parsed.data;

  try {
    /*
     * **最多试两次。**
     *
     * 逐字校验必须做(模型的默认倾向就是顺手润色, 而润色过的稿子肉眼看不出差别),
     * 但每次手抖都硬拒会让这个功能很难用 —— 实测同一段稿子第一次丢了 2 个字,
     * 第二次 171 字一字不差。这是随机滑落, 不是系统性问题, 重试一次就好。
     *
     * 两次都不过才拒绝, 并且**报出具体动了哪些字** —— 只报数量没法判断严重程度:
     * 丢两个「了」和把一句话换掉, 数字可能一样, 但一个无所谓一个不能忍。
     */
    const llm = getDeepSeekTextLLM(apiKey);
    let acts0: ScriptImportResponse['acts'] | null = null;
    let lastFidelity = { faithful: false, detail: '', addedChars: 0, missingChars: 0 };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await llm.callStructured({
        systemPrompt: SCRIPT_IMPORT.buildSystemPrompt(),
        userMessage: SCRIPT_IMPORT.buildUserMessage({ text }),
        responseSchema: SCRIPT_IMPORT.responseSchema,
      });
      lastFidelity = checkImportFidelity(text, out.result.acts);
      if (lastFidelity.faithful) {
        acts0 = out.result.acts;
        break;
      }
      console.warn(`[scripts/import] 第 ${attempt} 次切分动了字: ${lastFidelity.detail}`);
    }

    if (!acts0) {
      return fail(
        `切分时模型动了你的字，已拒绝导入（${lastFidelity.detail}）。` +
        `重试两次都不行——把稿子拆短一点再导通常能过。`,
        422,
      );
    }

    const seconds = allocateActSeconds(durationSec);
    const acts = acts0.map((a) => ({
      act: a.act,
      title: a.title,
      narration: a.narration,
      visual: '',
      note: '',
      targetSec: seconds[a.act] ?? 0,
      beats: [],
      facts: [],
    }));

    const draft = await prisma.scriptDraft.create({
      data: {
        userId: user.id,
        topic,
        niche: 'ai-knowledge',
        platform: 'douyin',
        output: {
          script: { acts },
          durationSec,
          source: 'imported',
          /*
           * 导入的稿子**不留 AI 原版快照**。
           *
           * `aiBaseline` 是「我的版 vs AI 版」的基准, 用来量「这稿子还剩多少是
           * AI 的」。这份稿子从头到尾是你写的, 基准无从谈起 —— 存一份等于说
           * 「AI 原本是这样写的」, 那是假的。改写度那一栏会因此不显示, 对的。
           */
        } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    return ok({ scriptDraftId: draft.id, acts, durationSec });
  } catch (e) {
    console.error('[scripts/import]', e);
    return fail(`导入失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
