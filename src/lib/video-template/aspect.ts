/**
 * 成片画幅(二十三期)。
 *
 * **为什么要有这个设置。** 在这之前整条出片链把画布写死成 1920x1080。真人出镜那条
 * 因此废掉过一整支片子: 用户拍的是 1080x1920 竖屏, B-roll 全出成横屏, 合成时缩进
 * 竖屏画面只剩 32% 的高度, 其余全是黑边。
 *
 * 那一条已经修了(按出镜素材反推画幅)。但图文口播和插画配音**没有素材可反推** ——
 * 它们纯由 AI 生成画面, 画幅只能是设置。而主阵地是抖音, 抖音是竖屏, 让这两条链
 * 只能出横屏等于让它们的产物没法直接发。
 *
 * 只给 9:16 和 16:9 两个值, 不做任意比例: 这两个覆盖了抖音和长视频, 而每多一个
 * 比例, Builder 的排版指令就要多一套说法 —— 说不清楚的比例只会让画面更糟。
 */

export const ASPECTS = ['9:16', '16:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_LABELS: Record<Aspect, string> = {
  '9:16': '竖屏（抖音）',
  '16:9': '横屏（长视频）',
};

export interface Frame {
  width: number;
  height: number;
}

const FRAMES: Record<Aspect, Frame> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};

/**
 * 画幅 → 像素。
 *
 * **认不出来一律退回横屏**, 不抛错: 这个值来自数据库, 老模板压根没有这个字段。
 * 退回横屏等于「和改动前一模一样」, 零迁移。
 */
export function frameOfAspect(aspect: string | null | undefined): Frame {
  return FRAMES[aspect as Aspect] ?? FRAMES['16:9'];
}

/**
 * 像素 → 画幅。
 *
 * 真人出镜那条链不读模板设置, 而是按出镜素材反推 —— 素材是竖的, 成片就必须是竖的,
 * 这件事没有第二种可能, 设置错了也不该覆盖它。
 */
export function aspectOfFrame(frame: Frame): Aspect {
  return frame.height > frame.width ? '9:16' : '16:9';
}
