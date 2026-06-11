import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface TitleCaptionInput {
  transcriptText: string;
  draftTitle: string | null;
  draftCaption: string | null;
}

const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const FeedbackBlock = z.object({
  rating: Rating,
  issues: z.array(z.string()),
  rewrites: z.array(z.string()),
});

export const TitleCaptionResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('evaluate'),
    titleFeedback: FeedbackBlock.optional(),
    captionFeedback: FeedbackBlock.optional(),
  }),
  z.object({
    mode: z.literal('generate'),
    generatedTitles: z.array(z.string()).min(1),
    generatedCaptions: z.array(z.string()).min(1),
  }),
]);

export type TitleCaptionResponse = z.infer<typeof TitleCaptionResponseSchema>;

export const TITLE_CAPTION = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评价或生成视频的标题和文案。
- 用户提供了草稿: mode="evaluate", 给评分 + 问题点 + 至少 2 个重写候选 (titleFeedback/captionFeedback)
- 用户未提供草稿: mode="generate", 生成 3 个标题候选 + 3 个文案候选

${JSON_STRICTNESS}`,
  buildUserMessage(input: TitleCaptionInput): ContentPart[] {
    const hasAny = input.draftTitle !== null || input.draftCaption !== null;
    const mode = hasAny ? 'evaluate' : 'generate';

    let userText: string;
    if (mode === 'evaluate') {
      userText = `根据视频内容评价用户草稿。
视频 transcript:
${input.transcriptText || '(无语音)'}

用户草稿:
- 标题: ${input.draftTitle ?? '(未填)'}
- 文案: ${input.draftCaption ?? '(未填)'}

请仅评价已填字段, 未填字段对应的 *Feedback 留空 (不要返回)。`;
    } else {
      userText = `用户未提供标题/文案草稿。请基于视频内容生成 3 个标题候选 + 3 个文案候选。
视频 transcript:
${input.transcriptText || '(无语音)'}`;
    }

    return [{ type: 'text', text: userText }];
  },
  responseSchema: TitleCaptionResponseSchema,
};
