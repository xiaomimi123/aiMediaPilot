import { describe, expect, it } from 'vitest';
import { buildPackagingOptions } from '@/lib/video-production/packaging-input';
import { defaultCaptionStyle } from '@/lib/video-template/model';

const TEMPLATE = {
  captionStyle: defaultCaptionStyle(),
  bgmPath: '/tmp/bgm.mp3',
  bgmVolume: 0.2,
  introPath: '/tmp/intro.mp4',
  outroPath: null,
};

const BASE = {
  transcript: null,
  alignedActs: null,
  narrations: {},
  shotEvents: [],
};

describe('buildPackagingOptions', () => {
  it('无模板时返回全空配置(包装段整段跳过, 零迁移)', () => {
    const opts = buildPackagingOptions({ ...BASE, template: null, mode: 'ppt-narration' });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
    expect(opts.bgmPath).toBeNull();
    expect(opts.introPath).toBeNull();
    expect(opts.outroPath).toBeNull();
  });

  it('模板的 BGM/片头片尾原样透传', () => {
    const opts = buildPackagingOptions({ ...BASE, template: TEMPLATE, mode: 'ppt-narration' });
    expect(opts.bgmPath).toBe('/tmp/bgm.mp3');
    expect(opts.bgmVolume).toBe(0.2);
    expect(opts.introPath).toBe('/tmp/intro.mp4');
    expect(opts.outroPath).toBeNull();
  });

  it('真人出镜: 字幕事件来自 ASR 原话转写', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'talking-head-broll',
      transcript: [{ startSec: 0, endSec: 1, text: '真实原话' }],
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 2000 }] as any,
      narrations: { hook: '稿子上的台词' },
    });
    expect(opts.captionEvents).toHaveLength(1);
    expect(opts.captionEvents[0].text).toBe('真实原话');
  });

  it('插画 TTS: 字幕事件来自对齐幕边界 + 稿子台词', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'illustration-tts',
      alignedActs: [{ act: 'hook', startMs: 0, endMs: 2000 }] as any,
      narrations: { hook: '稿子上的台词' },
    });
    expect(opts.captionEvents).toEqual([{ startMs: 0, endMs: 2000, text: '稿子上的台词' }]);
  });

  it('图文口播(无对齐无转写): 字幕事件来自分镜时长铺排', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: TEMPLATE,
      mode: 'ppt-narration',
      shotEvents: [{ startMs: 0, endMs: 3000, text: '分镜文案' }],
    });
    expect(opts.captionEvents).toEqual([{ startMs: 0, endMs: 3000, text: '分镜文案' }]);
  });

  it('模板 captionStyle 为 null 时不产出字幕事件(明确关掉字幕)', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: { ...TEMPLATE, captionStyle: null },
      mode: 'talking-head-broll',
      transcript: [{ startSec: 0, endSec: 1, text: '原话' }],
    });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
  });

  it('captionStyle 是非法 JSON 形状时降级为不烧字幕而不是崩溃', () => {
    const opts = buildPackagingOptions({
      ...BASE,
      template: { ...TEMPLATE, captionStyle: { fontFamily: 'Comic Sans MS' } },
      mode: 'ppt-narration',
      shotEvents: [{ startMs: 0, endMs: 1000, text: 'x' }],
    });
    expect(opts.captionStyle).toBeNull();
    expect(opts.captionEvents).toEqual([]);
  });
});
