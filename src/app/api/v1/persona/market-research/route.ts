import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getDecryptedTavilyKey } from '@/lib/radar/config';
import { getSearchProvider } from '@/lib/radar/search';
import { loadPersonaProfile } from '@/lib/persona/profile';
import { MARKET_RESEARCH } from '@/lib/llm/prompts';

/**
 * 市场调研路由 (十期 T4) — 人设定位体系的第二步: 基于已建档的受众/内容支柱,
 * 拉两条 Tavily 搜索摘要 (赛道现状 + 受众相关账号), 喂给 DeepSeek 提炼市场洞察,
 * 直写落库 PersonaProfile.marketInsight。
 *
 * 与 T1 的 profile PUT 不同 —— PUT 是前端表单的合并语义 (整个请求体覆盖除新字段外的
 * 原始字段); 这里是服务端单字段直写, 用 `prisma.personaProfile.update` 只动
 * marketInsight 一列, 不触碰 audience/pillars/painPoints 等其余字段 (同六期 refine
 * 「output spread」先例: 只覆盖本次产出的那部分, 其余原样保留)。
 */
const DEFAULT_NICHE = 'ai-knowledge';
const SEARCH_MAX_RESULTS = 5;

export async function POST() {
  const user = await getOrCreateDefaultUser();

  const profile = await loadPersonaProfile(user.id);
  if (!profile) return fail('人设定位档案未建立, 请先完善受众与内容支柱', 400);

  const tavilyKey = await getDecryptedTavilyKey(user.id);
  if (!tavilyKey) return fail('未配置 Tavily key, 请在「雷达配置」卡保存后重试', 400);

  // 两条查询: 赛道现状 (pillars 为空时退化为只发第二条) + 受众相关内容账号
  const queries: string[] = [];
  if (profile.pillars.length > 0) {
    queries.push(`${profile.pillars[0].name} 赛道 现状`);
  }
  queries.push(`${profile.audience} 内容 账号`);

  const provider = getSearchProvider(tavilyKey);
  const digestParts: string[] = [];
  let anySucceeded = false;
  for (const query of queries) {
    try {
      const results = await provider.search(query, { maxResults: SEARCH_MAX_RESULTS });
      anySucceeded = true;
      for (const r of results) {
        if (r.content.trim() !== '') digestParts.push(`【${r.url}】\n${r.content}`);
      }
    } catch (e) {
      console.warn(
        `[market-research] 搜索失败 (query="${query}"), 单独跳过`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
  if (!anySucceeded) return fail('市场搜索失败, 请稍后重试', 502);

  const apiKey = await resolveDeepSeekApiKey(user.id);
  if (!apiKey) return fail('服务端未配置 DEEPSEEK_API_KEY', 503);

  const llm = getDeepSeekTextLLM(apiKey);
  try {
    const out = await llm.callStructured({
      systemPrompt: MARKET_RESEARCH.buildSystemPrompt(DEFAULT_NICHE),
      userMessage: MARKET_RESEARCH.buildUserMessage({
        audience: profile.audience,
        pillars: profile.pillars.map((p) => p.name),
        searchDigest: digestParts.join('\n\n'),
      }),
      responseSchema: MARKET_RESEARCH.responseSchema,
    });

    const marketInsight = { ...out.result, researchedAt: new Date().toISOString() };
    await prisma.personaProfile.update({
      where: { userId: user.id },
      data: { marketInsight },
    });

    return ok({ marketInsight });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST persona/market-research]', e);
    return fail(`市场调研失败: ${msg}`, 500);
  }
}
