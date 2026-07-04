import { describe, expect, it } from 'vitest';
import { SYNTHESIZE, SynthesizeResponseSchema } from '@/lib/llm/prompts/synthesize';

describe('SYNTHESIZE', () => {
  it('buildSystemPrompt("ai-knowledge") 含 "AI 知识"', () => {
    expect(SYNTHESIZE.buildSystemPrompt('ai-knowledge')).toContain('AI 知识');
  });

  it('buildSystemPrompt("二次元") 含 "二次元" (custom niche injection)', () => {
    expect(SYNTHESIZE.buildSystemPrompt('二次元')).toContain('二次元');
  });

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
    expect(text).toMatch(/4 个维度全部就绪/);
  });

  it('buildUserMessage 某维度是 { error } → 标 missing + 列出可用', () => {
    const parts = SYNTHESIZE.buildUserMessage({
      hook: { rating: 3 },
      retention: { error: 'LLM timeout' },
      titleCaption: { mode: 'evaluate' },
      cover: { mode: 'generate' },
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('retention: missing');
    expect(text).toContain('可用维度: hook, titleCaption, cover');
    expect(text).toContain('缺失维度: retention');
  });

  it('buildUserMessage 某维度 null 也算 missing', () => {
    const parts = SYNTHESIZE.buildUserMessage({
      hook: { rating: 3 },
      retention: null,
      titleCaption: undefined,
      cover: { mode: 'generate' },
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('retention: missing');
    expect(text).toContain('titleCaption: missing');
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
