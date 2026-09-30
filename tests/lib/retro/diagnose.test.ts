import { describe, expect, it } from 'vitest';
import { diagnose, computeBaseline, assignSegments, type MetricSet } from '@/lib/retro/diagnose';

const ms = (o: Partial<MetricSet>): MetricSet => ({ viewCount: 1000, likeCount: 20, favoriteCount: 5, shareCount: 2, subscribeCount: 1, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.3, avgViewSec: 10, ...o });
const history = [ms({}), ms({}), ms({}), ms({ completionRate5s: 0.6 })];
const lines = [
  { startSec: 0, endSec: 4, text: '开头一句', segment: '开场钩子' },
  { startSec: 4, endSec: 12, text: '背景铺垫很长', segment: '概念A' },
  { startSec: 12, endSec: 20, text: '后面的内容', segment: '概念B' },
];

describe('diagnose', () => {
  it('compares each stage with the usual (bounce: lower is better)', () => {
    const d = diagnose({ work: ms({ bounceRate2s: 0.2, completionRate5s: 0.3, completionRate: 0.1 }), history, lines, benchmark: null, curve: [] });
    const by = Object.fromEntries(d.stages.map((s) => [s.key, s.verdict]));
    expect(by).toMatchObject({ hook2s: 'good', hook5s: 'bad', ending: 'even' });
    expect(d.baselineCount).toBe(4);
  });
  it('maps the average view second onto the transcript', () => {
    const d = diagnose({ work: ms({ avgViewSec: 8.2 }), history, lines, benchmark: null, curve: [] });
    expect(d.dropAt).toEqual({ sec: 8.2, segment: '概念A', line: '背景铺垫很长' });
    expect(d.stages.find((s) => s.key === 'middle')?.note).toContain('平均在第 8 秒离开，这时在讲「概念A」：『背景铺垫很长』');
  });
  it('gives seconds only without a transcript', () => {
    const d = diagnose({ work: ms({ avgViewSec: 8.2 }), history, lines: null, benchmark: null, curve: [] });
    expect(d.dropAt).toEqual({ sec: 8.2, segment: null, line: null });
    expect(d.stages.find((s) => s.key === 'middle')?.note).toContain('平均在第 8 秒离开（没有转写，对不到具体句子）');
  });
  it('does not compare when history has fewer than 3 works', () => {
    const d = diagnose({ work: ms({}), history: history.slice(0, 2), lines, benchmark: null, curve: [] });
    expect(d.stages.every((s) => s.verdict === 'na')).toBe(true);
    expect(d.stages[0].note).toContain('历史作品太少');
  });
  it('compares like multiples with the benchmark', () => {
    const d = diagnose({ work: ms({ likeCount: 40 }), history, lines, benchmark: { digg: 4008, baselineDigg: 466 }, curve: [] });
    expect(d.benchmark).toEqual({ theirRatio: 8.6, myRatio: 2 });
  });
  it('assigns transcript lines to script segments by character overlap', () => {
    const segs = [{ label: '开场钩子', text: '做电商的先别买剪辑课' }, { label: '概念A', text: '打开豆包点技能入口接入Flova' }];
    const out = assignSegments(segs, [
      { startSec: 0, endSec: 3, text: '做电商的，先别买剪辑课' },
      { startSec: 3, endSec: 7, text: '打开豆包，点技能入口' },
      { startSec: 7, endSec: 9, text: '哈哈哈哈' },
    ]);
    expect(out.map((l) => l.segment)).toEqual(['开场钩子', '概念A', null]);
  });
  it('computes rate stages from counts', () => {
    const b = computeBaseline(history);
    expect(b.medians.like).toBeCloseTo(0.02);
    expect(b.likeMedian).toBe(20);
  });
});
