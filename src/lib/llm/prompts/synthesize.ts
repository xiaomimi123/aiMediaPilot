import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export interface SynthesizeInput {
  hook: unknown;
  retention: unknown;
  titleCaption: unknown;
  cover: unknown;
}

export const SynthesizeResponseSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  topActionItems: z.array(z.string()).min(1).max(5),
});

export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>;

export const SYNTHESIZE = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 综合 4 个维度的评估子报告, 给出 1-100 的综合评分 + 3-5 条"现在去改"的高优先级 action items。
- overallScore: 权重参考 = 钩子 30%, 完播 30%, 标题/文案 20%, 封面 20%
- topActionItems: 跨维度凝练, 每条具体可执行 (不要说"提升观感", 要说"把 0:01 改成提问句")

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: SynthesizeInput): ContentPart[] {
    return [
      {
        type: 'text',
        text: `4 个维度子报告 (JSON):
hook: ${JSON.stringify(input.hook, null, 2)}
retention: ${JSON.stringify(input.retention, null, 2)}
titleCaption: ${JSON.stringify(input.titleCaption, null, 2)}
cover: ${JSON.stringify(input.cover, null, 2)}

综合给出 overallScore 和 topActionItems。`,
      },
    ];
  },
  responseSchema: SynthesizeResponseSchema,
};
