import { describe, it, expect } from 'vitest';
import { judgeShotLayout } from '@/lib/video-production/frame-layout';

const P = { width: 1080, height: 1920 };
const s = (o: Partial<{ bottomReach: number; contentRatio: number; sideBySide: boolean }> = {}) => ({
  bottomReach: 0.75, contentRatio: 0.05, sideBySide: false, ...o,
});

describe('竖屏并排块判定(读 DOM 真实几何, 不猜像素)', () => {
  it('多数帧并排 → 拦', () => {
    const r = judgeShotLayout([s({ sideBySide: true }), s({ sideBySide: true }), s()], P);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('并排');
  });

  it('个别帧并排(比如入场动画的一瞬)→ 不误伤', () => {
    expect(judgeShotLayout([s(), s({ sideBySide: true }), s()], P).ok).toBe(true);
  });

  it('横屏并排是正常排版 → 不判', () => {
    const land = { width: 1920, height: 1080 };
    expect(judgeShotLayout([s({ sideBySide: true }), s({ sideBySide: true })], land).ok).toBe(true);
  });

  it('没内容的帧不归它管', () => {
    expect(judgeShotLayout([s({ sideBySide: true, contentRatio: 0.002 })], P).ok).toBe(true);
  });

  it('拿不到 DOM 几何(旧调用方)时当作没并排, 行为不变', () => {
    expect(judgeShotLayout([{ bottomReach: 0.75, contentRatio: 0.05 }], P).ok).toBe(true);
  });
});
