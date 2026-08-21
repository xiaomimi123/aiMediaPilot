import { describe, expect, it } from 'vitest';
import {
  buildProbeArgs,
  buildExtractFramesArgs,
  buildExtractAudioArgs,
  buildExtractSingleFrameArgs,
  buildEncodeFramesArgs,
  buildConcatArgs,
  buildCompositeCutawayArgs,
  buildBurnCaptionsArgs,
  buildMuxAudioArgs,
  parseProbeOutput,
} from '@/lib/video/ffmpeg';

describe('buildProbeArgs', () => {
  it('构造 ffprobe 取 duration + format', () => {
    const args = buildProbeArgs('/tmp/a.mp4');
    expect(args).toContain('-show_format');
    expect(args).toContain('-of');
    expect(args).toContain('json');
    expect(args[args.length - 1]).toBe('/tmp/a.mp4');
  });
});

describe('buildExtractFramesArgs', () => {
  it('每 N 秒抽一帧, 输出到指定目录', () => {
    const args = buildExtractFramesArgs({
      videoPath: '/in.mp4',
      framesDir: '/out',
      intervalSec: 3,
    });
    expect(args).toContain('-i');
    expect(args).toContain('/in.mp4');
    expect(args.join(' ')).toMatch(/fps=1\/3/);
    expect(args).toContain('/out/frame_%04d.jpg');
  });
});

describe('buildExtractAudioArgs', () => {
  it('抽取 16kHz mono wav', () => {
    const args = buildExtractAudioArgs({ videoPath: '/in.mp4', audioPath: '/out.wav' });
    expect(args).toContain('-vn');
    expect(args.join(' ')).toMatch(/-ar 16000/);
    expect(args.join(' ')).toMatch(/-ac 1/);
    expect(args[args.length - 1]).toBe('/out.wav');
  });
});

describe('buildExtractSingleFrameArgs', () => {
  it('指定时间戳抽 1 帧', () => {
    const args = buildExtractSingleFrameArgs({
      videoPath: '/in.mp4',
      timestampSec: 2.5,
      outputPath: '/out/frame.jpg',
    });
    expect(args.join(' ')).toMatch(/-ss 2.5/);
    expect(args).toContain('-frames:v');
    expect(args).toContain('1');
    expect(args[args.length - 1]).toBe('/out/frame.jpg');
  });
});

describe('buildEncodeFramesArgs', () => {
  it('按 fps 把帧图片序列编码为 mp4', () => {
    const args = buildEncodeFramesArgs({ framesDir: '/tmp/f', fps: 24, outputPath: '/tmp/out.mp4' });
    expect(args).toContain('-framerate');
    expect(args).toContain('24');
    expect(args).toContain('/tmp/f/frame_%04d.png');
    expect(args).toContain('/tmp/out.mp4');
  });
});

describe('buildConcatArgs', () => {
  it('用 concat demuxer 拼接多段 clip', () => {
    const args = buildConcatArgs({
      clipPaths: ['/tmp/a.mp4', '/tmp/b.mp4'],
      outputPath: '/tmp/out.mp4',
      concatListPath: '/tmp/list.txt',
    });
    expect(args).toContain('-f');
    expect(args).toContain('concat');
    expect(args).toContain('-safe');
    expect(args).toContain('0');
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).toContain('/tmp/list.txt');
    expect(args).toContain('/tmp/out.mp4');
  });
});

describe('buildCompositeCutawayArgs', () => {
  it('给定 1 个 segment, 生成含 filter_complex/源视频/B-roll/输出路径的参数', () => {
    const args = buildCompositeCutawayArgs({
      sourceVideoPath: '/tmp/source.mp4',
      segments: [{ startMs: 1000, endMs: 2000, clipPath: '/tmp/broll.mp4' }],
      outputPath: '/tmp/out.mp4',
    });
    expect(args).toContain('-filter_complex');
    expect(args).toContain('/tmp/source.mp4');
    expect(args).toContain('/tmp/broll.mp4');
    expect(args).toContain('/tmp/out.mp4');
    expect(args).toContain('[outv]');
  });

  it('按 startMs 防御性排序乱序 segments', () => {
    const argsUnsorted = buildCompositeCutawayArgs({
      sourceVideoPath: '/tmp/source.mp4',
      segments: [
        { startMs: 2000, endMs: 2500, clipPath: '/tmp/b.mp4' },
        { startMs: 500, endMs: 1000, clipPath: '/tmp/a.mp4' },
      ],
      outputPath: '/tmp/out.mp4',
    });
    const filterIdx = argsUnsorted.indexOf('-filter_complex');
    const filterComplex = argsUnsorted[filterIdx + 1];
    // a.mp4 对应的 segment(startMs=500)排序后应先于 b.mp4(startMs=2000)出现在拼接顺序里
    const aLabelPos = filterComplex.indexOf('[2:v]'); // a.mp4 是第二个 -i, 但排在前面处理
    const bLabelPos = filterComplex.indexOf('[1:v]'); // b.mp4 是第一个 -i, 但排在后面处理
    expect(aLabelPos).toBeGreaterThan(-1);
    expect(bLabelPos).toBeGreaterThan(-1);
    expect(aLabelPos).toBeLessThan(bLabelPos);
  });

  it('0 个 segment 时直通源视频的视频流和音频流', () => {
    const args = buildCompositeCutawayArgs({
      sourceVideoPath: '/tmp/source.mp4',
      segments: [],
      outputPath: '/tmp/out.mp4',
    });
    expect(args).not.toContain('-filter_complex');
    expect(args).toContain('0:v');
    expect(args).toContain('0:a');
  });
});

describe('buildBurnCaptionsArgs', () => {
  it('用 subtitles filter 烧录字幕', () => {
    const args = buildBurnCaptionsArgs({
      videoPath: '/in.mp4',
      srtPath: '/tmp/captions-abc.srt',
      outputPath: '/out.mp4',
    });
    expect(args).toContain('-i');
    expect(args).toContain('/in.mp4');
    expect(args).toContain('-vf');
    expect(args.join(' ')).toMatch(/subtitles=\/tmp\/captions-abc\.srt/);
    expect(args[args.length - 1]).toBe('/out.mp4');
  });
});

describe('buildMuxAudioArgs', () => {
  it('用 -map 把视频流和音频流分别绑定到两个输入, -shortest 对齐时长', () => {
    const args = buildMuxAudioArgs({
      videoPath: '/tmp/video.mp4',
      audioPath: '/tmp/voice.wav',
      outputPath: '/tmp/out.mp4',
    });
    expect(args).toContain('/tmp/video.mp4');
    expect(args).toContain('/tmp/voice.wav');
    expect(args).toContain('-map');
    expect(args).toContain('0:v:0');
    expect(args).toContain('1:a:0');
    expect(args).toContain('-shortest');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });
});

describe('parseProbeOutput', () => {
  it('从 ffprobe JSON 解出 duration + formatName', () => {
    const json = JSON.stringify({
      format: { duration: '67.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    const result = parseProbeOutput(json);
    expect(result.durationSec).toBeCloseTo(67.5);
    expect(result.formatName).toContain('mp4');
  });

  it('损坏的 JSON 抛错', () => {
    expect(() => parseProbeOutput('not json')).toThrow();
  });

  it('format 字段缺失抛错', () => {
    expect(() => parseProbeOutput('{}')).toThrow(/missing .format/);
  });

  it('duration 缺失抛错', () => {
    expect(() => parseProbeOutput(JSON.stringify({ format: { format_name: 'mp4' } }))).toThrow(/invalid duration/);
  });
});
