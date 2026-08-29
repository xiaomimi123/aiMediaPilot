import { describe, it, expect } from 'vitest';
import { measureFrameDetail } from '@/lib/video-production/frame-detail';

/** 造一张纯色图。 */
function flat(w: number, h: number, rgb: [number, number, number]): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { b[i*3] = rgb[0]; b[i*3+1] = rgb[1]; b[i*3+2] = rgb[2]; }
  return b;
}

/** 在图上画一个实心矩形。 */
function rect(b: Buffer, w: number, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y*w+x)*3; b[i] = rgb[0]; b[i+1] = rgb[1]; b[i+2] = rgb[2];
  }
}

describe('measureFrameDetail', () => {
  it('纯色空屏没有细节', () => {
    expect(measureFrameDetail(flat(64, 64, [20, 20, 30]), 64, 64).detailRatio).toBe(0);
  });

  it('一整块纯色大卡片几乎没有细节 —— 只有边框那一圈', () => {
    const b = flat(64, 64, [20, 20, 30]);
    rect(b, 64, 8, 8, 56, 56, [60, 60, 80]); // 占了 56% 面积的大卡片
    const m = measureFrameDetail(b, 64, 64);
    expect(m.detailRatio).toBeLessThan(0.1);
  });

  it('同样面积里塞满细碎元素, 细节远高于空卡片', () => {
    const empty = flat(64, 64, [20, 20, 30]);
    rect(empty, 64, 8, 8, 56, 56, [60, 60, 80]);

    const busy = flat(64, 64, [20, 20, 30]);
    rect(busy, 64, 8, 8, 56, 56, [60, 60, 80]);
    // 卡片里画 8 行"文字"
    for (let r = 0; r < 8; r++) rect(busy, 64, 12, 12 + r * 5, 52, 14 + r * 5, [230, 230, 240]);

    const a = measureFrameDetail(empty, 64, 64).detailRatio;
    const c = measureFrameDetail(busy, 64, 64).detailRatio;
    expect(c).toBeGreaterThan(a * 3);
  });

  it('细节全挤在一角时分布分数低', () => {
    const b = flat(64, 64, [20, 20, 30]);
    for (let r = 0; r < 6; r++) rect(b, 64, 2, 2 + r * 3, 20, 3 + r * 3, [230, 230, 240]);
    const m = measureFrameDetail(b, 64, 64);
    expect(m.cellsWithDetail).toBeLessThan(m.totalCells / 2);
  });

  it('细节铺开时分布分数高', () => {
    const b = flat(64, 64, [20, 20, 30]);
    for (let r = 0; r < 12; r++) rect(b, 64, 4, 3 + r * 5, 60, 5 + r * 5, [230, 230, 240]);
    const m = measureFrameDetail(b, 64, 64);
    expect(m.cellsWithDetail).toBeGreaterThan(m.totalCells / 2);
  });
});

import { judgeHollowCard } from '@/lib/video-production/frame-detail';

describe('judgeHollowCard —— 专抓「大色块刷分」', () => {
  it('占比高但细节极低 = 空壳卡片, 判为不合格', () => {
    // 真实帧的数: 一张几乎空的大卡片
    const r = judgeHollowCard({ contentRatio: 0.26, detailRatio: 0.016 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('空');
  });

  it('占比中等但细节扎实 = 正常信息卡, 放行', () => {
    // 真实帧的数: 四行文字 + 图标 + 分隔线
    expect(judgeHollowCard({ contentRatio: 0.177, detailRatio: 0.05 }).ok).toBe(true);
  });

  it('本来就没什么内容的留白帧不归它管 —— 那是密度那关的事', () => {
    expect(judgeHollowCard({ contentRatio: 0.04, detailRatio: 0.01 }).ok).toBe(true);
  });

  it('满屏细节当然放行', () => {
    expect(judgeHollowCard({ contentRatio: 0.5, detailRatio: 0.12 }).ok).toBe(true);
  });
});
