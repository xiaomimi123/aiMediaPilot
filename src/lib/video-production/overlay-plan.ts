import { z } from 'zod';

/**
 * 口播文字叠加层契约(三十七期)——真人口播链回归「关键词大字/注解/箭头」叠加层。
 *
 * 考古参照: `.superpowers/sdd/2026-09-08-text-overlay-remotion/archaeology-overlay-plan.ts`
 * (二十三期旧渲染引擎, 像素 + ASS 锚点)。常量(`OVERLAY_SLOTS`/`OVERLAY_KINDS`)原样搬;
 * `slotPosition` + `textSafeZone` 的**思想**(人在右→安全区在左半、五格自上而下、
 * 竖屏格子在上)移植到这里的 0~1 归一化坐标 —— 这里不产出像素, 渲染层/编辑层
 * 各自按自己的画面尺寸乘上去。
 *
 * **红线(同 shot.style 三重保证哲学)**: `OverlayExtractionSchema` 是 LLM 响应契约,
 * 绝不含 x/y —— 模型给不准坐标, 而且一旦模型碰坐标, 拖拽编辑的"用户改过的位置"
 * 就再也分不清是模型编的还是用户拖的。`OverlayPlanSchema` 是存储/PATCH 契约,
 * 在同一份 base 字段上叠加可选的 x/y(0~1), 表示"用户在编辑台拖拽后覆盖的位置"。
 */

/** 位置槽位。语义槽位而不是像素——模型给不准像素, 槽位能保证不压到人脸。 */
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
  /** 用户在编辑台拖拽后的覆盖位置(0~1 归一化)。不存在则回退到 slot 的默认格位。 */
  x?: number;
  y?: number;
}

/**
 * 两版共享的 base 字段——别抄两份, 抄两份的下场是改一处忘一处。
 *
 * text 上限 14 字: 考古版的关键词/注解都是"一句话大字", 14 字是给横屏 5 行格子
 * 里单行不换行、竖屏格子里也不挤成两行的经验上限(超过就该拆成两条)。
 */
const overlayBaseFields = {
  kind: z.enum(OVERLAY_KINDS),
  text: z.string().min(1).max(14),
  slot: z.enum(OVERLAY_SLOTS),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
};

/** LLM 响应契约: 只有语义槽位, 不含坐标 —— 模型不碰坐标的红线在这里。 */
export const OverlayExtractionSchema = z.object({
  items: z.array(z.object(overlayBaseFields).strict()),
});

/** 存储/PATCH 契约: 同一套 base 字段 + 可选 x/y(0~1) —— 拖拽编辑写回的位置覆盖。 */
export const OverlayPlanSchema = z.object({
  items: z.array(
    z.object({
      ...overlayBaseFields,
      x: z.number().min(0).max(1).optional(),
      y: z.number().min(0).max(1).optional(),
    }).strict(),
  ),
});

export type OverlayAspect = '16:9' | '9:16';
export type OverlayPersonSide = 'left' | 'center' | 'right';

export interface OverlayRect {
  x: number;
  y: number;
  anchor: 'top' | 'bottom';
}

/**
 * 槽位 → 归一化坐标 + 锚点。
 *
 * 移植自考古版 `slotPosition` + `textSafeZone` 的思想, 换算成 0~1:
 * - 横屏(16:9): 安全区是画面左右半边之一, 由人物所在侧决定 —— 人在右, 安全区
 *   (以及格子)在左半边, 反之亦然; 人在中间时退回考古版"上方一条带"的思路,
 *   这里简化为居中偏上的窄带。
 *   格带取 x∈[0.06,0.42](考古版 `textSafeZone` 半区宽 0.48 画幅 + `slotsInZone`
 *   的 8% 内边距, 这里合并成一个直接量出的归一化区间), 镜像时整体翻到右半边
 *   (1 - 0.42, 1 - 0.06)。
 *   五行 y 从 0.18 到 0.72 均匀分布(考古版 `slotsInZone`: 顶部留 12%、可用高度
 *   82%, 这里取头尾两行的归一化位置, 中间三行等距)。
 * - 竖屏(9:16): 人脸占中下(参考 `text-zone.ts` 的 `PORTRAIT_FACE_TOP = 0.34`,
 *   这里格带留得更宽一点给五行文字), 格带 y∈[0.08,0.42], x 固定贴左对齐一条,
 *   与横屏保持同一套 x∈[0.06,0.42] 的左侧字带写法一致。
 * - top-center: y=0.12(考古版 `frame.height * 0.12` 直接可用, 已是归一化写法)。
 * - bottom-center: y=0.78, **不是**考古版的 0.88 —— 那个数字是旧问题的来源
 *   (底部格和字幕安全区打架, 见任务书), 这里抬高到字幕安全区上方, 测试断言
 *   y < 0.82, 0.78 留了余量。
 */
export function overlaySlotRect(
  aspect: OverlayAspect,
  personSide: OverlayPersonSide,
  slot: OverlaySlot,
): OverlayRect {
  if (slot === 'top-center') {
    return { x: 0.5, y: 0.12, anchor: 'top' };
  }
  if (slot === 'bottom-center') {
    return { x: 0.5, y: 0.78, anchor: 'bottom' };
  }

  const row = Number(slot.split('-')[1]); // 1~5
  const rowsY = [0.18, 0.27, 0.405, 0.54, 0.72]; // 五格自上而下(见上方注释)
  const y = rowsY[Math.min(row - 1, rowsY.length - 1)];

  if (aspect === '9:16') {
    // 竖屏: 格带整体挪到上方(人脸占中下), x 与横屏左侧字带写法一致
    const portraitRowsY = [0.08, 0.145, 0.245, 0.335, 0.42];
    return { x: 0.06, y: portraitRowsY[Math.min(row - 1, portraitRowsY.length - 1)], anchor: 'top' };
  }

  // 横屏: 人在右 → 格子在左半边(x∈[0.06,0.42]); 人在左 → 镜像到右半边;
  // 人在中间 → 退回左半边兜底(考古版对"人在中"也是回落上方带, 这里简化统一
  // 为左半边, 因为 overlaySlotRect 不像考古版拿到完整 layout, 无法判断分屏方向)。
  if (personSide === 'left') {
    return { x: 1 - 0.06, y, anchor: 'top' };
  }
  return { x: 0.06, y, anchor: 'top' };
}

/**
 * 定位纯函数——渲染层与拖拽编辑层的唯一几何真源。
 *
 * item.x/y 存在(用户拖拽覆盖过) → 直接用, 不再查槽位表; 否则回退到
 * `overlaySlotRect` 的默认格位。锚点固定为 'top': 用户拖拽给的是左上角原点,
 * 不像槽位表还带着 bottom-center 那种底部对齐的语义。
 */
export function overlayPosition(
  aspect: OverlayAspect,
  personSide: OverlayPersonSide,
  // slot 放宽收 string: 调用方(测试里的 item() 工厂函数)常把 slot 字面量组装
  // 在一个未标注类型的对象里, TS 会把它推宽成 string —— 真正的枚举校验交给
  // OverlayExtractionSchema/OverlayPlanSchema, 这里信任上游已经校验过。
  item: { slot: string; x?: number; y?: number },
): OverlayRect {
  if (item.x !== undefined && item.y !== undefined) {
    return { x: item.x, y: item.y, anchor: 'top' };
  }
  return overlaySlotRect(aspect, personSide, item.slot as OverlaySlot);
}
