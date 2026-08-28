import { describe, it, expect } from 'vitest';
import { computePipRect, PIP_SCALE_MAX, PIP_SCALE_MIN } from '@/lib/video/pip-layout';

const frame = { width: 1080, height: 1920 };
const source = { width: 1080, height: 1920 };

describe('computePipRect', () => {
  it('宽度按比例算', () => {
    const r = computePipRect(frame, source, { position: 'br', scale: 0.25, margin: 40 });
    expect(r.width).toBe(270);
  });

  it('**高度跟着源视频宽高比** —— 各自缩放会把人脸压扁', () => {
    const r = computePipRect(frame, { width: 1920, height: 1080 }, { position: 'br', scale: 0.25, margin: 0 });
    expect(r.height).toBe(Math.round(270 * (1080 / 1920)));
  });

  it('四个角的位置都对', () => {
    const p = (position: 'tl' | 'tr' | 'bl' | 'br') =>
      computePipRect(frame, source, { position, scale: 0.25, margin: 40 });
    expect(p('tl')).toMatchObject({ x: 40, y: 40 });
    expect(p('tr').x).toBe(1080 - 270 - 40);
    expect(p('bl').y).toBe(1920 - 480 - 40);
    expect(p('br')).toMatchObject({ x: 1080 - 270 - 40, y: 1920 - 480 - 40 });
  });

  it('**比例越界要夹住** —— 越界值会生成一条把画面全盖住的滤镜', () => {
    expect(computePipRect(frame, source, { position: 'br', scale: 9, margin: 0 }).width)
      .toBe(Math.round(1080 * PIP_SCALE_MAX));
    expect(computePipRect(frame, source, { position: 'br', scale: 0.001, margin: 0 }).width)
      .toBe(Math.round(1080 * PIP_SCALE_MIN));
  });

  it('边距过大时不会把小窗推到画面外', () => {
    const r = computePipRect(frame, source, { position: 'br', scale: 0.4, margin: 5000 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('负边距按 0 算', () => {
    expect(computePipRect(frame, source, { position: 'tl', scale: 0.2, margin: -30 }))
      .toMatchObject({ x: 0, y: 0 });
  });

  it('源宽度为 0 也不除零', () => {
    const r = computePipRect(frame, { width: 0, height: 100 }, { position: 'br', scale: 0.2, margin: 0 });
    expect(Number.isFinite(r.height)).toBe(true);
  });
});
