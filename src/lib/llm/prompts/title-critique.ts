import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const HOOK_TYPES = ['数字', '反差', '问题', '承诺', '悬念', '情绪', '其它'] as const;

export const TitleCritiqueResponseSchema = z.object({
  lengthVerdict: z.enum(['good', 'short', 'long']),
  hookTypes: z.array(z.enum(HOOK_TYPES)).min(0).max(4),
  suggestions: z.array(z.string().min(3).max(200)).min(1).max(3),
  overallScore: z.number().int().min(0).max(100),
});

export type TitleCritiqueResponse = z.infer<typeof TitleCritiqueResponseSchema>;

const SHARED_FOOTER = `
评估维度:
- lengthVerdict: 标题字数判断 — good / short / long (具体范围见每平台规则)
- hookTypes: 检测到的钩子类型, 从 [数字/反差/问题/承诺/悬念/情绪/其它] 里选, 0-4 个 (没明显钩子返回空数组)
- suggestions: 2-3 个具体改进建议, 每条 ≤ 80 字。 要具体: 不要说"加吸引力", 要说"在开头加数字 / 把'技巧'改成'秘诀'"
- overallScore: 0-100 综合评分`;

function douyinPrompt(niche: string): string {
  return `${getExpertPersona(niche)}

任务: 你审查用户准备用来发 抖音短视频 的候选标题。 给出结构化评估。

平台规则:
- 字数: good = 10-25 字, short = <10, long = >25
- 抖音偏好强钩子: 数字/反差/承诺/悬念
- 允许 1-2 个表情符号, 但不要堆叠
${SHARED_FOOTER}

${JSON_STRICTNESS}`;
}

function xiaohongshuPrompt(niche: string): string {
  return `${getExpertPersona(niche)}

任务: 你审查用户准备用来发 小红书图文笔记 的候选标题。 给出结构化评估。

平台规则:
- 字数: good = 15-30 字, short = <15, long = >35
- 小红书偏好情感化 / 共鸣 / 反差; 推荐带 1-2 个 emoji 或分隔符 |
- 关键词建议: "绝了" "亲测" "保姆级" "藏不住了" "踩坑" 等小红书风
${SHARED_FOOTER}

${JSON_STRICTNESS}`;
}

function gongzhonghaoPrompt(niche: string): string {
  return `${getExpertPersona(niche)}

任务: 你审查用户准备用来发 微信公众号 长文章 的候选标题。 给出结构化评估。

平台规则:
- 字数: good = 15-50 字, short = <15, long = >60
- 公众号偏沉稳信息含量风, 不堆 emoji, 不堆 ! ?
- 偏好: 数字 + 信息密度 / 权威感 / 反常识洞察
- 例: "ChatGPT 写周报: 3 个不为人知的 prompt 技巧" (✓)
- 反例: "震惊!! 这个 AI 技巧让你瞬间..." (X 太抖音化)
${SHARED_FOOTER}

${JSON_STRICTNESS}`;
}

function buildUserMessage(input: { title: string }): ContentPart[] {
  return [
    {
      type: 'text',
      text: `候选标题: "${input.title}"\n\n按 schema 输出评估。`,
    },
  ];
}

export const TITLE_CRITIQUE_DOUYIN = {
  buildSystemPrompt: douyinPrompt,
  buildUserMessage,
  responseSchema: TitleCritiqueResponseSchema,
};

export const TITLE_CRITIQUE_XIAOHONGSHU = {
  buildSystemPrompt: xiaohongshuPrompt,
  buildUserMessage,
  responseSchema: TitleCritiqueResponseSchema,
};

export const TITLE_CRITIQUE_GONGZHONGHAO = {
  buildSystemPrompt: gongzhonghaoPrompt,
  buildUserMessage,
  responseSchema: TitleCritiqueResponseSchema,
};

// Legacy alias (consumers may migrate over time)
export const TITLE_CRITIQUE = TITLE_CRITIQUE_DOUYIN;

export const CRITIQUE_BY_PLATFORM = {
  douyin: TITLE_CRITIQUE_DOUYIN,
  xiaohongshu: TITLE_CRITIQUE_XIAOHONGSHU,
  gongzhonghao: TITLE_CRITIQUE_GONGZHONGHAO,
} as const;

export type CritiquePlatform = keyof typeof CRITIQUE_BY_PLATFORM;
