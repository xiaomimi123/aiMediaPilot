import { describe, expect, it } from 'vitest';
import {
  titleFingerprint,
  clusterByTopic,
  composeHeat,
  applyTimeDecay,
  HEAT_WEIGHTS,
} from '@/lib/radar/scoring';

describe('titleFingerprint', () => {
  it('返回稳定的 hex hash 串', () => {
    const fp = titleFingerprint('ChatGPT 太强了');
    expect(fp).toMatch(/^[0-9a-f]+$/);
    expect(fp.length).toBeGreaterThan(0);
  });

  it('相同输入产出相同指纹 (确定性)', () => {
    expect(titleFingerprint('AI 工具评测')).toBe(titleFingerprint('AI 工具评测'));
  });

  it('忽略大小写差异', () => {
    expect(titleFingerprint('ChatGPT 发布新模型')).toBe(titleFingerprint('chatgpt 发布新模型'));
  });

  it('忽略首尾/内部空白差异', () => {
    expect(titleFingerprint('  AI  工具 评测  ')).toBe(titleFingerprint('AI工具评测'));
  });

  it('忽略半角标点差异', () => {
    expect(titleFingerprint('AI,太强了!')).toBe(titleFingerprint('AI太强了'));
  });

  it('全角字符归一为半角后与半角版本一致 (字母/数字/标点)', () => {
    expect(titleFingerprint('ＡＩ工具评测２０２６')).toBe(titleFingerprint('AI工具评测2026'));
    expect(titleFingerprint('AI，太强了')).toBe(titleFingerprint('AI,太强了'));
  });

  it('不同语义标题产出不同指纹', () => {
    expect(titleFingerprint('ChatGPT 发布新模型')).not.toBe(titleFingerprint('Claude 发布新模型'));
  });
});

describe('clusterByTopic', () => {
  it('标题指纹相同 → 归入同一簇', () => {
    const items = [
      { titleFingerprint: 'fp-a', matchedKeywords: ['x'] },
      { titleFingerprint: 'fp-a', matchedKeywords: ['y'] },
      { titleFingerprint: 'fp-b', matchedKeywords: ['z'] },
    ];
    const clusters = clusterByTopic(items);
    expect(clusters).toHaveLength(2);
    const sizes = clusters.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('关键词 Jaccard 恰好 = 0.6 (边界) → 归入同一簇', () => {
    // A={a,b,c} B={a,b,c,d,e} — 交集 3 / 并集 5 = 0.6
    const items = [
      { titleFingerprint: 'fp-1', matchedKeywords: ['a', 'b', 'c'] },
      { titleFingerprint: 'fp-2', matchedKeywords: ['a', 'b', 'c', 'd', 'e'] },
    ];
    const clusters = clusterByTopic(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(2);
  });

  it('关键词 Jaccard < 0.6 → 不归入同一簇', () => {
    // A={a} B={a,b} — 交集 1 / 并集 2 = 0.5
    const items = [
      { titleFingerprint: 'fp-1', matchedKeywords: ['a'] },
      { titleFingerprint: 'fp-2', matchedKeywords: ['a', 'b'] },
    ];
    const clusters = clusterByTopic(items);
    expect(clusters).toHaveLength(2);
  });

  it('两组关键词皆为空数组 → 不因"都是空集"而误判同簇', () => {
    const items = [
      { titleFingerprint: 'fp-1', matchedKeywords: [] },
      { titleFingerprint: 'fp-2', matchedKeywords: [] },
    ];
    const clusters = clusterByTopic(items);
    expect(clusters).toHaveLength(2);
  });

  it('传递性合并: A~B (指纹相同) 且 B~C (关键词达标) → A/B/C 同簇', () => {
    const items = [
      { titleFingerprint: 'fp-same', matchedKeywords: ['k1'] },
      { titleFingerprint: 'fp-same', matchedKeywords: ['a', 'b', 'c'] },
      { titleFingerprint: 'fp-other', matchedKeywords: ['a', 'b', 'c', 'd', 'e'] },
    ];
    const clusters = clusterByTopic(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('单条 item → 单独一簇', () => {
    const items = [{ titleFingerprint: 'fp-1', matchedKeywords: ['a'] }];
    const clusters = clusterByTopic(items);
    expect(clusters).toEqual([[items[0]]]);
  });

  it('空数组输入 → 空数组输出', () => {
    expect(clusterByTopic([])).toEqual([]);
  });

  it('保留原始 item 引用 (额外字段不丢失)', () => {
    const items = [{ id: 'x1', titleFingerprint: 'fp-1', matchedKeywords: ['a'] }];
    const clusters = clusterByTopic(items);
    expect(clusters[0][0].id).toBe('x1');
  });
});

describe('composeHeat', () => {
  it('权重精确值: relevance*.35 + freshness*.2 + discussion*.25 + feasibility*.2', () => {
    // 80*.35=28 + 60*.2=12 + 70*.25=17.5 + 90*.2=18 = 75.5 → round 76
    const score = composeHeat(
      { relevance: 80, freshness: 60, discussion: 70, feasibility: 90 },
      0
    );
    expect(score).toBe(76);
  });

  it('权重常量之和为 1 (relevance+freshness+discussion+feasibility)', () => {
    const sum =
      HEAT_WEIGHTS.relevance + HEAT_WEIGHTS.freshness + HEAT_WEIGHTS.discussion + HEAT_WEIGHTS.feasibility;
    expect(sum).toBeCloseTo(1);
  });

  it('共现加成: 每多 1 源 +8 分', () => {
    const zero = { relevance: 0, freshness: 0, discussion: 0, feasibility: 0 };
    expect(composeHeat(zero, 0)).toBe(0);
    expect(composeHeat(zero, 1)).toBe(8);
    expect(composeHeat(zero, 2)).toBe(16);
    expect(composeHeat(zero, 3)).toBe(24);
  });

  it('共现加成封顶 +24 (超过 3 源不再增加)', () => {
    const zero = { relevance: 0, freshness: 0, discussion: 0, feasibility: 0 };
    expect(composeHeat(zero, 4)).toBe(24);
    expect(composeHeat(zero, 10)).toBe(24);
  });

  it('clamp 上限 100 (满分 + 共现加成也不超 100)', () => {
    const full = { relevance: 100, freshness: 100, discussion: 100, feasibility: 100 };
    expect(composeHeat(full, 10)).toBe(100);
  });

  it('clamp 下限 0 (防御性: 非法负值输入不产出负分)', () => {
    const negative = { relevance: -50, freshness: -50, discussion: -50, feasibility: -50 };
    expect(composeHeat(negative, 0)).toBe(0);
  });

  it('返回值为整数', () => {
    const score = composeHeat({ relevance: 33, freshness: 33, discussion: 33, feasibility: 33 }, 1);
    expect(Number.isInteger(score)).toBe(true);
  });
});

describe('applyTimeDecay', () => {
  const base = new Date('2026-08-13T12:00:00Z');

  it('0h (刚采集) → 不衰减', () => {
    expect(applyTimeDecay(100, base, base)).toBe(100);
  });

  it('满 24h → 扣 8 分', () => {
    const now = new Date(base.getTime() + 24 * 60 * 60 * 1000);
    expect(applyTimeDecay(100, base, now)).toBe(92);
  });

  it('25h (未满第 2 个 24h 周期) → 与 24h 结果相同, 不重复扣分', () => {
    const now = new Date(base.getTime() + 25 * 60 * 60 * 1000);
    expect(applyTimeDecay(100, base, now)).toBe(92);
  });

  it('240h (10 天) → 触发下限 (原分 30%), 不会继续跌破', () => {
    // 理论扣分 10*8=80 → 100-80=20, 但下限是 100*0.3=30, 应 clamp 到 30
    const now = new Date(base.getTime() + 240 * 60 * 60 * 1000);
    expect(applyTimeDecay(100, base, now)).toBe(30);
  });

  it('下限按原分 30% 计算 (非整分场景 floor 到 Int)', () => {
    // 77*0.3=23.1 → floor 23; 240h 后理论值 77-80=-3, 应 clamp 到 23
    const now = new Date(base.getTime() + 240 * 60 * 60 * 1000);
    expect(applyTimeDecay(77, base, now)).toBe(23);
  });

  it('未过 24h (如 10h) → 不扣分', () => {
    const now = new Date(base.getTime() + 10 * 60 * 60 * 1000);
    expect(applyTimeDecay(100, base, now)).toBe(100);
  });
});
