import { describe, it, expect } from 'vitest';
import { smashIn, fadeUp, beatHit, slideIn, staggerIn, sweepHighlight, drawLine } from '../../../remotion/src/motion/anim';
import { ringDraw, curveDraw, barGrow, countTo } from '../../../remotion/src/motion/anim';

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

  /*
   * 三十二期 Task 1 复审: opacity 的"提前完成"是 SmashWord 手法的一部分 ——
   * 文字先快速可见(砸的冲击), 缩放随后由 back-out 继续回弹(落的物理感), 两者
   * 刻意错峰。上面那条"进行中"断言只要求 0<opacity<1, 把 opacity 拉成全程线性
   * (抹平错峰、退化成普通缩放淡入)照样能过 —— 实测确认过。所以单独钉住错峰本身:
   * 动效过半时 opacity 必须显著领先于缩放的回弹进度。
   */
  it('smashIn: opacity 领先于缩放回弹(错峰, 不是同步渐变)', () => {
    const half = smashIn(Math.round(FPS * (1 + 0.21)), FPS, 1); // p≈0.5
    // opacity 到此已过 90%(0.5/0.55), 而缩放仍在运动中(尚未落到 1)。
    // 注意缩放此刻是 0.968 —— **小于 1**: Easing.back 的 out 版本会过冲,
    // 砸字的缩放轨迹是 1.35 →(砸下去过冲到 0.97)→ 回弹到 1, 这正是"砸"的
    // 物理感。所以错峰的证据是"缩放仍在运动(≠1)", 不是"缩放大于 1"。
    expect(half.opacity as number).toBeGreaterThan(0.85);
    const scaleV = Number((half.transform as string).match(/scale\(([\d.]+)\)/)![1]);
    expect(Math.abs(scaleV - 1)).toBeGreaterThan(0.02);
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

describe('新卡用的动效函数(三十三期)', () => {
  const FPS = 30;
  const C = 880; // 圆周长, 2πR ≈ 2π×140

  it('ringDraw: at 之前环全空, 结束后停在 ratio 对应的位置', () => {
    expect(ringDraw(0, FPS, 1, 0.5, C).strokeDashoffset).toBe(C);
    const done = ringDraw(FPS * 3, FPS, 1, 0.5, C);
    expect(done.strokeDasharray).toBe(C);
    expect(done.strokeDashoffset).toBeCloseTo(C * 0.5, 1);
  });

  it('ringDraw: ratio=1 时结束后 offset 归零(整圈画满)', () => {
    expect(ringDraw(FPS * 3, FPS, 0, 1, C).strokeDashoffset).toBeCloseTo(0, 1);
  });

  it('curveDraw: 0 → 1, 时长由调用方给', () => {
    expect(curveDraw(0, FPS, 1, 2)).toBe(0);
    expect(curveDraw(FPS * 5, FPS, 1, 2)).toBe(1);
    // 时长 2s: at=1s 起, 2s 处正好走一半
    expect(curveDraw(FPS * 2, FPS, 1, 2)).toBeCloseTo(0.5, 1);
  });

  it('barGrow: scaleX 从 0 长到 ratio, 左对齐原点', () => {
    expect(barGrow(0, FPS, 0, 0.8).transform).toBe('scaleX(0)');
    expect(barGrow(FPS * 3, FPS, 0, 0.8).transform).toBe('scaleX(0.8)');
    expect(barGrow(0, FPS, 0, 0.8).transformOrigin).toBe('left center');
  });

  it('countTo: 从 0 数到 target, 结束后精确等于 target', () => {
    expect(countTo(0, FPS, 1, 900, 1.6)).toBe(0);
    expect(countTo(FPS * 5, FPS, 1, 900, 1.6)).toBe(900);
    const mid = countTo(FPS * 1 + 24, FPS, 1, 900, 1.6);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(900);
  });

  it('countTo: 非整数 target 结束后不被取整(与 Stat 卡的既有约定一致)', () => {
    expect(countTo(FPS * 5, FPS, 0, 32.2, 1)).toBeCloseTo(32.2, 5);
  });
});

