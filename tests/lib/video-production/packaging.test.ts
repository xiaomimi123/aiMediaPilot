import { describe, expect, it, vi, beforeEach } from 'vitest';

// 显式给每个 mock 标注参数类型 —— 否则 vi.fn(async () => undefined) 推出的调用记录
// 是空元组 `[]`, 后面 `.mock.calls[0][0]` 在本项目的 strict tsconfig 下过不了 tsc。
const ffmpegMock = vi.hoisted(() => ({
  burnCaptions: vi.fn(
    async (_opts: { videoPath: string; srt: string; outputPath: string; format?: 'srt' | 'ass' }) => undefined,
  ),
  mixBgm: vi.fn(
    async (_opts: { videoPath: string; bgmPath: string; bgmVolume: number; outputPath: string }) => undefined,
  ),
  attachIntroOutro: vi.fn(
    async (_opts: { videoPath: string; introPath?: string | null; outroPath?: string | null; outputPath: string }) =>
      undefined,
  ),
}));
vi.mock('@/lib/video/ffmpeg', () => ffmpegMock);

const fsMock = vi.hoisted(() => ({ copyFile: vi.fn(async () => undefined) }));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { needsPackaging, runPackaging } from '@/lib/video-production/packaging';
import { defaultCaptionStyle } from '@/lib/video-template/model';

beforeEach(() => vi.clearAllMocks());

const EMPTY = {
  captionStyle: null,
  captionEvents: [],
  bgmPath: null,
  bgmVolume: 0.15,
  introPath: null,
  outroPath: null,
};

describe('needsPackaging', () => {
  it('三项都没配 → false', () => {
    expect(needsPackaging(EMPTY)).toBe(false);
  });

  it('配了字幕样式但没有字幕事件 → false(无内容可烧)', () => {
    expect(needsPackaging({ ...EMPTY, captionStyle: defaultCaptionStyle() })).toBe(false);
  });

  it('配了字幕样式且有事件 → true', () => {
    expect(needsPackaging({
      ...EMPTY,
      captionStyle: defaultCaptionStyle(),
      captionEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
    })).toBe(true);
  });

  it('只配 BGM → true', () => {
    expect(needsPackaging({ ...EMPTY, bgmPath: '/tmp/bgm.mp3' })).toBe(true);
  });

  it('只配片头 → true', () => {
    expect(needsPackaging({ ...EMPTY, introPath: '/tmp/intro.mp4' })).toBe(true);
  });
});

describe('runPackaging', () => {
  const base = {
    masterPath: '/root/master.mp4',
    workDir: '/root',
    outputPath: '/root/packaged.mp4',
  };

  it('三步全配时按 字幕 → BGM → 片头片尾 顺序执行', async () => {
    const order: string[] = [];
    ffmpegMock.burnCaptions.mockImplementation(async () => { order.push('captions'); });
    ffmpegMock.mixBgm.mockImplementation(async () => { order.push('bgm'); });
    ffmpegMock.attachIntroOutro.mockImplementation(async () => { order.push('intro-outro'); });

    await runPackaging({
      ...base,
      options: {
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: '字幕' }],
        bgmPath: '/tmp/bgm.mp3',
        bgmVolume: 0.2,
        introPath: '/tmp/intro.mp4',
        outroPath: '/tmp/outro.mp4',
      },
    });

    expect(order).toEqual(['captions', 'bgm', 'intro-outro']);
  });

  it('字幕用 .ass 格式烧录, 内容是生成的 ASS 而不是 SRT', async () => {
    await runPackaging({
      ...base,
      options: {
        ...EMPTY,
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: '测试' }],
      },
    });

    expect(ffmpegMock.burnCaptions).toHaveBeenCalledTimes(1);
    const call = ffmpegMock.burnCaptions.mock.calls[0][0];
    expect(call.format).toBe('ass');
    expect(call.srt).toContain('[V4+ Styles]');
    expect(call.srt).toContain('测试');
  });

  it('只配 BGM 时不调用字幕与片头片尾', async () => {
    await runPackaging({ ...base, options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3' } });

    expect(ffmpegMock.burnCaptions).not.toHaveBeenCalled();
    expect(ffmpegMock.attachIntroOutro).not.toHaveBeenCalled();
    expect(ffmpegMock.mixBgm).toHaveBeenCalledTimes(1);
    expect(ffmpegMock.mixBgm.mock.calls[0][0].bgmPath).toBe('/tmp/bgm.mp3');
  });

  it('每步的输入是上一步的输出, 最后一步写到 outputPath', async () => {
    await runPackaging({
      ...base,
      options: {
        captionStyle: defaultCaptionStyle(),
        captionEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
        bgmPath: '/tmp/bgm.mp3',
        bgmVolume: 0.2,
        introPath: '/tmp/intro.mp4',
        outroPath: null,
      },
    });

    const captionOut = ffmpegMock.burnCaptions.mock.calls[0][0].outputPath;
    const bgmIn = ffmpegMock.mixBgm.mock.calls[0][0].videoPath;
    const bgmOut = ffmpegMock.mixBgm.mock.calls[0][0].outputPath;
    const finalIn = ffmpegMock.attachIntroOutro.mock.calls[0][0].videoPath;
    const finalOut = ffmpegMock.attachIntroOutro.mock.calls[0][0].outputPath;

    expect(ffmpegMock.burnCaptions.mock.calls[0][0].videoPath).toBe('/root/master.mp4');
    expect(bgmIn).toBe(captionOut);
    expect(finalIn).toBe(bgmOut);
    expect(finalOut).toBe('/root/packaged.mp4');
  });

  it('无需包装时原样复制 master 到 outputPath, 不调任何 ffmpeg', async () => {
    await runPackaging({ ...base, options: EMPTY });

    expect(ffmpegMock.burnCaptions).not.toHaveBeenCalled();
    expect(ffmpegMock.mixBgm).not.toHaveBeenCalled();
    expect(ffmpegMock.attachIntroOutro).not.toHaveBeenCalled();
    expect(fsMock.copyFile).toHaveBeenCalledWith('/root/master.mp4', '/root/packaged.mp4');
  });

  it('onStep 回调按步骤名依次触发(供 worker 落状态)', async () => {
    const steps: string[] = [];
    await runPackaging({
      ...base,
      options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3', introPath: '/tmp/intro.mp4' },
      onStep: async (s) => { steps.push(s); },
    });
    expect(steps).toEqual(['bgm', 'intro-outro']);
  });

  it('某一步失败时错误带上步骤名(便于定位)', async () => {
    ffmpegMock.mixBgm.mockRejectedValueOnce(new Error('ffmpeg 崩了'));
    await expect(
      runPackaging({ ...base, options: { ...EMPTY, bgmPath: '/tmp/bgm.mp3' } }),
    ).rejects.toThrow(/BGM/);
  });
});
