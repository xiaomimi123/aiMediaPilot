import { describe, expect, it } from 'vitest';
import {
  readAnalysisReport,
  readOverallScore,
  readOverallScoreWithMeta,
  readPredictedPlaysRange,
  readRetroReport,
  readScriptDraftOutput,
  readInspirationInsight,
} from '@/lib/json-readers';

describe('readAnalysisReport', () => {
  it('valid → 解析', () => {
    expect(readAnalysisReport({ overallScore: 75 })?.overallScore).toBe(75);
  });
  it('null / undefined / 字符串 → null', () => {
    expect(readAnalysisReport(null)).toBeNull();
    expect(readAnalysisReport(undefined)).toBeNull();
    expect(readAnalysisReport('not-an-object')).toBeNull();
  });
});

describe('readOverallScore', () => {
  it('数字 → 返回', () => {
    expect(readOverallScore({ overallScore: 42 })).toBe(42);
  });
  it('缺字段 / null / 字符串 → null', () => {
    expect(readOverallScore({})).toBeNull();
    expect(readOverallScore(null)).toBeNull();
    expect(readOverallScore({ overallScore: 'high' })).toBeNull();
  });
  it('partial=true → null (严格 comparable 场景排除 partial)', () => {
    expect(readOverallScore({ overallScore: 60, partial: true })).toBeNull();
    expect(readOverallScore({ overallScore: 60, partial: false })).toBe(60);
    // partial 缺省 → 视为非 partial
    expect(readOverallScore({ overallScore: 60 })).toBe(60);
  });
});

describe('readOverallScoreWithMeta', () => {
  it('partial=true 时仍返回 score + partial 标位', () => {
    expect(readOverallScoreWithMeta({ overallScore: 60, partial: true })).toEqual({
      score: 60,
      partial: true,
    });
  });
  it('partial 缺省 → partial=false', () => {
    expect(readOverallScoreWithMeta({ overallScore: 80 })).toEqual({ score: 80, partial: false });
  });
  it('无 score → null', () => {
    expect(readOverallScoreWithMeta({ partial: true })).toBeNull();
    expect(readOverallScoreWithMeta(null)).toBeNull();
  });
});

describe('readPredictedPlaysRange', () => {
  it('三字段齐 → 完整对象', () => {
    expect(
      readPredictedPlaysRange({ predictedPlaysRange: { predicted: 1000, lower: 500, upper: 2000 } }),
    ).toEqual({ predicted: 1000, lower: 500, upper: 2000 });
  });
  it('缺 upper → null', () => {
    expect(readPredictedPlaysRange({ predictedPlaysRange: { predicted: 1000, lower: 500 } })).toBeNull();
  });
  it('predictedPlaysRange 是字符串 → null', () => {
    expect(readPredictedPlaysRange({ predictedPlaysRange: 'oops' })).toBeNull();
  });
});

describe('readRetroReport', () => {
  it('passthrough 保留额外字段', () => {
    const parsed = readRetroReport({
      predictedOverallScore: 80,
      inferredActualScore: 60,
      extraField: 'kept',
    });
    expect(parsed?.predictedOverallScore).toBe(80);
    expect(parsed?.inferredActualScore).toBe(60);
    expect((parsed as any)?.extraField).toBe('kept');
  });
  it('非对象 → null', () => {
    expect(readRetroReport(null)).toBeNull();
    expect(readRetroReport(123)).toBeNull();
  });
});

describe('readScriptDraftOutput', () => {
  it('valid titles + hooks', () => {
    const parsed = readScriptDraftOutput({
      titles: [{ text: 'foo', hookType: '数字' }, { text: 'bar' }],
      hooks: [{ text: 'hook1' }],
    });
    expect(parsed?.titles).toHaveLength(2);
    expect(parsed?.hooks).toHaveLength(1);
    expect(parsed?.titles?.[0].hookType).toBe('数字');
  });
  it('titles 缺失 → parsed.titles undefined, 不是 null 整体', () => {
    const parsed = readScriptDraftOutput({});
    expect(parsed).not.toBeNull();
    expect(parsed?.titles).toBeUndefined();
  });
  it('null / string → null', () => {
    expect(readScriptDraftOutput(null)).toBeNull();
    expect(readScriptDraftOutput('string')).toBeNull();
  });
});

describe('readInspirationInsight', () => {
  it('recommendedTopics valid → 返回', () => {
    const parsed = readInspirationInsight({
      recommendedTopics: [{ title: 't1', rationale: 'r1' }],
    });
    expect(parsed?.recommendedTopics).toHaveLength(1);
  });
  it('recommendedTopics 缺 rationale → 整体 null (schema 严格)', () => {
    const parsed = readInspirationInsight({
      recommendedTopics: [{ title: 't1' }],
    });
    expect(parsed).toBeNull();
  });
  it('null → null', () => {
    expect(readInspirationInsight(null)).toBeNull();
  });
});
