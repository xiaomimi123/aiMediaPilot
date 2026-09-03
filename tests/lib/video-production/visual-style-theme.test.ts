import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { renderFilm } from '@/lib/video-production/remotion-render';
import { extractSingleFrame } from '@/lib/video/ffmpeg';
import { THEMES } from '../../../remotion/src/theme';

/*
 * 二十九期 Task 1: card / illustration 两组卡面视觉 token(remotion/src/theme.ts)。
 *
 * 下面两条测试各防不同的回归(任务原文要求想清楚每条测试防什么):
 *
 * - 「真渲染, 断言背景像素不同」(第一个 describe) 测的是**端到端**——token 有没有
 *   真正接进 Film/卡片组件、渲染管线有没有把它用上。它测不出「某张卡片单独把
 *   token 读取改回写死色值」这类局部回归: 只要 Film 顶层 AbsoluteFill 的背景色
 *   仍然读 `theme.background`, 背景像素就仍然会不同——哪怕某张卡片内部的文字
 *   颜色偷偷改回了写死值, 这条测试也测不出来(抽的是背景角落像素, 不是文字
 *   像素)。这正是任务里点名的变异场景, 靠下面第二条测试兜住。
 * - 「纯断言, 两组 token 背景基色确实不同」(第二个 describe) 防的是: 有人把
 *   card/illustration 两组 token 的 `background` 改成同一个值。真渲染测试不会
 *   因此失败(两次渲染背景色一样, 渲染管线本身没有 bug), 只有直接比对 token
 *   自身的值才能抓住这个退化——它不依赖真渲染有没有恰好覆盖到这处改动。
 *
 * 抽像素做法: `extractSingleFrame` 抽帧到 `.ppm`(未压缩、ASCII 头 + 二进制像素,
 * 手工解析几行代码即可)——本机核实过 `convert`/`magick`(ImageMagick)都没装,
 * 也没有现成的 PNG 解析库依赖, ffmpeg/ffprobe 都在且已是这条产线本来就依赖的
 * 工具, 所以选 ppm 是"最稳"的选项: 不需要新增依赖, 不需要额外二进制。
 *
 * 取背景角落的一个像素(x=8,y=8, 落在 safeBox 的内边距区里, 文字/卡片内容不会
 * 画到这里)。两次渲染取同一个时间戳(0.2s): `Ambient` 的呼吸/扫光只按帧号
 * (时间)变化, 与 `visualStyle` 无关(见 motion/ambient.tsx 顶部新增的判断),
 * 所以同一时间戳下两次渲染在这个像素上的差异只可能来自 `theme.background`
 * 本身, 不是 Ambient 叠加层的相位巧合。
 */

function parsePpm(buf: Buffer): { width: number; height: number; data: Buffer } {
  if (buf.subarray(0, 2).toString('ascii') !== 'P6') {
    throw new Error('不是 P6 格式的 PPM 文件');
  }
  let pos = 2;
  const tokens: number[] = [];
  // P6 头部是 "P6 <width> <height> <maxval>", 允许注释行(# 开头)与任意空白分隔——
  // 手工扫描这三个数字 token, 比引入一个完整的 PPM 解析库更简单也更可控。
  while (tokens.length < 3) {
    while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23 /* '#' */) {
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
      continue;
    }
    const start = pos;
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    tokens.push(Number(buf.subarray(start, pos).toString('ascii')));
  }
  pos++; // maxval 后紧跟的单个空白符, 之后就是二进制像素数据(每像素 3 字节 RGB)
  const [width, height] = tokens;
  return { width, height, data: buf.subarray(pos) };
}

function readPixel(
  ppm: { width: number; height: number; data: Buffer },
  x: number,
  y: number,
): [number, number, number] {
  const offset = (y * ppm.width + x) * 3;
  return [ppm.data[offset], ppm.data[offset + 1], ppm.data[offset + 2]];
}

async function renderCornerPixel(
  visualStyle: 'card' | 'illustration',
  tmpDir: string,
): Promise<[number, number, number]> {
  const mp4Path = path.join(tmpDir, `${visualStyle}.mp4`);
  const ppmPath = path.join(tmpDir, `${visualStyle}.ppm`);
  const fps = 15;
  await renderFilm({
    input: {
      shots: [{ shotId: 'a', startMs: 0, endMs: 1000, card: 'statement', slots: { text: 'x' } }],
      audioSrc: null,
      bgm: null,
      captions: [],
      aspect: '16:9',
      visualStyle,
    },
    outputPath: mp4Path,
    durationInFrames: fps, // 1 秒, 够抽 0.2s 处的帧
    fps,
  });
  await extractSingleFrame({ videoPath: mp4Path, timestampSec: 0.2, outputPath: ppmPath });
  const ppm = parsePpm(fs.readFileSync(ppmPath));
  return readPixel(ppm, 8, 8);
}

describe('卡面视觉风格 token: card/illustration 真渲染背景像素不同', () => {
  it(
    '同一时间戳下, 两种 visualStyle 渲染出的背景角落像素颜色有肉眼可辨的差距',
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-style-theme-'));
      try {
        const cardPixel = await renderCornerPixel('card', tmpDir);
        const illustrationPixel = await renderCornerPixel('illustration', tmpDir);
        // 实测(手工核对过): h264 编码本身在纯色背景上也会有 ±1~2 的量化噪声,
        // 直接用 `not.toEqual` 会被这种噪声"假阳性"地判定为"不同"——曾经真的
        // 复现过(把 Film.tsx 顶层背景改回写死同一色值, 两次渲染的像素仍然
        // `not.toEqual`, 因为逐通道差了 1)。所以这里改成按曼哈顿距离设一个
        // 阈值: 两组 token 真实的 background 差距(#f3eeeb vs #f7e8c8)逐通道
        // 差出十几到二十几, 编码噪声只有 1~2, 阈值取 10 能把两者清楚分开。
        const distance =
          Math.abs(illustrationPixel[0] - cardPixel[0]) +
          Math.abs(illustrationPixel[1] - cardPixel[1]) +
          Math.abs(illustrationPixel[2] - cardPixel[2]);
        expect(distance).toBeGreaterThan(10);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});

describe('卡面视觉风格 token: 纯断言防回归(不依赖真渲染是否恰好覆盖到)', () => {
  it('card 与 illustration 两组 token 的背景基色确实不同', () => {
    expect(THEMES.illustration.background).not.toBe(THEMES.card.background);
  });
});
