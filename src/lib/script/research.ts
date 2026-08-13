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
    // parts 分两组组装、最后按「精炼素材优先, 搜索正文兜底」的顺序拼接——
    // composeRawMaterials 超长时是简单的头部保留/尾部截断 (slice(0, maxLen)),
    // 而 Tavily 搜索经常两次查询各 5 条结果、单条正文就有数千字, 合计轻松突破
    // MAX_RAW_MATERIALS_LEN; 若仍按"雷达种子→搜索→用户素材"的原始产生顺序拼接,
    // 用户在素材框里明确填写的内容会被排在最后、经常被整体截断在外, 完全不会
    // 出现在喂给 DeepSeek 的 rawMaterials 里 (真实调用验证过: 搜索结果一多,
    // 简报清一色引用搜索来源, 用户素材从未被引用)。改为把「雷达种子」与
    // 「用户素材」(两者都简短、且是明确关联该选题的高信号内容) 放在 searchParts
    // 之前, 让容量有限时被截掉的是体积最大、优先级最低的搜索正文, 而不是用户
    // 主动提供的内容。
    const curatedParts: MaterialPart[] = [];
    const searchParts: MaterialPart[] = [];

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
          curatedParts,
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

    // ② 用户自备素材 — 同样归入优先保留组
    if (input.userMaterials) {
      pushIfNonEmpty(curatedParts, '用户素材', input.userMaterials);
    }

    // ③ Tavily 搜索 — 无 key 跳过; 有 key 搜原词 + "主题 案例 数据" 各一次, 单次失败单独跳过
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
            pushIfNonEmpty(searchParts, `搜索(${r.url})`, r.content);
          }
        } catch (e) {
          console.warn(
            `[research] Tavily 搜索失败 (query="${query}"), 单独跳过`,
            e instanceof Error ? e.message : String(e)
          );
        }
      }
    }

    const parts = [...curatedParts, ...searchParts];

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
