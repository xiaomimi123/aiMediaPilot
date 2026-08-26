import { describe, expect, it } from 'vitest';
import { measureFrameDensity, judgeFrameDensity, judgeShotDensity } from '@/lib/video-production/frame-density';

/**
 * 阈值依据(2026-08-26 实测, 见 docs/superpowers/specs/2026-08-25-reference-video-teardown.md):
 *   参考视频 PPT 型   contentRatio 0.30~0.54 / 九宫格 7-9 格
 *   参考视频 真人+动效 contentRatio 0.72~0.87 / 九宫格 9 格
 *   我们的产出        contentRatio 0.013~0.098 / 九宫格 3-9 格
 * 参考视频也有 0.054 的留白转场帧, 所以判定要允许少量空镜, 只拦"空得离谱"的。
 */

function solid(rgb: [number, number, number], w = 12, h = 9): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i += 1) { b[i * 3] = rgb[0]; b[i * 3 + 1] = rgb[1]; b[i * 3 + 2] = rgb[2]; }
  return b;
}

describe('measureFrameDensity', () => {
  it('纯色帧 → 内容占比 0, 只占 0 格', () => {
    const m = measureFrameDensity(solid([246, 244, 233]), 12, 9);
    expect(m.contentRatio).toBe(0);
    expect(m.cellsUsed).toBe(0);
  });

  it('背景色取出现最多的颜色, 不假设是白或黑', () => {
    const b = solid([15, 23, 42]); // 深色底
    b[0] = 255; b[1] = 255; b[2] = 255; // 一个亮点
    const m = measureFrameDensity(b, 12, 9);
    expect(m.background).toBe('#0F172A');
    expect(m.contentRatio).toBeGreaterThan(0);
  });

  it('内容铺满 → 占比接近 1, 九宫格全占', () => {
    const b = solid([246, 244, 233]);
    for (let i = 0; i < 12 * 9; i += 1) { if (i % 2) { b[i * 3] = 0; b[i * 3 + 1] = 0; b[i * 3 + 2] = 0; } }
    const m = measureFrameDensity(b, 12, 9);
    expect(m.contentRatio).toBeGreaterThan(0.4);
    expect(m.cellsUsed).toBe(9);
  });

  it('容差内的轻微色差算背景, 不把抗锯齿噪点当内容', () => {
    const b = solid([246, 244, 233]);
    b[0] = 250; b[1] = 248; b[2] = 237; // 差 4, 在容差内
    expect(measureFrameDensity(b, 12, 9).contentRatio).toBe(0);
  });

  it('空缓冲不抛异常', () => {
    const m = measureFrameDensity(Buffer.alloc(0), 0, 0);
    expect(m.contentRatio).toBe(0);
  });
});

describe('judgeFrameDensity', () => {
  it('参考视频铺满的帧(0.30/8 格)→ 合格', () => {
    expect(judgeFrameDensity({ contentRatio: 0.30, cellsUsed: 8, background: '#F3EFE5' }).ok).toBe(true);
  });

  it('真正的空屏(0.0)→ 不合格', () => {
    const r = judgeFrameDensity({ contentRatio: 0.0, cellsUsed: 0, background: '#F9F6ED' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/空/);
  });

  it('参考视频自己的标题页/转场(0.042~0.056)→ 必须合格', () => {
    // 2026-08-26 复核: 参考视频 t=3s 标题页 5.6%、t=45s 转场 5.4%、t=106s 收尾 4.2%。
    // 原阈值 0.12 会把参考视频自己的正常帧判为不合格 —— 那是拿峰值当均值定错了线。
    for (const ratio of [0.042, 0.054, 0.056]) {
      expect(judgeFrameDensity({ contentRatio: ratio, cellsUsed: 5, background: '#F3EFE5' }).ok).toBe(true);
    }
  });

  it('我们的典型帧(0.05/5 格)→ 现在算合格 —— 它和参考的标题页是同一量级', () => {
    expect(judgeFrameDensity({ contentRatio: 0.05, cellsUsed: 5, background: '#F6F4E9' }).ok).toBe(true);
  });

  it('内容集中在中间但确实有内容 → 合格 —— 参考视频的标题页就是这样, 那是排版不是缺陷', () => {
    // 同上一条复核: 原来把"只占 1 格"也判为不合格, 等于禁止居中标题页这种正常构图
    expect(judgeFrameDensity({ contentRatio: 0.25, cellsUsed: 1, background: '#FFFFFF' }).ok).toBe(true);
  });

  it('一格都没有 → 不合格(那是真的什么都没渲出来)', () => {
    expect(judgeFrameDensity({ contentRatio: 0.5, cellsUsed: 0, background: '#FFFFFF' }).ok).toBe(false);
  });

  it('反馈文案里带上实测数字, 好让模型知道差多少', () => {
    const r = judgeFrameDensity({ contentRatio: 0.005, cellsUsed: 1, background: '#F9F6ED' });
    expect(r.reason).toMatch(/0\.5%|0\.005/);
  });
});

describe('整镜判定(允许合理留白, 只拦普遍性空洞)', () => {
  const dense = { contentRatio: 0.35, cellsUsed: 8, background: '#F3EFE5' };
  const empty = { contentRatio: 0.004, cellsUsed: 1, background: '#F9F6ED' };

  it('多数取样帧都空 → 判为不合格', () => {
    const r = judgeShotDensity([empty, empty, empty]);
    expect(r.ok).toBe(false);
  });

  it('只有个别帧空(合理的留白转场)→ 通过, 不误伤', () => {
    // 参考视频实测就有 5.4% 的留白转场帧, 一刀切会把它也拦下
    expect(judgeShotDensity([dense, empty, dense]).ok).toBe(true);
  });

  it('全都够密 → 通过', () => {
    expect(judgeShotDensity([dense, dense, dense]).ok).toBe(true);
  });

  it('不合格时反馈里带上"几帧里有几帧是空的"', () => {
    const r = judgeShotDensity([empty, empty, dense]);
    expect(r.reason).toMatch(/3 帧|2 帧|2\/3/);
  });

  it('没有取样帧时不判失败 —— 取不到样是渲染的问题, 不该赖 Builder', () => {
    expect(judgeShotDensity([]).ok).toBe(true);
  });
});
