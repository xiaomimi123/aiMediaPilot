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
