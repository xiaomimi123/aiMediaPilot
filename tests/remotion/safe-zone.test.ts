import { describe, expect, it } from 'vitest';
import { DOUYIN_OVERLAYS, H, W, ZONE } from '../../remotion/kit/tokens';
import { captionLayout, displayWidth } from '../../remotion/kit/text';

type Rect = { left: number; top: number; width: number; height: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

describe('safe zones', () => {
  it('keeps every zone clear of the Douyin top tabs, right action column and bottom caption', () => {
    for (const [name, z] of Object.entries(ZONE)) {
      for (const [o, r] of Object.entries(DOUYIN_OVERLAYS)) expect(overlaps(z, r), `${name} 被 ${o} 挡住`).toBe(false);
      expect(z.left).toBeGreaterThanOrEqual(60);
      expect(z.left + z.width).toBeLessThanOrEqual(W - 60);
      expect(z.top + z.height).toBeLessThanOrEqual(H);
    }
  });
  it('uses the agreed zone numbers', () => {
    expect(ZONE.pip).toEqual({ left: W - 60 - 350, top: 300, width: 350, height: 470 });
    expect(ZONE.title).toEqual({ left: 60, top: 300, width: 590, height: 470 });
    expect(ZONE.content).toEqual({ left: 60, top: 790, width: 790, height: 560 });
    expect(ZONE.captions).toEqual({ left: 60, top: 1380, width: 790, height: 120 });
  });
});

describe('captionLayout', () => {
  const inner = ZONE.captions.width - 60;
  const cases = ['半年后干到类目第一', '这个U盘让我在抖音把一个品类干到了第一', '我当时就在想这事有救了然后半年后真的把一个品类干到了第一名', '今天我们来聊一聊OpenClaw这个开源项目到底怎么用才能真正提升效率不踩坑呢朋友们'];
  it('never lets a subtitle row run wider than the caption zone', () => {
    for (const t of cases) {
      const l = captionLayout(t, ZONE.captions.width);
      expect(l.rows.join('')).toBe(t);
      for (const r of l.rows) expect(displayWidth(r) * l.fontSize).toBeLessThanOrEqual(inner);
    }
  });
  it('keeps the large font for short lines and shrinks only long ones', () => {
    expect(captionLayout(cases[0], ZONE.captions.width).fontSize).toBe(50);
    expect(captionLayout(cases[3], ZONE.captions.width).fontSize).toBeLessThan(50);
  });
});
