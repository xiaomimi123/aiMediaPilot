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

// 4 个维度的原始权重, 也在 worker fallback 分时用
export const SYNTHESIZE_WEIGHTS = {
  hook: 0.3,
  retention: 0.3,
  titleCaption: 0.2,
  cover: 0.2,
} as const;

function isMissing(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'object' && v !== null && 'error' in v);
}

export const SYNTHESIZE = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 综合最多 4 个维度的评估子报告, 给出 0-100 的综合评分 + 3-5 条"现在去改"的高优先级 action items。
- overallScore: 权重参考 = 钩子 30%, 完播 30%, 标题/文案 20%, 封面 20%
- 若某维度标记为 "missing", 忽略它, 按剩下维度的权重重新归一化
- topActionItems: 跨维度凝练, 每条具体可执行 (不要说"提升观感", 要说"把 0:01 改成提问句")
- 缺维度时, action items 只针对可用维度提

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: SynthesizeInput): ContentPart[] {
    const dims: Array<[string, unknown]> = [
      ['hook', input.hook],
      ['retention', input.retention],
      ['titleCaption', input.titleCaption],
      ['cover', input.cover],
    ];
    const availableNames = dims.filter(([, v]) => !isMissing(v)).map(([n]) => n);
    const missingNames = dims.filter(([, v]) => isMissing(v)).map(([n]) => n);

    const body = dims
      .map(([name, v]) =>
        isMissing(v) ? `${name}: missing` : `${name}: ${JSON.stringify(v, null, 2)}`,
      )
      .join('\n');

    const meta =
      missingNames.length === 0
        ? '4 个维度全部就绪。'
        : `可用维度: ${availableNames.join(', ')}。 缺失维度: ${missingNames.join(', ')}。 只按可用维度评估。`;

    return [
      {
        type: 'text',
        text: `${meta}

维度子报告 (JSON):
${body}

综合给出 overallScore 和 topActionItems。`,
      },
    ];
  },
  responseSchema: SynthesizeResponseSchema,
};
