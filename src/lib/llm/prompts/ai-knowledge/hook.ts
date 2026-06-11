import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface HookInput {
  durationSec: number;
  frameImagePaths: string[];                  // 6 张 (前 3 秒每 0.5s)
  transcript03s: string;
}

export const HookResponseSchema = z.object({
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  summary: z.string().min(1),
  suggestions: z.array(z.string()).min(1),
  keyObservations: z.array(z.object({
    timestampSec: z.number(),
    note: z.string(),
  })),
});

export type HookResponse = z.infer<typeof HookResponseSchema>;

export const HOOK = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评估视频前 3 秒钩子。给出 1-5 评分、一句话总结、可执行改进建议、关键帧观察。
- rating 1: 平淡无反差,大概率被划走
- rating 5: 强烈反差/钩子,大概率留住观看

${JSON_STRICTNESS}`,
  buildUserMessage(input: HookInput): ContentPart[] {
    const transcript = input.transcript03s.trim() || '(无语音)';
    return [
      {
        type: 'text',
        text: `视频总时长: ${input.durationSec}s\n前 3 秒 transcript:\n${transcript}\n\n下面是前 3 秒按 0.5s 间隔抽取的关键帧 (从 0s 到 2.5s):`,
      },
      ...input.frameImagePaths.map((p) => ({
        type: 'image_url' as const,
        image_url: { url: `file://${p}` },
      })),
    ];
  },
  responseSchema: HookResponseSchema,
};
