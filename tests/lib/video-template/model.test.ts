import { describe, expect, it } from 'vitest';
import {
  PRESET_TEMPLATES,
  VideoTemplateConfigSchema,
  defaultCaptionStyle,
  CAPTION_FONT_WHITELIST,
} from '@/lib/video-template/model';

describe('PRESET_TEMPLATES', () => {
  it('恰好 3 个预设, 三种交付模式各一个', () => {
    expect(PRESET_TEMPLATES).toHaveLength(3);
    const modes = PRESET_TEMPLATES.map((t) => t.deliveryMode).sort();
    expect(modes).toEqual(['illustration-tts', 'ppt-narration', 'talking-head-broll']);
  });

  it('每个预设都能通过 schema 校验', () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(() => VideoTemplateConfigSchema.parse(preset)).not.toThrow();
    }
  });

  it('预设默认不带 BGM/片头/片尾(素材需用户自己上传)', () => {
    for (const preset of PRESET_TEMPLATES) {
      expect(preset.bgmPath).toBeNull();
      expect(preset.introPath).toBeNull();
      expect(preset.outroPath).toBeNull();
    }
  });

  it('插画预设用 illustration 画面风格并带配音音色预设', () => {
    const illust = PRESET_TEMPLATES.find((t) => t.deliveryMode === 'illustration-tts')!;
    expect(illust.visualStyle).toBe('illustration');
    expect(illust.voicePreset).not.toBeNull();
  });
});

describe('VideoTemplateConfigSchema', () => {
  it('拒绝非法交付模式(manual 不是模板的合法值)', () => {
    const bad = { ...PRESET_TEMPLATES[0], deliveryMode: 'manual' };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });

  it('拒绝白名单外的字幕字体', () => {
    const bad = {
      ...PRESET_TEMPLATES[0],
      captionStyle: { ...defaultCaptionStyle(), fontFamily: 'Comic Sans MS' },
    };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });

  it('拒绝越界的 bgmVolume', () => {
    expect(() => VideoTemplateConfigSchema.parse({ ...PRESET_TEMPLATES[0], bgmVolume: 1.5 })).toThrow();
    expect(() => VideoTemplateConfigSchema.parse({ ...PRESET_TEMPLATES[0], bgmVolume: -0.1 })).toThrow();
  });

  it('拒绝非 #RRGGBB 的字幕颜色', () => {
    const bad = {
      ...PRESET_TEMPLATES[0],
      captionStyle: { ...defaultCaptionStyle(), primaryColor: 'white' },
    };
    expect(() => VideoTemplateConfigSchema.parse(bad)).toThrow();
  });
});

describe('defaultCaptionStyle', () => {
  it('默认字体在白名单内', () => {
    expect(CAPTION_FONT_WHITELIST).toContain(defaultCaptionStyle().fontFamily);
  });
});
