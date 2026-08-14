import { describe, expect, it } from 'vitest';
import { computeIntentMix } from '@/lib/cockpit/intent-stats';

/**
 * `computeIntentMix` — 内容组合比例的纯函数统计 (十期 T6, spec §3「内容组合比例」)。
 *
 * 百分比分母统一取 `total`（含未标注条目）——未标注不显示百分比，只显示条数,
 * 但它在"整块饼"里占的那一份仍然要从 reach/trust/convert 的百分比里扣掉,
 * 这样三者之和天然 ≤ 100（多出来的份额留给未标注/取整损失）。
 *
 * 取整规则用最大余数法 (Hamilton apportionment)：先对 reach/trust/convert 三个
 * 精确占比取 floor，目标总量 targetSum = round(已标注条目占比)，再把
 * (targetSum - 三个 floor 之和) 这几个名额按小数部分从大到小分给对应类别
 * (同小数部分按 reach→trust→convert 的声明顺序决出先后)。数学上可证
 * floorSum ≤ floor(exactSum) ≤ targetSum，remainder 恒 ≥0 且 ≤3，不会出现
 * 「各自独立四舍五入导致三者之和超过 100」的问题 (例如 3/2/2 分 7 份, 各自
 * 独立四舍五入是 43/29/29=101, 本方法固定给出 43/29/28=100)。
 */
describe('computeIntentMix', () => {
  it('空集合 → 全 0', () => {
    expect(computeIntentMix([])).toEqual({ reach: 0, trust: 0, convert: 0, untagged: 0, total: 0 });
  });

  it('全部未标注 → 三个百分比都是 0, untagged 等于 total', () => {
    const items = [{ intent: '' as const }, { intent: '' as const }, { intent: '' as const }];
    expect(computeIntentMix(items)).toEqual({ reach: 0, trust: 0, convert: 0, untagged: 3, total: 3 });
  });

  it('混合且能整除 → 百分比精确, 无需分配余数', () => {
    const items = [
      ...Array(3).fill({ intent: 'reach' as const }),
      ...Array(3).fill({ intent: 'trust' as const }),
      ...Array(3).fill({ intent: 'convert' as const }),
      { intent: '' as const },
    ];
    expect(computeIntentMix(items)).toEqual({ reach: 30, trust: 30, convert: 30, untagged: 1, total: 10 });
  });

  it('全部已标注 (无未标注) → 三者之和为 100', () => {
    const items = [
      ...Array(2).fill({ intent: 'reach' as const }),
      ...Array(1).fill({ intent: 'trust' as const }),
      ...Array(1).fill({ intent: 'convert' as const }),
    ];
    // 精确占比 50/25/25, 无需取整分配
    expect(computeIntentMix(items)).toEqual({ reach: 50, trust: 25, convert: 25, untagged: 0, total: 4 });
  });

  it('四舍五入边界: 3/2/2 分 7 份 → 最大余数法结果为 43/29/28 (和为 100, 不是各自独立四舍五入的 101)', () => {
    const items = [
      ...Array(3).fill({ intent: 'reach' as const }),
      ...Array(2).fill({ intent: 'trust' as const }),
      ...Array(2).fill({ intent: 'convert' as const }),
    ];
    const result = computeIntentMix(items);
    expect(result).toEqual({ reach: 43, trust: 29, convert: 28, untagged: 0, total: 7 });
    expect(result.reach + result.trust + result.convert).toBeLessThanOrEqual(100);
  });

  it('只有 1 条 reach, 其余未标注 → reach 向下取整不超过实际占比', () => {
    const items = [{ intent: 'reach' as const }, { intent: '' as const }, { intent: '' as const }];
    // 1/3 = 33.33%, round(33.33) = 33
    expect(computeIntentMix(items)).toEqual({ reach: 33, trust: 0, convert: 0, untagged: 2, total: 3 });
  });

  it('三者之和恒 ≤ 100 (随机若干组合抽样校验)', () => {
    const combos: Array<[number, number, number, number]> = [
      [1, 1, 1, 1],
      [5, 3, 1, 0],
      [0, 0, 0, 5],
      [11, 13, 7, 2],
      [1, 0, 0, 0],
    ];
    for (const [reach, trust, convert, untagged] of combos) {
      const items = [
        ...Array(reach).fill({ intent: 'reach' as const }),
        ...Array(trust).fill({ intent: 'trust' as const }),
        ...Array(convert).fill({ intent: 'convert' as const }),
        ...Array(untagged).fill({ intent: '' as const }),
      ];
      const result = computeIntentMix(items);
      expect(result.reach + result.trust + result.convert).toBeLessThanOrEqual(100);
      expect(result.total).toBe(reach + trust + convert + untagged);
      expect(result.untagged).toBe(untagged);
    }
  });
});
