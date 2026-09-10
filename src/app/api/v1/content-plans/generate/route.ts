import { ok, fail } from '@/lib/api';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { loadPersonaProfile } from '@/lib/persona/profile';
import { loadCreatorVoice } from '@/lib/persona/voice';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import { buildVoiceSection } from '@/lib/llm/prompts/voice-section';
import { CONTENT_PLAN_GENERATE } from '@/lib/llm/prompts/content-plan-generate';
import { contentPlanGenerateSchema, type PersonaSnapshot } from '@/lib/content-plan/model';

const TOTAL_DAYS = 30;

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  let body: {
    weeklyCadence?: unknown;
    defaultTemplateId?: unknown;
    startDate?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const weeklyCadence = body.weeklyCadence;
  if (typeof weeklyCadence !== 'number' || !Number.isInteger(weeklyCadence) || weeklyCadence < 1 || weeklyCadence > 7) {
    return fail('weeklyCadence 必须是 1-7 的整数', 400);
  }
  const defaultTemplateId =
    typeof body.defaultTemplateId === 'string' && body.defaultTemplateId.trim() !== ''
      ? body.defaultTemplateId.trim()
      : null;
  const startDate = typeof body.startDate === 'string' && body.startDate.trim() !== '' ? body.startDate.trim() : todayISODate();

  const user = await getOrCreateDefaultUser();

  const profile = await loadPersonaProfile(user.id);
  if (!profile || profile.pillars.length === 0) {
    return fail('请先完成定位问答，建立你的内容支柱，才能生成规划', 400);
  }

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  const voice = await loadCreatorVoice(user.id);
  const personaSection = buildPersonaSection(profile, 'topic');
  const voiceSection = buildVoiceSection(voice, []);

  const pillarNames = profile.pillars.map((p) => p.name);
  const schema = contentPlanGenerateSchema(pillarNames);

  let days: { dayIndex: number; pillarName: string; topic: string; angle: string; hookDirection: string }[];
  try {
    const llm = getDeepSeekTextLLM(apiKey);
    const out = await llm.callStructured({
      systemPrompt: CONTENT_PLAN_GENERATE.buildSystemPrompt(weeklyCadence, personaSection, voiceSection),
      userMessage: CONTENT_PLAN_GENERATE.buildUserMessage(),
      responseSchema: schema,
      // 30 天×5 个字段的 JSON 响应体量不小 — 显式给够 maxTokens 防默认截断产生残缺 JSON
      // (同 topic-discovery 30 条先例的教训)。
      maxTokens: 6000,
    });
    const parsed = schema.parse(out.result);
    days = parsed.days;
  } catch (e) {
    console.error('[POST content-plans/generate]', e);
    return fail('规划生成失败，请重试', 500);
  }

  const personaSnapshot: PersonaSnapshot = {
    audience: profile.audience,
    pillars: profile.pillars,
    angle: profile.angle,
    avoid: profile.avoid,
  };

  const planId = await prisma.$transaction(async (tx) => {
    // 服务端强制单活跃规划: 生成新规划前先归档旧的 active 规划。
    const existingActive = await tx.contentPlan.findFirst({
      where: { userId: user.id, status: 'active' },
      select: { id: true },
    });
    if (existingActive) {
      await tx.contentPlan.updateMany({
        where: { userId: user.id, status: 'active' },
        data: { status: 'archived', archivedAt: new Date() },
      });
    }

    const plan = await tx.contentPlan.create({
      data: {
        userId: user.id,
        startDate,
        totalDays: TOTAL_DAYS,
        weeklyCadence,
        defaultTemplateId,
        personaSnapshot: personaSnapshot as unknown as object,
        status: 'active',
      },
      select: { id: true },
    });

    await tx.contentPlanDay.createMany({
      data: days.map((d) => ({
        planId: plan.id,
        dayIndex: d.dayIndex,
        pillarName: d.pillarName,
        topic: d.topic,
        angle: d.angle,
        hookDirection: d.hookDirection,
        status: 'pending',
      })),
    });

    return plan.id;
  });

  return ok({ planId });
}
