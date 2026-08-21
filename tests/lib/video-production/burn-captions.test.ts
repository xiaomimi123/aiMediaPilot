import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { burnCaptions, probeVideo } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

const SAMPLE_SRT = `1
00:00:00,000 --> 00:00:01,000
测试字幕
`;

describe('burnCaptions', () => {
  let workDir: string;
  let sourceVideoPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'burn-captions-'));
    sourceVideoPath = path.join(workDir, 'source-test.mp4');

    // 真实的 2 秒纯色测试视频
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'color=blue:s=640x360:d=2:r=30', '-c:v', 'libx264', sourceVideoPath],
      { timeout: 60_000 },
    );
  }, 60_000);

  it(
    '真实烧录字幕：输出文件存在, 时长约 2 秒, 有视频流',
    async () => {
      const outputPath = path.join(workDir, 'output.mp4');

      const tmpEntriesBefore = new Set(
        (await fs.readdir(os.tmpdir())).filter((name) => /^captions-.*\.srt$/.test(name)),
      );

      await burnCaptions({
        videoPath: sourceVideoPath,
        srt: SAMPLE_SRT,
        outputPath,
      });

      const stat = await fs.stat(outputPath);
      expect(stat.size).toBeGreaterThan(0);

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(1.5);
      expect(probeResult.durationSec).toBeLessThan(2.5);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_streams',
        '-of', 'json',
        outputPath,
      ]);
      const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>;
      expect(streams.some((s) => s.codec_type === 'video')).toBe(true);

      // burnCaptions 内部写的临时 .srt 文件应在成功返回后被清理，不新增残留在 tmpdir 里
      // (用调用前后的差集比较，避免被环境里其他历史遗留的 captions-*.srt 文件误伤)
      const tmpEntriesAfter = (await fs.readdir(os.tmpdir())).filter((name) =>
        /^captions-.*\.srt$/.test(name),
      );
      const newLeftoverSrt = tmpEntriesAfter.filter((name) => !tmpEntriesBefore.has(name));
      expect(newLeftoverSrt).toEqual([]);
    },
    60_000,
  );
});
