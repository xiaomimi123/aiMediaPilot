import type { DeliveryMode } from '@/lib/cockpit/model';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import { CaptionStyleSchema, type CaptionStyle } from '@/lib/video-template/model';
import {
  captionEventsFromTranscript,
  captionEventsFromAlignedActs,
  type CaptionEvent,
} from '@/lib/video-production/ass-captions';
import type { PackagingOptions } from '@/lib/video-production/packaging';

export type VideoTemplateRecord = {
  captionStyle: unknown;
  bgmPath: string | null;
  bgmVolume: number;
  introPath: string | null;
  outroPath: string | null;
};

/** DB 里的 captionStyle 是 Json 列, 形状不可信 —— 校验失败就降级为不烧字幕, 不让整条任务崩。 */
function parseCaptionStyle(raw: unknown): CaptionStyle | null {
  if (!raw) return null;
  const parsed = CaptionStyleSchema.safeParse(raw);
  return parsed.success ? (parsed.data as CaptionStyle) : null;
}

/**
 * 把模板配置 + 本次任务的真实时间轴数据合成包装段入参。
 * 字幕事件源按交付模式取: 真人出镜优先 ASR 原话(用户实际念的可能与稿子有出入),
 * 其次是对齐后的幕边界 + 稿子台词(插画 TTS), 都没有则用分镜时长铺排(图文口播)。
 */
export function buildPackagingOptions(input: {
  template: VideoTemplateRecord | null;
  mode: DeliveryMode;
  transcript: TranscriptSegment[] | null;
  alignedActs: AlignedAct[] | null;
  narrations: Record<string, string>;
  shotEvents: CaptionEvent[];
}): PackagingOptions {
  if (!input.template) {
    return {
      captionStyle: null,
      captionEvents: [],
      bgmPath: null,
      bgmVolume: 0.15,
      introPath: null,
      outroPath: null,
    };
  }

  const captionStyle = parseCaptionStyle(input.template.captionStyle);

  let captionEvents: CaptionEvent[] = [];
  if (captionStyle) {
    if (input.mode === 'talking-head-broll' && input.transcript?.length) {
      captionEvents = captionEventsFromTranscript(input.transcript);
    } else if (input.alignedActs?.length) {
      captionEvents = captionEventsFromAlignedActs(input.alignedActs, input.narrations);
    } else {
      captionEvents = input.shotEvents;
    }
  }

  return {
    captionStyle,
    captionEvents,
    bgmPath: input.template.bgmPath,
    bgmVolume: input.template.bgmVolume,
    introPath: input.template.introPath,
    outroPath: input.template.outroPath,
  };
}
