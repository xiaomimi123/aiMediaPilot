import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { burnCaptions, buildBurnCaptionsArgs, probeVideo } from '@/lib/video/ffmpeg';

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
        (await fs.readdir(os.tmpdir())).filter((name) => /^captions-.*\.(srt|ass)$/.test(name)),
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
        /^captions-.*\.(srt|ass)$/.test(name),
      );
      const newLeftoverSrt = tmpEntriesAfter.filter((name) => !tmpEntriesBefore.has(name));
      expect(newLeftoverSrt).toEqual([]);
    },
    60_000,
  );

  it(
    '真实烧录: .srt 路径含 filter 特殊字符(空格/单引号/逗号/方括号)时转义后仍能成功',
    async () => {
      // 终审遗留验证: subtitles= 的值要过 ffmpeg filtergraph 两层解析,
      // 未转义的特殊字符路径会直接解析失败。这里用真实 ffmpeg 证明转义方案有效。
      const weirdDir = path.join(workDir, "sub dir's [x],v1");
      await fs.mkdir(weirdDir, { recursive: true });
      const srtPath = path.join(weirdDir, 'captions.srt');
      await fs.writeFile(srtPath, SAMPLE_SRT, 'utf-8');
      const outputPath = path.join(workDir, 'output-weird-path.mp4');

      await execFileAsync(
        FFMPEG_BIN,
        buildBurnCaptionsArgs({ videoPath: sourceVideoPath, srtPath, outputPath }),
        { timeout: 60_000 },
      );

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(1.5);
      expect(probeResult.durationSec).toBeLessThan(2.5);
    },
    60_000,
  );

  it(
    '真实烧录 .ass 样式字幕: 输出成功且时长不变',
    async () => {
      const outputPath = path.join(workDir, 'output-ass.mp4');
      const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,PingFang SC,56,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,90,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,中文样式字幕
`;
      await burnCaptions({ videoPath: sourceVideoPath, srt: ass, outputPath, format: 'ass' });

      const probeResult = await probeVideo(outputPath);
      expect(probeResult.durationSec).toBeGreaterThan(1.5);
      expect(probeResult.durationSec).toBeLessThan(2.5);
    },
    60_000,
  );
});
