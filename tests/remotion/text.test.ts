import { describe, expect, it } from 'vitest';
import { displayWidth, balanceLines, shouldCountUp } from '../../remotion/kit/text';

describe('displayWidth', () => {
  it('counts CJK as 1 and latin/digits as 0.55', () => {
    expect(displayWidth('你好')).toBe(2);
    expect(displayWidth('AI')).toBeCloseTo(1.1);
  });
});

describe('balanceLines', () => {
  it('keeps a short line as one line', () => {
    expect(balanceLines('半年后干到类目第一', 18)).toEqual(['半年后干到类目第一']);
  });
  it('splits a long line into two balanced lines, never leaving a single orphan character', () => {
    const lines = balanceLines('这个U盘让我在抖音把一个品类干到了第一', 18);
    expect(lines).toHaveLength(2);
    expect(lines.join('')).toBe('这个U盘让我在抖音把一个品类干到了第一');
    expect(Math.min(...lines.map(displayWidth))).toBeGreaterThanOrEqual(6);
  });
  it('prefers breaking after punctuation near the middle', () => {
    expect(balanceLines('我当时就在想，这事有救了朋友们大家好呀', 16)[0].endsWith('，')).toBe(true);
  });
  it('does not split inside a latin word', () => {
    const lines = balanceLines('今天我们来聊一聊OpenClaw这个开源项目怎么用', 16);
    expect(lines.some((l) => l.includes('OpenClaw'))).toBe(true);
  });
});

describe('shouldCountUp', () => {
  it('counts up plain quantities', () => {
    for (const v of ['148208', '32.5%', '3万+', '780']) expect(shouldCountUp(v)).toBe(true);
  });
  it('does not count up ratios, ranks, years or text', () => {
    for (const v of ['9/10', '#1', 'No.1', '2026', 'TOP 1', '一个']) expect(shouldCountUp(v)).toBe(false);
  });
});
