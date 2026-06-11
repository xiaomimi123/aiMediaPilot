import { describe, expect, it } from 'vitest';
import { SYNTHESIZE, SynthesizeResponseSchema } from '@/lib/llm/prompts/ai-knowledge/synthesize';

describe('SYNTHESIZE', () => {
  it('buildUserMessage 含 4 个维度子报告', () => {
    const parts = SYNTHESIZE.buildUserMessage({
      hook: { rating: 3 },
      retention: { riskPoints: [] },
      titleCaption: { mode: 'evaluate' },
      cover: { mode: 'generate' },
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/hook/);
    expect(text).toMatch(/retention/);
    expect(text).toMatch(/titleCaption/);
    expect(text).toMatch(/cover/);
  });
});

describe('SynthesizeResponseSchema', () => {
  it('overallScore 1-100', () => {
    expect(() => SynthesizeResponseSchema.parse({
      overallScore: 78,
      topActionItems: ['改 0:01 钩子', '压缩 0:18'],
    })).not.toThrow();
  });

  it('overallScore 超出 0-100 被拒', () => {
    expect(() => SynthesizeResponseSchema.parse({ overallScore: 120, topActionItems: ['x'] })).toThrow();
  });

  it('topActionItems 至少 1 条', () => {
    expect(() => SynthesizeResponseSchema.parse({ overallScore: 50, topActionItems: [] })).toThrow();
  });
});
