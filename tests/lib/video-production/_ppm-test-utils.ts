/**
 * PPM(P6)像素抽帧断言的共享小工具——与 visual-style-theme.test.ts 同一手法,
 * 抽出来给出镜视频层的 cutaway/pip 两份真渲染测试共用, 避免重复。
 *
 * 文件名不以 `.test.ts` 结尾, 不会被 vitest 当成测试文件收集。
 */

export function parsePpm(buf: Buffer): { width: number; height: number; data: Buffer } {
  if (buf.subarray(0, 2).toString('ascii') !== 'P6') {
    throw new Error('不是 P6 格式的 PPM 文件');
  }
  let pos = 2;
  const tokens: number[] = [];
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
  pos++;
  const [width, height] = tokens;
  return { width, height, data: buf.subarray(pos) };
}

export function readPixel(
  ppm: { width: number; height: number; data: Buffer },
  x: number,
  y: number,
): [number, number, number] {
  const offset = (y * ppm.width + x) * 3;
  return [ppm.data[offset], ppm.data[offset + 1], ppm.data[offset + 2]];
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function manhattan(a: [number, number, number], b: [number, number, number]): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/**
 * 在一块矩形区域内扫描, 判断是否存在"足够接近目标色"的像素(二十九期终审
 * 补 pipReserve 防撞回归用)。
 *
 * 为什么扫区域而不是单点采样: 字幕文字的具体渲染宽度依赖字体度量(不同机器/
 * 字体的字形宽度有细微差异, 见 remotion-audio-captions.test.ts 顶部注释里
 * 同样的顾虑), 只采一个像素点容易因为"字刚好没盖到那个点"而产生假阴性/假阳性。
 * 扫一片区域找"有没有任意一点接近目标色"对字体度量的容差要宽得多——只要
 * 文字确实落在(或确实没落在)这片区域里的某处, 结论就不会因为具体字形宽度的
 * 几像素误差而翻转。
 */
export function regionContainsColor(
  ppm: { width: number; height: number; data: Buffer },
  xRange: [number, number],
  yRange: [number, number],
  target: [number, number, number],
  threshold: number,
): boolean {
  const x0 = Math.max(0, Math.floor(xRange[0]));
  const x1 = Math.min(ppm.width - 1, Math.ceil(xRange[1]));
  const y0 = Math.max(0, Math.floor(yRange[0]));
  const y1 = Math.min(ppm.height - 1, Math.ceil(yRange[1]));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (manhattan(readPixel(ppm, x, y), target) < threshold) return true;
    }
  }
  return false;
}

import { spawnSync } from 'child_process';

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

/**
 * `ffmpeg -af volumedetect` 量音频能量。用 spawnSync 而不是 execFile 系(那些
 * 默认只捕获 stdout)——volumedetect 的结果写在 stderr 里, `-f null -` 让
 * ffmpeg 只跑滤镜不产出文件, 退出码 0。
 */
export function meanVolumeDb(videoPath: string, startSec?: number, durSec?: number): number {
  const args = [
    '-hide_banner',
    ...(startSec !== undefined ? ['-ss', String(startSec)] : []),
    '-i', videoPath,
    ...(durSec !== undefined ? ['-t', String(durSec)] : []),
    '-af', 'volumedetect',
    '-f', 'null',
    '-',
  ];
  const res = spawnSync(FFMPEG_BIN, args, { encoding: 'utf8' });
  const stderr = res.stderr || '';
  const m = stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  if (!m) {
    throw new Error(`volumedetect 未能解析 mean_volume, stderr 尾部:\n${stderr.slice(-2000)}`);
  }
  return Number(m[1]);
}
