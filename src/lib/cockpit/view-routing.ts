// 三期 IA 演化: 视图路由 (`?view=`/`?tab=` 解析) 的纯逻辑模块。
// 从 Cockpit.tsx / sidebar.tsx 里抽出来的原因: 这两处都是 "use client" 组件文件
// (sidebar.tsx 还引入了 next/link), 把 URLSearchParams 解析逻辑留在那边既无法脱离
// React/Next 单独做单元测试, 也容易在后续扩展 (T6 的历史链接精确映射) 时因为改动
// 顺手牵连组件渲染代码。NavView/PlatformNavId 类型同样搬到这里作为唯一定义来源——
// sidebar.tsx 现在反过来 `import type` 这两个类型, 避免和这个模块产生环形依赖。
import { CONTENT_PLATFORMS } from "./model";
import type { ContentPlatformEx } from "./model";

type RoutingPlatform = (typeof CONTENT_PLATFORMS)[number];
export type PlatformNavId = `platform-${RoutingPlatform}`;

// goals/review 曾是旧 NavigationItemId 的残留, 在 T2 从侧栏拿掉后仍短暂留在联合里
// 承接内部跳转和历史 `?view=` 链接。T4 把这两个视图合并进 analytics（目标/复盘 两个 tab），
// 因此从联合里彻底移除 —— 历史 `?view=goals`/`?view=review` 链接改由
// `resolveInitialView` 折叠到 "analytics" + `resolveInitialAnalyticsTab` 精确映射 tab
// （见下方两个函数）。schedule 已并入 momentum 的档期 tab (T3), 不再是独立 NavView ——
// 状态改由 `MomentumPeriod` ("today"|"week"|"schedule") 承载, 见下方 `resolveInitialMomentumTab`。
// 四期 T6: 新增 "radar" 固定视图 (热点雷达), 挂在工作台组「灵感库选题」正下方
// (侧栏顺序见 sidebar.tsx WORKBENCH_NAV_ITEMS)。该视图自取数 (不进 WorkspaceState,
// 见 radar.tsx 顶部注释), 与其余固定视图一样只是多一个合法 `?view=` 目的地。
// 十一期 T1: 新增 "positioning" 固定视图 (账号定位), 挂在工作台组**第一项**——定位
// 是内容战略资产, 是一切选题/写稿的前提, 语义上不该和设置页的配置项并列 (十期教训)。
// 视图组件本身在 T2 落地 (src/components/cockpit/views/positioning.tsx), 这里先只开
// 合法的 `?view=` 目的地, 供 T2 挂载消费。
// 十六期新增: 新首页默认视图; momentum/pipeline/platform-* 三个值保留仅供
// resolveInitialView 内部兼容识别历史链接, 不再是可达的 view 状态。
export type NavView =
  | "positioning"
  | "inspirations"
  | "radar"
  | "home"
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
  "positioning",
  "inspirations",
  "radar",
  "momentum",
  "pipeline",
  "analytics",
  ...CONTENT_PLATFORMS.map((platform) => `platform-${platform}`),
];

/**
 * 解析 `?view=` 初始视图。合法固定项 / 平台项放行, `settings` 单独放行,
 * legacy `goals`/`review` 折叠进 `"analytics"`（精确到 tab 由
 * `resolveInitialAnalyticsTab` 处理, 见下方）, 其余（含缺省、非法值、`momentum`/
 * `pipeline`/`platform-*`/旧的 `schedule`）一律回退 `"home"`。十六期起 `"home"` 取代
 * `"momentum"` 成为默认落地视图 —— `momentum`/`pipeline`/`platform-*` 均不再是可达的
 * view 状态, 旧 `?view=schedule` 链接同样落回 `"home"`（`schedule` 从未进过
 * `FIXED_VIEW_IDS`, T3 后就不是独立 NavView）。精确到平台 tab 的映射由
 * `resolveInitialHomePlatform` 重读原始 `view` 参数完成（T6, 与
 * `resolveInitialAnalyticsTab` 处理 legacy `goals`/`review` 的手法一致）。
 */
export function resolveInitialView(searchParams: URLSearchParams): NavView {
  const requested = searchParams.get("view");
  if (!requested) return "home"; // 原来是 "momentum"
  if (requested === "settings") return "settings";
  if (requested === "goals" || requested === "review") return "analytics";
  // 十六期: momentum/pipeline/platform-* 三类历史 view 值统一落到 "home"
  // (原首页流水线/平台看板/今日推进已合并进新首页, 见 resolveInitialHomePlatform
  // 精确到平台 tab 预选)。
  if (requested === "momentum" || requested === "pipeline") return "home";
  if (FIXED_VIEW_IDS.includes(requested)) {
    if (requested.startsWith("platform-")) return "home";
    return requested as NavView;
  }
  return "home"; // 原来是 "momentum"
}

export type MomentumPeriod = "today" | "week" | "schedule";

const MOMENTUM_TABS: ReadonlyArray<MomentumPeriod> = ["today", "week", "schedule"];

/**
 * 解析 `?tab=` 初始档期/今日/本周 tab。**门控**: 只在 `resolvedView === "momentum"` 时
 * 才读取 `tab`/legacy `view` 参数——否则任何非 momentum 视图（例如
 * `?view=inspirations&tab=schedule`）都会被忽略, 返回 `"today"`。这是为了避免 `tab`
 * 参数在未来跨视图深链场景里被误读 (例如先落在 inspirations, 之后 SPA 内切到 momentum
 * 时不应该直接跳到档期)。
 *
 * 与 `resolveInitialAnalyticsTab` 处理 legacy `?view=goals`/`?view=review` 的手法一致
 * (T6): legacy `?view=schedule`（重新读取原始 `view` 参数值）在这里精确落到 `"schedule"`
 * tab, 优先级高于 `?tab=`；否则再看 `?tab=`（`?view=momentum&tab=schedule` 深链的写法）,
 * 非法/缺省值落回 `"today"`。**十六期提醒**: `resolveInitialView` 已改为把
 * `momentum`/`pipeline`/`platform-*`/`schedule` 等历史 `?view=` 值统一折叠成 `"home"`
 * (取代原来的 `"momentum"`), 因此本函数的门控在任何经 `resolveInitialView` 得出的
 * `resolvedView` 上都不会再匹配 —— 只有显式传入字面量 `"momentum"`（`NavView` 联合里
 * 仍保留该值仅供兼容, 见类型定义处注释）时门控才会放行, 见单测。
 */
export function resolveInitialMomentumTab(searchParams: URLSearchParams, resolvedView: NavView): MomentumPeriod {
  if (resolvedView !== "momentum") return "today";
  const requestedView = searchParams.get("view");
  if (requestedView === "schedule") return "schedule";
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

/**
 * 解析首页流水线视图的初始平台 tab 预选。**门控**: 只在 `resolvedView === "home"` 时
 * 才读取参数——否则返回 undefined（即"全部"tab）。与 `resolveInitialMomentumTab`/
 * `resolveInitialAnalyticsTab` 同样的历史链接精确映射手法 (T6)：`resolveInitialView`
 * 已经把 `?view=platform-douyin` 折叠成 `"home"`，这一步重新读取原始 `view` 参数值，
 * 若是合法的 `platform-*` id 则精确到该平台 tab；否则（含 `?view=momentum`/
 * `?view=pipeline`/缺省）落到 undefined（"全部"tab）。
 */
export function resolveInitialHomePlatform(
  searchParams: URLSearchParams,
  resolvedView: NavView,
): ContentPlatformEx | undefined {
  if (resolvedView !== "home") return undefined;
  const requestedView = searchParams.get("view");
  if (requestedView && requestedView.startsWith("platform-")) {
    const platform = requestedView.slice("platform-".length);
    if ((CONTENT_PLATFORMS as readonly string[]).includes(platform)) {
      return platform as ContentPlatformEx;
    }
  }
  return undefined;
}
