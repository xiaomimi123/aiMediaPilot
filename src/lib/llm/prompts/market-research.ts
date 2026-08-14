import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 市场调研 (十期 T4) — 把「受众 + 内容支柱 + Tavily 搜索摘要」提炼成结构化市场洞察,
 * 落库到 PersonaProfile.marketInsight, 供人设定位体系报告 (PERSONA_SUMMARY) 与
 * 后续选题引用。
 *
 * 搜索摘要本身的拼接/截断由路由层 (market-research/route.ts) 负责, 这里只管提炼。
 */

export const MarketInsightSchema = z.object({
  landscape: z.string().min(10).max(300), // 赛道格局: 当前这个细分领域整体在做什么
  mainstream: z.string().min(10).max(300), // 主流玩法: 同赛道账号普遍在用的内容打法
  unmet: z.string().min(10).max(300), // 未满足需求: 受众有但主流玩法没接住的诉求
  opportunity: z.string().min(10).max(300), // 机会点: 结合自身内容支柱能切入的差异化空间
});

export type MarketInsight = z.infer<typeof MarketInsightSchema>;

export interface MarketResearchInput {
  audience: string;
  pillars: string[];
  searchDigest: string;
}

export const MARKET_RESEARCH = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 你收到一份市场搜索摘要 (围绕该创作者的赛道现状 + 目标受众相关内容账号搜出来的原始正文拼接而成), 请据此提炼出一份市场洞察, 帮创作者看清自己所在的赛道格局、找到差异化机会。

输出 schema 四个字段, 每个字段 10-300 字:
- landscape: 赛道格局 —— 这个细分领域当前整体是什么状态 (玩家多不多、内容供给饱和度、大致的竞争烈度)
- mainstream: 主流玩法 —— 同赛道账号普遍在用什么样的内容打法/选题套路, 具体指出来, 不要泛泛而谈
- unmet: 未满足需求 —— 目标受众有, 但主流玩法没有真正接住的诉求/痛点/期待
- opportunity: 机会点 —— 结合这位创作者已有的内容支柱, 具体指出一个可以切入的差异化空间, 不要给一句正确的废话

要求:
- 每个字段必须结合搜索摘要里的具体信息作答, 不能脱离摘要凭空编造行业判断
- 如果搜索摘要信息有限, 允许基于摘要合理推断, 但不能编造具体的数字/案例/账号名
- 拒绝"内容为王""坚持输出"这类放之四海皆准的空话, 每句话都要能落回这个具体赛道

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: MarketResearchInput): ContentPart[] {
    const pillarsText = input.pillars.length > 0 ? input.pillars.join('、') : '(暂无内容支柱)';
    const digestText = input.searchDigest.trim() || '(搜索摘要为空)';

    return [
      {
        type: 'text',
        text: `目标受众:
${input.audience}

内容支柱:
${pillarsText}

市场搜索摘要:
${digestText}

请基于以上信息, 按 schema 输出一份市场洞察。`,
      },
    ];
  },
  responseSchema: MarketInsightSchema,
};
