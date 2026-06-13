import { describe, expect, it } from 'vitest';
import { COVER, CoverResponseSchema } from '@/lib/llm/prompts/cover';

describe('COVER', () => {
  it('buildSystemPrompt("ai-knowledge") 含 "AI 知识"', () => {
    expect(COVER.buildSystemPrompt('ai-knowledge')).toContain('AI 知识');
  });

  it('buildSystemPrompt("美食") 含 "美食" (custom niche injection)', () => {
    expect(COVER.buildSystemPrompt('美食')).toContain('美食');
  });

  it('evaluate 模式 (用户上传了封面)', () => {
    const parts = COVER.buildUserMessage({
      transcriptFirstChunk: 'demo',
      userCoverPath: '/tmp/user.jpg',
      candidatePaths: [],
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/已上传封面/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(1);
  });

  it('generate 模式 (无上传, 3 张候选)', () => {
    const parts = COVER.buildUserMessage({
      transcriptFirstChunk: 'demo',
      userCoverPath: null,
      candidatePaths: ['/a.jpg', '/b.jpg', '/c.jpg'],
    });
    expect((parts[0] as any).text).toMatch(/3 张候选/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
  });
});

describe('CoverResponseSchema', () => {
  it('evaluate 响应', () => {
    expect(() => CoverResponseSchema.parse({
      mode: 'evaluate',
      feedback: { rating: 4, issues: ['文字小'], suggestions: ['放大字号'] },
    })).not.toThrow();
  });

  it('generate 响应', () => {
    expect(() => CoverResponseSchema.parse({
      mode: 'generate',
      candidates: [
        { coverCandidateIdx: 0, timestampSec: 0, reason: '画面清晰' },
        { coverCandidateIdx: 1, timestampSec: 22, reason: '有表情' },
      ],
      recommendedIdx: 1,
    })).not.toThrow();
  });
});
