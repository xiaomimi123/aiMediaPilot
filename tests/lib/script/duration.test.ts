import { describe, expect, it } from 'vitest';
import { countSpokenChars, estimateSec, segmentBudgetSec, checkDuration } from '@/lib/script/duration';
import { SEGMENT_ROLES, ROLE_SHARE, ROLE_LABEL, DEFAULT_TARGET_SEC, type Script } from '@/lib/script/model';

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

describe('story beats', () => {
  it('uses story beats as segment names and shares', () => {
    expect(ROLE_LABEL).toEqual({ hook: '钩子', conceptA: '我是谁·当时', conceptB: '遇到什么', fact: '怎么做的', bridge: '结果', close: '经验或悬念' });
    expect(ROLE_SHARE).toEqual({ hook: 0.1, conceptA: 0.15, conceptB: 0.2, fact: 0.2, bridge: 0.25, close: 0.1 });
    expect(DEFAULT_TARGET_SEC).toBe(75);
  });
});

describe('checkDuration', () => {
  it('passes a script exactly on budget', () => {
    // 60s: 6 / 9 / 12 / 12 / 15 / 6 秒 → ×5 字
    const r = checkDuration(scriptWith([30, 45, 60, 60, 75, 30]), 60);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.hints).toEqual([]);
    expect(r.totalSec).toBe(60);
  });

  it('only the whole film over its limit fails; a long segment is just a hint', () => {
    // 钩子预算 6s, 上限 7.5s; 60 字 = 12s; 全片 63s 在上限 66s 内
    const r = checkDuration(scriptWith([60, 45, 60, 45, 75, 30]), 60);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.segments[0]).toMatchObject({ index: 1, role: 'hook', estSec: 12, budgetSec: 6, limitSec: 7.5, over: true });
    expect(r.hints).toEqual(['第1段「钩子」约 12 秒，参考 6 秒（约 30 字）']);
  });

  it('fails when the whole film is over its limit and names the long segments', () => {
    const r = checkDuration(scriptWith([30, 45, 60, 200, 75, 30]), 60);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(['全片约 88 秒，目标 60 秒（上限 66 秒） —— 删到约 330 字以内']);
    expect(r.hints).toEqual(['第4段「怎么做的」约 40 秒，参考 12 秒（约 60 字）']);
  });
});
