import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface CoverInput {
  transcriptFirstChunk: string;
  userCoverPath: string | null;
  candidatePaths: string[];                   // 3 张候选 (mode=generate 时使用)
}

const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const CoverResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('evaluate'),
    feedback: z.object({
      rating: Rating,
      issues: z.array(z.string()),
      suggestions: z.array(z.string()),
    }),
  }),
  z.object({
    mode: z.literal('generate'),
    candidates: z.array(z.object({
      coverCandidateIdx: z.number().int().min(0),
      timestampSec: z.number(),
      reason: z.string(),
    })),
    recommendedIdx: z.number().int().min(0),
  }),
]);

export type CoverResponse = z.infer<typeof CoverResponseSchema>;

export const COVER = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评价封面 (用户上传时) 或从候选中推选封面 (未上传时)。
- evaluate: 给 1-5 评分 + 问题点 + 改进建议
- generate: 评每张候选适合度 + 给出 recommendedIdx (从 0 开始的索引)

${JSON_STRICTNESS}`,
  buildUserMessage(input: CoverInput): ContentPart[] {
    const transcript = input.transcriptFirstChunk.trim() || '(无语音)';

    if (input.userCoverPath) {
      return [
        {
          type: 'text',
          text: `视频主题 (开头 transcript): ${transcript}\n\n下面是用户已上传封面, 请评价:`,
        },
        { type: 'image_url', image_url: { url: `file://${input.userCoverPath}` } },
      ];
    }

    const parts: ContentPart[] = [
      {
        type: 'text',
        text: `视频主题 (开头 transcript): ${transcript}\n\n用户未上传封面。下面是从视频抽出的 3 张候选 (按顺序索引 0/1/2), 请评估并推选:`,
      },
    ];
    for (const p of input.candidatePaths) {
      parts.push({ type: 'image_url', image_url: { url: `file://${p}` } });
    }
    return parts;
  },
  responseSchema: CoverResponseSchema,
};
