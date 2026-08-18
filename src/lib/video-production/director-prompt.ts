import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';

export const ShotSchema = z.object({
  shotId: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  claim: z.string().min(1),
  visualJob: z.string().min(1),
  beats: z.array(z.object({
    visibleState: z.string().min(1),
    development: z.string().min(1),
  })).min(2).max(8),
});
export type Shot = z.infer<typeof ShotSchema>;

export const DirectorResponseSchema = z.object({
  concept: z.string().min(1),          // 一句话视觉概念
  palette: z.array(z.string()).min(3).max(8), // 十六进制色值
  shots: z.array(ShotSchema).min(1),
});
export type DirectorResponse = z.infer<typeof DirectorResponseSchema>;

export const DIRECTOR = {
  buildSystemPrompt(): string {
    return `你是一个 B-roll 视频的"导演"，只负责影片的意义和视觉方向。

规则：
- 用 SRT 的整数毫秒作为时间真相，覆盖从 0 到最后一句结束。
- 把表达同一个意思的字幕行合并成一个镜头，在语义转折处切镜，不要机械按字幕行切分。
- 单个镜头不超过 40000 毫秒。
- 每个镜头要写清楚：观众理解到的主张(claim)、这个画面要完成的视觉任务(visualJob，如 clarify/reveal/compare/prove)、2-6 个"微节拍"(beats，每个节拍要说清楚画面变成了什么样(visibleState)以及这个变化本身是什么(development))。
- 第一版要求构图从简：优先保证时长覆盖完整、字幕/文字清晰可读，不追求视觉丰富度和复杂运镜——用简单的文字卡片+基础过渡即可，不要设计复杂的隐喻或多层构图。
- 统一的调色板(palette)只给 3-8 个十六进制色值，覆盖全片使用。

只输出 JSON，不要 markdown 代码块标记，不要解释文字。字段：concept(一句话视觉概念)、palette(色值数组)、shots(镜头数组，每个镜头含 shotId/startMs/endMs/claim/visualJob/beats)。`;
  },
  buildUserMessage(srt: string): ContentPart[] {
    return [{ type: 'text', text: `完整 SRT 字幕：\n\n${srt}\n\n请给出完整的分镜方案。` }];
  },
  responseSchema: DirectorResponseSchema,
};
