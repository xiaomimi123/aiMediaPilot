import { ok, fail } from '@/lib/api';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { buildRerollMessages } from '@/lib/llm/prompts/content-plan-generate';
import { contentPlanDayItemSchema, type PersonaSnapshot } from '@/lib/content-plan/model';

/**
 * 三十八期 Task 2: 单天换选题(reroll)。
 *
 * 仅 pending 允许 —— 已生成脚本/成片的天不许被选题覆盖(状态机只前进不回退)。
 * 输入 = `plan.personaSnapshot`(不重读档案, 快照一致性是设计红线) + avoidTopics
 * = 本天原 topic + 同规划其余天的 topic 列表(防止换出来的选题又撞车)。
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string; dayIndex: string } },
) {
  const dayIndex = Number(params.dayIndex);
  if (!Number.isInteger(dayIndex)) {
    return fail('dayIndex 必须是整数', 400);
  }

  const user = await getOrCreateDefaultUser();

  const plan = await prisma.contentPlan.findUnique({ where: { id: params.id } });
  if (!plan || plan.userId !== user.id) {
    return fail('规划不存在', 404);
  }
  if (dayIndex < 1 || dayIndex > plan.totalDays) {
    return fail('dayIndex 超出规划范围', 400);
  }

  const day = await prisma.contentPlanDay.findUnique({
    where: { planId_dayIndex: { planId: plan.id, dayIndex } },
  });
  if (!day) {
    return fail('这一天不存在', 404);
  }
  if (day.status !== 'pending') {
    return fail('已生成脚本/成片的天不能换选题——要改内容去重新生成脚本', 409);
  }

  const otherDays = await prisma.contentPlanDay.findMany({
    where: { planId: plan.id, dayIndex: { not: dayIndex } },
    select: { topic: true },
  });
  const avoidTopics = [day.topic, ...otherDays.map((d) => d.topic)];

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  const personaSnapshot = plan.personaSnapshot as unknown as PersonaSnapshot;
  const pillarNames = personaSnapshot.pillars.map((p) => p.name);
  const schema = contentPlanDayItemSchema(pillarNames);

  let item: { pillarName: string; topic: string; angle: string; hookDirection: string };
  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const { systemPrompt, userMessage } = buildRerollMessages({ dayIndex, personaSnapshot, avoidTopics });
    const out = await llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: schema,
      maxTokens: 800,
    });
    item = schema.parse(out.result);
  } catch (e) {
    console.error('[POST content-plans days reroll]', e);
    return fail('换选题失败，请重试', 500);
  }

  const updated = await prisma.contentPlanDay.update({
    where: { id: day.id },
    data: {
      pillarName: item.pillarName,
      topic: item.topic,
      angle: item.angle,
      hookDirection: item.hookDirection,
      edited: true,
    },
  });

  return ok(updated);
}
