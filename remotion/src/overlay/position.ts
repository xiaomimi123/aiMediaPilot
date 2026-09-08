/**
 * 叠加层定位纯函数(三十七期 Task 3)——本体从主项目 `src/lib/video-production/
 * overlay-plan.ts` 搬到这里(remotion 侧)。
 *
 * 为什么搬家、不是原地留着让渲染层 import 主项目: `remotion/` 是独立子项目
 * (自己的 `tsconfig.json`, `typecheck:remotion` 单独跑), **不能反过来 import
 * 主项目文件**——`mergeShotStyle` 的先例是反过来的方向(主项目 import
 * remotion 侧的实现, 见 `remotion/src/cards/style.ts` 与
 * `tests/lib/video-production/merge-shot-style.test.ts`), 这里延续同一条
 * 「几何/合并这类渲染层与编辑层都要用的纯函数, 本体放 remotion 侧」的规矩。
 *
 * 主项目的 `overlay-plan.ts` 现在只 `export { overlaySlotRect, overlayPosition }
 * from '../../../remotion/src/overlay/position'` 转发——两侧(渲染层、剪辑台
 * 拖拽层、既有单测)同源, 不会出现"两份实现悄悄长歪"的问题。
 *
 * 移植/裁决说明见搬家前的版本(git blame `overlay-plan.ts` 的这段实现,
 * commit 5b46d15)——数值、取舍一个字没改, 只是换了文件位置。
 */

export const OVERLAY_SLOTS = [
  'left-1', 'left-2', 'left-3', 'left-4', 'left-5',
  'top-center', 'bottom-center',
] as const;
export type OverlaySlot = (typeof OVERLAY_SLOTS)[number];

export type OverlayAspect = '16:9' | '9:16';
export type OverlayPersonSide = 'left' | 'center' | 'right';

export interface OverlayRect {
  x: number;
  y: number;
  anchor: 'top' | 'bottom';
}

/**
 * 槽位 → 归一化坐标 + 锚点。数值与取舍见 T1 落地时的注释(原文保留在
 * `overlay-plan.ts` 的 git 历史里, commit 5b46d15)。
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
  const rowsY = [0.18, 0.27, 0.405, 0.54, 0.72]; // 五格自上而下
  const y = rowsY[Math.min(row - 1, rowsY.length - 1)];

  if (aspect === '9:16') {
    // 竖屏: 格带整体挪到上方(人脸占中下), x 与横屏左侧字带写法一致
    const portraitRowsY = [0.08, 0.145, 0.245, 0.335, 0.42];
    return { x: 0.06, y: portraitRowsY[Math.min(row - 1, portraitRowsY.length - 1)], anchor: 'top' };
  }

  // 横屏: 人在右 → 格子在左半边(x∈[0.06,0.42]); 人在左 → 镜像到右半边;
  // 人在中间 → 退回左半边兜底。
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
  // slot 放宽收 string: 调用方常把 slot 字面量组装在一个未标注类型的对象里,
  // TS 会把它推宽成 string —— 真正的枚举校验交给两侧的 zod schema, 这里信任
  // 上游已经校验过。
  item: { slot: string; x?: number; y?: number },
): OverlayRect {
  if (item.x !== undefined && item.y !== undefined) {
    return { x: item.x, y: item.y, anchor: 'top' };
  }
  return overlaySlotRect(aspect, personSide, item.slot as OverlaySlot);
}
