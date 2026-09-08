import { describe, it, expect } from 'vitest';
import {
  OverlayExtractionSchema, OverlayPlanSchema, overlaySlotRect, overlayPosition,
} from '@/lib/video-production/overlay-plan';

const item = (over = {}) => ({ kind: 'keyword', text: '任何平台', slot: 'left-1', startMs: 0, endMs: 3000, ...over });

describe('两个 schema 的分工', () => {
  it('提取版: 合法条目通过; text 超 14 字拒; 未知 slot 拒; 多余键拒(.strict)', () => {
    expect(OverlayExtractionSchema.safeParse({ items: [item()] }).success).toBe(true);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ text: '这句话实在太长超过十四个字了吧' })] }).success).toBe(false);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ slot: 'right-1' })] }).success).toBe(false);
    expect(OverlayExtractionSchema.safeParse({ items: [item({ color: 'red' })] }).success).toBe(false);
  });

  it('红线: 提取版拒收 x/y —— 模型不碰坐标', () => {
    expect(OverlayExtractionSchema.safeParse({ items: [item({ x: 0.5, y: 0.5 })] }).success).toBe(false);
  });

  it('存储版收 x/y(0~1), 越界拒', () => {
    expect(OverlayPlanSchema.safeParse({ items: [item({ x: 0.5, y: 0.5 })] }).success).toBe(true);
    expect(OverlayPlanSchema.safeParse({ items: [item({ x: 1.5 })] }).success).toBe(false);
  });
});

describe('定位纯函数', () => {
  it('人在右 → left 格在左半边; 人在左 → 格挪到右半边', () => {
    expect(overlaySlotRect('16:9', 'right', 'left-1').x).toBeLessThan(0.5);
    expect(overlaySlotRect('16:9', 'left', 'left-1').x).toBeGreaterThan(0.5);
  });
  it('五格自上而下递增', () => {
    const ys = [1,2,3,4,5].map((i) => overlaySlotRect('16:9', 'right', `left-${i}` as never).y);
    for (let i = 1; i < 5; i++) expect(ys[i]).toBeGreaterThan(ys[i-1]);
  });
  it('竖屏: 格子整体在上半(人脸占中下)', () => {
    expect(overlaySlotRect('9:16', 'center', 'left-5').y).toBeLessThan(0.5);
  });
  it('bottom-center 抬到字幕安全区上方(y < 0.82)', () => {
    expect(overlaySlotRect('16:9', 'right', 'bottom-center').y).toBeLessThan(0.82);
  });
  it('overlayPosition: 有 x/y 用 x/y, 无则回格位', () => {
    expect(overlayPosition('16:9', 'right', item({ x: 0.8, y: 0.6 }))).toMatchObject({ x: 0.8, y: 0.6 });
    expect(overlayPosition('16:9', 'right', item())).toEqual(overlaySlotRect('16:9', 'right', 'left-1'));
  });
});
