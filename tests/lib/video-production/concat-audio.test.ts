import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { concatAudioTracks, concatClips, probeVideo } from '@/lib/video/ffmpeg';

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';

/**
 * 回归测试 (二十期 code review 发现的真实 bug 修复)：illustration-tts 分支把逐幕 TTS
 * 输出(mp3 编码内容)拼接成一条完整音轨时, 不能像视频 clip 拼接那样用 concatClips 的
 * `-c copy`——mp3 是帧编码, `-c copy` 在拼接点上不是采样点精确的, 会有可测量的时长漂移。
 * concatAudioTracks 改用 concat demuxer + `-c:a pcm_s16le` 强制重编码, 拼接点采样点精确对齐。
 *
 * 用 ffmpeg lavfi 生成的 2 段真实 mp3(libmp3lame 编码, 模拟 synthesizeVolcTts 的实际输出
 * 格式), 不需要真实 TTS API 调用。
 */
describe('concatAudioTracks', () => {
  let workDir: string;
  let clipA: string;
  let clipB: string;
  let clipC: string;
  const durASec = 2;
  const durBSec = 1.5;
  const durCSec = 1;

  beforeAll(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'concat-audio-'));
    clipA = path.join(workDir, 'act-a.mp3');
    clipB = path.join(workDir, 'act-b.mp3');
    clipC = path.join(workDir, 'act-c.mp3');

    for (const [outPath, freq, durSec] of [
      [clipA, 440, durASec],
      [clipB, 523, durBSec],
      [clipC, 660, durCSec],
    ] as const) {
      await execFileAsync(
        FFMPEG_BIN,
        [
          '-y',
          '-f', 'lavfi',
          '-i', `sine=frequency=${freq}:duration=${durSec}`,
          '-c:a', 'libmp3lame',
          outPath,
        ],
        { timeout: 60_000 },
      );
    }
  }, 60_000);

  it(
    '真实拼接 3 段 mp3：输出时长与输入时长之和的误差在 ±10ms 以内(采样点精确)',
    async () => {
      const outputPath = path.join(workDir, 'concatenated.wav');
      await concatAudioTracks({
        audioPaths: [clipA, clipB, clipC],
        outputPath,
        concatListPath: path.join(workDir, 'concat-audio-list.txt'),
      });

      const probeResult = await probeVideo(outputPath);
      const expectedSec = durASec + durBSec + durCSec;
      expect(Math.abs(probeResult.durationSec - expectedSec)).toBeLessThan(0.01);
    },
    60_000,
  );

  it(
    '对照组：旧的 concatClips(-c copy) 拼接同样 3 段 mp3 会产生可测量的时长漂移(证明修复前的 bug 确实存在)',
    async () => {
      const outputPath = path.join(workDir, 'concatenated-copy.mp3');
      await concatClips({
        clipPaths: [clipA, clipB, clipC],
        outputPath,
        concatListPath: path.join(workDir, 'concat-list-copy.txt'),
      });

      const probeResult = await probeVideo(outputPath);
      const expectedSec = durASec + durBSec + durCSec;
      // 不断言具体漂移量(依赖 ffmpeg 版本/环境), 只断言这条路径确实无法保证 <10ms 的精度——
      // 用来对照证明 concatAudioTracks 的重编码路径是必要的, 而不是画蛇添足。
      expect(Math.abs(probeResult.durationSec - expectedSec)).toBeGreaterThan(0.01);
    },
    60_000,
  );
});
