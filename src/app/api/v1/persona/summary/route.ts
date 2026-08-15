import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { loadCreatorVoice } from '@/lib/persona/voice';
import { loadPersonaProfile } from '@/lib/persona/profile';
import { PERSONA_SUMMARY } from '@/lib/llm/prompts';

/**
 * 体系报告路由 (十期 T4) — 人设定位体系的收尾步骤: 把已建档的完整 profile
 * (含 T4 上一步产出的 marketInsight, 若有) 交给 DeepSeek 汇总成一页 markdown
 * 报告, 直写落库 PersonaProfile.systemSummary。
 *
 * 服务端单字段直写 (`prisma.personaProfile.update` 只动 systemSummary 一列),
 * 不是 T1 profile PUT 那种整请求体合并语义 —— 同 market-research 路由先例。
 */
const DEFAULT_NICHE = 'ai-knowledge';

export async function POST() {
  const user = await getOrCreateDefaultUser();

  const profile = await loadPersonaProfile(user.id);
  // 十二期: 人物志一并喂给报告 —— 没有它这份一页纸只是营销 brief
  const voice = await loadCreatorVoice(user.id);
  if (!profile) return fail('人设定位档案未建立, 请先完善受众与内容支柱', 400);

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: PERSONA_SUMMARY.buildSystemPrompt(DEFAULT_NICHE),
      userMessage: PERSONA_SUMMARY.buildUserMessage({ profile, voice }),
      responseSchema: PERSONA_SUMMARY.responseSchema,
    });

    await prisma.personaProfile.update({
      where: { userId: user.id },
      data: { systemSummary: out.result.summary },
    });

    return ok({ summary: out.result.summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST persona/summary]', e);
    return fail(`体系报告生成失败: ${msg}`, 500);
  }
}
