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

/**
 * 定位纯函数(`overlaySlotRect`/`overlayPosition`)与其类型(`OverlayAspect`/
 * `OverlayPersonSide`/`OverlayRect`)——**三十七期 Task 3 起本体搬到
 * `remotion/src/overlay/position.ts`**(remotion 侧), 这里只转发。
 *
 * 为什么反过来搬(`mergeShotStyle` 的先例是主项目 import remotion 侧实现,
 * 这条规矩延续同一个方向): `remotion/` 是独立 tsconfig 的子项目, 渲染层
 * (`TextOverlayLayer.tsx`)需要这两个函数算像素位置, 而 remotion 侧不能反过来
 * import 主项目文件。主项目 import remotion 文件则有先例可循(`plan-preview.tsx`
 * import `Film.tsx`、`merge-shot-style.test.ts` import `cards/style.ts`)——
 * 主项目 tsc 的 include 本来就会把 `remotion/src/**` 一起编译进去(`remotion`/
 * `@remotion/player` 也在主项目 node_modules 里, 见 `package.json`), 这条路
 * 是通的。
 *
 * 这里 re-export 而不是整体删掉本文件里的定义: 本文件里的 `OverlaySlot`/
 * `OVERLAY_SLOTS`/`OVERLAY_KINDS` 是 LLM 契约(`OverlayExtractionSchema`/
 * `OverlayPlanSchema`)的一部分, 继续留在这里; 只有"给定坐标算像素位置"这条
 * 纯几何逻辑挪走。两边类型同名同形(`OverlaySlot` 在 remotion 侧也有定义,
 * 结构相同, 互不 import, 与 `CaptionItem` 那类"两侧同形不 import"惯例一致
 * ——但这两个函数**确实**互相 import 了, 因为它们的行为必须完全同源, 不能
 * 靠"同形状但两份实现"来保证一致(T1 测试与 Task 6 拖拽层都依赖这一点)。
 */
export {
  overlaySlotRect,
  overlayPosition,
  type OverlayAspect,
  type OverlayPersonSide,
  type OverlayRect,
} from '../../../remotion/src/overlay/position';
import type { OverlayPersonSide as _OverlayPersonSide } from '../../../remotion/src/overlay/position';

/**
 * 从 `vp.overlayPlan`(存储 Json, 可能是 `null`/未经校验的历史数据) +
 * `template.personSide`/`cornerBadge` 算出喂给 `FilmInput` 的三个叠加层字段。
 *
 * **三处调用点共用同一份实现**(worker 的四处渲染/体检入口、`shot-still` 路由、
 * `film-plan` GET 路由), 不各写一份——三十六期 templateStyle 那批注入点是内联
 * 表达式抄四遍(字段简单, 抄得起), 这里多了一次 schema 校验 + 枚举兜底, 值得
 * 抽成函数, 改一处不用满仓找。
 *
 * `overlayPlanJson` 校验失败(历史脏数据/未来 schema 演进)时不抛错、按"没有
 * 叠加层"处理(`overlays: []`)——这是可选功能, 与 `extractOverlayPlan` 提取
 * 失败不拦片同一个纪律, 不该因为读出来的旧数据对不上新 schema 就让渲染/体检
 * 报错。
 */
export function resolveOverlayInput(
  overlayPlanJson: unknown,
  personSide: string | null | undefined,
  cornerBadge: string | null | undefined,
): { overlays: OverlayItem[]; overlayPersonSide: _OverlayPersonSide; cornerBadge: string | null } {
  const parsed = overlayPlanJson ? OverlayPlanSchema.safeParse(overlayPlanJson) : null;
  const overlays = parsed?.success ? (parsed.data.items as OverlayItem[]) : [];
  const overlayPersonSide: _OverlayPersonSide =
    personSide === 'left' || personSide === 'center' || personSide === 'right' ? personSide : 'right';
  return { overlays, overlayPersonSide, cornerBadge: cornerBadge ?? null };
}
