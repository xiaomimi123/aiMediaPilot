// 三期 IA 演化: 视图路由 (`?view=`/`?tab=` 解析) 的纯逻辑模块。
// 从 Cockpit.tsx / sidebar.tsx 里抽出来的原因: 这两处都是 "use client" 组件文件
// (sidebar.tsx 还引入了 next/link), 把 URLSearchParams 解析逻辑留在那边既无法脱离
// React/Next 单独做单元测试, 也容易在后续扩展 (T6 的历史链接精确映射) 时因为改动
// 顺手牵连组件渲染代码。NavView/PlatformNavId 类型同样搬到这里作为唯一定义来源——
// sidebar.tsx 现在反过来 `import type` 这两个类型, 避免和这个模块产生环形依赖。
import { CONTENT_PLATFORMS } from "./model";

type RoutingPlatform = (typeof CONTENT_PLATFORMS)[number];
export type PlatformNavId = `platform-${RoutingPlatform}`;

// goals/review 曾是旧 NavigationItemId 的残留, 在 T2 从侧栏拿掉后仍短暂留在联合里
// 承接内部跳转和历史 `?view=` 链接。T4 把这两个视图合并进 analytics（目标/复盘 两个 tab），
// 因此从联合里彻底移除 —— 历史 `?view=goals`/`?view=review` 链接改由
// `resolveInitialView` 折叠到 "analytics" + `resolveInitialAnalyticsTab` 精确映射 tab
// （见下方两个函数）。schedule 已并入 momentum 的档期 tab (T3), 不再是独立 NavView ——
// 状态改由 `MomentumPeriod` ("today"|"week"|"schedule") 承载, 见下方 `resolveInitialMomentumTab`。
export type NavView =
  | "inspirations"
  | "momentum"
  | "pipeline"
  | "analytics"
  | "settings"
  | PlatformNavId;

export function isPlatformNavView(view: NavView): view is PlatformNavId {
  return view.startsWith("platform-");
}

// 与 sidebar.tsx 的 ALL_NAV_ITEMS (WORKBENCH_NAV_ITEMS + PLATFORM_NAV_ITEMS + OVERVIEW_NAV_ITEMS)
// id 集合原样对应, 只取 id 不取 label/icon, 避免依赖 sidebar.tsx (见上方模块注释)。
const FIXED_VIEW_IDS: ReadonlyArray<string> = [
  "inspirations",
  "momentum",
  "pipeline",
  "analytics",
  ...CONTENT_PLATFORMS.map((platform) => `platform-${platform}`),
];

/**
 * 解析 `?view=` 初始视图。合法固定项 / 平台项放行, `settings` 单独放行,
 * legacy `goals`/`review` 折叠进 `"analytics"`（精确到 tab 由
 * `resolveInitialAnalyticsTab` 处理, 见下方）, 其余（含缺省、非法值、旧的 `schedule`）
 * 一律回退 `"momentum"`。`schedule` 在 T3 后不再是独立 NavView —— 旧 `?view=schedule`
 * 链接落回 momentum(今日), T6 再做到档期 tab 的精确映射。
 */
export function resolveInitialView(searchParams: URLSearchParams): NavView {
  const requested = searchParams.get("view");
  if (!requested) return "momentum";
  if (requested === "settings") return "settings";
  if (requested === "goals" || requested === "review") return "analytics";
  if (FIXED_VIEW_IDS.includes(requested)) {
    return requested as NavView;
  }
  return "momentum";
}

export type MomentumPeriod = "today" | "week" | "schedule";

const MOMENTUM_TABS: ReadonlyArray<MomentumPeriod> = ["today", "week", "schedule"];

/**
 * 解析 `?tab=` 初始档期/今日/本周 tab。**门控**: 只在 `resolvedView === "momentum"` 时
 * 才读取 `tab` 参数——否则任何非 momentum 视图（例如 `?view=inspirations&tab=schedule`）
 * 都会被忽略, 返回 `"today"`。这是为了避免 `tab` 参数在未来跨视图深链场景里被误读
 * (例如先落在 inspirations, 之后 SPA 内切到 momentum 时不应该直接跳到档期)。
 */
export function resolveInitialMomentumTab(searchParams: URLSearchParams, resolvedView: NavView): MomentumPeriod {
  if (resolvedView !== "momentum") return "today";
  const requested = searchParams.get("tab");
  if (requested && (MOMENTUM_TABS as ReadonlyArray<string>).includes(requested)) {
    return requested as MomentumPeriod;
  }
  return "today";
}

export type AnalyticsTab = "goals" | "review";

const ANALYTICS_TABS: ReadonlyArray<AnalyticsTab> = ["goals", "review"];

/**
 * 解析 `?view=`/`?tab=` 初始内容数据分析 (目标/复盘) tab。**门控**: 只在
 * `resolvedView === "analytics"` 时才读取参数——否则回退 `"goals"`, 与
 * `resolveInitialMomentumTab` 的门控方式一致。
 *
 * 与 momentum 的 tab 解析不同的一点: legacy `?view=goals`/`?view=review` 需要精确落到
 * 对应 tab（`resolveInitialView` 已把两者都折叠成 `"analytics"`, 这一步的信息已经丢失），
 * 因此这里重新读取原始 `view` 参数值——若是 legacy id 直接决定 tab；否则再看 `?tab=`
 * （新 `?view=analytics&tab=review` 深链的写法）, 非法/缺省值落回 `"goals"`。
 */
export function resolveInitialAnalyticsTab(searchParams: URLSearchParams, resolvedView: NavView): AnalyticsTab {
  if (resolvedView !== "analytics") return "goals";
  const requestedView = searchParams.get("view");
  if (requestedView === "review") return "review";
  if (requestedView === "goals") return "goals";
  const requestedTab = searchParams.get("tab");
  if (requestedTab && (ANALYTICS_TABS as ReadonlyArray<string>).includes(requestedTab)) {
    return requestedTab as AnalyticsTab;
  }
  return "goals";
}
