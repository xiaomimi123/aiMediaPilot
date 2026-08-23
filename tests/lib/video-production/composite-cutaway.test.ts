import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { compositeCutawayVideo, probeVideo } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/**
 * 用真实 ffmpeg 在指定时间戳抽 1 帧并缩到 1x1，输出 rgb24 原始像素——
 * 用于验证输出视频在某个时间点上实际显示的是哪个纯色画面(而不仅仅是时长/流信息正确)。
 */
async function sampleFrameColor(videoPath: string, timestampSec: number): Promise<RgbColor> {
  const { stdout } = await execFileAsync(
    FFMPEG_BIN,
    [
      '-y',
      '-ss', String(timestampSec),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=1:1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      'pipe:1',
    ],
    { timeout: 30_000, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
  );
  const buf = stdout as unknown as Buffer;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

function isCloseToColor(actual: RgbColor, expected: RgbColor, tolerance = 60): boolean {
  return (
    Math.abs(actual.r - expected.r) <= tolerance &&
    Math.abs(actual.g - expected.g) <= tolerance &&
    Math.abs(actual.b - expected.b) <= tolerance
  );
}

const BLUE: RgbColor = { r: 0, g: 0, b: 255 };
// ffmpeg 的具名颜色 "green" 实际是 CSS 标准的深绿 (0,128,0)，不是 (0,255,0)
const GREEN: RgbColor = { r: 0, g: 128, b: 0 };
const YELLOW: RgbColor = { r: 255, g: 255, b: 0 };

describe('compositeCutawayVideo', () => {
  let workDir: string;
  let sourceVideoPath: string;
  let brollClipPath: string;
  let longSourceVideoPath: string;
  let greenBrollPath: string;
  let yellowBrollPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'composite-cutaway-'));
    sourceVideoPath = path.join(workDir, 'source-test.mp4');
    brollClipPath = path.join(workDir, 'broll-test.mp4');
    longSourceVideoPath = path.join(workDir, 'source-long.mp4');
    greenBrollPath = path.join(workDir, 'broll-green.mp4');
    yellowBrollPath = path.join(workDir, 'broll-yellow.mp4');

    // 真实的 3 秒"出镜视频"素材：蓝色画面 + 1000Hz 正弦波音轨
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=blue:s=640x360:d=3:r=30',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=3',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest',
        sourceVideoPath,
      ],
      { timeout: 60_000 },
    );

    // 真实的 1 秒 B-roll 素材：红色画面, 无声
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'color=red:s=640x360:d=1:r=30', '-c:v', 'libx264', '-an', brollClipPath],
      { timeout: 60_000 },
    );

    // 真实的 5 秒"出镜视频"素材(蓝色画面 + 音轨)，用于多分镜乱序验证
    await execFileAsync(
      FFMPEG_BIN,
      [
        '-y',
        '-f', 'lavfi', '-i', 'color=blue:s=640x360:d=5:r=30',
        '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest',
        longSourceVideoPath,
      ],
      { timeout: 60_000 },
    );

    // 两段不同颜色的 1 秒 B-roll，用于验证乱序 segments 落到正确的时间位置
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'color=green:s=640x360:d=1:r=30', '-c:v', 'libx264', '-an', greenBrollPath],
      { timeout: 60_000 },
    );
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'color=yellow:s=640x360:d=1:r=30', '-c:v', 'libx264', '-an', yellowBrollPath],
      { timeout: 60_000 },
    );
  }, 60_000);

  it(
    '真实合成挖空替换：中间 1 秒切到 B-roll, 音轨保持源视频完整连续',
    async () => {
      const outputPath = path.join(workDir, 'output.mp4');

      await compositeCutawayVideo({
        sourceVideoPath,
        segments: [{ startMs: 1000, endMs: 2000, clipPath: brollClipPath }],
        outputPath,
      });

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(2.5);
      expect(probeResult.durationSec).toBeLessThan(3.5);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_streams',
        '-of', 'json',
        outputPath,
      ]);
      const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>;
      expect(streams.some((s) => s.codec_type === 'video')).toBe(true);
      expect(streams.some((s) => s.codec_type === 'audio')).toBe(true);
    },
    60_000,
  );

  it(
    '真实合成多分镜乱序 segments：数组顺序打乱后仍按 startMs 正确落位',
    async () => {
      const outputPath = path.join(workDir, 'output-multi-out-of-order.mp4');

      // 故意把 startMs 更大的 segment 放在数组前面，验证防御性排序在真实 ffmpeg 输出里生效
      await compositeCutawayVideo({
        sourceVideoPath: longSourceVideoPath,
        segments: [
          { startMs: 3000, endMs: 4000, clipPath: yellowBrollPath },
          { startMs: 1000, endMs: 2000, clipPath: greenBrollPath },
        ],
        outputPath,
      });

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(4.5);
      expect(probeResult.durationSec).toBeLessThan(5.5);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_streams',
        '-of', 'json',
        outputPath,
      ]);
      const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>;
      expect(streams.some((s) => s.codec_type === 'video')).toBe(true);
      expect(streams.some((s) => s.codec_type === 'audio')).toBe(true);

      // 逐时间点抽帧核对实际画面颜色，直接验证画面落位是否正确(而不仅仅是时长/流信息对了)
      const beforeFirst = await sampleFrameColor(outputPath, 0.5); // 源视频(蓝)
      const insideGreenSeg = await sampleFrameColor(outputPath, 1.5); // green segment
      const betweenSegs = await sampleFrameColor(outputPath, 2.5); // 源视频(蓝)
      const insideYellowSeg = await sampleFrameColor(outputPath, 3.5); // yellow segment
      const afterLast = await sampleFrameColor(outputPath, 4.5); // 源视频(蓝)

      expect(isCloseToColor(beforeFirst, BLUE)).toBe(true);
      expect(isCloseToColor(insideGreenSeg, GREEN)).toBe(true);
      expect(isCloseToColor(betweenSegs, BLUE)).toBe(true);
      expect(isCloseToColor(insideYellowSeg, YELLOW)).toBe(true);
      expect(isCloseToColor(afterLast, BLUE)).toBe(true);
    },
    60_000,
  );

  it(
    '真实合成: 最后一个 segment 的 endMs 恰好等于源视频总时长时不报错(零长度尾段边界)',
    async () => {
      const outputPath = path.join(workDir, 'output-tail-boundary.mp4');

      // 用真实探测到的源时长做 endMs, 复现"对齐结果最后一幕顶到视频末尾"的场景
      const { durationSec } = await probeVideo(sourceVideoPath);
      const endMs = Math.round(durationSec * 1000);

      await compositeCutawayVideo({
        sourceVideoPath,
        segments: [{ startMs: 1000, endMs, clipPath: brollClipPath }],
        outputPath,
      });

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(durationSec - 0.5);
      expect(probeResult.durationSec).toBeLessThan(durationSec + 0.5);

      // 1s 之前是源视频(蓝), 1s 之后一直到结尾都是 B-roll(红)
      const beforeSeg = await sampleFrameColor(outputPath, 0.5);
      const insideSegTail = await sampleFrameColor(outputPath, durationSec - 0.3);
      expect(isCloseToColor(beforeSeg, BLUE)).toBe(true);
      expect(isCloseToColor(insideSegTail, { r: 255, g: 0, b: 0 })).toBe(true);
    },
    60_000,
  );

  it(
    '0 个 segment 时直通合成, 时长与源视频一致',
    async () => {
      const outputPath = path.join(workDir, 'output-zero.mp4');

      await compositeCutawayVideo({
        sourceVideoPath,
        segments: [],
        outputPath,
      });

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(2.5);
      expect(probeResult.durationSec).toBeLessThan(3.5);
    },
    60_000,
  );
});
