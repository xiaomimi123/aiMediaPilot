# 前端整体重构（十六期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-08-19-frontend-redesign-design.md`（含三次修正）落地十六期前端重构：极简视觉基线、新流水线首页（合并平台看板+今日推进）、侧栏从 11 项收窄到 4 项，全站其余页面套用新视觉基线。

**Architecture:** 新增 CSS token + 两个基础类作为视觉基线；新增一个纯逻辑函数（`resolveInitialHomePlatform`）扩展现有 `view-routing.ts` 路由解析；新增一个薄组件 `home-pipeline.tsx`，把已有的 `ContentOverviewView`/`PlatformView`/`MomentumView` 三个组件原样组合成新首页（不重写它们内部逻辑，不新建数据获取路径）；侧栏收窄是纯数组裁剪；其余页面重贴皮是逐页替换 className/内联样式为新基线，不动状态/逻辑代码。

**Tech Stack:** Next.js 14 (App Router) / React / TypeScript / 纯 CSS（无新依赖）/ Vitest + Testing Library（现有测试栈不变）。

## Global Constraints

- 不改变任何 API、Prisma schema、数据模型（spec §5）。
- 不改变任何现有交互逻辑：看板拖拽换阶段、内容详情步骤条跳转、档期改期、六幕脚本生成等所有现有行为按原样保留——本计划所有"重贴皮"类任务只允许改 className/内联 style/JSX 包裹结构，不允许改状态管理代码（`useState`/`useEffect`/事件处理函数体）。
- 颜色 token（`--paper`/`--surface`/`--ink`/`--muted`/`--line`/`--clay`/`--olive`/`--gold` 等，`src/app/cockpit.css:2-32` 明暗两套）保留不动，只新增间距/字号/圆角 token，不替换现有颜色变量。
- 每个 Task 结束后 `npm run typecheck && npm run test` 全绿再 commit；尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 重贴皮类任务（Task 6-10）没有对应的自动化测试可写（纯视觉改动），验收方式是"改动前后跑一次现有测试全绿 + 人工过一遍页面截图/走查"，不新增测试文件——这是刻意的，不是漏做。
- `content-detail.tsx` 有一段约 400-1085 行的既有状态管理区（防抖/乐观锁/竞态守卫，见 Task 6 里的精确边界），任何任务都不允许改动这段代码本体，只能改它外层的 JSX className。
- `MomentumView`（`momentum.tsx:157-234`）、`ContentOverviewView`（`pipeline.tsx`）、`PlatformView`（`views/platform.tsx`）三个组件本身在本计划中**只被移动挂载位置、不改内部实现**——Task 5 把它们从 `Cockpit.tsx` 的旧 `view==="momentum"|"pipeline"|isPlatformNavView(view)` 分支搬到新 `HomePipelineView` 内部，props 原样透传。

---

### Task 1: CSS 视觉基线 — 新增间距/字号/圆角 token + 基础类

**Files:**
- Modify: `src/app/cockpit.css`

**Interfaces (Produces，Task 4/6-10 消费):**
```css
/* 新 token，加进现有 :root 块 (第 2-32 行内，:root 结尾 `}` 之前) */
--space-xs: 6px;
--space-sm: 10px;
--space-md: 16px;
--space-lg: 24px;
--space-xl: 40px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 12px;
--text-xs: 11px;
--text-sm: 13px;
--text-base: 14px;
--text-lg: 16px;

/* 同样的 12 行加进 html[data-theme="dark"] 块 (第 33 行开始) —— 数值和 :root 完全一致
   (间距/字号/圆角不随明暗变化，只有颜色 token 才需要明暗两套不同数值)，
   这里加是为了让暗色模式下也能用这些变量名，不是要写不同的值。 */

/* 新基础类，加在 cockpit.css 里现有 .panel/.card-tags 附近 (约第 745 行之后)，
   新起一段注释块 `/* 十六期: 视觉基线 — 简洁极简 token 与基础类 */` */
.card-minimal {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  background: var(--surface);
}

.section-label {
  font-size: var(--text-xs);
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: var(--space-sm);
}
```

- [ ] **Step 1:** 打开 `src/app/cockpit.css`，确认 `:root` 块精确的开始/结束行（当前第 2 行 `:root {` 开始；用括号匹配找到对应 `}`，不要假设行号——文件后续可能已被其它并行改动微调）。在结束 `}` 之前插入上面 12 行新 token。
- [ ] **Step 2:** 找到 `html[data-theme="dark"] {` 块（当前约第 33 行开始）的结束 `}`，同样插入这 12 行（数值相同，不要写暗色专属数值）。
- [ ] **Step 3:** 在 `.panel`/`.card-tags` 定义附近（当前约第 201/738 行一带）新增一段注释块 `/* 十六期: 视觉基线 — 简洁极简 token 与基础类 */`，加入 `.card-minimal`/`.section-label` 两个类定义（如上）。
- [ ] **Step 4:** 确认没有跟现有类名冲突（`.card-minimal`/`.section-label` 此前不存在，已在探查阶段确认）。
- [ ] **Step 5:** `npm run typecheck && npm run test` 确认全绿（这一步纯 CSS 改动不应该影响任何测试，绿色只是确认没有语法错误导致的连锁问题）；`npm run build` 确认 CSS 能正常编译。
- [ ] **Step 6:** commit `feat(style): 十六期视觉基线 — 间距/字号/圆角 token + card-minimal/section-label 基础类`

---

### Task 2: `view-routing.ts` — 新增 "home" 视图 + 平台预选解析

**Files:**
- Modify: `src/lib/cockpit/view-routing.ts`
- Modify: `tests/lib/cockpit/view-routing.test.ts`

**Interfaces (Produces，Task 3/5 消费):**
```ts
export type NavView =
  | "positioning"
  | "inspirations"
  | "radar"
  | "home"        // 新增，替代原来 momentum 作为默认落地视图
  | "momentum"     // 保留 (仅供 resolveInitialView 内部识别历史 ?view= 值用，不再是可达状态)
  | "pipeline"     // 保留 (同上)
  | "analytics"
  | "settings"
  | PlatformNavId; // 保留 (同上)

export function resolveInitialHomePlatform(
  searchParams: URLSearchParams,
  resolvedView: NavView,
): ContentPlatformEx | undefined;
```

**具体改法：**

1. `NavView` 联合类型加入 `"home"`（放在 `"radar"` 和 `"momentum"` 之间，注释说明"十六期新增：新首页默认视图；momentum/pipeline/platform-* 三个值保留仅供 resolveInitialView 内部兼容识别历史链接，不再是可达的 view 状态"）。

2. `resolveInitialView` 改动（当前第 60-69 行）：
```ts
export function resolveInitialView(searchParams: URLSearchParams): NavView {
  const requested = searchParams.get("view");
  if (!requested) return "home"; // 原来是 "momentum"
  if (requested === "settings") return "settings";
  if (requested === "goals" || requested === "review") return "analytics";
  // 十六期: momentum/pipeline/platform-* 三类历史 view 值统一落到 "home"
  // (原首页流水线/平台看板/今日推进已合并进新首页，见 resolveInitialHomePlatform
  // 精确到平台 tab 预选)。
  if (requested === "momentum" || requested === "pipeline") return "home";
  if (FIXED_VIEW_IDS.includes(requested)) {
    if (requested.startsWith("platform-")) return "home";
    return requested as NavView;
  }
  return "home"; // 原来是 "momentum"
}
```

3. 新增函数（放在 `resolveInitialAnalyticsTab` 之后，文件末尾）：
```ts
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
```
需要在文件顶部 `import { CONTENT_PLATFORMS } from "./model";` 基础上，额外 `import type { ContentPlatformEx } from "./model";`（确认 `model.ts` 确实导出这个类型名——若类型名不同，以 `model.ts` 实际导出为准，不要凭空假设）。

**Test（`tests/lib/cockpit/view-routing.test.ts`，改写已有断言 + 新增用例）：**

现有测试文件里所有 `expect(resolveInitialView(...)).toBe('momentum')` 的断言（对应"缺省 view"/"非法 view"/"非法平台 id"三个用例）需要改成 `.toBe('home')`。"固定视图 id 放行"用例里 `expect(resolveInitialView(paramsFrom('view=momentum'))).toBe('momentum')` 和 `expect(resolveInitialView(paramsFrom('view=pipeline'))).toBe('pipeline')` 两行需要改成 `.toBe('home')`；`view=platform-douyin` 的断言也从 `.toBe('platform-douyin')` 改成 `.toBe('home')`。

新增一个 `describe('resolveInitialHomePlatform', ...)` 块：
```ts
describe('resolveInitialHomePlatform', () => {
  it('非 home 视图 → undefined（即便 view 参数看起来像平台）', () => {
    const params = paramsFrom('view=inspirations');
    expect(resolveInitialHomePlatform(params, 'inspirations')).toBeUndefined();
  });

  it('view=platform-douyin → home 视图下解析出 douyin', () => {
    const params = paramsFrom('view=platform-douyin');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBe('douyin');
  });

  it('view=platform-foo（非法平台）→ undefined', () => {
    const params = paramsFrom('view=platform-foo');
    const view = resolveInitialView(params);
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('view=momentum → home 视图下解析出 undefined（全部 tab，非某个平台）', () => {
    const params = paramsFrom('view=momentum');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('view=pipeline → home 视图下解析出 undefined', () => {
    const params = paramsFrom('view=pipeline');
    const view = resolveInitialView(params);
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('缺省 view → home 视图下解析出 undefined', () => {
    const params = paramsFrom('');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });
});
```

- [ ] **Step 1:** 按上面代码改 `view-routing.ts`（`NavView` 加 `"home"`；`resolveInitialView` 默认值和三类历史 id 映射；新增 `resolveInitialHomePlatform`）。
- [ ] **Step 2:** 改写 `tests/lib/cockpit/view-routing.test.ts` 里受影响的现有断言（见上），新增 `resolveInitialHomePlatform` 测试块。
- [ ] **Step 3:** `npx vitest run tests/lib/cockpit/view-routing.test.ts` 确认全部通过。
- [ ] **Step 4:** `npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `feat(cockpit): 十六期 — view-routing 新增 home 视图 + 平台预选解析`

---

### Task 3: 侧栏收窄 — 11 项到 4 项

**Files:**
- Modify: `src/components/cockpit/sidebar.tsx`

**Interfaces (Consumes Task 1 的 CSS 基线, Task 2 的 NavView):**

调整 `sidebar.tsx` 里的四个导出常量：

```ts
// 保留 3 项 (去掉 momentum)
export const WORKBENCH_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "positioning", label: "账号定位", icon: "positioning" },
  { id: "inspirations", label: "灵感库选题", icon: "inspiration" },
  { id: "radar", label: "热点雷达", icon: "radar" },
];

// 整个删除 PLATFORM_NAV_ITEMS 的渲染消费（常量本身可以保留导出，供未来需要时复用，
// 但 renderItem 渲染列表里不再出现）——见下方 Step 2。

// 只保留 analytics (去掉 pipeline)
export const OVERVIEW_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  { id: "analytics", label: "内容数据分析", icon: "analytics" },
];

// ALL_NAV_ITEMS 探查阶段确认目前没有外部消费者，可以按新的三个常量重新拼接
// (WORKBENCH + OVERVIEW，不再包含 PLATFORM)，或者直接删除导出——按"最小改动"原则，
// 保留导出但改成 WORKBENCH_NAV_ITEMS + OVERVIEW_NAV_ITEMS 拼接即可，不要删除整个常量
// (避免未来某处新增消费者时基线不对)。

export const MOBILE_NAV_ITEMS: ReadonlyArray<SidebarNavItem> = [
  ...WORKBENCH_NAV_ITEMS,
  ...OVERVIEW_NAV_ITEMS,
]; // 逻辑不变 (仍是 workbench+overview 拼接)，因为两个源数组已经收窄，这里自动跟着变成 4 项。
```

**具体改法：**

1. `WORKBENCH_NAV_ITEMS` 数组删掉 `{ id: "momentum", ... }` 这一行。
2. `PLATFORM_NAV_ITEMS` 常量定义本身**保留不删**（避免破坏潜在的类型引用/未来复用），但渲染层（`nav` JSX，约第 142-148 行的 `.sidebar-group-label`"创作" + `PLATFORM_NAV_ITEMS.map(...)` 那一段）整体删除——不再渲染"创作"分组标题和 5 个平台入口。
3. `OVERVIEW_NAV_ITEMS` 数组删掉 `{ id: "pipeline", ... }` 这一行。
4. `ALL_NAV_ITEMS` 保留导出，内容改成 `[...WORKBENCH_NAV_ITEMS, ...OVERVIEW_NAV_ITEMS]`（不再 spread `PLATFORM_NAV_ITEMS`）。
5. `MOBILE_NAV_ITEMS` 定义本身不用改（已经是 `WORKBENCH_NAV_ITEMS + OVERVIEW_NAV_ITEMS` 拼接，两个源数组收窄后它自动跟着变成 4 项）。
6. 应用 Task 1 的 CSS 基线到 `.nav-item`/`.nav-section-label`/`.sidebar-group-label` 相关样式规则（在 `cockpit.css` 里找到这几个类的现有定义，把手写的 padding/字号数值替换成 `var(--space-sm)`/`var(--text-sm)` 等新 token，不改变布局结构，只统一数值来源）——这一步是 CSS 文件的改动，不是 `sidebar.tsx` 本身。

**Test：** 这个组件目前如果有测试文件（`tests/components/cockpit/sidebar.test.ts`，Explore 报告提到过 `tests/components/cockpit/sidebar.test.ts` 存在），先读一遍现状再改——如果现有测试断言了 `ALL_NAV_ITEMS`/`WORKBENCH_NAV_ITEMS` 等数组的具体长度或内容，需要同步更新断言到新的收窄后的数组；如果测试只是渲染快照/交互测试不依赖具体数组长度，可能不需要改。**这一步不能凭空猜，必须先读现有测试文件内容再决定改法。**

- [ ] **Step 1:** 读 `tests/components/cockpit/sidebar.test.ts` 现状，确认哪些断言依赖数组长度/具体项。
- [ ] **Step 2:** 按上面代码改 `sidebar.tsx` 的四个常量 + 渲染 JSX（删除"创作"分组渲染）。
- [ ] **Step 3:** 根据 Step 1 的发现，同步更新 `sidebar.test.ts` 里受影响的断言。
- [ ] **Step 4:** 在 `cockpit.css` 里给 `.nav-item`/`.nav-section-label`/`.sidebar-group-label` 应用 Task 1 新 token（数值替换，不改结构）。
- [ ] **Step 5:** `npm run typecheck && npm run test` 全绿。
- [ ] **Step 6:** commit `feat(cockpit): 十六期 — 侧栏收窄至 4 项(账号定位/灵感库/热点雷达/数据分析)`

---

### Task 4: `home-pipeline.tsx` 新组件 — 首页流水线视图

**Files:**
- Create: `src/components/cockpit/views/home-pipeline.tsx`

**Interfaces (Consumes Task 1 CSS 基线; Produces，Task 5 消费):**

这个组件不做任何新的数据获取或状态派生——它接收的 props 是 `Cockpit.tsx` 已经在用的现成数据/回调（分别是原来传给 `MomentumView`/`ContentOverviewView`/`PlatformView` 三个组件的 props），只是把"平台 tab 选中态"和"今日推进展开/收起态"这两个新增的纯 UI 状态放在组件内部用 `useState` 管理（不需要 Task 5 那边传下来，因为不需要持久化，纯本地交互态）。

```ts
import type { ContentPlatformEx, WorkspaceState, WorkStage, ScheduleObject, ScheduleObjectType, LiveSession, StageEvent } from "@/lib/cockpit/model";
import type { MomentumPeriod } from "@/lib/cockpit/view-routing";
import type { DailyStageEntry } from "./momentum";

export function HomePipelineView(props: {
  // 平台 tab 初始预选 (来自 resolveInitialHomePlatform，Task 5 传入)
  initialPlatform: ContentPlatformEx | undefined;

  // ContentOverviewView / PlatformView 共用的既有 props (与 Cockpit.tsx 现有调用完全一致)
  state: WorkspaceState;
  pageTitle: string;
  updateTitle: (value: string) => void;
  query: string;
  setQuery: (value: string) => void;
  type: string;
  setType: (value: string) => void;
  open: (id: string) => void;
  addToday: (id: string) => void;
  dropStage: (event: DragEvent, stage: import("@/lib/cockpit/model").ContentStage) => void;
  createContentForPlatform: (platform: ContentPlatformEx) => void;

  // 顶部摘要条用 (今日/逾期统计，来自 Cockpit.tsx 现有 todayEntries/overdueEntries 计算)
  todayEntries: DailyStageEntry[];
  overdueEntries: DailyStageEntry[];

  // 展开态渲染整个 MomentumView 需要的全部既有 props (与 Cockpit.tsx 现有
  // `<MomentumView ... />` 调用完全一致，逐字透传，见 Cockpit.tsx:639-666)
  momentumPeriod: MomentumPeriod;
  setMomentumPeriod: (period: MomentumPeriod) => void;
  momentumPageTitle: string;
  momentumPageTitleFallback: string;
  updateMomentumPageTitle: (value: string) => void;
  openReview: () => void;
  moveToday: (eventId: string, direction: -1 | 1) => void;
  toggleComplete: (eventId: string) => void;
  removeFromToday: (eventId: string) => void;
  schedule: (contentId: string, stage: WorkStage, plannedDate: string) => void;
  moveEvent: (eventId: string, plannedDate: string) => void;
  unschedule: (contentId: string, stage: WorkStage) => void;
  createReviewDay: (plannedDate: string) => void;
  moveReviewDay: (reviewDayId: string, plannedDate: string) => void;
  removeReviewDay: (reviewDayId: string) => void;
  saveLive: (session: LiveSession) => void;
  moveLive: (liveSessionId: string, plannedDate: string) => void;
  removeLive: (liveSessionId: string) => void;
  saveObjectType: (type: ScheduleObjectType) => void;
  archiveObjectType: (typeId: string) => void;
  removeObjectType: (typeId: string) => void;
  saveObject: (object: ScheduleObject) => void;
  moveObject: (objectId: string, plannedDate: string) => void;
  removeObject: (objectId: string) => void;
  configureColors: () => void;
}): JSX.Element;
```

**实现要点：**

1. `const [platform, setPlatform] = useState<ContentPlatformEx | undefined>(props.initialPlatform);` — tab 切换只改这个本地状态，不影响 URL（与现有 `view` 状态的处理方式一致：`?view=` 只在首次挂载时读取一次）。
2. `const [expanded, setExpanded] = useState(false);` — 顶部摘要条展开态。
3. 摘要文案：用 `props.todayEntries.length` 和 `props.overdueEntries.length` 拼一句话，例如 `` `你有 ${props.todayEntries.length} 条内容待推进，${props.overdueEntries.length} 条已逾期` ``——具体措辞可以比这个更自然，但必须真实反映这两个数字，不能是静态占位文案。
4. 平台 tab 栏：`["全部", ...CONTENT_PLATFORMS]` 渲染成一排按钮（复用脑暴阶段 mockup 的视觉：选中态底部实线，用 `.section-label`/新 token 而不是硬编码数值），点击设置 `platform` 本地状态。`CONTENT_PLATFORMS`/`PLATFORM_LABELS` 从 `@/lib/cockpit/model` 引入（与 `sidebar.tsx` 现有引入方式一致）。
5. 展开区：`expanded && <MomentumView momentumPeriod={props.momentumPeriod} setMomentumPeriod={props.setMomentumPeriod} pageTitle={props.momentumPageTitle} pageTitleFallback={props.momentumPageTitleFallback} updatePageTitle={props.updateMomentumPageTitle} state={props.state} todayEntries={props.todayEntries} overdueEntries={props.overdueEntries} open={props.open} openReview={props.openReview} moveToday={props.moveToday} toggleComplete={props.toggleComplete} removeFromToday={props.removeFromToday} schedule={props.schedule} moveEvent={props.moveEvent} unschedule={props.unschedule} createReviewDay={props.createReviewDay} moveReviewDay={props.moveReviewDay} removeReviewDay={props.removeReviewDay} saveLive={props.saveLive} moveLive={props.moveLive} removeLive={props.removeLive} saveObjectType={props.saveObjectType} archiveObjectType={props.archiveObjectType} removeObjectType={props.removeObjectType} saveObject={props.saveObject} moveObject={props.moveObject} removeObject={props.removeObject} configureColors={props.configureColors} />` — props 逐字对应 `Cockpit.tsx:639-666` 现有调用，一个不漏、一个不改。
6. 下方主体：`platform === undefined ? <ContentOverviewView state={props.state} pageTitle={props.pageTitle} updateTitle={props.updateTitle} query={props.query} setQuery={props.setQuery} type={props.type} setType={props.setType} open={props.open} addToday={props.addToday} dropStage={props.dropStage} /> : <PlatformView platform={platform} state={props.state} pageTitle={props.pageTitle} updateTitle={props.updateTitle} query={props.query} setQuery={props.setQuery} type={props.type} setType={props.setType} open={props.open} addToday={props.addToday} dropStage={props.dropStage} createContent={() => props.createContentForPlatform(platform)} />` — 与 `Cockpit.tsx` 现有 `view==="pipeline"`/`isPlatformNavView(view)` 两个分支的现成调用完全一致（第一个不传 `platformFilter`，第二个传 `platform`+`createContent`），只是从"两个互斥的顶层分支"改成"同一个组件内部的三元表达式"。
7. `import { ContentOverviewView } from "./pipeline";` / `import { PlatformView } from "./platform";` / `import { MomentumView } from "./momentum";` —— 三个既有组件原样引入复用，不改它们的文件。

**Test：** 这个组件是新的组合逻辑（tab 切换 + 展开/收起），不是纯重贴皮，值得写一个轻量组件测试（`tests/components/cockpit/home-pipeline.test.ts`，参照现有 `tests/components/cockpit/sidebar.test.ts` 的测试风格/mock 方式）：
- 初始 `initialPlatform=undefined` → 渲染 `ContentOverviewView`（可以断言某个只有 `ContentOverviewView` 才有的 DOM 特征，或者更简单地 mock 掉 `./pipeline`/`./platform`/`./momentum` 三个子组件模块，断言只有对应的 mock 被渲染）。
- 初始 `initialPlatform="douyin"` → 渲染 `PlatformView` 且 `platform` prop 为 `"douyin"`。
- 点击"抖音"tab 后（从"全部"起始态）→ 切换为渲染 `PlatformView platform="douyin"`。
- 点击展开控件后 → `MomentumView` 出现在 DOM 里；再点一次收起 → 消失。
- 摘要文案里包含 `todayEntries.length` 和 `overdueEntries.length` 的真实数值（传入 mock 数组，断言文案包含对应数字）。

- [ ] **Step 1:** 读 `tests/components/cockpit/sidebar.test.ts` 了解本项目组件测试的 mock 约定（是否 mock 子组件、用什么测试工具）。
- [ ] **Step 2:** TDD：先写上面 5 个测试用例（RED），再实现 `home-pipeline.tsx`（GREEN）。
- [ ] **Step 3:** 应用 Task 1 CSS 基线到新增的 tab 栏/摘要条 JSX（对应 `cockpit.css` 里新增这部分的样式规则，用 `.card-minimal`/`.section-label`/新 spacing token，不要手写新的魔法数值）。
- [ ] **Step 4:** `npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `feat(cockpit): 十六期 — 新首页组件 HomePipelineView(平台tab+今日推进展开+看板复用)`

---

### Task 5: `Cockpit.tsx` 接线 — 首页渲染 + onBrandClick 改造

**Files:**
- Modify: `src/components/cockpit/Cockpit.tsx`

**Interfaces (Consumes Task 2/4):**

1. 删除三个旧渲染分支（`Cockpit.tsx` 当前约 639-673 行）：`view === "momentum" ? <MomentumView .../> : null`、`view === "pipeline" ? <ContentOverviewView .../> : null`、`isPlatformNavView(view) ? <PlatformView .../> : null` 这三段整体删除。
2. 新增一段：`view === "home" ? <HomePipelineView initialPlatform={resolveInitialHomePlatform(searchParams, view)} state={state} pageTitle={state.pageTitles.pipeline} updateTitle={(value) => updatePageTitle("pipeline", value)} query={pipelineQuery} setQuery={setPipelineQuery} type={pipelineType} setType={setPipelineType} open={openContent} addToday={addToToday} dropStage={onDropStage} createContentForPlatform={createContentForPlatform} todayEntries={todayEntries} overdueEntries={overdueEntries} momentumPeriod={momentumPeriod} setMomentumPeriod={setMomentumPeriod} momentumPageTitle={state.pageTitles[momentumPeriod]} momentumPageTitleFallback={DEFAULT_PAGE_TITLES[momentumPeriod]} updateMomentumPageTitle={(value) => updatePageTitle(momentumPeriod, value)} openReview={() => { setView("analytics"); setAnalyticsTab("review"); }} moveToday={moveToday} toggleComplete={toggleTodayComplete} removeFromToday={removeFromToday} schedule={planStage} moveEvent={moveCalendarEvent} unschedule={clearStagePlan} createReviewDay={createReviewDay} moveReviewDay={moveReviewDay} removeReviewDay={deleteReviewDay} saveLive={saveLiveSession} moveLive={moveLiveSession} removeLive={deleteLiveSession} saveObjectType={saveScheduleObjectType} archiveObjectType={archiveScheduleObjectType} removeObjectType={deleteScheduleObjectType} saveObject={saveScheduleObject} moveObject={moveScheduleObject} removeObject={deleteScheduleObject} configureColors={() => setShowStageColors(true)} /> : null`

   注意：`resolveInitialHomePlatform(searchParams, view)` 每次渲染都会重新调用——这是可以接受的（纯函数、无副作用、成本可忽略），但更规范的写法是像 `momentumPeriod` 一样用 `useState(() => resolveInitialHomePlatform(searchParams, view))` 只在挂载时算一次，作为 `initialPlatform` 传下去（组件内部自己管后续切换状态，不需要父组件重新算）。**用 `useState` 初始化的写法，不要每次渲染都调用。**

3. `import { HomePipelineView } from "./views/home-pipeline";` 加到文件顶部现有 view 组件 import 列表（`Cockpit.tsx:77-84` 一带）。
4. `import { resolveInitialHomePlatform } from "@/lib/cockpit/view-routing";` 加到现有 `resolveInitialView`/`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab` import 那一行。
5. `onBrandClick` 改动（当前第 614 行）：`onBrandClick={() => { setView("home"); }}` —— 不再需要 `setMomentumPeriod("today")`（那是旧的"点击品牌回到今日推进页并重置到今日 tab"逻辑；新首页没有"today 起始 tab"这个概念，展开态默认收起即可，`momentumPeriod` 状态不需要在这里重置）。
6. 确认删除三个旧分支后，`MomentumView`/`ContentOverviewView`/`PlatformView`/`isPlatformNavView` 这几个 import 是否在文件其它地方还有用到——`isPlatformNavView` 探查阶段只在这一处渲染分支用到，删除分支后这个 import 会变成未使用，需要一并从 import 列表删除（否则 lint/typecheck 会报未使用变量）；`MomentumView`/`ContentOverviewView`/`PlatformView` 三个组件的直接 import 在 `Cockpit.tsx` 里不再需要（改由 `home-pipeline.tsx` 内部 import），同样要删除，但**先全文 grep 一遍确认真的没有其它地方还在用**，不要假设。

**Test：** `Cockpit.tsx` 目前是否有专门的测试文件？先 `find tests -iname "*cockpit*"` 确认。如果存在且断言了 `view==="momentum"`/`"pipeline"` 相关渲染，需要同步更新为 `"home"`；如果没有专门测试（很可能——这种顶层容器组件在这个代码库里似乎主要靠 `view-routing.ts` 的纯函数测试 + 人工走查覆盖，不直接测 `Cockpit.tsx` 本身），则跳过，不需要新建。

- [ ] **Step 1:** `find tests -iname "*cockpit*"` 确认是否存在 `Cockpit.tsx` 的专门测试，读一遍决定是否要改。
- [ ] **Step 2:** 按上面 6 点改 `Cockpit.tsx`（删旧分支、加新分支、改 `onBrandClick`、清理未使用 import）。
- [ ] **Step 3:** `npm run typecheck` 确认没有未使用 import / 类型错误（这一步尤其要认真看，本任务改动面涉及大量 prop 透传，容易漏传或传错类型）。
- [ ] **Step 4:** `npm run test` 全绿。
- [ ] **Step 5:** `npm run dev` 手工走查：打开首页确认默认显示流水线视图（不再是"今日推进"）；点几个平台 tab 确认切换正常且各自的产出区/分发区仍然存在（这是原来 `PlatformView` 自带的，只是搬了位置，功能应该完全没变）；点展开控件确认完整的今日/本周/档期视图能正常打开且可以正常操作（比如拖拽改期）；点侧栏品牌 logo 确认能跳回首页。
- [ ] **Step 6:** commit `feat(cockpit): 十六期 — Cockpit.tsx 接线新首页, 移除旧 momentum/pipeline/platform 分支`

---

### Task 6: 内容详情页重贴皮

**Files:**
- Modify: `src/components/cockpit/content-detail.tsx`（仅 JSX className，不动第 400-1085 行状态管理区）
- Modify: `src/components/cockpit/stage-stepper.tsx`

**约束（重申 Global Constraints）：** 只替换 className/内联 style 为 Task 1 的新 token/基础类，不改任何 `useState`/`useEffect`/事件处理函数的函数体，不改任何 prop 的传递关系。

**具体改法：**
1. `.drawer-section`/`.section-title-row` 等容器 class（`content-detail.tsx` 里 7 个 `activeTab === "X"` 分支共用的包装元素）保留原 class 名不改（避免破坏可能依赖这些 class 名的现有 CSS 选择器/测试），但在 `cockpit.css` 里找到这些 class 的现有样式定义，把手写的 padding/border/圆角数值替换成 Task 1 的新 token（`var(--space-md)`/`var(--radius-md)` 等），必要时新增 `border:1px solid var(--line)` 让它们视觉上向 `.card-minimal` 靠拢——**这一步主要发生在 `cockpit.css`，不是 `content-detail.tsx` 本身**，除非某处是内联 `style={{...}}` 写死的数值（若有，直接改成对应 CSS 变量）。
2. `.checklist`（`content-detail.tsx:1109/1112`）、`.review-block`（`1115`）等清单/卡片类样式同样在 `cockpit.css` 里找到定义调整 token。
3. `stage-stepper.tsx` 的步骤条视觉（圆点/连线/当前态放大高亮）同样只调整 `cockpit.css` 里对应的样式规则，不改 `stage-stepper.tsx` 组件本身的逻辑代码（除非纯粹是内联 style 数值，同上处理）。

**Test：** 不新增测试。跑一遍现有 `tests/components/cockpit/content-detail*.test.ts`（若存在）确认全绿，证明没有动到状态逻辑。

- [ ] **Step 1:** `find tests -iname "*content-detail*" -o -iname "*stage-stepper*"` 确认现有测试文件，跑一遍记录基线（多少个测试全绿）。
- [ ] **Step 2:** 在 `cockpit.css` 里定位 `.drawer-section`/`.section-title-row`/`.checklist`/`.review-block`/步骤条相关（`.stage-stepper`/`.stage-status-track` 等，具体类名以 `stage-stepper.tsx` 实际渲染用到的为准）现有样式规则，逐条把手写数值替换成 Task 1 新 token。
- [ ] **Step 3:** `npm run dev` 打开一条内容详情页，过一遍全部 7 个步骤 tab（含 AI 自动生成模式的"生成成片"面板），确认视觉变化符合预期（留白变大、边框变细）且没有任何交互失效。
- [ ] **Step 4:** Step 1 记录的测试基线重新跑一遍，确认数量和通过率完全一致（证明零回归）。
- [ ] **Step 5:** `npm run typecheck && npm run test` 全绿。
- [ ] **Step 6:** commit `style(cockpit): 十六期 — 内容详情页套用视觉基线`

---

### Task 7: 账号定位页重贴皮

**Files:**
- Modify: `src/components/cockpit/views/positioning.tsx`（如有必要的 className 调整；大概率改动主要在 `cockpit.css`）
- 关联组件（如需要）：`src/components/cockpit/settings-cards/{experience-card,persona-card,style-profile-card,voice-card}.tsx` —— 这四个卡片组件`positioning.tsx`顶部注释明确写着"不重写卡片本体，只换挂载位置"，本次同理：**不改这四个文件的组件逻辑**，只在 `cockpit.css` 里调整它们渲染出来的容器 class 对应的样式规则。

- [ ] **Step 1:** `find tests -iname "*positioning*"` 确认现有测试，跑一遍记录基线。
- [ ] **Step 2:** 在 `cockpit.css` 里定位这个页面用到的容器 class，替换数值为 Task 1 新 token。
- [ ] **Step 3:** `npm run dev` 走查账号定位页（体系报告 + 人物志卡 + 经历库卡 + Persona 卡 + 语言风格卡），确认视觉变化且交互不受影响。
- [ ] **Step 4:** 基线测试重新跑一遍确认一致；`npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `style(cockpit): 十六期 — 账号定位页套用视觉基线`

---

### Task 8: 灵感库选题页重贴皮

**Files:**
- Modify: `src/components/cockpit/views/inspirations.tsx`（如有必要）+ `cockpit.css`

- [ ] **Step 1:** `find tests -iname "*inspiration*"` 确认现有测试，跑一遍记录基线。
- [ ] **Step 2:** 在 `cockpit.css` 里定位这个页面用到的容器 class，替换数值为 Task 1 新 token。
- [ ] **Step 3:** `npm run dev` 走查灵感库选题页，确认视觉变化且交互（新建、更新、从灵感创建内容、打开内容）不受影响。
- [ ] **Step 4:** 基线测试重新跑一遍确认一致；`npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `style(cockpit): 十六期 — 灵感库选题页套用视觉基线`

---

### Task 9: 热点雷达页重贴皮

**Files:**
- Modify: `src/components/cockpit/views/radar.tsx`（339 行，本计划里最大的一个独立视图文件，如有必要）+ `cockpit.css`

- [ ] **Step 1:** `find tests -iname "*radar*"` 确认现有测试，跑一遍记录基线。
- [ ] **Step 2:** 在 `cockpit.css` 里定位这个页面用到的容器 class，替换数值为 Task 1 新 token。
- [ ] **Step 3:** `npm run dev` 走查热点雷达页（含未配置空态、条目采纳流程），确认视觉变化且交互不受影响。
- [ ] **Step 4:** 基线测试重新跑一遍确认一致；`npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `style(cockpit): 十六期 — 热点雷达页套用视觉基线`

---

### Task 10: 内容数据分析页重贴皮

**Files:**
- Modify: `src/components/cockpit/views/analytics.tsx` + `src/components/cockpit/views/goals.tsx` + `src/components/cockpit/views/review.tsx`（如有必要）+ `cockpit.css`

**注意：** 这个"侧栏页面"实际横跨三个文件（`analytics.tsx` 是 tab 容器，`goals.tsx`/`review.tsx` 是两个 tab 各自的内容），三个都要走查，不要漏改 `goals.tsx`/`review.tsx` 只改了外层容器。

- [ ] **Step 1:** `find tests -iname "*analytics*" -o -iname "*goals*" -o -iname "*review*"` 确认现有测试（注意排除跟本页面无关的同名文件，如内容详情页里的"复盘"tab 相关测试，确认路径确实指向这三个 views 文件），跑一遍记录基线。
- [ ] **Step 2:** 在 `cockpit.css` 里定位这三个文件用到的容器 class，替换数值为 Task 1 新 token。
- [ ] **Step 3:** `npm run dev` 走查内容数据分析页的目标/复盘两个 tab，确认视觉变化且交互不受影响。
- [ ] **Step 4:** 基线测试重新跑一遍确认一致；`npm run typecheck && npm run test` 全绿。
- [ ] **Step 5:** commit `style(cockpit): 十六期 — 内容数据分析页(目标/复盘)套用视觉基线`

---

### Task 11: 收尾 — 全站走查 + README

**Files:**
- README.md
- 无代码改动（若走查发现真 bug，按先例单独开 fix commit，不与文档改动混在一起）

**走查清单（`npm run dev` 真实点一遍，不是看代码）：**
1. 首页默认展示流水线视图（不再是"今日推进"），顶部摘要条文案数字真实。
2. 点开顶部摘要条展开态，今日/本周/档期三个 tab 都能正常切换和操作（含拖拽改期）。
3. 平台 tab 切换正常，"新建内容"和分发区在具体平台 tab 下仍然存在且能用。
4. 侧栏只剩 4 项（账号定位/灵感库选题/热点雷达/内容数据分析），点击品牌 logo 回到首页。
5. 打开一条内容详情页，7 个 tab 都能正常切换，AI 自动生成模式的"生成成片"面板仍然正常。
6. 旧收藏链接兼容：手动访问 `?view=momentum`、`?view=pipeline`、`?view=platform-douyin` 三种 URL，确认都落到首页（第三种应预选中"抖音"tab）。
7. 深色模式切换正常，新 token 在明暗两态下都不出现颜色断层/看不清的情况。
8. 移动端窄屏（浏览器开发者工具切移动尺寸）确认底部导航 4 项显示正常。

- [ ] **Step 1:** 按上面 8 条走查一遍，记录实际观察；若发现真 bug，单独 fix commit 修复（不是这一步的规划范围，但按先例处理方式记录在案）。
- [ ] **Step 2:** README 补十六期段落：新首页/侧栏结构变化的用户可见说明（不需要写实现细节，写"现在长什么样、怎么用"）。
- [ ] **Step 3:** `npm run typecheck && npm run test && npm run build` 全绿；commit `docs(cockpit): 十六期收尾 — 前端重构走查 + README 对齐`

---

## Self-Review 记录

- **Spec 覆盖：** §1 视觉系统 → Task 1；§2 新首页 → Task 2/4/5；§3 侧栏重排 → Task 3；§4 其余页面改造原则 → Task 6-10；§5 YAGNI 未越界（未改 API/schema，未新增依赖，未做移动端专属设计，未做双视图并存）；§6 风险——`MomentumView` 标题重复已在 spec 里明确接受为过渡态、不强行拆分。
- **类型一致性：** `HomePipelineView` 的 props 类型（Task 4）与 `Cockpit.tsx` 实际拥有的变量（Task 5）逐一对应确认过（`todayEntries`/`overdueEntries`/`momentumPeriod` 等），`resolveInitialHomePlatform` 的返回类型 `ContentPlatformEx | undefined` 与 `HomePipelineView.initialPlatform` 的类型一致。
- **已知不确定点（实施核实记账本）：** `model.ts` 里 `ContentPlatformEx` 的确切导出名需要 Task 2 实施时核实（探查阶段引用过这个类型名但未逐字确认导出语句）；`sidebar.tsx`/`content-detail.tsx`/4 个独立页面各自现有测试文件的具体断言内容需要各任务实施时先读后改，不能凭空假设；`cockpit.css` 里每个页面具体用到哪些 class 名需要实施时现读现改，本计划只给出改造原则和大致定位，不逐一列出每个 class 的改前改后数值（这类"机械替换 token"性质的收尾工作交给实施阶段按 Task 1 已定义的 token 表现读现改，属于合理的执行细节留白，不是需求不明确）。
