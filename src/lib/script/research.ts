import { prisma } from '@/lib/prisma';
import { getDecryptedTavilyKey } from '@/lib/radar/config';
import { getSearchProvider } from '@/lib/radar/search';
import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';
import { getDeepSeekTextLLM } from '@/lib/llm/clients';
import { RESEARCH_BRIEF, type ResearchBrief } from '@/lib/llm/prompts/research-brief';

/**
 * 研究层 — 把「雷达种子摘要 + Tavily 搜索正文 + 用户自备素材」拼接成原始素材,
 * 交给 DeepSeek 提炼成素材简报 (RESEARCH_BRIEF)。
 *
 * 全流程"尽力而为, 永不阻断写稿": 雷达种子查询失败/未命中静默跳过, 单次搜索失败
 * 单独跳过不影响另一次, key 缺失或素材池全空直接降级返回 null, 任何未预期异常
 * 兜底 catch 后同样返回 null —— 调用方 (阶段一 research()) 据此在界面提示
 * 「本篇未联网研究」而不是让整条生成链路失败。
 */

const MAX_RAW_MATERIALS_LEN = 8000;
const SEARCH_MAX_RESULTS = 5;
const SEARCH_DAYS = 7; // 与四期雷达 run.ts 的 SEARCH_DAYS 同口径, 只取近一周素材
const RADAR_TITLE_MATCH_LEN = 12;

export interface RunResearchInput {
  topic: string;
  niche: string;
  userMaterials?: string;
}

interface MaterialPart {
  label: string;
  text: string;
}

/** 纯函数: 按序拼接 `【label】\ntext`(块间空行分隔), 超长按 maxLen 截断。 */
export function composeRawMaterials(parts: MaterialPart[], maxLen: number): string {
  const joined = parts.map((p) => `【${p.label}】\n${p.text}`).join('\n\n');
  return joined.length > maxLen ? joined.slice(0, maxLen) : joined;
}

function pushIfNonEmpty(parts: MaterialPart[], label: string, text: string): void {
  if (text.trim() !== '') parts.push({ label, text });
}

export async function runResearch(
  userId: string,
  input: RunResearchInput
): Promise<ResearchBrief | null> {
  try {
    const parts: MaterialPart[] = [];

    // ① 雷达种子 — 尽力而为, 命中则注入(标注来源 url), 未命中/异常静默跳过
    try {
      const seed = await prisma.radarItem.findFirst({
        where: {
          userId,
          status: 'adopted',
          OR: [{ title: { contains: input.topic.slice(0, RADAR_TITLE_MATCH_LEN) } }],
        },
      });
      if (seed) {
        pushIfNonEmpty(
          parts,
          `雷达来源(${seed.url})`,
          [seed.aiSummary, seed.aiAngle].filter((s) => s.trim() !== '').join('\n')
        );
      }
    } catch (e) {
      console.warn(
        '[research] 雷达种子查询失败, 静默跳过',
        e instanceof Error ? e.message : String(e)
      );
    }

    // ② Tavily 搜索 — 无 key 跳过; 有 key 搜原词 + "主题 案例 数据" 各一次, 单次失败单独跳过
    const tavilyKey = await getDecryptedTavilyKey(userId);
    if (tavilyKey) {
      const provider = getSearchProvider(tavilyKey);
      const queries = [input.topic, `${input.topic} 案例 数据`];
      for (const query of queries) {
        try {
          const results = await provider.search(query, {
            maxResults: SEARCH_MAX_RESULTS,
            days: SEARCH_DAYS,
          });
          for (const r of results) {
            pushIfNonEmpty(parts, `搜索(${r.url})`, r.content);
          }
        } catch (e) {
          console.warn(
            `[research] Tavily 搜索失败 (query="${query}"), 单独跳过`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    // ③ 用户自备素材
    if (input.userMaterials) {
      pushIfNonEmpty(parts, '用户素材', input.userMaterials);
    }

    // 素材池全空 → 降级返回 null, 不调用 DeepSeek
    if (parts.length === 0) return null;

    // DeepSeek key 缺失 → 同样降级返回 null (不 throw)
    const deepseekKey = await resolveDeepSeekApiKey(userId);
    if (!deepseekKey) return null;

    const rawMaterials = composeRawMaterials(parts, MAX_RAW_MATERIALS_LEN);

    const llm = getDeepSeekTextLLM(deepseekKey);
    const out = await llm.callStructured({
      systemPrompt: RESEARCH_BRIEF.buildSystemPrompt(input.niche),
      userMessage: RESEARCH_BRIEF.buildUserMessage({ topic: input.topic, rawMaterials }),
      responseSchema: RESEARCH_BRIEF.responseSchema,
    });
    return out.result;
  } catch (e) {
    console.warn('[research] runResearch 异常, 降级返回 null', e instanceof Error ? e.message : String(e));
    return null;
  }
}
