import { describe, expect, it } from 'vitest';
import { parseLooseBeijingTime } from '@/lib/douyin/parse-time';

describe('parseLooseBeijingTime', () => {
  it('YYYY-MM-DD HH:MM 视为 Beijing 时间 (无秒)', () => {
    const d = parseLooseBeijingTime('2026-07-05 12:30');
    // Beijing 12:30 = UTC 04:30
    expect(d?.toISOString()).toBe('2026-07-05T04:30:00.000Z');
  });

  it('YYYY-MM-DD HH:MM:SS 含秒版本', () => {
    const d = parseLooseBeijingTime('2026-07-05 12:30:45');
    expect(d?.toISOString()).toBe('2026-07-05T04:30:45.000Z');
  });

  it('T 分隔也接受', () => {
    const d = parseLooseBeijingTime('2026-07-05T12:30');
    expect(d?.toISOString()).toBe('2026-07-05T04:30:00.000Z');
  });

  it('前后空白 tolerable', () => {
    const d = parseLooseBeijingTime('  2026-07-05 12:30  ');
    expect(d?.toISOString()).toBe('2026-07-05T04:30:00.000Z');
  });

  it('回归: 之前旧公式吃 "HH:MM:SS" 会产 NaN, 兜底成 new Date() → 打乱 retro 计时', () => {
    // 旧公式 `input.replace(' ', 'T') + ':00'` 对 "12:30:45" 会得到
    // "T12:30:45:00" (多余冒号) → NaN → 调用侧 ?? new Date().
    // 新公式必须成功返回一个合法 Date, 不再走兜底。
    const d = parseLooseBeijingTime('2026-01-01 12:30:15');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).not.toBeNaN();
  });

  it('回归: 之前不带 TZ, 非 CST server 结果偏 8h. 新版应固定 Beijing.', () => {
    const d = parseLooseBeijingTime('2026-07-05 00:00');
    // Beijing 00:00 == UTC 前一天 16:00
    expect(d?.toISOString()).toBe('2026-07-04T16:00:00.000Z');
  });

  it('空 / 非法格式 → null', () => {
    expect(parseLooseBeijingTime('')).toBeNull();
    expect(parseLooseBeijingTime('random')).toBeNull();
    expect(parseLooseBeijingTime('2026-07-05')).toBeNull();
    expect(parseLooseBeijingTime('2026/07/05 12:30')).toBeNull();
  });
});
