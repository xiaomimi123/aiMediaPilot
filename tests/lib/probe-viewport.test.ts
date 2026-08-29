import { describe, it, expect } from 'vitest';
import { probeViewport } from '@/lib/video-production/shot-renderer';

/**
 * 真实事故: 探针固定 160x90 横屏, 而成片改成竖屏后真实渲染是 1080x1920。
 * 给竖屏排的版在横屏小窗里量, 量的不是同一个东西 —— 一个整整 23 秒、100% 纯空白
 * 的镜头就这么一路过检, 密度检查报告零失败。
 */
describe('probeViewport', () => {
  it('竖屏成片用竖屏探针 —— 比例必须一致', () => {
    const v = probeViewport({ width: 1080, height: 1920 });
    expect(v.height).toBeGreaterThan(v.width);
    expect(v.height / v.width).toBeCloseTo(1920 / 1080, 1);
  });

  it('横屏保持横屏', () => {
    const v = probeViewport({ width: 1920, height: 1080 });
    expect(v.width / v.height).toBeCloseTo(16 / 9, 1);
  });

  /*
   * 尺寸必须等于真实渲染尺寸, 不能缩。
   *
   * 缩小视口的代价是实测出来的: Builder 排版用的是按 1080 宽算的绝对像素, 在缩小的
   * 窗口里元素跑出可视区 —— 一次出片里 4 个镜头被判「三次仍未达标」, 而它们渲出来的
   * clip 实测是 4%~5%, 画面完全正常。全是误报, 每个还白烧 3 次模型调用。
   *
   * 换尺寸确实等于换了阈值那把尺, 所以 frame-density 的阈值已在 2026-08-29 一并
   * 重新标定(见那边的注释)。
   */
  it('就是真实渲染尺寸, 一点都不缩', () => {
    expect(probeViewport({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(probeViewport({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
  });

  it('不给画幅时按横屏 1920x1080', () => {
    expect(probeViewport()).toEqual({ width: 1920, height: 1080 });
  });
});
