import { z } from 'zod';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { IMAGE_PLAN, ImagePlanSchema, type ImagePlan } from '@/lib/llm/prompts/image-plan';

/**
 * 出图计划路由 — 为已生成的小红书图文笔记规划全套配图 (封面 + shotIdeas 对应图)。
 *
 * 幂等: 已有 output.imagePlan 且请求未带 ?force=1 → 直接返回既有计划, 不调用 LLM。
 * 没有计划 (或带 force=1) → 调 LLM 生成, 严格校验 images 张数 = 1 (封面) + shotIdeas
 * 条数且 ≤10, 不符则 502 提示重试; 通过才落盘 output.imagePlan (spread 保留其余键)。
 */

// 防御性读取 ScriptDraft.output — 只关心出图计划所需的四个字段, 其余键原样透传。
const XhsImageInputSchema = z
  .object({
    coverText: z.string().min(1),
    intro: z.string().min(1),
    body: z.string().min(1),
    shotIdeas: z.array(z.object({ idx: z.number().int(), description: z.string() })).min(1),
    imagePlan: ImagePlanSchema.optional(),
  })
  .passthrough();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get('force') === '1';

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true, niche: true, platform: true, output: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  if (draft.platform !== 'xiaohongshu') return fail('仅支持小红书脚本出图', 400);

  const parsedOutput = XhsImageInputSchema.safeParse(draft.output);
  if (!parsedOutput.success) return fail('该脚本还没有可用于出图的图文笔记, 请先生成', 400);

  const { coverText, intro, body, shotIdeas, imagePlan: existingPlan } = parsedOutput.data;

  if (existingPlan && !force) {
    return ok({ plan: existingPlan });
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('DEEPSEEK_API_KEY 未配置', 503);

  const llm = getDeepSeekTextLLM(apiKey);

  try {
    const out = await llm.callStructured({
      systemPrompt: IMAGE_PLAN.buildSystemPrompt(draft.niche),
      userMessage: IMAGE_PLAN.buildUserMessage({ coverText, intro, body, shotIdeas }),
      responseSchema: IMAGE_PLAN.responseSchema,
    });
    const plan: ImagePlan = out.result;

    const expectedCount = 1 + shotIdeas.length;
    if (plan.images.length !== expectedCount || plan.images.length > 10) {
      return fail('AI 生成的配图数量不对, 请重试', 502);
    }

    await prisma.scriptDraft.update({
      where: { id },
      data: {
        output: {
          ...(draft.output as Record<string, unknown>),
          imagePlan: plan,
        },
      },
    });

    return ok({ plan });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/images/plan]', e);
    return fail(`出图计划生成失败: ${msg}`, 500);
  }
}
