import { describe, expect, it } from 'vitest';
import { RETRO_GAP, RetroGapResponseSchema } from '@/lib/llm/prompts/ai-knowledge/retro-gap';

describe('RETRO_GAP', () => {
  it('systemPrompt 含专家人设 + 落差分析关键词', () => {
    expect(RETRO_GAP.systemPrompt).toMatch(/AI 知识类/);
    expect(RETRO_GAP.systemPrompt).toMatch(/落差|对比|accuracy/);
  });

  it('buildUserMessage 含 A v1 报告 + 实际数据字段', () => {
    const parts = RETRO_GAP.buildUserMessage({
      report: {
        hook: { rating: 3, summary: 'x' },
        retention: { riskPoints: [{ startSec: 18, endSec: 24 }] },
        titleCaption: { mode: 'evaluate' },
        cover: { mode: 'generate' },
        overallScore: 78,
      } as any,
      actual: {
        plays: 12345n,
        likes: 1234n,
        comments: 234n,
        shares: 45n,
        collects: 123n,
        completionRateBp: 3210,
        retention3sBp: 6540,
        followConversionBp: 120,
        likeRateBp: 999,
        commentRateBp: 189,
        shareRateBp: 36,
        topComments: null,
      },
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/钩子.*3/);
    expect(text).toMatch(/12345/);
    expect(text).toMatch(/完播率.*32\.10%|3210/);
  });
});

describe('RetroGapResponseSchema', () => {
  const validBase = {
    schemaVersion: 1,
    niche: 'ai-knowledge',
    hookGap: {
      predictedRating: 3,
      relevantActual: { retention3sBp: 6540 },
      takeaway: '钩子预判 ★3,实际 3s 留存 65%',
      accuracy: 'on-target',
    },
    retentionGap: {
      predictedRiskPoints: 1,
      relevantActual: { completionRateBp: 3210 },
      takeaway: 'x',
      accuracy: 'under-estimated',
    },
    titleCaptionGap: {
      mode: 'evaluate',
      relevantActual: {},
      takeaway: 'x',
      accuracy: 'unknown',
    },
    coverGap: {
      mode: 'generate',
      relevantActual: { plays: 12345 },
      takeaway: 'x',
      accuracy: 'over-estimated',
    },
    overallTakeaway: '综合',
    predictedOverallScore: 78,
    inferredActualScore: 65,
  };

  it('合法响应通过', () => {
    expect(() => RetroGapResponseSchema.parse(validBase)).not.toThrow();
  });

  it('accuracy 必须是 4 enum 之一', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, hookGap: { ...validBase.hookGap, accuracy: 'maybe' } })
    ).toThrow();
  });

  it('overallScore 接受 null', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, predictedOverallScore: null, inferredActualScore: null })
    ).not.toThrow();
  });

  it('inferredActualScore 超出 0-100 被拒', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, inferredActualScore: 150 })
    ).toThrow();
  });
});
