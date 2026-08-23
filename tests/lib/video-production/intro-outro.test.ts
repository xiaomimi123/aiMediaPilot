import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { attachIntroOutro, probeVideo, hasAudioStream } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

interface RgbColor { r: number; g: number; b: number }

async function sampleFrameColor(videoPath: string, timestampSec: number): Promise<RgbColor> {
  const { stdout } = await execFileAsync(
    FFMPEG_BIN,
    ['-y', '-ss', String(timestampSec), '-i', videoPath, '-frames:v', '1',
     '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { timeout: 30_000, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 },
  );
  const buf = stdout as unknown as Buffer;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

function isCloseToColor(a: RgbColor, e: RgbColor, tol = 60): boolean {
  return Math.abs(a.r - e.r) <= tol && Math.abs(a.g - e.g) <= tol && Math.abs(a.b - e.b) <= tol;
}

const RED: RgbColor = { r: 255, g: 0, b: 0 };
const BLUE: RgbColor = { r: 0, g: 0, b: 255 };
const YELLOW: RgbColor = { r: 255, g: 255, b: 0 };

describe('attachIntroOutro', () => {
  let workDir: string;
  let mainPath: string;
  let introPath: string;
  let outroPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'intro-outro-'));
    mainPath = path.join(workDir, 'main.mp4');
    introPath = path.join(workDir, 'intro.mp4');
    outroPath = path.join(workDir, 'outro.mp4');

    // 正片: 4 秒蓝色 + 音轨, 320x180
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=4:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', mainPath,
    ], { timeout: 60_000 });

    // 片头: 2 秒红色, **无音轨**且**尺寸不同**(验证静音补齐 + 尺寸对齐两条防御)
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=red:s=640x360:d=2:r=15', '-c:v', 'libx264', '-an', introPath,
    ], { timeout: 60_000 });

    // 片尾: 2 秒黄色 + 音轨, 又一个不同尺寸
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=yellow:s=480x270:d=2:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=600:duration=2',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', outroPath,
    ], { timeout: 60_000 });
  }, 180_000);

  it('片头+片尾都配: 总时长≈2+4+2, 三段画面各自落位, 输出有音轨', async () => {
    const outputPath = path.join(workDir, 'out-both.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath, outroPath, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(7.0);
    expect(probed.durationSec).toBeLessThan(9.0);

    expect(isCloseToColor(await sampleFrameColor(outputPath, 1.0), RED)).toBe(true);   // 片头
    expect(isCloseToColor(await sampleFrameColor(outputPath, 4.0), BLUE)).toBe(true);  // 正片
    expect(isCloseToColor(await sampleFrameColor(outputPath, 7.0), YELLOW)).toBe(true); // 片尾

    expect(await hasAudioStream(outputPath)).toBe(true);
  }, 180_000);

  it('只配片头: 总时长≈2+4, 开头是片头', async () => {
    const outputPath = path.join(workDir, 'out-intro-only.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath, outroPath: null, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(5.0);
    expect(probed.durationSec).toBeLessThan(7.0);
    expect(isCloseToColor(await sampleFrameColor(outputPath, 1.0), RED)).toBe(true);
  }, 180_000);

  it('都没配: 原样复制正片, 时长不变', async () => {
    const outputPath = path.join(workDir, 'out-none.mp4');
    await attachIntroOutro({ videoPath: mainPath, introPath: null, outroPath: null, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);
  }, 120_000);
});
