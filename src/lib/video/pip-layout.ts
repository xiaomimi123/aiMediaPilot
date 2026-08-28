/**
 * 口播画中画的版面(二十三期)。
 *
 * 在这之前, 真人出镜模式只有一种合成方式: **顺序挖空** —— B-roll 那几段把你的人像
 * 整个替换掉, 期间观众只听得到声音、看不到人。画中画是另一种: B-roll 铺满画面,
 * 你的人像缩成一个小窗放在角落, 人一直在。
 *
 * 两种都留着, 因为它们服务不同的内容: 需要观众盯住画面上的信息时挖空更干净;
 * 讲经历、要人味的时候, 人不该消失。
 */

export const PIP_POSITIONS = ['tl', 'tr', 'bl', 'br'] as const;
export type PipPosition = (typeof PIP_POSITIONS)[number];

export const PIP_POSITION_LABELS: Record<PipPosition, string> = {
  tl: '左上',
  tr: '右上',
  bl: '左下',
  br: '右下',
};

export interface PipLayout {
  position: PipPosition;
  /** 小窗宽度占画面宽度的比例。 */
  scale: number;
  /** 离边缘的像素距离。 */
  margin: number;
}

/** 比例上下限。太小看不清脸, 太大就不是画中画了。 */
export const PIP_SCALE_MIN = 0.12;
export const PIP_SCALE_MAX = 0.45;

export interface PipRect {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * 算出小窗在画面上的像素位置。
 *
 * **等比缩放**: 只按宽度算比例, 高度跟着源视频宽高比走 —— 按宽高各自缩放会把人脸
 * 压扁, 而那是这个功能里最不能接受的失真。
 *
 * 比例先夹到 [0.12, 0.45]: 界面上滑块已经限住了, 但这个函数也被 ffmpeg 参数构造
 * 直接调用, 一个越界的值会生成一条画面全被小窗盖住的滤镜。
 */
export function computePipRect(
  frame: { width: number; height: number },
  source: { width: number; height: number },
  layout: PipLayout,
): PipRect {
  const scale = Math.min(PIP_SCALE_MAX, Math.max(PIP_SCALE_MIN, layout.scale));
  const width = Math.round(frame.width * scale);
  const ratio = source.height / (source.width || 1);
  const height = Math.round(width * ratio);
  const m = Math.max(0, Math.round(layout.margin));

  const left = layout.position === 'tl' || layout.position === 'bl';
  const top = layout.position === 'tl' || layout.position === 'tr';

  return {
    width,
    height,
    x: left ? m : Math.max(0, frame.width - width - m),
    y: top ? m : Math.max(0, frame.height - height - m),
  };
}
