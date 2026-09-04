import { describe, expect, it } from 'vitest';
import {
  buildProbeArgs,
  buildExtractFramesArgs,
  buildExtractAudioArgs,
  buildExtractSingleFrameArgs,
  buildEncodeFramesArgs,
  buildConcatAudioArgs,
  parseProbeOutput,
  buildProbeDimensionsArgs,
  parseProbeDimensionsOutput,
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

describe('buildConcatAudioArgs', () => {
  it('用 concat demuxer 但强制 -c:a pcm_s16le 重编码, 不用 -c copy', () => {
    const args = buildConcatAudioArgs({
      audioPaths: ['/tmp/a.mp3', '/tmp/b.mp3'],
      outputPath: '/tmp/out.wav',
      concatListPath: '/tmp/list.txt',
    });
    expect(args).toContain('-f');
    expect(args).toContain('concat');
    expect(args).toContain('-safe');
    expect(args).toContain('0');
    expect(args).toContain('-c:a');
    expect(args).toContain('pcm_s16le');
    expect(args).not.toContain('copy');
    expect(args).toContain('/tmp/list.txt');
    expect(args).toContain('/tmp/out.wav');
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

describe('buildProbeDimensionsArgs', () => {
  it('构造 ffprobe 取第一条视频流的 width/height', () => {
    const args = buildProbeDimensionsArgs('/tmp/a.mp4');
    expect(args).toContain('-select_streams');
    expect(args).toContain('v:0');
    expect(args.join(' ')).toMatch(/stream=width,height/);
    expect(args[args.length - 1]).toBe('/tmp/a.mp4');
  });
});

describe('parseProbeDimensionsOutput', () => {
  it('从 ffprobe JSON 解出 width/height', () => {
    const json = JSON.stringify({ streams: [{ width: 2160, height: 3840 }] });
    const result = parseProbeDimensionsOutput(json);
    expect(result).toEqual({ width: 2160, height: 3840 });
  });

  it('损坏的 JSON 抛错', () => {
    expect(() => parseProbeDimensionsOutput('not json')).toThrow();
  });

  it('streams 缺失或为空抛错', () => {
    expect(() => parseProbeDimensionsOutput('{}')).toThrow(/missing width\/height/);
    expect(() => parseProbeDimensionsOutput(JSON.stringify({ streams: [] }))).toThrow(/missing width\/height/);
  });
});
