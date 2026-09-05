import { describe, it, expect } from 'vitest';
import { smashIn, fadeUp, beatHit, slideIn, staggerIn, sweepHighlight, drawLine } from '../../../remotion/src/motion/anim';

const FPS = 30;

describe('anim 纯函数 —— 三个边界: at 之前 / 进行中 / 结束后', () => {
  it('smashIn: at 之前不可见, 结束后归位', () => {
    expect(smashIn(0, FPS, 1).opacity).toBe(0);
    const mid = smashIn(FPS * 1 + 6, FPS, 1);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    const after = smashIn(FPS * 3, FPS, 1);
    expect(after.opacity).toBe(1);
    expect(after.transform).toBe('scale(1) translateY(0px)');
  });

  it('fadeUp: 结束后 opacity 1 且不再位移', () => {
    expect(fadeUp(0, FPS, 1).opacity).toBe(0);
    expect(fadeUp(FPS * 3, FPS, 1)).toEqual({ opacity: 1, transform: 'translateY(0px)' });
  });

  it('beatHit: 峰值出现在中段, 首尾都回到 scale(1)', () => {
    expect(beatHit(0, FPS, 1).transform).toBe('scale(1)');
    const peak = beatHit(Math.round(FPS * 1.15), FPS, 1).transform as string;
    const v = Number(peak.replace('scale(', '').replace(')', ''));
    expect(v).toBeGreaterThan(1);
    expect(beatHit(FPS * 3, FPS, 1).transform).toBe('scale(1)');
  });

  it('slideIn: 左右方向的初始位移符号相反', () => {
    const l = slideIn(0, FPS, 0, 'left').transform as string;
    const r = slideIn(0, FPS, 0, 'right').transform as string;
    expect(l).toContain('-');
    expect(r).not.toContain('-');
  });

  it('staggerIn: 第 n 条比第 0 条晚 n×gap 起步', () => {
    // fadeUp 本身持续 0.5s(15 帧), gap 只有 0.12s(3.6 帧)——两者duration
    // 远大于 gap, 相邻条目必然大段重叠。故不能取"第 0 条已完全落位"的时刻来比较
    // (那时第 1 条也早已起步很久, 不再是"没开始"), 而是取一个**恰好落在两者
    // 起步帧之间**的时刻: 第 0 条已经开始动(起步于第 15 帧), 第 1 条还没
    // 起步(起步于第 18.6 帧)。
    const at = 0.5;
    const t = 17; // 15 < 17 < 18.6
    expect(staggerIn(t, FPS, at, 0).opacity).toBeGreaterThan(0); // 第 0 条已经在动
    expect(staggerIn(t, FPS, at, 1).opacity).toBe(0); // 第 1 条还没起步(clamp 到 0)
  });

  it('sweepHighlight: 0% → 100%', () => {
    expect(sweepHighlight(0, FPS, 1).backgroundSize).toBe('0% 100%');
    expect(sweepHighlight(FPS * 3, FPS, 1).backgroundSize).toBe('100% 100%');
  });

  it('drawLine: clipPath 从右侧 100% 收到 0%', () => {
    expect(drawLine(0, FPS, 1).clipPath).toBe('inset(0 100% 0 0)');
    expect(drawLine(FPS * 3, FPS, 1).clipPath).toBe('inset(0 0% 0 0)');
  });
});
