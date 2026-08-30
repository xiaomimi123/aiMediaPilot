import { describe, it, expect } from 'vitest';
import { platformSafeMarginV, PLATFORM_UI_BOTTOM_RATIO } from '@/lib/video-production/caption-safe-zone';

describe('platformSafeMarginV —— 字幕不能被平台自己的 UI 盖住', () => {
  it('竖屏 1080x1920 至少要抬到 350 —— 抖音底部有文案/音乐条', () => {
    expect(platformSafeMarginV({ width: 1080, height: 1920 })).toBeGreaterThanOrEqual(350);
  });

  it('横屏没有这个问题, 保持小边距', () => {
    expect(platformSafeMarginV({ width: 1920, height: 1080 })).toBeLessThan(150);
  });

  it('按比例算, 不是写死 350 —— 换个竖屏分辨率也要对', () => {
    const small = platformSafeMarginV({ width: 720, height: 1280 });
    const big = platformSafeMarginV({ width: 1080, height: 1920 });
    expect(small / 1280).toBeCloseTo(big / 1920, 2);
  });

  it('遮挡比例是有依据的常量, 不是随手取的', () => {
    expect(PLATFORM_UI_BOTTOM_RATIO).toBeGreaterThan(0.15);
    expect(PLATFORM_UI_BOTTOM_RATIO).toBeLessThan(0.25);
  });
});

describe('clampCaptionMargin —— 只抬不降', () => {
  it('配置值低于安全线时抬上去', async () => {
    const { clampCaptionMargin } = await import('@/lib/video-production/caption-safe-zone');
    const r = clampCaptionMargin(120, { width: 1080, height: 1920 });
    expect(r.marginV).toBeGreaterThanOrEqual(350);
    expect(r.raised).toBe(true);
  });

  it('配置值本来就够高就不动它 —— 用户可能有自己的道理', async () => {
    const { clampCaptionMargin } = await import('@/lib/video-production/caption-safe-zone');
    const r = clampCaptionMargin(500, { width: 1080, height: 1920 });
    expect(r.marginV).toBe(500);
    expect(r.raised).toBe(false);
  });

  it('横屏一律不动', async () => {
    const { clampCaptionMargin } = await import('@/lib/video-production/caption-safe-zone');
    expect(clampCaptionMargin(100, { width: 1920, height: 1080 }).marginV).toBe(100);
  });
});
