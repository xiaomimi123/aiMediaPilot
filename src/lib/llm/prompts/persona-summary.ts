import { z } from 'zod';
import { JSON_STRICTNESS } from './base';
import type { PersonaProfileData } from '@/lib/persona/profile';
import type { ContentPart } from '@/lib/llm/vision';

/**
 * 体系报告 (十期 T4) — 把人设定位档案的全部字段 (受众/内容支柱/差异化角度/
 * 不做什么/痛点/产品供给/转化路径/市场洞察) 汇总成一页 markdown 报告, 落库
 * 到 PersonaProfile.systemSummary, 是账号定位体系的最终交付物。
 */

export const PersonaSummaryResponseSchema = z.object({
  summary: z.string().min(100).max(2000),
});

export interface PersonaSummaryInput {
  profile: PersonaProfileData;
}

function formatProfileForPrompt(profile: PersonaProfileData): string {
  const pillarsText =
    profile.pillars.length > 0
      ? profile.pillars.map((p) => `- ${p.name}: ${p.description}`).join('\n')
      : '(暂无内容支柱)';

  const painPointsText =
    profile.painPoints.length > 0
      ? profile.painPoints.map((p) => `- ${p.pain} (依据: ${p.evidence})`).join('\n')
      : '(暂无痛点记录)';

  const offeringsText =
    profile.offerings.length > 0
      ? profile.offerings
          .map((o) => `- ${o.name} [${o.type}]: ${o.description} (解决: ${o.targetPain})`)
          .join('\n')
      : '(暂无产品供给)';

  const marketInsightText = profile.marketInsight
    ? `赛道格局: ${profile.marketInsight.landscape}
主流玩法: ${profile.marketInsight.mainstream}
未满足需求: ${profile.marketInsight.unmet}
机会点: ${profile.marketInsight.opportunity}`
    : '(暂无市场调研)';

  return `目标受众: ${profile.audience || '(未填写)'}
想吸引的粉丝画像: ${profile.targetFans || '(未填写)'}

内容支柱:
${pillarsText}

差异化角度: ${profile.angle || '(未填写)'}
明确不做什么: ${profile.avoid || '(未填写)'}

用户痛点:
${painPointsText}

产品供给:
${offeringsText}

转化路径: ${profile.productLogic || '(未填写)'}

市场调研:
${marketInsightText}`;
}

export const PERSONA_SUMMARY = {
  buildSystemPrompt(niche: string): string {
    return `你是 ${niche} 赛道创作者的「定位顾问」。 用户已经把人设定位档案的各个字段 (受众/内容支柱/差异化角度/不做什么/痛点/产品供给/转化路径/市场调研) 分别填写完成, 现在需要你把这些分散的字段汇总成一份完整、连贯、一页纸能读完的账号定位体系报告。

输出 schema 只有一个字段:
- summary: 100-2000 字的 markdown 报告

写作要求:
- 用 markdown 标题/列表组织结构, 不是把各字段罗列堆砌, 而是要写出字段之间的逻辑关系 (e.g. 为什么这批内容支柱能覆盖这批痛点、市场机会点如何呼应差异化角度)
- 语言要具体、有主见, 拒绝"用心做内容""持续输出价值"这类空话
- 如果某个字段用户没填 (标注"未填写"/"暂无"), 不要在报告里编造内容, 可以如实指出这是待补充的部分, 但不要影响整体报告的完整性和可读性
- 报告面向创作者本人, 是给他自己看的定位说明书, 不是给平台审核看的官方介绍

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: PersonaSummaryInput): ContentPart[] {
    return [
      {
        type: 'text',
        text: `人设定位档案:
${formatProfileForPrompt(input.profile)}

请综合以上信息, 按 schema 输出一份 100-2000 字的账号定位体系报告 (markdown 格式)。`,
      },
    ];
  },
  responseSchema: PersonaSummaryResponseSchema,
};
