import { describe, expect, it } from 'vitest';
import { emptyChecklist, isEmptyChecklist, isReady, needsHookRewrite } from '@/lib/checklist/types';
import type { PublishChecklistState } from '@/lib/checklist/types';

function fullCompleted(): PublishChecklistState {
  return {
    reviewedHook: true,
    reviewedRetention: true,
    reviewedTitleCaption: true,
    reviewedCover: true,
    finalTitle: '我的标题',
    finalCoverNote: '用候选 2',
    actionItemsAdopted: [0],
  };
}

describe('isReady', () => {
  it('空 checklist + 任意 hookScore → false', () => {
    expect(isReady({ state: emptyChecklist(), hookScore: 100 })).toBe(false);
    expect(isReady({ state: emptyChecklist(), hookScore: null })).toBe(false);
  });

  it('全勾 + hookScore 高 → true', () => {
    expect(isReady({ state: fullCompleted(), hookScore: 90 })).toBe(true);
  });

  it('hookScore null → 不要求重写, 仍 true', () => {
    expect(isReady({ state: fullCompleted(), hookScore: null })).toBe(true);
  });

  it('hookScore < 70 + 无 rewrittenHook → false', () => {
    expect(isReady({ state: fullCompleted(), hookScore: 50 })).toBe(false);
  });

  it('hookScore < 70 + rewrittenHook 已填 → true', () => {
    const state = { ...fullCompleted(), rewrittenHook: '新钩子文案' };
    expect(isReady({ state, hookScore: 50 })).toBe(true);
  });

  it('finalTitle 仅空白 → false (trim)', () => {
    const state = { ...fullCompleted(), finalTitle: '   ' };
    expect(isReady({ state, hookScore: 90 })).toBe(false);
  });

  it('actionItemsAdopted 为空 → false', () => {
    const state = { ...fullCompleted(), actionItemsAdopted: [] };
    expect(isReady({ state, hookScore: 90 })).toBe(false);
  });
});

describe('needsHookRewrite', () => {
  it('null → false', () => {
    expect(needsHookRewrite(null)).toBe(false);
  });
  it('70 → false (边界, ≥ 70 不需要)', () => {
    expect(needsHookRewrite(70)).toBe(false);
  });
  it('69 → true', () => {
    expect(needsHookRewrite(69)).toBe(true);
  });
  it('0 → true', () => {
    expect(needsHookRewrite(0)).toBe(true);
  });
});

describe('isEmptyChecklist', () => {
  it('emptyChecklist() → true', () => {
    expect(isEmptyChecklist(emptyChecklist())).toBe(true);
  });
  it('两次 emptyChecklist() 深等 (回归旧 === 引用相等 bug)', () => {
    const a = emptyChecklist();
    const b = emptyChecklist();
    expect(a === b).toBe(false); // 引用不同
    expect(isEmptyChecklist(a) && isEmptyChecklist(b)).toBe(true);
  });
  it('用户勾了 reviewedHook → false', () => {
    const s = { ...emptyChecklist(), reviewedHook: true };
    expect(isEmptyChecklist(s)).toBe(false);
  });
  it('finalTitle 非空 → false', () => {
    const s = { ...emptyChecklist(), finalTitle: '我的' };
    expect(isEmptyChecklist(s)).toBe(false);
  });
  it('actionItemsAdopted 非空 → false', () => {
    const s = { ...emptyChecklist(), actionItemsAdopted: [0] };
    expect(isEmptyChecklist(s)).toBe(false);
  });
  it('rewrittenHook / completedAt 也算非空', () => {
    expect(isEmptyChecklist({ ...emptyChecklist(), rewrittenHook: 'x' })).toBe(false);
    expect(isEmptyChecklist({ ...emptyChecklist(), completedAt: '2026-07-05' })).toBe(false);
  });
});
