import { z } from 'zod';
import type { DeliveryMode } from '@/lib/cockpit/model';

/**
 * 字幕字体白名单 —— `.ass` 的字体名必须是渲染机器上真实装了的字体, libass 找不到
 * 会静默回退成默认字体(看起来"样式没生效")。收敛为 macOS 自带中文字体, 不做字体上传
 * (见 spec §7 范围外)。
 */
export const CAPTION_FONT_WHITELIST = [
  'PingFang SC',
  'Hiragino Sans GB',
  'STHeiti',
  'Songti SC',
] as const;

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  primaryColor: string;  // #RRGGBB
  outlineColor: string;  // #RRGGBB
  outlineWidth: number;
  marginV: number;       // 距画面底部的边距(像素)
}

export interface VideoTemplateConfig {
  name: string;
  description: string;
  deliveryMode: DeliveryMode;
  visualStyle: 'card' | 'illustration';
  palette: string[] | null;
  voicePreset: { voiceType?: string; resourceId?: string } | null;
  scriptPrompt: {
    tone?: string;
    targetDurationSec?: 30 | 45 | 60 | 90;
    hookHint?: string;
    extraGuidance?: string;
  } | null;
  captionStyle: CaptionStyle | null;  // null = 不烧字幕
  bgmPath: string | null;
  bgmVolume: number;                  // 0~1
  introPath: string | null;
  outroPath: string | null;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const CaptionStyleSchema = z.object({
  fontFamily: z.enum(CAPTION_FONT_WHITELIST),
  fontSize: z.number().int().min(12).max(200),
  primaryColor: z.string().regex(HEX_COLOR),
  outlineColor: z.string().regex(HEX_COLOR),
  outlineWidth: z.number().min(0).max(10),
  marginV: z.number().int().min(0).max(500),
});

export const VideoTemplateConfigSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200),
  // 'manual' 不是模板的合法值 —— 模板一定驱动某条 AI 生成管线
  deliveryMode: z.enum(['ppt-narration', 'talking-head-broll', 'illustration-tts']),
  visualStyle: z.enum(['card', 'illustration']),
  palette: z.array(z.string().regex(HEX_COLOR)).nullable(),
  voicePreset: z.object({ voiceType: z.string().optional(), resourceId: z.string().optional() }).nullable(),
  scriptPrompt: z
    .object({
      tone: z.string().max(100).optional(),
      targetDurationSec: z.union([z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).optional(),
      hookHint: z.string().max(200).optional(),
      extraGuidance: z.string().max(500).optional(),
    })
    .nullable(),
  captionStyle: CaptionStyleSchema.nullable(),
  bgmPath: z.string().nullable(),
  bgmVolume: z.number().min(0).max(1),
  introPath: z.string().nullable(),
  outroPath: z.string().nullable(),
}) as unknown as z.ZodType<VideoTemplateConfig>;

export function defaultCaptionStyle(): CaptionStyle {
  return {
    fontFamily: 'PingFang SC',
    fontSize: 56,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    marginV: 90,
  };
}

/**
 * 内置 3 个预设 —— 按三种交付模式各一个(用户 2026-08-23 拍板)。首次进入模板页且
 * 该用户 0 条模板时播种; 播种后与普通模板完全一样, 可改可复制可删。
 * 素材(BGM/片头/片尾)一律为 null: 用户自己上传(spec §2.3)。
 */
export const PRESET_TEMPLATES: readonly VideoTemplateConfig[] = [
  {
    name: '图文口播',
    description: 'AI 分镜卡片串成完整片子, 无需出镜也无需配音',
    deliveryMode: 'ppt-narration',
    visualStyle: 'card',
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
  },
  {
    name: '真人出镜 + B-roll',
    description: '上传自己拍的口播视频, AI 生成 B-roll 挖空替换, 烧录真实原话字幕',
    deliveryMode: 'talking-head-broll',
    visualStyle: 'card',
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.12,
    introPath: null,
    outroPath: null,
  },
  {
    name: '插画配音',
    description: '火山 TTS 逐幕配音驱动插画风分镜, 全自动出片',
    deliveryMode: 'illustration-tts',
    visualStyle: 'illustration',
    palette: null,
    voicePreset: { voiceType: 'zh_female_vv_uranus_bigtts', resourceId: 'seed-tts-2.0' },
    scriptPrompt: { targetDurationSec: 90 },
    captionStyle: defaultCaptionStyle(),
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
  },
];
