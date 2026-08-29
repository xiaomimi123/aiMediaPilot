import { describe, it, expect } from 'vitest';
import { measureFrameLayout, judgeShotLayout } from '@/lib/video-production/frame-layout';

const W = 60, H = 107;
function canvas(): Buffer { return Buffer.alloc(W * H * 3, 10); }
function box(b: Buffer, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y*W+x)*3; b[i] = 240; b[i+1] = 240; b[i+2] = 240;
  }
}

describe('measureFrameLayout', () => {
  it('量出内容最下沿在画面多高的位置', () => {
    const b = canvas();
    box(b, 5, 10, 55, 20);
    expect(measureFrameLayout(b, W, H).bottomReach).toBeCloseTo(20 / H, 1);
  });

});

describe('judgeShotLayout(竖屏)', () => {
  const portrait = { width: 1080, height: 1920 };

  it('内容只到上半屏 → 拦, 并说清楚差多少', () => {
    const r = judgeShotLayout([{ bottomReach: 0.45, contentRatio: 0.04 }], portrait);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('下');
  });

  it('排到位又没分栏 → 过', () => {
    expect(judgeShotLayout([{ bottomReach: 0.72, contentRatio: 0.04 }], portrait).ok).toBe(true);
  });

  it('本来就没什么内容的帧不归它管 —— 那是密度那关的事', () => {
    expect(judgeShotLayout([{ bottomReach: 0.2, contentRatio: 0.003 }], portrait).ok).toBe(true);
  });

  it('横屏不判 —— 排版铺不到底在横屏不是问题', () => {
    const land = { width: 1920, height: 1080 };
    expect(judgeShotLayout([{ bottomReach: 0.4, contentRatio: 0.04 }], land).ok).toBe(true);
  });

  it('多数帧合格就放行, 不因个别帧打回', () => {
    const bad = { bottomReach: 0.3, contentRatio: 0.04 };
    const good = { bottomReach: 0.75, contentRatio: 0.04 };
    expect(judgeShotLayout([good, bad, good], portrait).ok).toBe(true);
  });
});
