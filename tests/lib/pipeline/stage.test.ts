import { describe, expect, it } from 'vitest';
import { deriveStage } from '@/lib/pipeline/stage';

describe('deriveStage', () => {
  it('全空 → DRAFTING', () => {
    expect(deriveStage({ picked: null, analysis: null, distributionCount: 0 })).toBe('DRAFTING');
  });

  it('picked 非空、无 analysis → READY (定稿待拍)', () => {
    expect(deriveStage({ picked: { titleIdx: 0 }, analysis: null, distributionCount: 0 })).toBe('READY');
  });

  it('有 analysis 未发布 → SHOT, 即使 picked 为 null (数据异常也不抛错)', () => {
    const analysis = { publishedAt: null, retroStatus: null };
    expect(deriveStage({ picked: null, analysis, distributionCount: 0 })).toBe('SHOT');
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('SHOT');
  });

  it('analysis.publishedAt 非空 → PUBLISHED', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'SCHEDULED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('PUBLISHED');
  });

  it('无 analysis 但有分发记录 → PUBLISHED (双通道发布, spec §2.1)', () => {
    expect(deriveStage({ picked: {}, analysis: null, distributionCount: 2 })).toBe('PUBLISHED');
  });

  it('retroStatus COMPLETED → RETROED, 优先级最高', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'COMPLETED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 3 })).toBe('RETROED');
  });

  it('retro FAILED 仍算 PUBLISHED, 不算 RETROED', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'FAILED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('PUBLISHED');
  });

  it('悬空 analysisId (analysis 传 null) + picked → 降级 READY', () => {
    expect(deriveStage({ picked: { hookIdx: 1 }, analysis: null, distributionCount: 0 })).toBe('READY');
  });
});
