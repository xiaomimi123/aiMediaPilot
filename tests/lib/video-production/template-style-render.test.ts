import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { renderShotStill } from '@/lib/video-production/remotion-render';
import { parsePpm, readPixel, manhattan } from './_ppm-test-utils';

/*
 * `FilmInput.templateStyle` 是否真的注入进渲染 —— 断言 JSX/入参无意义(参数可能
 * 被读了却没用), 只有真渲染出两张图、逐像素比才说明问题。手法照
 * `card-style-render.test.ts`(同镜同时刻互比, 不跨时刻比墨量——Ambient 环境层
 * 全片底噪, 跨时刻比较已被实测证伪, 见 task-3-brief.md)。
 *
 * A = 无 templateStyle、无 shot.style;
 * B = templateStyle {accent:'red'};
 * C = templateStyle {accent:'red'} 且 shot.style {accent:'blue'}(镜上覆盖模板);
 * D = templateStyle {scale:0.8}, 与 A 比(证明不只 accent 接通, scale 也接通)。
 */

const renderStatement = async (
  templateStyle: unknown,
  shotStyle: unknown,
  atMs: number,
  name: string,
) => {
  const png = path.join(os.tmpdir(), `tpl-style-${name}-${Date.now()}.png`);
  const ppm = png.replace(/\.png$/, '.ppm');
  await renderShotStill({
    input: {
      shots: [{
        shotId: 's1', startMs: 0, endMs: 4000, card: 'statement',
        slots: { text: '模板样式测试', sub: '副句' },
        ...(shotStyle ? { style: shotStyle } : {}),
      }] as never,
      audioSrc: null, bgm: null, captions: [], sourceVideo: null,
      aspect: '16:9', visualStyle: 'card',
      ...(templateStyle ? { templateStyle } : {}),
    } as never,
    shotIndex: 0, atMs, outputPath: png,
  });
  execFileSync('ffmpeg', ['-v', 'quiet', '-i', png, '-y', ppm]);
  const img = parsePpm(fs.readFileSync(ppm));
  fs.unlinkSync(png);
  fs.unlinkSync(ppm);
  return img;
};

/** 逐像素互比(网格抽样, 步长 4px, 与 `cards-ring-odometer-entity.test.ts` 的
 * `countInk` 同一手法)——累加两张同分辨率图对应位置像素的 manhattan 距离。 */
function diffPixels(
  a: ReturnType<typeof parsePpm>,
  b: ReturnType<typeof parsePpm>,
): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`两张图分辨率不一致: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  let total = 0;
  for (let y = 0; y < a.height; y += 4) {
    for (let x = 0; x < a.width; x += 4) {
      total += manhattan(readPixel(a, x, y), readPixel(b, x, y));
    }
  }
  return total;
}

describe('FilmInput.templateStyle 注入渲染', () => {
  it('A/B: 模板默认 accent 接通 —— 无 templateStyle vs templateStyle{accent:red} 逐像素有明显差分', async () => {
    const a = await renderStatement(undefined, undefined, 2000, 'a');
    const b = await renderStatement({ accent: 'red' }, undefined, 2000, 'b');
    const diff = diffPixels(a, b);
    // eslint-disable-next-line no-console -- 报告要求写实测差分数值
    console.log(`[template-style-render] A/B diff = ${diff}`);
    expect(diff, 'templateStyle.accent=red 应该让画面出现红色强调, 与默认画面逐像素有明显差分').toBeGreaterThan(50);
  }, 120_000);

  it('B/C: 镜上 style 覆盖模板默认 —— templateStyle{accent:red} vs (templateStyle{accent:red}+shot.style{accent:blue}) 逐像素有明显差分', async () => {
    const b = await renderStatement({ accent: 'red' }, undefined, 2000, 'b2');
    const c = await renderStatement({ accent: 'red' }, { accent: 'blue' }, 2000, 'c');
    const diff = diffPixels(b, c);
    // eslint-disable-next-line no-console -- 报告要求写实测差分数值
    console.log(`[template-style-render] B/C diff = ${diff}`);
    expect(diff, '镜上显式 style 应该覆盖模板默认 —— C 应该显示蓝色而不是红色, 与 B 逐像素有明显差分').toBeGreaterThan(50);
  }, 120_000);

  it('A/D: 模板默认 scale 接通(不只是 accent) —— 无 templateStyle vs templateStyle{scale:0.8} 逐像素有明显差分', async () => {
    const a = await renderStatement(undefined, undefined, 2000, 'a2');
    const d = await renderStatement({ scale: 0.8 }, undefined, 2000, 'd');
    const diff = diffPixels(a, d);
    // eslint-disable-next-line no-console -- 报告要求写实测差分数值
    console.log(`[template-style-render] A/D diff = ${diff}`);
    expect(diff, 'templateStyle.scale=0.8 应该缩小卡片, 与默认画面逐像素有明显差分').toBeGreaterThan(50);
  }, 120_000);
});
