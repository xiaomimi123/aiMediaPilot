import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mixBgm, probeVideo, hasAudioStream } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

describe('mixBgm', () => {
  let workDir: string;
  let videoWithVoice: string;
  let videoSilent: string;
  let shortBgm: string;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bgm-mix-'));
    videoWithVoice = path.join(workDir, 'with-voice.mp4');
    videoSilent = path.join(workDir, 'silent.mp4');
    shortBgm = path.join(workDir, 'bgm.mp3');

    // 4 秒带"人声"(1000Hz 正弦)的正片
    await execFileAsync(FFMPEG_BIN, [
      '-y',
      '-f', 'lavfi', '-i', 'color=blue:s=320x180:d=4:r=15',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', videoWithVoice,
    ], { timeout: 60_000 });

    // 4 秒无音轨的正片(图文口播模式的形状)
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'color=green:s=320x180:d=4:r=15', '-c:v', 'libx264', '-an', videoSilent,
    ], { timeout: 60_000 });

    // 1 秒 BGM —— 故意比正片短, 验证 -stream_loop 循环补齐
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', shortBgm,
    ], { timeout: 60_000 });
  }, 120_000);

  it('正片有人声: 混音后仍是一条音轨, 总时长不被短 BGM 截断也不被循环拖长', async () => {
    const outputPath = path.join(workDir, 'out-voice.mp4');
    await mixBgm({ videoPath: videoWithVoice, bgmPath: shortBgm, bgmVolume: 0.15, outputPath });

    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);

    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', outputPath]);
    const streams = JSON.parse(stdout).streams as Array<{ codec_type: string }>;
    expect(streams.filter((s) => s.codec_type === 'audio')).toHaveLength(1);
    expect(streams.some((s) => s.codec_type === 'video')).toBe(true);
  }, 120_000);

  it('正片无音轨: BGM 成为唯一音轨, 时长以画面为准', async () => {
    const outputPath = path.join(workDir, 'out-silent.mp4');
    expect(await hasAudioStream(videoSilent)).toBe(false);

    await mixBgm({ videoPath: videoSilent, bgmPath: shortBgm, bgmVolume: 0.3, outputPath });

    expect(await hasAudioStream(outputPath)).toBe(true);
    const probed = await probeVideo(outputPath);
    expect(probed.durationSec).toBeGreaterThan(3.5);
    expect(probed.durationSec).toBeLessThan(4.5);
  }, 120_000);
});
