import { describe, expect, it } from 'vitest';
import { DOUYIN_OVERLAYS, H, LANDSCAPE_OVERLAYS, LANDSCAPE_ZONE, LAYOUT, W, ZONE, layoutFor } from '../../remotion/kit/tokens';
import { captionLayout, displayWidth } from '../../remotion/kit/text';

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('landscape layout', () => {
  it('is 1920×1080 with the agreed zones', () => {
    expect(LAYOUT.landscape.W).toBe(1920);
    expect(LAYOUT.landscape.H).toBe(1080);
    expect(LANDSCAPE_ZONE).toEqual({
      content: { left: 96, top: 120, width: 1360, height: 765 },
      pip: { left: 1488, top: 120, width: 336, height: 448 },
      title: { left: 1488, top: 568, width: 336, height: 317 },
      captions: { left: 96, top: 905, width: 1360, height: 100 },
    });
    expect(LANDSCAPE_ZONE.content.width / LANDSCAPE_ZONE.content.height).toBeCloseTo(16 / 9, 2);
  });
  it('keeps every zone clear of the generic 16:9 overlays and inside the frame', () => {
    for (const [name, z] of Object.entries(LANDSCAPE_ZONE)) {
      for (const [o, r] of Object.entries(LANDSCAPE_OVERLAYS)) expect(overlaps(z, r), `${name} 被 ${o} 挡住`).toBe(false);
      expect(z.left + z.width).toBeLessThanOrEqual(1920 - 96);
      expect(z.top + z.height).toBeLessThanOrEqual(1080);
    }
  });
  it('leaves the portrait layout exactly as it was', () => {
    expect(LAYOUT.portrait).toEqual({ W, H, ZONE, OVERLAYS: DOUYIN_OVERLAYS });
    expect([W, H]).toEqual([1080, 1920]);
  });
  it('falls back to portrait for a missing or unknown orientation', () => {
    expect(layoutFor(undefined)).toBe(LAYOUT.portrait);
    expect(layoutFor('horizontal')).toBe(LAYOUT.portrait);
    expect(layoutFor('landscape')).toBe(LAYOUT.landscape);
  });
  it('fits long landscape subtitles in 1360', () => {
    const t = '今天我们来聊一聊OpenClaw这个开源项目到底怎么用才能真正提升效率不踩坑呢朋友们大家好';
    const l = captionLayout(t, LANDSCAPE_ZONE.captions.width);
    expect(l.rows.join('')).toBe(t);
    for (const r of l.rows) expect(displayWidth(r) * l.fontSize).toBeLessThanOrEqual(LANDSCAPE_ZONE.captions.width - 60);
    expect(captionLayout('半年后干到类目第一', LANDSCAPE_ZONE.captions.width)).toEqual({ fontSize: 50, rows: ['半年后干到类目第一'] });
  });
});
