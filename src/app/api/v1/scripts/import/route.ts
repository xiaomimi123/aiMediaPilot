import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import {
  SCRIPT_IMPORT,
  type ScriptImportResponse,
  checkImportFidelity,
  stripScaffold,
} from '@/lib/llm/prompts/script-import';
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
  /**
   * 可以留空。
   *
   * 稿子已经在手里了, 逼他先想一个主题才能导入是把顺序搞反了 —— 真机上他就卡在
   * 这里: 文案贴好了, 不知道该填什么, 下一步走不了。留空时用模型从稿子里起的名字。
   */
  topic: z.string().trim().max(120).optional(),
  text: z.string().trim().min(50).max(8000),
  durationSec: z.number().int().min(15).max(600).default(60),
});

export async function POST(req: Request) {
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return fail('稿子至少 50 字、最多 8000 字', 400);

  const user = await getOrCreateDefaultUser();
  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  const { topic, text, durationSec } = parsed.data;

  /*
   * 核对要按**去掉结构标记后的正文**来。
   *
   * 真实使用时导入失败了, 报「丢了「【」×6「0」×6「秒」×6」—— 稿子里带着 `【0-4秒】`
   * 这样的时间标记。模型不把它们当台词是对的, 错的是拿带标记的原文当基准: 于是
   * 每次都判「你被改了字」, 而提示还叫他「把稿子拆短一点」, 拆多短都没用。
   *
   * 标记本身不丢 —— 它们照旧交给模型当切分线索(他自己划的段落线)。
   */
  const spoken = stripScaffold(text);
  if (spoken.replace(/\s/g, '').length < 30) {
    return fail('去掉时间标记和段落标签之后，剩下的台词太少了（不足 30 字）。', 400);
  }

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
    let acts0: ScriptImportResponse | null = null;
    let lastFidelity = { faithful: false, detail: '', addedChars: 0, missingChars: 0 };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const out = await llm.callStructured({
        systemPrompt: SCRIPT_IMPORT.buildSystemPrompt(),
        userMessage: SCRIPT_IMPORT.buildUserMessage({ text }),
        responseSchema: SCRIPT_IMPORT.responseSchema,
      });
      lastFidelity = checkImportFidelity(spoken, out.result.acts);
      if (lastFidelity.faithful) {
        acts0 = out.result;
        break;
      }
      console.warn(`[scripts/import] 第 ${attempt} 次切分动了字: ${lastFidelity.detail}`);
    }

    if (!acts0) {
      /*
       * 提示要说得出**下一步该做什么**。
       *
       * 上一版写的是「把稿子拆短一点再导」—— 那次真实失败的原因是稿子里带
       * 【0-4秒】时间标记, 拆多短都没用, 等于把人往错的方向推。现在标记会被
       * 自动剥掉, 所以剩下的失败多半是别的少见符号或者模型真的手滑了。
       */
      return fail(
        `切分时模型动了你的字，已拒绝导入（${lastFidelity.detail}）。` +
        `时间标记和段落标签已经自动剥掉了，所以问题多半出在上面那几个字上——` +
        `看看它们是不是某种少见的符号或者排版字符，删掉再试。`,
        422,
      );
    }

    const seconds = allocateActSeconds(durationSec);
    const acts = acts0.acts.map((a) => ({
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
        // 用户填了就用他的; 没填就用模型从稿子里起的那个
        topic: topic || acts0.topic,
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

    return ok({ scriptDraftId: draft.id, acts, durationSec, topic: topic || acts0.topic });
  } catch (e) {
    console.error('[scripts/import]', e);
    return fail(`导入失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
