import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export interface RetentionInput {
  durationSec: number;
  frameImagePaths: string[];                  // 30-60 张全段抽样
  transcriptSegments: TranscriptSegment[];
}

export const RetentionResponseSchema = z.object({
  riskPoints: z.array(z.object({
    startSec: z.number(),
    endSec: z.number(),
    severity: z.enum(['low', 'medium', 'high']),
    reason: z.string(),
    suggestion: z.string(),
  })),
  overallSummary: z.string().min(1),
});

export type RetentionResponse = z.infer<typeof RetentionResponseSchema>;

export const RETENTION = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 通览整段视频, 标出可能让观众划走 (低完播率) 的时段。每个风险点给 start/end 秒数、严重程度 (low/medium/high)、原因、改进建议。如果整段流畅可以返回空数组。

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: RetentionInput): ContentPart[] {
    const transcript = input.transcriptSegments.length === 0
      ? '(无语音)'
      : input.transcriptSegments
          .map((s) => `[${s.startSec.toFixed(2)}-${s.endSec.toFixed(2)}] ${s.text}`)
          .join('\n');
    return [
      {
        type: 'text',
        text: `视频总时长: ${input.durationSec}s\n带时间戳的 transcript:\n${transcript}\n\n下面是全段抽样帧 (按时间顺序):`,
      },
      ...input.frameImagePaths.map((p) => ({
        type: 'image_url' as const,
        image_url: { url: `file://${p}` },
      })),
    ];
  },
  responseSchema: RetentionResponseSchema,
};
