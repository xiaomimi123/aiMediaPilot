import { describe, expect, it } from 'vitest';
import { countSpokenChars, estimateSec, segmentBudgetSec, checkDuration } from '@/lib/script/duration';
import { SEGMENT_ROLES, ROLE_SHARE, type Script } from '@/lib/script/model';

function scriptWith(lengths: number[]): Script {
  return { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };
}

describe('countSpokenChars', () => {
  it('counts CJK chars one each and ignores punctuation', () => {
    expect(countSpokenChars('你好，世界！')).toBe(4);
  });
  it('counts latin runs by ceil(len/3)', () => {
    // GPT(3→1) 4o(2→1) 涨价(2) 3(1→1) 倍(1)
    expect(countSpokenChars('GPT-4o 涨价 3 倍')).toBe(6);
  });
  it('returns 0 for empty text', () => {
    expect(countSpokenChars('')).toBe(0);
  });
});

describe('estimateSec', () => {
  it('uses 5 chars per second rounded to 0.1', () => {
    expect(estimateSec('字'.repeat(50))).toBe(10);
    expect(estimateSec('字'.repeat(49))).toBe(9.8);
  });
});

describe('segment shares', () => {
  it('sum to 1', () => {
    const sum = SEGMENT_ROLES.reduce((n, r) => n + ROLE_SHARE[r], 0);
    expect(sum).toBeCloseTo(1, 6);
  });
  it('budget for hook at 60s is 6s', () => {
    expect(segmentBudgetSec('hook', 60)).toBe(6);
  });
});

describe('checkDuration', () => {
  it('passes a script exactly on budget', () => {
    // 60s: 6 / 13.5 / 13.5 / 9 / 13.5 / 4.5 秒 → ×5 字
    const r = checkDuration(scriptWith([30, 67, 67, 45, 67, 22]), 60);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.totalSec).toBeCloseTo(59.6, 1);
  });

  it('flags an over-limit segment with actual values and a char target', () => {
    // 冷知识预算 9s, 上限 11.3s; 187 字 = 37.4s
    const r = checkDuration(scriptWith([30, 67, 67, 187, 67, 22]), 60);
    expect(r.ok).toBe(false);
    const fact = r.segments[3];
    expect(fact).toMatchObject({ index: 4, role: 'fact', estSec: 37.4, budgetSec: 9, limitSec: 11.3, over: true });
    expect(r.issues[0]).toBe('第4段「冷知识」约 37.4 秒，上限 11.3 秒 —— 删到约 56 字以内，只改这一段');
    expect(r.issues[1]).toBe('全片约 88 秒，目标 60 秒（上限 66 秒）');
  });

  it('flags total even when every segment is within its own limit', () => {
    // 每段都到 1.2 倍预算: 单段不超 1.25, 全片 72s > 66s
    const r = checkDuration(scriptWith([36, 81, 81, 54, 81, 27]), 60);
    expect(r.segments.every((s) => !s.over)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(['全片约 72 秒，目标 60 秒（上限 66 秒）']);
  });
});
