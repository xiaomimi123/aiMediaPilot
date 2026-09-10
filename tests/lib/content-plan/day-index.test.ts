import { describe, expect, it } from 'vitest';
import { dayIndexFor } from '@/lib/content-plan/day-index';

describe('dayIndexFor', () => {
  it('startDate 当天 → 1', () => {
    expect(dayIndexFor('2026-09-10', '2026-09-10', 30)).toBe(1);
  });

  it('startDate 前一天 → null(规划还没开始)', () => {
    expect(dayIndexFor('2026-09-10', '2026-09-09', 30)).toBeNull();
  });

  it('第 30 天(totalDays=30) → 30', () => {
    expect(dayIndexFor('2026-09-10', '2026-10-09', 30)).toBe(30);
  });

  it('第 31 天(超出 totalDays) → null', () => {
    expect(dayIndexFor('2026-09-10', '2026-10-10', 30)).toBeNull();
  });
});
