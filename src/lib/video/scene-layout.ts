/**
 * 逐场景版面(二十三期)。
 *
 * 前一版把「口播放哪」做成了模板级的四角小窗 —— 那是错的。真实的口播视频里,
 * 版面是**逐个场景在变**的: 讲道理时人物全屏, 摆证据时内容占大半、人退到一侧,
 * 演示时录屏铺满、人缩成一个圆窗。一个全局设置表达不了这件事。
 *
 * 所以版面挂在**场景**上, 由时间线上的选中项来切。
 *
 * 这个模块是**预览和 ffmpeg 的唯一真相**: 编辑台里画的框和滤镜里叠的窗都从
 * `computeSceneRects` 来。两边各算一套的话, 编辑台就又变成一个骗人的界面 ——
 * 你在上面调好了, 出片却是另一个样子。
 */

export const SCENE_LAYOUTS = [
  'person-full',
  'content-full',
  'content-left',
  'content-right',
  'person-circle',
] as const;

export type SceneLayout = (typeof SCENE_LAYOUTS)[number];

export const SCENE_LAYOUT_LABELS: Record<SceneLayout, string> = {
  'person-full': '人物全屏',
  'content-full': '内容全屏',
  'content-left': '左内容·右人物',
  'content-right': '左人物·右内容',
  'person-circle': '内容铺满·圆形人物',
};

/** 一句话说明这个版面什么时候用。写在界面上, 免得五个名字看着都差不多。 */
export const SCENE_LAYOUT_HINTS: Record<SceneLayout, string> = {
  'person-full': '只有你。讲观点、讲经历的时候用——观众要看着你的脸。',
  'content-full': '只有画面。摆数据、摆步骤的时候用，人退场，声音继续。',
  'content-left': '内容在左、你在右。一边讲一边指着东西说。',
  'content-right': '你在左、内容在右。同上，换个方向。',
  'person-circle': '内容铺满，你缩成一个圆窗。演示录屏时用得最多。',
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneRects {
  /** 口播画面的位置。null = 这一幕不出现人。 */
  person: Rect | null;
  /** B-roll/内容画面的位置。null = 这一幕不出现内容。 */
  content: Rect | null;
  /** 人物是否裁成圆形。ffmpeg 侧用 geq 蒙版实现。 */
  personCircle: boolean;
}

/** 左右分屏时内容占的宽度比例, 以及两块之间的留白。 */
const SPLIT_CONTENT_RATIO = 0.58;
const SPLIT_GAP_RATIO = 0.02;
/** 圆窗直径占画面宽度的比例。 */
const CIRCLE_RATIO = 0.26;
const CIRCLE_MARGIN_RATIO = 0.04;

/**
 * 算出这个版面下人物与内容各自占画面的哪一块。
 *
 * 分屏时**两块都按各自区域等比裁切**(cover), 不是拉伸 —— 把人脸压扁是这里最不能
 * 接受的失真。具体裁切交给 ffmpeg 的 `scale=...:force_original_aspect_ratio=increase`
 * + `crop`, 这里只负责给出目标矩形。
 */
export function computeSceneRects(
  frame: { width: number; height: number },
  layout: SceneLayout,
): SceneRects {
  const W = frame.width;
  const H = frame.height;

  switch (layout) {
    case 'person-full':
      return { person: { x: 0, y: 0, width: W, height: H }, content: null, personCircle: false };

    case 'content-full':
      return { person: null, content: { x: 0, y: 0, width: W, height: H }, personCircle: false };

    case 'content-left':
    case 'content-right': {
      const gap = Math.round(W * SPLIT_GAP_RATIO);
      const contentW = Math.round((W - gap) * SPLIT_CONTENT_RATIO);
      const personW = W - gap - contentW;
      const contentLeft = layout === 'content-left';
      return {
        content: {
          x: contentLeft ? 0 : personW + gap,
          y: 0,
          width: contentW,
          height: H,
        },
        person: {
          x: contentLeft ? contentW + gap : 0,
          y: 0,
          width: personW,
          height: H,
        },
        personCircle: false,
      };
    }

    case 'person-circle': {
      const d = Math.round(W * CIRCLE_RATIO);
      const m = Math.round(W * CIRCLE_MARGIN_RATIO);
      return {
        content: { x: 0, y: 0, width: W, height: H },
        // 圆窗放右下: 竖屏里右下最不容易压到画面中心的内容
        person: { x: W - d - m, y: H - d - m, width: d, height: d },
        personCircle: true,
      };
    }
  }
}

/** 这个版面需要 B-roll 吗 —— 不需要的场景可以省掉一次 Builder 调用。 */
export function needsContent(layout: SceneLayout): boolean {
  return layout !== 'person-full';
}

/** 这个版面出不出现人 —— 决定挖空还是叠加。 */
export function needsPerson(layout: SceneLayout): boolean {
  return layout !== 'content-full';
}
