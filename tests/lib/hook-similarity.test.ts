import { describe, expect, it } from 'vitest';
import { isHookTypeOverlap } from '@/lib/patterns/hook-similarity';

describe('isHookTypeOverlap', () => {
  it('完全相同 → true', () => {
    expect(isHookTypeOverlap('数字', '数字')).toBe(true);
  });

  it('双向 substring → true', () => {
    expect(isHookTypeOverlap('数字', '用数字')).toBe(true);
    expect(isHookTypeOverlap('反差', '制造反差')).toBe(true);
  });

  it('倒序描述 (2-char 共享) → true', () => {
    // 这是原 substring 失败 case
    expect(isHookTypeOverlap('数字开头', '开头用数字')).toBe(true);
    expect(isHookTypeOverlap('悬念开场', '开场留悬念')).toBe(true);
  });

  it('同义词组 → true', () => {
    expect(isHookTypeOverlap('数字', '清单')).toBe(true);
    expect(isHookTypeOverlap('反差', '颠覆认知')).toBe(true);
    expect(isHookTypeOverlap('情绪', '痛点共鸣')).toBe(true);
  });

  it('完全无关 → false', () => {
    expect(isHookTypeOverlap('数字', '故事')).toBe(false);
    expect(isHookTypeOverlap('权威专家', '情绪痛点')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(isHookTypeOverlap('', '数字')).toBe(false);
    expect(isHookTypeOverlap('数字', '')).toBe(false);
  });

  it('前缀虚词 (用/以/含) 不影响匹配', () => {
    expect(isHookTypeOverlap('用数字', '数字')).toBe(true);
    expect(isHookTypeOverlap('以悬念', '悬念')).toBe(true);
  });
});
