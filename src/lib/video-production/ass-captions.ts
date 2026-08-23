import type { CaptionStyle } from '@/lib/video-template/model';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export interface CaptionEvent {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * `#RRGGBB` → ASS 的 `&HAABBGGRR`。ASS 颜色是 **BGR 逆序**且带 alpha 前缀
 * (00 = 完全不透明), 直接把 CSS 十六进制丢进去会红蓝对调。
 */
export function hexToAssColor(hex: string): string {
  const v = hex.replace('#', '').toUpperCase();
  const r = v.slice(0, 2);
  const g = v.slice(2, 4);
  const b = v.slice(4, 6);
  return `&H00${b}${g}${r}`;
}

/** 毫秒 → ASS 时间戳 `H:MM:SS.cc` (百分秒, 不是毫秒 —— 与 SRT 的 `HH:MM:SS,mmm` 不同)。 */
export function formatAssTimestamp(ms: number): string {
  const totalCs = Math.round(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * 生成 `.ass` 字幕文件内容。选 ASS 而非 SRT 是因为样式(字体/字号/颜色/描边/边距)
 * 要能按模板配置, SRT 本身不带样式信息 —— libass 是 ffmpeg subtitles filter 现成
 * 支持的能力, 不引新依赖(spec §3.2)。
 * Alignment=2 是底部居中。
 */
export function buildAssCaptions(events: CaptionEvent[], style: CaptionStyle): string {
  const header = `[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontFamily},${style.fontSize},${hexToAssColor(style.primaryColor)},&H000000FF,${hexToAssColor(style.outlineColor)},&H00000000,0,0,0,0,100,100,0,0,1,${style.outlineWidth},0,2,40,40,${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const dialogues = events.map((e) => {
    // ASS 的 Dialogue 是单行记录, 文本里的换行必须写成 \N 转义, 否则会把一条事件
    // 撕成两行、后半行不是合法记录直接被 libass 丢弃。
    const text = e.text.replace(/\r?\n/g, '\\N');
    return `Dialogue: 0,${formatAssTimestamp(e.startMs)},${formatAssTimestamp(e.endMs)},Default,,0,0,0,,${text}`;
  });

  return `${header}\n${dialogues.join('\n')}\n`;
}

/**
 * 真人出镜模式的字幕事件源 —— ASR 转写的真实原话(不是脚本台词, 用户实际念的可能
 * 与稿子有出入)。TranscriptSegment 的 startSec/endSec 单位是**秒**
 * (与 srt-synthesis.ts 的 buildCaptionSrtFromTranscript 同源, 见该文件 116 行用法)。
 */
export function captionEventsFromTranscript(segments: TranscriptSegment[]): CaptionEvent[] {
  return segments
    .map((s) => ({
      startMs: Math.round(s.startSec * 1000),
      endMs: Math.round(s.endSec * 1000),
      text: s.text.trim(),
    }))
    .filter((e) => e.text.length > 0);
}

/**
 * 插画 TTS / 图文口播模式的字幕事件源 —— 按对齐后的幕边界把该幕台词整段铺上去。
 * 缺 narration 的幕直接跳过(而不是产出 "undefined" 文本 —— 十九期
 * buildSrtFromAlignedActs 踩过这个坑)。
 */
export function captionEventsFromAlignedActs(
  aligned: AlignedAct[],
  narrations: Record<string, string>,
): CaptionEvent[] {
  return [...aligned]
    .sort((a, b) => a.startMs - b.startMs)
    .map((a) => ({ startMs: a.startMs, endMs: a.endMs, text: (narrations[a.act] ?? '').trim() }))
    .filter((e) => e.text.length > 0);
}

const SRT_TIMESTAMP = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/;
const SRT_TIMESTAMP_LINE = new RegExp(`^${SRT_TIMESTAMP.source}\\s*-->\\s*${SRT_TIMESTAMP.source}`);

function parseSrtTimestamp(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
}

/**
 * 图文口播模式的字幕兜底源(二十期)—— 该模式没有 ASR、也没有对齐后的幕边界(无配音,
 * 见 packaging-input.ts 里 buildPackagingOptions 的优先级说明), `vp.srt` 才是整条片子
 * 时间轴的真相来源(由 synthesizeSrtFromSixActScript 产出、驱动 Director 分镜), 逐句
 * 粒度天然比整幕铺排更适合当字幕。
 * SRT 来自 DB 列, 形状不可信 —— 畸形块直接跳过而不是抛错, 与其它 captionEventsFrom*
 * 系列函数的"缺数据就丢弃, 不产出垃圾字幕"策略一致。
 */
export function captionEventsFromSrt(srt: string): CaptionEvent[] {
  if (!srt.trim()) return [];

  return srt
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const lines = block.split(/\r?\n/).filter((l) => l.length > 0);
      // 标准 SRT 块: [序号, 时间戳, ...文本行]; 序号行本身不参与解析(不校验递增),
      // 时间戳行必须匹配, 否则整块视为畸形。
      const timestampLineIndex = lines.findIndex((l) => SRT_TIMESTAMP_LINE.test(l));
      if (timestampLineIndex === -1) return null;
      const match = lines[timestampLineIndex].match(SRT_TIMESTAMP_LINE);
      if (!match) return null;
      const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
      const text = lines.slice(timestampLineIndex + 1).join('\n').trim();
      if (!text) return null;
      return {
        startMs: parseSrtTimestamp(h1, m1, s1, ms1),
        endMs: parseSrtTimestamp(h2, m2, s2, ms2),
        text,
      };
    })
    .filter((e): e is CaptionEvent => e !== null);
}
