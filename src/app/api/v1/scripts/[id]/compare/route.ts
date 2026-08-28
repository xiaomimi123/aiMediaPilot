import type { Prisma } from '@prisma/client';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { SCRIPT_COMPARE, checkCompareFacts, isTooSmallToTeach } from '@/lib/llm/prompts/script-compare';

export const dynamic = 'force-dynamic';

/**
 * 对照版(二十三期)。
 *
 * 同一段素材换一种写法, 并说明每一幕动了什么手法 —— 只给诊断不给例子, 等于一张
 * 空白答卷: 知道「这句啰嗦」和知道「不啰嗦长什么样」之间隔着的正是学习本身。
 *
 * **写进 `output.compareVersions`, 绝不碰 `script.acts`。** 对照版永远是对照。
 * 他要照抄是他的选择, 但改写度那个数字声称「这稿子还有多少是你的」, 如果对照版
 * 能悄悄流进正文而它毫无反应, 那个数字就开始骗人 —— 骗人的指标比没有更坏。
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();

  const draft = await prisma.scriptDraft.findFirst({
    where: { id, userId: user.id },
    select: { output: true },
  });
  if (!draft) return fail('稿子不存在', 404);

  const output = draft.output as { script?: { acts?: { act?: string; narration?: string }[] } } | null;
  const acts = (output?.script?.acts ?? [])
    .map((a) => ({ act: a.act ?? '', narration: (a.narration ?? '').trim() }))
    .filter((a) => a.act && a.narration);

  const total = acts.reduce((n, a) => n + a.narration.length, 0);
  if (total < 40) {
    return fail('先自己写点东西再看对照——对照的是你的写法，空稿子没有可对照的。', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('未配置 DeepSeek key', 503);

  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: SCRIPT_COMPARE.buildSystemPrompt(),
      userMessage: SCRIPT_COMPARE.buildUserMessage({ acts }),
      responseSchema: SCRIPT_COMPARE.responseSchema,
    });

    const byAct = new Map(acts.map((a) => [a.act, a.narration]));
    const versions = out.result.acts
      .filter((a) => byAct.has(a.act) && a.rewritten.trim())
      // 抠字眼的那几幕整幕丢掉 —— 见 isTooSmallToTeach 的说明
      .filter((a) => a.keep || !isTooSmallToTeach(byAct.get(a.act) ?? '', a.rewritten))
      .map((a) => {
        const facts = checkCompareFacts(byAct.get(a.act) ?? '', a.rewritten);
        return {
          act: a.act,
          rewritten: a.rewritten.trim(),
          // 模型偶尔会把字段名漏进正文(「keep：以具体动作开头…」), 切掉
          whatChanged: a.whatChanged.replace(/^keep\s*[:：]\s*/i, ''),
          keep: a.keep,
          // 编出来的细节最坏: 看起来像「写得更好了」, 其实是替他多说了一件他没有的事
          inventedNumbers: facts.inventedNumbers,
        };
      });

    const merged = {
      ...(draft.output as Record<string, unknown>),
      compareVersions: {
        acts: versions,
        overallNote: out.result.overallNote,
        // 存快照: 之后他把正文改了, 前端要能说「这份对照是针对旧版本出的」
        forNarration: Object.fromEntries(acts.map((a) => [a.act, a.narration])),
        at: new Date().toISOString(),
      },
    };
    await prisma.scriptDraft.update({
      where: { id },
      data: { output: merged as unknown as Prisma.InputJsonValue },
    });

    return ok({ acts: versions, overallNote: out.result.overallNote });
  } catch (e) {
    console.error('[scripts/compare]', e);
    return fail(`出对照版失败: ${e instanceof Error ? e.message.slice(0, 200) : '未知错误'}`, 500);
  }
}
