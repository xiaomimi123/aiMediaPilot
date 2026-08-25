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

/** 模板的交付模式 —— 不含 'manual': 模板一定驱动某条 AI 生成管线。 */
export type TemplateDeliveryMode = Exclude<DeliveryMode, 'manual'>;

export interface VideoTemplateConfig {
  name: string;
  description: string;
  deliveryMode: TemplateDeliveryMode;
  visualStyle: 'card' | 'illustration';
  palette: string[] | null;
  voicePreset: { voiceType?: string; resourceId?: string } | null;
  scriptPrompt: {
    tone?: string;
    // 120/180/240 是二十一期按同行参考视频(110~240 秒)补的档位, 原有四档保留不动
    targetDurationSec?: 30 | 45 | 60 | 90 | 120 | 180 | 240;
    hookHint?: string;
    extraGuidance?: string;
  } | null;
  /**
   * 画面明暗基调(二十一期)。参考视频实测是米白亮底 + 深色字(帧均值亮度 215),
   * 我们原来固定深蓝底 + 白字。默认 'dark' 保持老模板行为不变。
   */
  visualTone: 'light' | 'dark';
  /**
   * 目标切镜节奏(秒)。参考视频 2.8~6 秒就有一次画面变化, 我们原来 Director 上限
   * 放到 40 秒、实际每镜 10 秒。null = 不约束(老行为)。
   */
  shotPaceSec: number | null;
  /**
   * 是否画常驻章节进度条。参考视频顶部有一条六章导航并高亮当前章, 观众随时知道
   * 讲到哪、还剩多少 —— 我们的六幕结构天然适合做这个。
   */
  showChapterNav: boolean;
  /**
   * 写稿前是否先跑素材研究(Tavily 搜索 → 带来源的事实点)。
   * 关掉时模板写稿直接凭主题空写 —— 那正是画面没有实感的源头: 手上没有可铺的真料,
   * Builder 只能画抽象图形。开着会多花一次 Tavily 额度与几十秒。
   */
  researchEnabled: boolean;
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

export const VideoTemplateConfigSchema: z.ZodType<VideoTemplateConfig> = z.object({
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
      targetDurationSec: z
        .union([
          z.literal(30), z.literal(45), z.literal(60), z.literal(90),
          z.literal(120), z.literal(180), z.literal(240),
        ])
        .optional(),
      hookHint: z.string().max(200).optional(),
      extraGuidance: z.string().max(500).optional(),
    })
    .nullable(),
  captionStyle: CaptionStyleSchema.nullable(),
  bgmPath: z.string().nullable(),
  bgmVolume: z.number().min(0).max(1),
  introPath: z.string().nullable(),
  outroPath: z.string().nullable(),
  visualTone: z.enum(['light', 'dark']),
  // 下限 1 秒: 比这更短就不是"切镜"而是闪频了, 属于明显的误配
  shotPaceSec: z.number().min(1).max(60).nullable(),
  showChapterNav: z.boolean(),
  researchEnabled: z.boolean(),
});

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
    visualTone: 'dark',
    shotPaceSec: null,
    showChapterNav: false,
    researchEnabled: false,
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
    visualTone: 'dark',
    shotPaceSec: null,
    showChapterNav: false,
    researchEnabled: false,
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
    visualTone: 'dark',
    shotPaceSec: null,
    showChapterNav: false,
    researchEnabled: false,
  },
  {
    // 二十一期: 按同行参考视频拆解结论复刻
    // (docs/superpowers/specs/2026-08-25-reference-video-teardown.md)。
    // 每个取值都来自实测, 不是拍脑袋:
    //   亮底 —— 参考帧均值亮度 215(米白), 我们原来是深蓝 #0F172A
    //   4 秒 —— 参考三条分别是 2.8 / 6.1 / 13.8 秒每镜, 取密集档的量级
    //   180 秒 —— 参考三条是 110 / 196 / 240 秒, 全部远长于我们原来的 90 秒
    //   章节条 —— 参考在顶部常驻六章导航并高亮当前章
    //   字幕 72px 深色 —— 亮底不需要白字描边, 参考的字幕明显大于我们的 56px
    name: '知识长视频(横屏)',
    description: '对标同行知识区横屏长视频: 亮底、快切镜、常驻章节进度条、大号深色字幕',
    deliveryMode: 'ppt-narration',
    visualStyle: 'card',
    palette: null,
    voicePreset: null,
    scriptPrompt: { targetDurationSec: 180 },
    captionStyle: {
      fontFamily: 'PingFang SC',
      fontSize: 72,
      primaryColor: '#1A1A1A',
      outlineColor: '#FFFFFF',
      outlineWidth: 2,
      marginV: 70,
    },
    bgmPath: null,
    bgmVolume: 0.15,
    introPath: null,
    outroPath: null,
    visualTone: 'light',
    shotPaceSec: 4,
    showChapterNav: true,
    // 这个预设的立身之本就是"有实感", 素材研究必须开 —— 没有真料铺不出密度
    researchEnabled: true,
  },
];
