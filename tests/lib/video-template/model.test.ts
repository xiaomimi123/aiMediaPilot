import { describe, expect, it } from 'vitest';
import {
  PRESET_TEMPLATES,
  VideoTemplateConfigSchema,
  defaultCaptionStyle,
  CAPTION_FONT_WHITELIST,
} from '@/lib/video-template/model';
import type { VideoTemplateConfig } from '@/lib/video-template/model';

describe('PRESET_TEMPLATES', () => {
  it('每种交付模式各至少一个预设, 且文字叠加是层不是模式', () => {
    // 二十一期新增「知识长视频(横屏)」后不再是恰好 3 个 —— 断言改为覆盖性检查,
    // 这样以后再按参考视频复刻新预设也不会误伤。
    // 二十三期新增「真人口播 · 文字叠加」预设 —— 它**不是新的交付模式**,
    // 就是 talking-head-broll 关掉 B-roll、开着文字叠加。文字叠加和真人形象
    // 是能加到任何模式上的层, 不是并列的模式。
    const modes = new Set(PRESET_TEMPLATES.map((t) => t.deliveryMode));
    expect(modes).toEqual(new Set(['illustration-tts', 'ppt-narration', 'talking-head-broll']));
    expect(PRESET_TEMPLATES.length).toBeGreaterThanOrEqual(4);
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

describe('VideoTemplateConfig 的 deliveryMode 类型收窄(编译期)', () => {
  it('manual 赋值给 deliveryMode 在编译期就被拒绝, 不必等到运行时过 zod 才报错', () => {
    // @ts-expect-error 'manual' 不在 TemplateDeliveryMode(= Exclude<DeliveryMode, 'manual'>)里 ——
    // 若这层类型收窄被移除(deliveryMode 退回宽的 DeliveryMode), 本行会变成"不再报错",
    // 下面这个 @ts-expect-error 指令本身就会因"未使用"而让 tsc --noEmit 失败, 从而暴露回归。
    const bad: VideoTemplateConfig = { ...PRESET_TEMPLATES[0], deliveryMode: 'manual' };
    expect(bad.deliveryMode).toBe('manual');
  });
});

describe('文字叠加与真人形象是层, 不是交付模式', () => {
  it('**没有 talking-head-overlay 这种交付模式** —— 它是层级错误, 已撤', () => {
    const modes = PRESET_TEMPLATES.map((t) => t.deliveryMode);
    expect(modes).not.toContain('talking-head-overlay');
  });

  it('参考片风格 = 口播模式 + 关掉 B-roll + 开文字叠加', () => {
    const p = PRESET_TEMPLATES.find((t) => t.name.includes('文字叠加'))!;
    expect(p.deliveryMode).toBe('talking-head-broll');
    expect(p.brollEnabled).toBe(false);
    expect(p.textOverlayEnabled).toBe(true);
  });

  it('每个预设都带这三个正交字段 —— 任何模式都能开文字叠加', () => {
    for (const p of PRESET_TEMPLATES) {
      expect(typeof p.textOverlayEnabled).toBe('boolean');
      expect(typeof p.brollEnabled).toBe('boolean');
      expect(['left', 'center', 'right']).toContain(p.personSide);
    }
  });
});
