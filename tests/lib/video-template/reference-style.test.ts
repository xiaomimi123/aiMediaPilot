import { describe, expect, it } from 'vitest';
import {
  PRESET_TEMPLATES,
  VideoTemplateConfigSchema,
  defaultCaptionStyle,
} from '@/lib/video-template/model';

/**
 * 二十一期: 按同行参考视频拆解结论(docs/superpowers/specs/2026-08-25-reference-video-teardown.md)
 * 新增「知识长视频」预设与三个风格字段。
 */
describe('风格字段', () => {
  const base = PRESET_TEMPLATES[0];

  it('三个新字段都有默认值, 老模板行为不变(暗色/无节奏约束/无章节条)', () => {
    expect(base.visualTone).toBe('dark');
    expect(base.shotPaceSec).toBeNull();
    expect(base.showChapterNav).toBe(false);
  });

  it('visualTone 只接受 light/dark', () => {
    expect(() => VideoTemplateConfigSchema.parse({ ...base, visualTone: 'rainbow' })).toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...base, visualTone: 'light' })).not.toThrow();
  });

  it('shotPaceSec 必须是正数或 null, 且不许荒唐地小', () => {
    expect(() => VideoTemplateConfigSchema.parse({ ...base, shotPaceSec: 0 })).toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...base, shotPaceSec: 0.5 })).toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...base, shotPaceSec: 4 })).not.toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...base, shotPaceSec: null })).not.toThrow();
  });

  it('支持参考视频那种长时长(110~240 秒), 不再卡死在 90 秒', () => {
    for (const sec of [120, 180, 240]) {
      expect(() =>
        VideoTemplateConfigSchema.parse({ ...base, scriptPrompt: { targetDurationSec: sec } }),
      ).not.toThrow();
    }
  });

  it('原有的短时长选项仍然合法(零迁移)', () => {
    for (const sec of [30, 45, 60, 90]) {
      expect(() =>
        VideoTemplateConfigSchema.parse({ ...base, scriptPrompt: { targetDurationSec: sec } }),
      ).not.toThrow();
    }
  });
});

describe('「知识长视频」预设', () => {
  const preset = PRESET_TEMPLATES.find((t) => t.name.includes('知识长视频'));

  it('存在, 且是图文口播模式', () => {
    expect(preset).toBeDefined();
    expect(preset!.deliveryMode).toBe('ppt-narration');
  });

  it('亮底 —— 参考视频实测帧均值亮度 215, 我们原来是深蓝底', () => {
    expect(preset!.visualTone).toBe('light');
  });

  it('切镜节奏对齐参考视频的 2.8~6 秒, 不是我们原来的 10 秒', () => {
    expect(preset!.shotPaceSec).toBeGreaterThanOrEqual(3);
    expect(preset!.shotPaceSec).toBeLessThanOrEqual(6);
  });

  it('开启章节进度条 —— 六幕结构天然适合做这个', () => {
    expect(preset!.showChapterNav).toBe(true);
  });

  it('时长对齐参考视频量级(不少于 120 秒)', () => {
    expect(preset!.scriptPrompt?.targetDurationSec).toBeGreaterThanOrEqual(120);
  });

  it('字幕是深色大号粗体 —— 亮底不需要白字, 字号大于默认', () => {
    const d = defaultCaptionStyle();
    expect(preset!.captionStyle).not.toBeNull();
    expect(preset!.captionStyle!.fontSize).toBeGreaterThan(d.fontSize);
    // 亮底配深色字: 主色应该是深色而非白色
    expect(preset!.captionStyle!.primaryColor.toUpperCase()).not.toBe('#FFFFFF');
  });

  it('整体仍能通过 schema 校验', () => {
    expect(() => VideoTemplateConfigSchema.parse(preset)).not.toThrow();
  });
});
