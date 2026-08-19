import { describe, expect, it } from 'vitest';
import { ALL_NAV_ITEMS, MOBILE_NAV_ITEMS, WORKBENCH_NAV_ITEMS } from '@/components/cockpit/sidebar';

// 十一期 T1: 「账号定位」插入 WORKBENCH_NAV_ITEMS 首位——覆盖 task-1-brief.md 里
// 明确写出的验收断言 (`WORKBENCH_NAV_ITEMS[0].id === 'positioning'` 且长度 +1)，
// 同时守住 MOBILE_NAV_ITEMS/ALL_NAV_ITEMS 是靠 spread WORKBENCH_NAV_ITEMS 派生、
// 不会漏收或重复收 positioning 这一隐含前提。
// 十六期 T3: 侧栏收窄至 4 项——WORKBENCH_NAV_ITEMS 去掉 momentum (今日推进并入新首页,
// 见 task-3-brief.md), 长度断言同步从 4 改为 3。
describe('WORKBENCH_NAV_ITEMS', () => {
  it('positioning 是工作台组第一项, label 逐字「账号定位」', () => {
    expect(WORKBENCH_NAV_ITEMS[0].id).toBe('positioning');
    expect(WORKBENCH_NAV_ITEMS[0].label).toBe('账号定位');
  });

  it('长度为 3 (positioning + inspirations + radar)', () => {
    expect(WORKBENCH_NAV_ITEMS.length).toBe(3);
    expect(WORKBENCH_NAV_ITEMS.map((item) => item.id)).toEqual([
      'positioning',
      'inspirations',
      'radar',
    ]);
  });
});

describe('派生导航列表同步收到 positioning', () => {
  it('MOBILE_NAV_ITEMS 首项是 positioning (spread 自 WORKBENCH_NAV_ITEMS)', () => {
    expect(MOBILE_NAV_ITEMS[0].id).toBe('positioning');
  });

  it('ALL_NAV_ITEMS 里 positioning 只出现一次', () => {
    expect(ALL_NAV_ITEMS.filter((item) => item.id === 'positioning')).toHaveLength(1);
  });
});
