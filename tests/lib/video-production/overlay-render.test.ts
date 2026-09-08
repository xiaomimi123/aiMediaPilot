import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';
import type { OverlayItem } from '@/lib/video-production/overlay-plan';

/*
 * 真渲染测试(三十七期 Task 3)——判据铁律: 同一时刻、内容一致、逐像素互比。
 * 手法照 `cards-ring-odometer-entity.test.ts` 的 `renderCard`/`diffPixels`,
 * 这里改叫 `renderOverlay`/沿用同一份 `diffPixels`(各自文件各抄一份, 与既有
 * 先例一致, 不额外抽共享模块)。
 *
 * shots 恒为 []: 这组测试只关心叠加层(TextOverlayLayer + cornerBadge), 不需要
 * 卡片内容——Film.tsx 的 Ambient 环境运动层在两次渲染里逐帧相同, 同一时刻互比
 * 会自动抵消, 剩下的差异纯粹来自叠加层有没有、在哪。
 */
const renderOverlay = async (opts: {
  overlays: OverlayItem[];
  overlayPersonSide?: 'left' | 'center' | 'right';
  cornerBadge?: string | null;
  atMs: number;
  name: string;
}) => {
  const png = path.join(os.tmpdir(), `${opts.name}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [] as never,
      audioSrc: null,
      bgm: null,
      captions: [],
      sourceVideo: null,
      aspect: '16:9',
      visualStyle: 'card',
      overlays: opts.overlays,
      overlayPersonSide: opts.overlayPersonSide ?? 'right',
      cornerBadge: opts.cornerBadge ?? null,
    } as never,
    shotIndex: 0,
    atMs: opts.atMs,
    outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  return { img, cleanup: () => [png, ppm].forEach((f) => fs.existsSync(f) && fs.unlinkSync(f)) };
};

/** 逐像素比较两张同尺寸渲染, 数出有多少采样点不同(手法同 cards-ring-odometer-entity.test.ts)。 */
const diffPixels = (
  a: ReturnType<typeof parsePpm>, b: ReturnType<typeof parsePpm>,
  y0: number, y1: number, x0: number, x1: number,
) => {
  let n = 0;
  for (let y = y0; y <= y1; y += 4) {
    for (let x = x0; x <= x1; x += 4) {
      if (manhattan(readPixel(a, x, y), readPixel(b, x, y)) > 30) n += 1;
    }
  }
  return n;
};

const keywordItem = (over: Partial<OverlayItem> = {}): OverlayItem => ({
  kind: 'keyword',
  text: '关键词',
  slot: 'left-1',
  startMs: 0,
  endMs: 5000,
  ...over,
});

describe('TextOverlayLayer 真渲染', () => {
  it('A(无 overlays) vs B(一条 keyword left-1) 同帧差分 > 50', async () => {
    // atMs=2000: keyword 的 smashIn 进场(0.42s)早已完成, 取的是稳定态而不是过程态。
    const [a, b] = await Promise.all([
      renderOverlay({ overlays: [], atMs: 2000, name: 'ov-a' }),
      renderOverlay({ overlays: [keywordItem()], atMs: 2000, name: 'ov-b' }),
    ]);
    try {
      const d = diffPixels(a.img, b.img, 0, a.img.height - 1, 0, a.img.width - 1);
      expect(d, `A/B 全幅差分应显著(实测 ${d})`).toBeGreaterThan(50);
    } finally { a.cleanup(); b.cleanup(); }
  }, 120_000);

  it('B vs C(同条但拖到 x:0.8,y:0.6) 差分 > 50 —— 坐标覆盖真的动了位置', async () => {
    const [b, c] = await Promise.all([
      renderOverlay({ overlays: [keywordItem()], atMs: 2000, name: 'ov-b2' }),
      renderOverlay({ overlays: [keywordItem({ x: 0.8, y: 0.6 })], atMs: 2000, name: 'ov-c' }),
    ]);
    try {
      const d = diffPixels(b.img, c.img, 0, b.img.height - 1, 0, b.img.width - 1);
      expect(d, `拖拽覆盖坐标后应有明显位移差分(实测 ${d})`).toBeGreaterThan(50);
    } finally { b.cleanup(); c.cleanup(); }
  }, 120_000);

  it('D(cornerBadge 三行) vs A 右上角区差分 > 50', async () => {
    const [a, d] = await Promise.all([
      renderOverlay({ overlays: [], atMs: 500, name: 'ov-a2' }),
      renderOverlay({ overlays: [], cornerBadge: '示例账号\n系列名称\n侵权必究', atMs: 500, name: 'ov-d' }),
    ]);
    try {
      const w = a.img.width, h = a.img.height;
      // 右上角区域: x∈[0.7w,0.98w], y∈[0.02h,0.2h]
      const diff = diffPixels(a.img, d.img, Math.floor(h * 0.02), Math.floor(h * 0.2), Math.floor(w * 0.7), Math.floor(w * 0.98));
      expect(diff, `右上角区应因常驻角标产生明显差分(实测 ${diff})`).toBeGreaterThan(50);
    } finally { a.cleanup(); d.cleanup(); }
  }, 120_000);
});
