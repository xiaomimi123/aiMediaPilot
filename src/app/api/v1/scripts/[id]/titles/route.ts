import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_TITLES, checkTitleGrounding } from '@/lib/llm/prompts/script-titles';

export const dynamic = 'force-dynamic';

/**
 * 给一份已有的稿子出标题和话题标签(二十三期)。
 *
 * 独立于生成: 完整生成时那三个标题和正文是同一次输出, 你后来把正文改成什么样它
 * 都不知道 —— 而且那批标题**前端从来没显示过**, 生成的稿子里也看不到。这里每次
 * 拿**当前正文**重出, 对导入的稿子一样能跑。
 *
 * 编造的数字**不拦, 只标**。数字对不上有时是模型算错、有时是它把「六千多」读成
 * 别的量级, 但也可能是它换了个说法而稿子里确实有 —— 直接扔掉会连带扔掉好标题。
 * 标出来让人扫一眼, 比替人做主更合适: 标题总共就三个, 看一眼的成本极低。
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();

  const draft = await prisma.scriptDraft.findFirst({
    where: { id, userId: user.id },
    select: { topic: true, output: true },
  });
  if (!draft) return fail('稿子不存在', 404);

  const output = draft.output as { script?: { acts?: { narration?: string }[] } } | null;
  const narration = (output?.script?.acts ?? [])
    .map((a) => (a.narration ?? '').trim())
    .filter(Boolean)
    .join('\n');

  if (narration.length < 30) {
    return fail('稿子还太短，写到 30 字以上再出标题——标题要落在稿子实际说了什么上。', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: SCRIPT_TITLES.buildSystemPrompt(),
      userMessage: SCRIPT_TITLES.buildUserMessage({ topic: draft.topic, narration }),
      responseSchema: SCRIPT_TITLES.responseSchema,
    });

    const titles = out.result.titles.map((t) => {
      const g = checkTitleGrounding(narration, t.text);
      return { ...t, grounded: g.grounded, inventedNumbers: g.inventedNumbers };
    });

    // 存进 output.titleSuggestions, 不动 output.titles —— 那是生成链路的产物,
    // 覆盖掉会让「生成时说的」和「现在说的」分不开
    const merged = {
      ...(draft.output as Record<string, unknown>),
      titleSuggestions: { titles, tags: out.result.tags, at: new Date().toISOString() },
    };
    await prisma.scriptDraft.update({
      where: { id },
      data: { output: merged as unknown as Prisma.InputJsonValue },
    });

    return ok({ titles, tags: out.result.tags });
  } catch (e) {
    console.error('[scripts/titles]', e);
    return fail(`出标题失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
