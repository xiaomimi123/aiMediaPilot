import { describe, it, expect } from 'vitest';
import {
  HOOK_PATTERNS,
  HOOK_LABELS,
  detectHookPattern,
  scoreHookStructure,
  hookStructureHints,
  HOOK_CHAR_BUDGET,
} from '@/lib/hooks/model';

describe('钩子模式', () => {
  it('六种模式', () => {
    expect(HOOK_PATTERNS).toHaveLength(6);
    expect(Object.keys(HOOK_LABELS)).toHaveLength(6);
  });

  it('数字开头 → 数字冲击', () => {
    expect(detectHookPattern('三天用 AI 赚了 5000 块')).toBe('number');
  });

  it('问号结尾 → 悬念提问', () => {
    expect(detectHookPattern('一个 skill 一周卖七十个，它是怎么做到的？')).toBe('question');
  });

  it('「其实不是」这类否定 → 反常识断言', () => {
    expect(detectHookPattern('你以为是价格的问题，其实不是')).toBe('counter');
  });

  it('「你在…的时候」 → 场景代入', () => {
    expect(detectHookPattern('你在超市拿过试吃的小杯酸奶吗')).toBe('scene');
  });

  it('认不出来时归到「其它」而不是硬套一个', () => {
    expect(detectHookPattern('今天讲一本书')).toBe('other');
  });
});

describe('scoreHookStructure —— 只算能量的东西', () => {
  it('控制在字数预算内加分', () => {
    const short = scoreHookStructure('你在超市拿过试吃的小杯酸奶吗');
    const long = scoreHookStructure('你在超市里面拿过那种插在竹签上的一小块食物或者小杯酸奶之类的试吃品吗真的很好吃');
    expect(short.total).toBeGreaterThan(long.total);
    expect(long.notes.join('')).toContain(String(HOOK_CHAR_BUDGET));
  });

  it('第二人称开头加分', () => {
    expect(scoreHookStructure('你有没有发现').total)
      .toBeGreaterThan(scoreHookStructure('我有没有发现').total);
  });

  it('钩子里出现书名号要扣 —— 先讲现象再点书', () => {
    const withBook = scoreHookStructure('《影响力》里讲了互惠原理');
    expect(withBook.notes.join('')).toContain('书名');
    expect(withBook.total).toBeLessThan(scoreHookStructure('有个原理让人很难拒绝别人').total);
  });

  it('满分不超过上限, 空串不报错', () => {
    const s = scoreHookStructure('');
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(s.max);
  });

  it('**不返回任何留存率预测** —— 没有发布数据就编不出这个数', () => {
    const s = scoreHookStructure('你有没有发现');
    expect(Object.keys(s)).not.toContain('retention');
    expect(Object.keys(s)).not.toContain('predictedRetention');
  });
});

describe('hookStructureHints —— 从自己的钩子里归纳', () => {
  const hooks = [
    { text: '你在超市拿过试吃的酸奶吗', pattern: 'scene' },
    { text: '你有没有发现便宜的东西反而贵', pattern: 'counter' },
    { text: '《活着》讲了什么', pattern: 'other' },
    { text: '三天赚了 5000 块', pattern: 'number' },
  ];

  it('统计第二人称开头的占比', () => {
    const hints = hookStructureHints(hooks);
    const h = hints.find((x) => x.key === 'secondPerson')!;
    expect(h.matched).toBe(2);
    expect(h.total).toBe(4);
  });

  it('统计超字数预算的条数', () => {
    const long = '你在超市里面拿过那种插在竹签上的一小块食物或者小杯酸奶之类的试吃品吗';
    const hints = hookStructureHints([...hooks, { text: long, pattern: 'scene' }]);
    expect(hints.find((x) => x.key === 'overBudget')!.matched).toBe(1);
  });

  it('样本太少时标出来 —— 4 条归纳不出规律', () => {
    const hints = hookStructureHints(hooks);
    expect(hints.every((h) => h.underpowered)).toBe(true);
  });

  it('样本够多时不再标 underpowered', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ text: `你看第 ${i} 条`, pattern: 'scene' }));
    expect(hookStructureHints(many).every((h) => !h.underpowered)).toBe(true);
  });

  it('空库返回空数组, 不硬给结论', () => {
    expect(hookStructureHints([])).toEqual([]);
  });
});
