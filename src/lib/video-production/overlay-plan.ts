import { hexToAssColor, formatAssTimestamp } from './ass-captions';
import { textSafeZone, slotsInZone, type PersonSide } from '@/lib/video/text-zone';
import type { SceneLayout } from '@/lib/video/scene-layout';

/**
 * 口播文字叠加(二十三期)。
 *
 * 参考片拆解见 `docs/superpowers/specs/2026-08-29-talking-head-overlay-style.md`。
 * 一句话: **全片零切镜, 所有视觉都是叠在真人画面上的文字**。
 *
 * 这条路不需要 B-roll、不需要 Builder、不需要无头浏览器 —— ASS 原生就支持这里
 * 要的全部能力(绝对定位、对齐锚点、字号、颜色、淡入淡出、逐条起止时间), 所以
 * 整层叠加编译成一个 `.ass`, 和字幕一次烧完。147 秒的片子几秒钟出, 而不是
 * 走渲染管线的三分多钟。
 */

/** 位置槽位。用语义槽位而不是让模型给像素 —— 模型给不准, 而槽位能保证不压到人脸。 */
export const OVERLAY_SLOTS = [
  'left-1', 'left-2', 'left-3', 'left-4', 'left-5',
  'top-center', 'bottom-center',
] as const;
export type OverlaySlot = (typeof OVERLAY_SLOTS)[number];

export const OVERLAY_KINDS = ['keyword', 'note', 'arrow'] as const;
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export interface OverlayItem {
  kind: OverlayKind;
  text: string;
  slot: OverlaySlot;
  startMs: number;
  endMs: number;
}

export interface OverlayStyle {
  /** 关键词颜色。参考片实测 #1478E8。 */
  keywordColor: string;
  noteColor: string;
  /** 关键词字号占画面高的比例。参考片实测 9.7%。 */
  keywordRatio: number;
  noteRatio: number;
  fontFamily: string;
}

export const REFERENCE_OVERLAY_STYLE: OverlayStyle = {
  keywordColor: '#1478E8',
  noteColor: '#FFFFFF',
  keywordRatio: 0.097,
  noteRatio: 0.055,
  fontFamily: 'PingFang SC',
};

/**
 * 槽位 → 画面坐标 + ASS 对齐锚点。
 *
 * **第一版把左半边写死成安全区**, 理由是参考片的人站在右边 —— 那是把一条片子的
 * 拍摄习惯当成了系统前提。现在安全区由 `textSafeZone` 从画幅 + 版面 + 人在哪侧
 * 算出来: 横屏人在右 → 左半边; 横屏人在左 → 右半边; 竖屏 → 上方一条带
 * (人脸占中间, 左右都贴脸)。
 *
 * 安全区放不下五行时槽位会自动减少 —— 这时排在后面的槽位回退到最后一个可用行,
 * 而不是溢出画面。
 */
export function slotPosition(
  slot: OverlaySlot,
  frame: { width: number; height: number },
  layout: SceneLayout = 'person-full',
  personSide: PersonSide = 'right',
): { x: number; y: number; an: number } {
  const zone = textSafeZone(frame, layout, personSide);

  if (slot.startsWith('left-')) {
    const row = Number(slot.split('-')[1]);
    const points = slotsInZone(zone, 5);
    // 行数不够时落到最后一行, 不溢出画面
    return points[Math.min(row - 1, points.length - 1)];
  }
  if (slot === 'top-center') {
    return { x: Math.round(frame.width / 2), y: Math.round(frame.height * 0.12), an: 8 };
  }
  return { x: Math.round(frame.width / 2), y: Math.round(frame.height * 0.88), an: 2 };
}

/** 箭头用字符顶替真矢量图形(见规格「没覆盖的」)。竖向连接用 ↓, 横向用 →。 */
function arrowText(text: string): string {
  return text.trim() || '↓';
}

/**
 * 把叠加计划编译成 ASS 事件。
 *
 * 每一条都用 `\pos` 绝对定位 + `\an` 锚点 + `\fs` 字号 + `\c` 颜色 + `\fad` 淡入,
 * 全部内联在 override 标签里, 不依赖样式表 —— 一条一个样式的话样式表会爆炸,
 * 而且改一个元素要去两个地方对。
 *
 * **时间零长或倒置的条目直接丢掉**: ASS 会把它们渲染成一闪而过或永不出现的鬼影,
 * 而那种问题在成片里极难定位。
 */
export function buildOverlayEvents(
  items: OverlayItem[],
  style: OverlayStyle,
  frame: { width: number; height: number },
  layout: SceneLayout = 'person-full',
  personSide: PersonSide = 'right',
): string[] {
  const out: string[] = [];

  for (const it of items) {
    // 箭头允许不给文字(默认 ↓) —— 空文字守卫必须放它过去, 否则「加个箭头」这个
    // 最常见的用法直接失效
    if (it.kind !== 'arrow' && !it.text.trim()) continue;
    if (it.endMs <= it.startMs) continue;

    const pos = slotPosition(it.slot, frame, layout, personSide);
    const isKeyword = it.kind === 'keyword';
    const size = Math.round(
      frame.height * (isKeyword ? style.keywordRatio : style.noteRatio),
    );
    const color = hexToAssColor(isKeyword ? style.keywordColor : style.noteColor);
    const text = it.kind === 'arrow' ? arrowText(it.text) : it.text.replace(/\r?\n/g, '\\N');

    const tags = [
      `\\an${pos.an}`,
      `\\pos(${pos.x},${pos.y})`,
      `\\fs${size}`,
      `\\c${color}`,
      // 描边保证亮底暗底都读得出来 —— 真人画面的背景是不可控的
      `\\3c&H000000&`,
      `\\bord${Math.max(2, Math.round(size * 0.05))}`,
      `\\b1`,
      // 淡入淡出各 200ms: 硬切在真人画面上会显得很跳
      `\\fad(200,200)`,
    ].join('');

    out.push(
      `Dialogue: 1,${formatAssTimestamp(it.startMs)},${formatAssTimestamp(it.endMs)},Overlay,,0,0,0,,{${tags}}${text}`,
    );
  }

  return out;
}

/**
 * 常驻声明(右上角三行)。
 *
 * **不进 LLM 计划**: 它每条片子都一样, 让模型每次重写只会引入不一致 —— 参考片里
 * 这三行 147 秒一个字没变过。
 */
export function buildDisclaimerEvent(
  lines: string[],
  durationMs: number,
  frame: { width: number; height: number },
): string | null {
  const text = lines.map((l) => l.trim()).filter(Boolean).join('\\N');
  if (!text || durationMs <= 0) return null;

  const size = Math.round(frame.height * 0.028);
  const x = Math.round(frame.width * 0.97);
  const y = Math.round(frame.height * 0.05);
  // 半透明灰: 参考片实测 #C8BFB5, 明显比正文淡 —— 它是声明不是内容
  const tags = `\\an9\\pos(${x},${y})\\fs${size}\\c${hexToAssColor('#C8BFB5')}\\alpha&H40&\\bord0`;
  return `Dialogue: 0,${formatAssTimestamp(0)},${formatAssTimestamp(durationMs)},Overlay,,0,0,0,,{${tags}}${text}`;
}

/**
 * 完整的叠加层 `.ass`。
 *
 * **必须写 PlayResX/PlayResY** —— 缺了它 libass 按 384×288 解释所有字号和 `\pos`
 * 坐标, 竖屏上等于放大 6.67 倍并且位置全错。字幕那边已经因为这个吃过一次亏。
 *
 * **`frame` 必须是探出来的真实尺寸, 不能是猜的。** 传错时 libass 会把整个叠加层
 * 从 PlayRes 拉伸到画面尺寸 —— 字号和位置一起歪, 而且歪得"看起来像是设计如此",
 * 不会报错。走查这段时我自己就按 1280×720 算了一段 1080×1920 的素材。
 * 调用方应当 `await probeVideoDimensions(videoPath)`。
 */
export function buildOverlayAss(
  items: OverlayItem[],
  style: OverlayStyle,
  frame: { width: number; height: number },
  opts?: {
    disclaimer?: string[];
    durationMs?: number;
    /** 这一段用的版面 —— 决定安全区在哪。 */
    layout?: SceneLayout;
    /** 拍摄时人在画面哪一侧。 */
    personSide?: PersonSide;
  },
): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${frame.width}
PlayResY: ${frame.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Overlay,${style.fontFamily},${Math.round(frame.height * style.noteRatio)},&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = buildOverlayEvents(
    items, style, frame, opts?.layout ?? 'person-full', opts?.personSide ?? 'right',
  );
  const disclaimer =
    opts?.disclaimer && opts.durationMs
      ? buildDisclaimerEvent(opts.disclaimer, opts.durationMs, frame)
      : null;

  return `${header}\n${[...(disclaimer ? [disclaimer] : []), ...events].join('\n')}\n`;
}
