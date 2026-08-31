/**
 * 版面约束层(二十五期)——卡片不接受任意坐标, 只能落在具名区域里。
 *
 * 为什么必须有: 验货时**人手填坐标**都撞出了元素重叠(「需求是真的」压在数字上),
 * 让模型填只会更糟。字幕安全区沿用 caption-safe-zone.ts 的既有结论:
 * 按画幅把底部留白抬到 height × 350/1920 以上, 只抬不降。
 */
export const SAFE = {
  topPct: 0.08,
  bottomPct: 350 / 1920, // 与 caption-safe-zone.ts 同一个依据
  leftPct: 0.08,
  rightPct: 0.08,
} as const;

export const safeBox = (width: number, height: number) => ({
  left: Math.round(width * SAFE.leftPct),
  right: Math.round(width * SAFE.rightPct),
  top: Math.round(height * SAFE.topPct),
  bottom: Math.round(height * SAFE.bottomPct),
  innerWidth: Math.round(width * (1 - SAFE.leftPct - SAFE.rightPct)),
  innerHeight: Math.round(height * (1 - SAFE.topPct - SAFE.bottomPct)),
});

/** 字号按短边取, 一套代码同时服务横竖屏。 */
export const scaleFont = (width: number, height: number, base: number) =>
  Math.round((Math.min(width, height) / 1080) * base);
