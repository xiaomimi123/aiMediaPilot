import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { compositeCutawayVideo, probeVideo } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

describe('compositeCutawayVideo', () => {
  let workDir: string;
  let sourceVideoPath: string;
  let brollClipPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'composite-cutaway-'));
    sourceVideoPath = path.join(workDir, 'source-test.mp4');
    brollClipPath = path.join(workDir, 'broll-test.mp4');

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
  }, 30_000);

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
