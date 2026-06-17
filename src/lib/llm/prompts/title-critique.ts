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

export const TITLE_CRITIQUE = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 你审查用户准备用来发抖音视频的候选标题。 给出结构化评估。

评估维度:
- lengthVerdict: 标题字数判断 — good (10-25 中文字符) / short (<10) / long (>25)
- hookTypes: 检测到的钩子类型, 从 [数字/反差/问题/承诺/悬念/情绪/其它] 里选, 0-4 个 (没明显钩子返回空数组)
- suggestions: 2-3 个具体改进建议, 每条 ≤ 80 字。 要具体: 不要说"加吸引力", 要说"在开头加数字 / 把'技巧'改成'秘诀'"
- overallScore: 0-100 综合评分

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { title: string }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `候选标题: "${input.title}"\n\n按 schema 输出评估。`,
      },
    ];
  },
  responseSchema: TitleCritiqueResponseSchema,
};
