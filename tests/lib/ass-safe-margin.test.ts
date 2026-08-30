import { describe, it, expect } from 'vitest';
import { buildAssCaptions } from '@/lib/video-production/ass-captions';

const style = {
  fontFamily: 'PingFang SC' as const, fontSize: 44, primaryColor: '#FFFFFF',
  outlineColor: '#000000', outlineWidth: 2, marginV: 120,
};
const events = [{ startMs: 0, endMs: 2000, text: '第一句' }];

/** 从 ASS 的 Style 行里取 MarginV(倒数第二个字段)。 */
function marginVOf(ass: string): number {
  const line = ass.split('\n').find((l) => l.startsWith('Style: Default'))!;
  const cols = line.split(',');
  return Number(cols[cols.length - 2]);
}

describe('字幕烧录要避开平台 UI', () => {
  it('竖屏: marginV 120 会被抬到 350', () => {
    expect(marginVOf(buildAssCaptions(events, style, { width: 1080, height: 1920 }))).toBe(350);
  });

  it('横屏: 原样保留 120', () => {
    expect(marginVOf(buildAssCaptions(events, style, { width: 1920, height: 1080 }))).toBe(120);
  });

  it('拿不到画幅时不动它 —— 连是不是竖屏都不知道, 凭空抬会顶到画面中间', () => {
    expect(marginVOf(buildAssCaptions(events, style))).toBe(120);
  });

  it('用户自己设得更高时不按回去', () => {
    const high = { ...style, marginV: 500 };
    expect(marginVOf(buildAssCaptions(events, high, { width: 1080, height: 1920 }))).toBe(500);
  });
});
