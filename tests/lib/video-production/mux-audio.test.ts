import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { muxAudioTrack, probeVideo } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

describe('muxAudioTrack', () => {
  let workDir: string;
  let videoPath: string;
  let audioPath: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mux-audio-'));
    videoPath = path.join(workDir, 'silent-video.mp4');
    audioPath = path.join(workDir, 'voice.wav');

    // 真实的 2 秒纯色无声测试视频
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'color=green:s=640x360:d=2:r=30', '-c:v', 'libx264', videoPath],
      { timeout: 60_000 },
    );

    // 真实的 2 秒正弦波测试音频(模拟 TTS 输出)
    await execFileAsync(
      FFMPEG_BIN,
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audioPath],
      { timeout: 60_000 },
    );
  }, 60_000);

  it(
    '真实混流：输出文件同时含视频流和音频流, 时长约 2 秒',
    async () => {
      const outputPath = path.join(workDir, 'output.mp4');

      await muxAudioTrack({ videoPath, audioPath, outputPath });

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
      expect(streams.some((s) => s.codec_type === 'audio')).toBe(true);
    },
    60_000,
  );
});
