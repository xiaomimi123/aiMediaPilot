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
   * 尺寸不动(长边 160): 它和 frame-density 里那条 0.03 阈值是一起标定出来的。
   * 试过按真实尺寸渲染 —— 同一份 HTML 量出 0.2% 对 5.1%, 差 25 倍, 既有的
   * 「一行小字标题页应当通过」当场挂掉。要走那条路得连标定一起重做。
   */
  it('长边仍是 160 —— 换了尺寸就等于换了阈值那把尺', () => {
    expect(Math.max(...Object.values(probeViewport({ width: 1080, height: 1920 })))).toBe(160);
  });

  it('不给画幅时退回老行为 160x90', () => {
    expect(probeViewport()).toEqual({ width: 160, height: 90 });
  });
});
