import { describe, expect, it } from 'vitest';
import { computeBaseline, judge, median } from '@/lib/benchmark/rules';

const now = new Date('2026-09-28T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);

describe('rules', () => {
  it('median of odd and even lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('baseline uses only the last 90 days and needs 3 works', () => {
    expect(computeBaseline([{ digg: 100, publishedAt: daysAgo(1) }, { digg: 200, publishedAt: daysAgo(2) }], now)).toBeNull();
    expect(computeBaseline([100, 200, 300].map((d, i) => ({ digg: d, publishedAt: daysAgo(i + 1) })).concat({ digg: 99999, publishedAt: daysAgo(200) }), now)).toBe(200);
  });
  it('flags a recent work at 3x baseline and at least 1000 likes', () => {
    expect(judge({ digg: 3000, publishedAt: daysAgo(3) }, 1000, now)).toEqual({ ratio: 3, isHit: true });
    expect(judge({ digg: 2900, publishedAt: daysAgo(3) }, 1000, now)).toEqual({ ratio: 2.9, isHit: false });
    expect(judge({ digg: 900, publishedAt: daysAgo(3) }, 100, now)).toEqual({ ratio: 9, isHit: false });
  });
  it('does not flag an old pinned work', () => {
    expect(judge({ digg: 90000, publishedAt: daysAgo(45) }, 1000, now).isHit).toBe(false);
  });
  it('gives no ratio without a baseline', () => {
    expect(judge({ digg: 90000, publishedAt: daysAgo(1) }, null, now)).toEqual({ ratio: null, isHit: false });
  });
});
