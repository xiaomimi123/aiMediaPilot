import { describe, expect, it } from 'vitest';
import { dayIndexFor, localDateString } from '@/lib/content-plan/day-index';

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

describe('localDateString: 本地日期, 不是 UTC(终审 critical 的回归)', () => {
  /*
   * 北京时间凌晨 0-8 点, toISOString() 的日期比本地少一天 —— 用它当规划
   * startDate 会让整份规划错位一天。本机时区 Asia/Shanghai, 直接用凌晨时刻钉:
   * 该时刻的 UTC 日期是前一天, localDateString 必须给本地的那天。
   */
  it('凌晨 1 点: 本地日期与 UTC 日期不同, 取本地', () => {
    const d = new Date('2026-09-10T01:00:00+08:00');
    expect(d.toISOString().slice(0, 10)).toBe('2026-09-09'); // UTC 陷阱本身
    expect(localDateString(d)).toBe('2026-09-10');           // 我们要的
  });
  it('下午: 两者一致(无回归)', () => {
    const d = new Date('2026-09-10T20:00:00+08:00');
    expect(localDateString(d)).toBe('2026-09-10');
  });
});
