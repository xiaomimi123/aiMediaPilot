/**
 * 版面约束层(二十五期)——卡片不接受任意坐标, 只能落在具名区域里。
 *
 * 为什么必须有: 验货时**人手填坐标**都撞出了元素重叠(「需求是真的」压在数字上),
 * 让模型填只会更糟。
 *
 * 终审已裁决的行为漂移(不是 bug, 保留): legacy 的 `caption-safe-zone.ts` 按画幅
 * 分流——横屏只留固定 100px(播放器控件是悬浮的, 不常驻), 竖屏才用
 * `height × 350/1920` 顶开抖音底部 UI。这里图简单, 两种画幅一律用同一个
 * `bottomPct = 350/1920`, 在 1080p 横屏上算出来约 197px, 比 legacy 的 100px
 * 保守了近一倍, 横屏卡片可用高度因此少了约 97px。
 *
 * 有意保留、不改回 legacy 分流: 横屏本来就没有平台 UI 遮挡问题, 从严只是让
 * 版面更保守, 不会撞出裁切或遮挡, 是「代价可承受的安全一侧」。要收紧到与
 * legacy 一致需要单独验证横屏卡片在 100px 边距下不会顶到平台 UI, 这是下一份
 * 计划的量, 本轮不做。
 */
export const SAFE = {
  topPct: 0.08,
  bottomPct: 350 / 1920, // 两种画幅一律用竖屏那条红线, 见上方说明——横屏因此比 legacy 更保守
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
