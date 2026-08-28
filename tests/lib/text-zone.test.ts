import { describe, it, expect } from 'vitest';
import { textSafeZone, slotsInZone, slotCapacity, PERSON_SIDE_LABELS, PERSON_SIDES } from '@/lib/video/text-zone';

const land = { width: 1920, height: 1080 };
const port = { width: 1080, height: 1920 };

describe('textSafeZone', () => {
  it('内容全屏没有人 → 整幅都能放', () => {
    expect(textSafeZone(port, 'content-full', 'right')).toEqual({ x: 0, y: 0, width: 1080, height: 1920 });
  });

  it('分屏 → 内容那一半就是安全区, 且不和人物重叠', () => {
    const z = textSafeZone(land, 'content-left', 'right');
    const person = 1920 - z.width;
    expect(z.x).toBe(0);
    expect(z.width).toBeLessThan(1920);
    expect(z.x + z.width).toBeLessThanOrEqual(1920 - person + 1);
  });

  it('左人物右内容时安全区在右 —— 跟着版面走, 不写死左边', () => {
    const z = textSafeZone(land, 'content-right', 'left');
    expect(z.x).toBeGreaterThan(0);
  });

  it('**竖屏人物全屏 → 安全区是上方一条带, 不是左半边**（人脸占中间, 左右都贴脸）', () => {
    const z = textSafeZone(port, 'person-full', 'right');
    expect(z.width).toBe(1080);
    expect(z.height).toBeLessThan(1920 * 0.4);
    expect(z.y).toBe(0);
  });

  it('横屏人物全屏 + 人在右 → 安全区在左半边（参考片就是这个情形）', () => {
    const z = textSafeZone(land, 'person-full', 'right');
    expect(z.x).toBe(0);
    expect(z.width).toBeLessThan(1920 / 2 + 20);
    expect(z.height).toBe(1080);
  });

  it('**横屏人在左 → 安全区翻到右边**', () => {
    const z = textSafeZone(land, 'person-full', 'left');
    expect(z.x).toBeGreaterThan(1920 / 2 - 20);
    expect(z.x + z.width).toBe(1920);
  });

  it('横屏人在中间 → 左右都贴脸, 退回上方一条带', () => {
    const z = textSafeZone(land, 'person-full', 'center');
    expect(z.width).toBe(1920);
    expect(z.height).toBeLessThan(1080 * 0.4);
  });

  it('圆窗 → 上方大片可用, 避开右下的圆窗', () => {
    const z = textSafeZone(port, 'person-circle', 'right');
    expect(z.height).toBeLessThan(1920);
    expect(z.width).toBe(1080);
  });

  it('安全区永远在画面内', () => {
    for (const frame of [land, port]) {
      for (const layout of ['person-full', 'content-full', 'content-left', 'content-right', 'person-circle'] as const) {
        for (const side of PERSON_SIDES) {
          const z = textSafeZone(frame, layout, side);
          expect(z.x).toBeGreaterThanOrEqual(0);
          expect(z.y).toBeGreaterThanOrEqual(0);
          expect(z.x + z.width).toBeLessThanOrEqual(frame.width);
          expect(z.y + z.height).toBeLessThanOrEqual(frame.height);
        }
      }
    }
  });
});

describe('slotsInZone', () => {
  it('槽位都落在安全区内', () => {
    const z = textSafeZone(land, 'person-full', 'right');
    for (const s of slotsInZone(z, 5)) {
      expect(s.x).toBeGreaterThanOrEqual(z.x);
      expect(s.x).toBeLessThanOrEqual(z.x + z.width);
      expect(s.y).toBeGreaterThanOrEqual(z.y);
      expect(s.y).toBeLessThanOrEqual(z.y + z.height);
    }
  });

  it('自上而下排列', () => {
    const ys = slotsInZone(textSafeZone(land, 'person-full', 'right'), 5).map((s) => s.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('**扁宽的安全区自动减行, 而不是压字号** —— 字压小了手机上读不出来', () => {
    const flat = textSafeZone(port, 'person-full', 'center'); // 上方一条带
    const tall = textSafeZone(land, 'person-full', 'right');  // 半个画面
    expect(slotCapacity(flat)).toBeLessThanOrEqual(slotCapacity(tall));
    expect(slotCapacity(flat)).toBeGreaterThanOrEqual(1);
  });

  it('至少给一行 —— 一行都排不下的话这个功能就没法用了', () => {
    expect(slotsInZone({ x: 0, y: 0, width: 100, height: 10 }, 5).length).toBeGreaterThanOrEqual(1);
  });

  it('要 0 行也返回 1 行, 不返回空数组', () => {
    expect(slotsInZone({ x: 0, y: 0, width: 100, height: 100 }, 0)).toHaveLength(1);
  });

  it('左对齐 —— 竖向堆叠成图解时居中会歪歪扭扭', () => {
    const s = slotsInZone(textSafeZone(land, 'person-full', 'right'), 3);
    expect(s.every((p) => p.an === 4)).toBe(true);
    expect(new Set(s.map((p) => p.x)).size).toBe(1);
  });
});

describe('文案', () => {
  it('每个人物位置都有中文名', () => {
    for (const s of PERSON_SIDES) expect(PERSON_SIDE_LABELS[s].length).toBeGreaterThan(0);
  });
});
