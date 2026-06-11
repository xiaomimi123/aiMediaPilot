import { describe, expect, it } from 'vitest';
import { TITLE_CAPTION, TitleCaptionResponseSchema } from '@/lib/llm/prompts/ai-knowledge/title-caption';

describe('TITLE_CAPTION', () => {
  it('evaluate 模式 (有草稿) → systemPrompt 提及评价', () => {
    const parts = TITLE_CAPTION.buildUserMessage({
      transcriptText: 'demo',
      draftTitle: 'ChatGPT 提示词指南',
      draftCaption: '今天分享 5 个技巧',
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/草稿/);
    expect(text).toMatch(/ChatGPT 提示词指南/);
  });

  it('generate 模式 (草稿全 null) → 提示生成 3 个候选', () => {
    const parts = TITLE_CAPTION.buildUserMessage({
      transcriptText: 'demo',
      draftTitle: null,
      draftCaption: null,
    });
    expect((parts[0] as any).text).toMatch(/生成 3 个/);
  });
});

describe('TitleCaptionResponseSchema', () => {
  it('evaluate 模式响应', () => {
    expect(() => TitleCaptionResponseSchema.parse({
      mode: 'evaluate',
      titleFeedback: { rating: 4, issues: ['偏泛'], rewrites: ['新标题 1', '新标题 2'] },
      captionFeedback: { rating: 3, issues: [], rewrites: [] },
    })).not.toThrow();
  });

  it('generate 模式响应', () => {
    expect(() => TitleCaptionResponseSchema.parse({
      mode: 'generate',
      generatedTitles: ['标题 1', '标题 2', '标题 3'],
      generatedCaptions: ['文案 1', '文案 2', '文案 3'],
    })).not.toThrow();
  });

  it('mode 必须是 evaluate 或 generate', () => {
    expect(() => TitleCaptionResponseSchema.parse({ mode: 'other' })).toThrow();
  });
});
