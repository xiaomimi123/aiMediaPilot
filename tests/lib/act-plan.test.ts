import { describe, it, expect } from 'vitest';
import { buildActPlan, OVER_TOLERANCE, SPEAKING_CHARS_PER_SEC, estimateSpokenSec } from '@/lib/script/act-plan';
import { ACT_KEYS, ACT_RATIOS } from '@/lib/script/six-act';

/** 按"想要几秒"倒推出对应字数的台词 —— 实际时长现在由字数决定。 */
function narrationOf(sec: number): string {
  return '字'.repeat(Math.round(sec * SPEAKING_CHARS_PER_SEC));
}

function acts(targets: Partial<Record<string, number>> = {}) {
  return ACT_KEYS.map((act) => ({
    act,
    title: act,
    narration: narrationOf(targets[act] ?? 10),
    visual: '画面',
    note: '',
    targetSec: targets[act] ?? 10,
    beats: [],
    facts: [],
  }));
}

describe('buildActPlan', () => {
  it('目标时长 = ACT_RATIOS × 总时长', () => {
    const plan = buildActPlan(acts(), 60);
    const hook = plan.rows.find((r) => r.act === 'hook')!;
    expect(hook.targetSec).toBeCloseTo(ACT_RATIOS.hook * 60);
    const a = plan.rows.find((r) => r.act === 'concept_a')!;
    expect(a.targetSec).toBeCloseTo(13.5); // 0.225 × 60, 与 spec 里的例子一致
  });

  it('实际时长按**字数**估, 不取稿子里写的 targetSec —— 打字时才会实时变', () => {
    const plan = buildActPlan(acts({ concept_a: 15 }), 60);
    expect(plan.rows.find((r) => r.act === 'concept_a')!.actualSec).toBe(15);
  });

  it('同一幕字数翻倍, 实际时长跟着翻倍(targetSec 原样不动也不影响)', () => {
    const one = buildActPlan(
      [{ act: 'hook', narration: narrationOf(6), targetSec: 99 }],
      60,
    );
    const two = buildActPlan(
      [{ act: 'hook', narration: narrationOf(12), targetSec: 99 }],
      60,
    );
    expect(two.rows[0].actualSec).toBeCloseTo(one.rows[0].actualSec * 2, 1);
  });

  it('estimateSpokenSec 按舒适语速换算, 空台词是 0 秒', () => {
    expect(estimateSpokenSec('')).toBe(0);
    expect(estimateSpokenSec('字'.repeat(50))).toBeCloseTo(50 / SPEAKING_CHARS_PER_SEC, 5);
  });

  it('标点不计入字数 —— 念的时候不出声', () => {
    expect(estimateSpokenSec('你好，世界。')).toBeCloseTo(estimateSpokenSec('你好世界'), 5);
  });

  it('合计与超出: 六幕各 10 秒、总时长 60 → 合计 60, 不超', () => {
    const plan = buildActPlan(acts(), 60);
    expect(plan.totalActualSec).toBe(60);
    expect(plan.overSec).toBe(0);
  });

  it('spec 里的例子: 合计 64 秒、总时长 60 → 超出 4 秒', () => {
    const plan = buildActPlan(acts({ concept_a: 14 }), 60);
    expect(plan.totalActualSec).toBe(64);
    expect(plan.overSec).toBe(4);
  });

  it('少于总时长时 overSec 为 0, 不报负数', () => {
    const plan = buildActPlan(acts({ hook: 4 }), 60);
    expect(plan.overSec).toBe(0);
    expect(plan.totalActualSec).toBe(54);
  });

  it('超出目标 10% 以上标 warn', () => {
    // hook 目标 = 6 秒, 容忍到 6.6
    expect(buildActPlan(acts({ hook: 7 }), 60).rows.find((r) => r.act === 'hook')!.warn).toBe(true);
    expect(buildActPlan(acts({ hook: 6.5 }), 60).rows.find((r) => r.act === 'hook')!.warn).toBe(false);
  });

  it('容忍度是导出的常量, 不是散在代码里的魔法数字', () => {
    expect(OVER_TOLERANCE).toBe(1.1);
  });

  it('六幕顺序固定, 不随输入顺序变 —— 左栏常驻不滚动, 顺序必须稳定', () => {
    const shuffled = [...acts()].reverse();
    expect(buildActPlan(shuffled, 60).rows.map((r) => r.act)).toEqual([...ACT_KEYS]);
  });

  it('没台词的幕实际时长是 0, 不会因为写了 targetSec 就算它有内容', () => {
    const plan = buildActPlan(
      [{ act: 'hook', narration: '', targetSec: 20 }],
      60,
    );
    expect(plan.rows[0].actualSec).toBe(0);
  });

  it('缺幕时补一个空行而不是漏掉 —— 左栏永远六项', () => {
    const missing = acts().filter((a) => a.act !== 'trivia');
    const plan = buildActPlan(missing, 60);
    expect(plan.rows).toHaveLength(6);
    const trivia = plan.rows.find((r) => r.act === 'trivia')!;
    expect(trivia.actualSec).toBe(0);
    expect(trivia.missing).toBe(true);
  });

  it('总时长为 0 时不除零, 目标全为 0 且不误报 warn', () => {
    const plan = buildActPlan(acts(), 0);
    expect(plan.rows.every((r) => r.targetSec === 0)).toBe(true);
    expect(plan.rows.some((r) => r.warn)).toBe(false);
  });

  it('每一行带中文幕名, 左栏直接用', () => {
    const plan = buildActPlan(acts(), 60);
    expect(plan.rows.find((r) => r.act === 'hook')!.label).toBe('开场钩子');
  });
});
