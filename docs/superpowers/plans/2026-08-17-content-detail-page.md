# 抖音内容详情页改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"点看板卡片→弹出右拉抽屉（7 个平级标签、硬编码停在概览）"换成"点看板卡片→跳转独立整页（步骤条自动定位当前阶段，录制/剪辑阶段从六幕脚本铺开逐幕指导清单）"。

**Architecture:** 看板列表/拖拽逻辑完全不动；把 `Cockpit.tsx` 里管理 `WorkspaceState` 加载/防抖保存/冲突处理的逻辑抽成共享 hook；新增一个真实 Next.js 路由渲染整页，复用该 hook 拿数据；`content-drawer.tsx` 现有的 700+ 行状态/请求逻辑原样保留，只重做最外层的呈现（抽屉滑出条 → 整页 + 步骤条），录制/剪辑两个 tab 的内容新增六幕稿分支。

**Tech Stack:** 同前（Next.js App Router 客户端组件为主，无新依赖）。

## Global Constraints

- 看板本身（列=阶段、拖拽换阶段、`platform.tsx`/`pipeline.tsx`）**不动**；侧栏 9 项结构**不动**。
- **不新建单条内容的读写 API**——新页面复用现有 `loadWorkspace()`/`saveWorkspace()`（`src/lib/cockpit/storage.ts`，client-side 单例模块状态，同一会话内跨组件安全复用）。这是对已批准 spec（`docs/superpowers/specs/2026-08-17-content-detail-page-design.md` §2）的一处实现细化：spec 提到的"归属校验"改为隐式依赖——`GET /api/v1/cockpit/workspace` 本身已按当前用户会话过滤，前端从加载到的 `state.contents` 里按 `id` 找不到就是"未找到/不属于当前用户"，统一走客户端"未找到该内容"空态，不做服务端 `notFound()`。
- 步骤条**不锁顺序**、不禁用未到达节点——只是展示导航，不触发阶段推进。
- 录制/剪辑阶段：六幕稿显式分岔渲染新清单；非六幕稿/无脚本内容渲染逻辑**一行不改**。
- 每个 Task 结束后 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；UI-only 改动额外做一次 dev 手工走查；尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- `content-drawer.tsx` 现有的所有竞态守卫注释（StrictMode mountedRef、currentItemIdRef、scriptDraftIdRef、itemIntentRef 等）在本计划中**逐字保留**，不得在"顺手清理"的名义下删除或简化——这些都是过去真实 bug 的修复痕迹。

---

## Task 1: 数据字段 + 步骤条状态纯函数

**Files:**
- Modify: `src/lib/cockpit/model.ts`（`ContentItem` 接口，紧跟 `editingNotes: string;` 之后，即第 137 行后）
- Create: `src/lib/cockpit/stage-stepper.ts`
- Test: `tests/lib/cockpit/stage-stepper.test.ts`

**Interfaces (Produces，Task 4/5 消费):**
```ts
// model.ts ContentItem 新增字段（可选，缺省=未打勾，旧数据零迁移）：
recordingActProgress?: Record<string, boolean>; // 键 = ActKey（六幕脚本act名），值 = 是否已录
editingActProgress?: Record<string, boolean>;   // 键 = ActKey，值 = 是否已剪

// stage-stepper.ts
export type StepStatus = 'done' | 'current' | 'upcoming';
export interface StepNode { stage: WorkStage; status: StepStatus }
export function computeStepNodes(flow: WorkStage[], currentStage: ContentStage): StepNode[];
// currentStage 在 flow 中的下标之前 => done；等于 => current；之后 => upcoming。
// currentStage 不在 flow 中（如 'archived' 或已脱离该平台流的脏值）=> 全部按 flow 顺序返回 status 'done'
// （historical 语义，与 StageStatusPanel 现有的 `item.stage === "archived" || stageIndex(item.stage) > stageIndex(stage)`
// 判断口径一致——见 content-drawer.tsx 第 366/382 行 `historical`/`completed` 计算）。
```

**Test:** `computeStepNodes(['topic','script','recording','editing','publishing','review'], 'recording')` → topic/script 为 done，recording 为 current，editing/publishing/review 为 upcoming；`currentStage='archived'` → 全部 done；`currentStage='topic'`（flow 首项）→ topic 为 current，其余 upcoming；`currentStage`（如 'inbox'）不在 flow 中但不是 archived → 全部 upcoming（inbox 排在 flow 所有阶段之前，语义上"还没到"，不是"已完成"——用 `CONTENT_STAGES` 全集下标比较，inbox 下标小于 flow 首项下标）；小红书 3 步 flow（`['topic','script','publishing']`）同样验证一遍首尾边界。

- [ ] Step 1: TDD；commit `feat(cockpit): 六幕录制/剪辑进度字段 + 步骤条状态纯函数`

---

## Task 2: 抽出共享 workspace 状态 hook

**Files:**
- Create: `src/lib/cockpit/use-workspace-state.ts`
- Modify: `src/components/cockpit/Cockpit.tsx`（第 527-529 行状态声明、第 543-545 行 `loadedStateRef`、第 559-576 行 `refreshWorkspace`，第 565-576 行加载 effect，第 607-622 行防抖保存 effect —— 全部迁入新 hook，`Cockpit.tsx` 换成调用它）

**Interfaces (Produces，Task 3 消费):**
```ts
// use-workspace-state.ts
export interface UseWorkspaceStateResult {
  state: WorkspaceState;
  setState: React.Dispatch<React.SetStateAction<WorkspaceState>>;
  hydrated: boolean;
  showOnboarding: boolean;
  setShowOnboarding: (value: boolean) => void;
  conflicted: boolean;
  refreshWorkspace: () => Promise<void>;
}
// onLoadError/onSaveError 由调用方传入，供 toast 提示（Cockpit.tsx 传 setToast，
// 新整页页面组件传自己的 notify）——hook 本身不依赖具体 UI 反馈机制。`createDemoState`
// 原是 Cockpit.tsx 内部函数（原第 258 行 `function createDemoState(): WorkspaceState`，
// 未导出），随本次搬迁一并移进这个新文件并导出（新页面组件构造初始 state 时需要它，
// 不应在两处各写一份）。
export function createDemoState(): WorkspaceState; // 函数体从 Cockpit.tsx:258 原样搬来，不改逻辑
export function useWorkspaceState(
  opts: { onLoadError?: (message: string) => void; onSaveError?: (message: string) => void },
): UseWorkspaceStateResult; // 内部用 useState<WorkspaceState>(() => createDemoState()) 做初始值，调用方不用再传 initialState
```

这是**行为保留型重构**——把现状原样搬进新文件，不改任何时序/判断逻辑。当前 `Cockpit.tsx` 里的原样代码（供对照，搬迁时逐行核对）：

```tsx
// 加载 effect（原第 565-576 行，其中 setTheme("light") 一行不搬——见下方"不搬"说明）：
useEffect(() => {
  loadWorkspace()
    .then((stored) => {
      if (stored) {
        loadedStateRef.current = stored;
        setState(stored);
      }
      else setShowOnboarding(true);
    })
    .catch(() => setToast("本地数据读取失败，已先使用当前数据。")) // 换成 opts.onLoadError?.(...)
    .finally(() => setHydrated(true));
}, []);

// 防抖保存 effect（原第 607-622 行）：
useEffect(() => {
  if (!hydrated || showOnboarding || conflicted) return;
  if (state === loadedStateRef.current) return; // 跳过刚加载完那次的 echo-save
  const timer = window.setTimeout(() => {
    saveWorkspace(state).catch((err) => {
      if (err instanceof ConflictError) {
        setConflicted(true);
        return;
      }
      setToast("自动保存失败，请检查网络后重试。"); // 换成 opts.onSaveError?.(...)
    });
  }, 250);
  return () => window.clearTimeout(timer);
}, [state, hydrated, showOnboarding, conflicted]);
```

**不搬进 hook 的部分**（留在 `Cockpit.tsx`，与 workspace 数据无关）：`document.title = workspaceTitle` effect、`theme`/`designStyle` 相关的另外两个 effect（第 583-599 行）。`refreshWorkspace`（原第 559-576 行）逐字迁入 hook，签名不变。

原加载 effect 里 `setTheme("light")`（第 571 行）这一行是 Cockpit.tsx 专属的主题副作用（新整页不需要跟随这个逻辑，它有自己的主题继承方式，同现有 `.dark`/`data-theme` 全局样式机制），不搬进 hook。改为在 `Cockpit.tsx` 里新增一个独立小 effect，监听 hook 返回的 `hydrated`/`state.designStyle`，在首次变为 `hydrated` 时补上同样的行为：
```tsx
useEffect(() => {
  if (hydrated && state.designStyle !== "editorial") setTheme("light");
}, [hydrated]); // 只在 hydrated 从 false→true 那一刻触发一次，与原逻辑等价（原本也只在加载完成的回调里判断一次）
```

**Step 1（无法写新单元测试的说明）：** 这是纯浏览器副作用重构（`fetch`/`setTimeout`/DOM），仓库现无组件渲染测试基建（同十三期 Task 5 先例）。验证方式：①`npm run typecheck && npm run test` 全绿（现有测试不依赖这段代码的具体位置，只要类型和其余逻辑不受影响即可全绿）；②`npm run dev` 手工走查：打开首页确认能正常加载 workspace、编辑任意字段后等待 1 秒左右确认自动保存无报错（Network 面板看到 PUT 请求）、开两个标签页制造 409 冲突确认仍能正确弹出冲突提示。

- [ ] Step 1: 按上方代码块把加载 effect + 防抖保存 effect + 相关 state/ref 原样迁入 `use-workspace-state.ts`，`Cockpit.tsx` 改为调用 `useWorkspaceState`
- [ ] Step 2: `npm run typecheck && npm run test`，确认全绿（无新增失败）
- [ ] Step 3: `npm run dev` 手工走查（加载/自动保存/双标签页冲突三项，见上）
- [ ] Step 4: commit `refactor(cockpit): 抽出共享 workspace 状态 hook`

---

## Task 3: 新路由 + 导航接线（沿用现有抽屉外观）

**Files:**
- Create: `src/app/content/detail/[id]/page.tsx`
- Create: `src/components/cockpit/content-detail-client.tsx`
- Modify: `src/components/cockpit/Cockpit.tsx`（`openContent` 函数，第 695 行起；删除 `selectedId`/`selectedTab` state 与第 1178 行的 `<ContentDrawer>` 渲染）

**Interfaces:**
- Consumes: Task 2 的 `useWorkspaceState`；现有 `ContentDrawer`（`content-drawer.tsx`，本 Task 不改它）
- Produces: 无（本 Task 只接线路由与导航，UI 外观留到 Task 4）

**说明：** 这一步只解决"点卡片之后去哪、数据从哪来"，先用**完全未修改**的 `<ContentDrawer>` 组件渲染出来（暂时还是抽屉的视觉外观，`initialTab` 用步骤条要用的默认阶段算出来），把最容易出错的路由/数据/多处调用点改动跟视觉重做（Task 4）分开验证，降低单个 task 的出错面。

`src/components/cockpit/content-detail-client.tsx`（新建，客户端组件，承接 `page.tsx` 传入的 `id`）：

```tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useWorkspaceState } from "@/lib/cockpit/use-workspace-state";
import { stageFlowFor } from "@/lib/cockpit/platform-stages";
import { transitionContentStage } from "@/lib/cockpit/workflow"; // 与 Cockpit.tsx 同一个纯函数导入源
import { todayISO } from "@/lib/cockpit/calculations";
import { ContentDrawer, type ContentDrawerTab } from "./content-drawer";
import type { WorkStage, ContentItem, ContentStage } from "@/lib/cockpit/model";

const STAGE_TO_TAB: Record<WorkStage, ContentDrawerTab> = {
  topic: "topic", script: "script", recording: "recording",
  editing: "editing", publishing: "publish", review: "review",
};

export function ContentDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, setState, hydrated } = useWorkspaceState({
    onLoadError: () => {},
    onSaveError: () => {},
  });
  const item = useMemo(() => state.contents.find((c) => c.id === id) ?? null, [state.contents, id]);

  if (!hydrated) return <p className="muted">加载中…</p>;
  if (!item) return <div className="page"><p className="muted">没有找到这条内容，可能已被删除。</p><a href="/">返回看板</a></div>;

  const stepParam = searchParams.get("step");
  const flow = stageFlowFor(item.platform);
  const defaultStage = flow.includes(item.stage as WorkStage) ? (item.stage as WorkStage) : flow[0];
  const initialTab: ContentDrawerTab = stepParam && stepParam in STAGE_TO_TAB
    ? STAGE_TO_TAB[stepParam as WorkStage]
    : STAGE_TO_TAB[defaultStage];

  const [toast, setToast] = useState("");

  // 下面每个函数都是从 Cockpit.tsx 对应同名函数搬来的**故意保留的独立副本**
  // （不抽共享模块）——这些函数把校验/toast提示/setState 混在一起，不是纯
  // `(state, args) => state` 函数，抽共享层需要先拆分校验与状态变更两层，
  // 属于超出本计划范围的重构；Cockpit.tsx 是这些逻辑的唯一真源，出现行为分歧时
  // 以 Cockpit.tsx 为准同步过来（同 content-drawer.tsx 里 `linkCockpitContent`
  // 与旧路由逻辑重复未抽共享的先例，见该文件相关注释）。搬运时把 `setToast` 换成
  // 本文件顶部这个局部 toast state，`setSelectedId(null)`（仅 deleteContent 里有，
  // Cockpit.tsx 原第 705 行）换成 `router.push('/?view=platform-' + item.platform)`。

  function updateItem(patch: Partial<ContentItem>) { // 对照 Cockpit.tsx:656-661 updateContent
    setState((prev) => ({ ...prev, contents: prev.contents.map((c) => c.id === item.id ? { ...c, ...patch, updatedAt: todayISO() } : c) }));
  }
  function mergeScriptField(partial: Partial<ContentItem["script"]>) { // 对照 Cockpit.tsx:669-680 mergeScript（读取回填时刻最新 item.script，不是闭包旧值——原函数体内部逻辑照抄）
    setState((prev) => ({ ...prev, contents: prev.contents.map((c) => c.id === item.id ? { ...c, script: { ...c.script, ...partial }, updatedAt: todayISO() } : c) }));
  }
  function changeStage(stage: ContentStage) { // 对照 Cockpit.tsx 里 changeStage={(stage) => setState((prev) => transitionContentStage(prev, selected.id, stage, date))}（第 1178 行内联），复用同一个 transitionContentStage 纯函数
    setState((prev) => transitionContentStage(prev, item.id, stage, todayISO()));
  }
  // setStageStatus/planStage(schedule)/clearStagePlan(unschedule)/deleteContent(remove)/
  // markPublished/unmarkPublished/saveReview 七个函数体分别对照 Cockpit.tsx:940-963/
  // 829-838/840-848/700-706/1003-1023/1029-1040附近/1061-1072，逐个复制到这里，
  // 函数签名去掉 contentId/item 参数（本文件只有一个 item，直接闭包引用），
  // setToast 换成本文件的 toast state，deleteContent 额外把
  // `setSelectedId(null)` 换成 `router.push('/?view=platform-' + item.platform)`。
  // 这些函数体额外用到的纯函数都从 Cockpit.tsx 同款来源导入：
  // canScheduleStage/removeStageEvent/scheduleStageForDate/setContentStageCompletion/
  // completedPublishingEvents 来自 "@/lib/cockpit/workflow"（同上面 transitionContentStage
  // 那个 import 语句，一并加进来）；deleteContentFromWorkspace/completeContentReview
  // 来自 "@/lib/cockpit/workspace"。

  return <ContentDrawer
    item={item}
    initialTab={initialTab}
    stageEvents={state.stageEvents}
    stageColors={state.stageColors}
    contentTypes={state.contentTypes}
    close={() => router.push(`/?view=platform-${item.platform}`)}
    update={updateItem}
    mergeScript={(_id, partial) => mergeScriptField(partial)}
    changeStage={changeStage}
    // setStageStatus/schedule/unschedule/remove/markPublished/unmarkPublished/
    // saveReview 按上面注释里列出的 Cockpit.tsx 行号逐个实现后传入，签名与
    // ContentDrawer props 类型（content-drawer.tsx:397 那一整行的类型标注）逐项对齐。
    ruleDeposited={Boolean(item.review.learnedRule.trim() && state.insightRules.some((rule) => rule.sourceContentId === item.id && rule.text === item.review.learnedRule.trim()))}
    addRule={(text) => { // 对照 Cockpit.tsx 第 1178 行内联的 addRule 箭头函数逐字复制，setToast 换成本文件 toast state
      const normalized = text.trim();
      if (!normalized) return;
      setState((prev) => {
        const existing = prev.insightRules.find((rule) => rule.sourceContentId === item.id && rule.text === normalized);
        if (existing) return { ...prev, insightRules: prev.insightRules.map((rule) => rule.id === existing.id ? { ...rule, active: true } : rule) };
        const rule = { id: crypto.randomUUID(), text: normalized, sourceContentId: item.id, createdAt: todayISO(), active: true };
        return { ...prev, insightRules: [rule, ...prev.insightRules] };
      });
      setToast("已沉淀为内容规则");
    }}
    notify={setToast}
  />;
}
```

**`src/app/content/detail/[id]/page.tsx`（新建，服务端组件外壳）：**

```tsx
import { ContentDetailClient } from "@/components/cockpit/content-detail-client";

export default async function ContentDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ContentDetailClient id={id} />;
}
```

**`Cockpit.tsx` 改动：**
- 删除 `selectedId`/`selectedTab` 两个 `useState`（原第 527-528 行）。
- `openContent(id, tab)`（原第 695 行）改为：
  ```tsx
  function openContent(id: string, tab?: ContentDrawerTab) {
    const stepQuery = tab && tab !== "overview" ? `?step=${TAB_TO_STAGE[tab]}` : "";
    router.push(`/content/detail/${id}${stepQuery}`);
  }
  ```
  （`TAB_TO_STAGE` 是 `STAGE_TO_TAB` 的反向映射，与 `content-detail-client.tsx` 里那份保持一致——两处都需要，建议把这两个映射表一并放进 `src/lib/cockpit/platform-stages.ts` 或新建 `src/lib/cockpit/stage-tab-map.ts` 导出共用，不要各写一份。）
- `Cockpit.tsx` 顶部加 `import { useRouter } from "next/navigation";`，函数体内 `const router = useRouter();`。
- 删除第 1178 行 `<ContentDrawer .../>` 整段渲染，以及它专属的 `scriptDraftIdOverrides`/`setScriptDraftIdOverrides` 状态（若确认这两个 state 只被这段渲染消费——搜索确认后再删，若还被其它地方引用则保留）。

**Step 1（无自动化测试，UI 路由改动）：**
- [ ] `npm run typecheck && npm run test` 全绿
- [ ] `npm run dev` 走查：①从抖音看板点一张卡片，确认跳转到 `/content/detail/<id>`，抽屉外观内容与之前一致可编辑 ②刷新页面，内容仍在（不再是空白） ③从「今日推进」/「灵感库」/「内容数据分析·复盘」几个入口点开内容，确认都能正确跳转且（review 入口）着陆在复盘 tab ④点"关闭"按钮返回对应平台看板页
- [ ] commit `feat(cockpit): 新增内容详情整页路由, 沿用现有抽屉视图接线`

---

## Task 4: 抽屉外观改造为整页 + 步骤条

**Files:**
- Modify: `src/components/cockpit/content-drawer.tsx` → 改名为 `src/components/cockpit/content-detail.tsx`（`git mv`），导出组件 `ContentDrawer` → `ContentDetailView`
- Modify: `src/components/cockpit/content-detail-client.tsx`（更新导入路径与组件名）
- Create: `src/components/cockpit/stage-stepper.tsx`

**Interfaces:**
- Consumes: Task 1 的 `computeStepNodes`
- Produces: `ContentDetailView` 组件（供 Task 3 已建好的 `content-detail-client.tsx` 使用）

**说明：** 只改 `content-detail.tsx`（原 `content-drawer.tsx`）文件末尾的渲染部分（原第 1083-1097 行，`return <div className="drawer-backdrop">...`），从 `const [tab, setTab] = useState<ContentDrawerTab>(initialTab);`（原第 398 行）到 `visibleTabs`/`activeTab` 计算（原第 1076-1082 行）之间的 700 行**逐字不动**——只是这个文件里最外层的容器 JSX 换掉。

**Step 1：** 新建 `src/components/cockpit/stage-stepper.tsx`：

```tsx
"use client";

import type { WorkStage } from "@/lib/cockpit/model";
import { computeStepNodes } from "@/lib/cockpit/stage-stepper";
import { stageLabelFor } from "@/lib/cockpit/platform-stages";

export function StageStepper({ platform, flow, currentStage, activeStage, onSelect }: {
  platform: string;
  flow: WorkStage[];
  currentStage: string;
  activeStage: WorkStage | "overview";
  onSelect: (stage: WorkStage | "overview") => void;
}) {
  const nodes = computeStepNodes(flow, currentStage as never);
  return <div className="stage-stepper">
    <button type="button" className={`stage-stepper-overview ${activeStage === "overview" ? "active" : ""}`} onClick={() => onSelect("overview")}>概览</button>
    <div className="stage-stepper-track">
      {nodes.map((node, idx) => <div key={node.stage} className="stage-stepper-item-wrap">
        <button
          type="button"
          className={`stage-stepper-node ${node.status} ${activeStage === node.stage ? "active" : ""}`}
          onClick={() => onSelect(node.stage)}
          aria-current={activeStage === node.stage ? "step" : undefined}
        >
          <span className="stage-stepper-dot">{node.status === "done" ? "✓" : ""}</span>
          <span className="stage-stepper-label">{stageLabelFor(platform, node.stage)}</span>
        </button>
        {idx < nodes.length - 1 ? <span className={`stage-stepper-line ${node.status === "done" ? "done" : ""}`} /> : null}
      </div>)}
    </div>
  </div>;
}
```

- [ ] Step 2: 在 `content-detail.tsx` 里，把 `const [tab, setTab] = useState<ContentDrawerTab>(initialTab);` 改为 `const [tab, setTab] = useState<ContentDrawerTab>(initialTab); // 打开时的初始 tab 已经由 content-detail-client.tsx 算好（当前阶段或 ?step= 覆盖), 这里不再需要额外逻辑`（其实不用改这一行，`initialTab` 的计算已经在 Task 3 的调用方做了）
- [ ] Step 3: 把原第 1083 行的 `<div className="drawer-backdrop" onMouseDown={...}><aside className="drawer" aria-label="内容详情"><header className="drawer-header">...</header><div className="drawer-tabs">{visibleTabs.map(...)}</div><div className="drawer-body">` 替换为：
  ```tsx
  return <div className="page content-detail-page">
    <div className="content-detail-header">
      <a className="text-button" href={`/?view=platform-${item.platform}`}>← 返回看板</a>
      <div className="drawer-badges"><Badge tone={item.stage} color={stageColors[item.stage]}>{stageLabelFor(item.platform, item.stage)}</Badge><Badge tone={`tier-${item.tier.toLowerCase()}`}>{item.tier}档</Badge></div>
      <input className="drawer-title" value={item.title} onChange={(e) => update({ title: e.target.value })} />
    </div>
    <StageStepper platform={item.platform} flow={stageFlowFor(item.platform)} currentStage={item.stage} activeStage={activeTab === "overview" ? "overview" : (TAB_STAGE[activeTab] as WorkStage)} onSelect={(stage) => setTab(stage === "overview" ? "overview" : (Object.entries(TAB_STAGE).find(([, s]) => s === stage)?.[0] as ContentDrawerTab))} />
    <div className="content-detail-body">
  ```
  并把原第 1097 行结尾的 `</div></aside></div>;` 改为 `</div></div>;`（少两层容器，其余 `close`/`onMouseDown` 相关的 backdrop 点击关闭逻辑一并删除——整页没有"点击背景关闭"这个概念）。
- [ ] Step 4: `close` prop 不再被这个文件内部调用（原本挂在头部关闭按钮上），从 `ContentDetailView` 的 props 类型里删除 `close`；`content-detail-client.tsx` 里也删除传入的 `close` 属性（改用header里的返回链接，Task 3 已经写了 `close={...}` 传参，这里同步去掉）。
- [ ] Step 5: `npm run typecheck && npm run test` 全绿
- [ ] Step 6: `npm run dev` 走查：整页打开一条内容，看到顶部步骤条，点当前阶段之外的节点能正常切换内容区，刷新页面步骤条仍然定位在正确阶段
- [ ] Step 7: commit `feat(cockpit): 内容详情页改为步骤条整页呈现`

---

## Task 5: 录制 / 剪辑阶段六幕逐幕指导清单

**Files:**
- Modify: `src/components/cockpit/content-detail.tsx`（原第 1092-1093 行的 `recording`/`editing` tab 内容）
- Create: `src/components/cockpit/six-act-guide-panel.tsx`
- Test: `tests/lib/cockpit/six-act-guide.test.ts`（若拆出纯函数）

**Interfaces:**
- Consumes: Task 1 的 `recordingActProgress`/`editingActProgress` 字段；十三期 `isSixActScript`/`ACT_LABELS`（`@/lib/script/six-act`）
- Produces: 无（叶子组件）

**Step 1（TDD，先写纯函数）：** 在 `src/lib/cockpit/six-act-guide.ts` 新增：
```ts
import type { ScriptAct } from "@/lib/script/six-act";

export interface ActGuideRow { act: ScriptAct; done: boolean }

export function buildActGuideRows(acts: ScriptAct[], progress: Record<string, boolean> | undefined): ActGuideRow[] {
  return acts.map((act) => ({ act, done: Boolean(progress?.[act.act]) }));
}
```
测试（`tests/lib/cockpit/six-act-guide.test.ts`）：6 幕全部返回、`progress` 为 `undefined` 时全部 `done: false`、部分幕标记为 `true` 时逐条对应正确、`progress` 含多余不存在的 act key 时被忽略（不产生第 7 行）。

- [ ] 写测试 → 跑测试确认失败 → 实现 → 跑测试确认通过

**Step 2：** 新建 `src/components/cockpit/six-act-guide-panel.tsx`：
```tsx
"use client";

import { ACT_LABELS, type ScriptAct } from "@/lib/script/six-act";
import { buildActGuideRows } from "@/lib/cockpit/six-act-guide";

export function SixActGuidePanel({ acts, progress, onToggle, mode }: {
  acts: ScriptAct[];
  progress: Record<string, boolean> | undefined;
  onToggle: (actKey: string, done: boolean) => void;
  mode: "recording" | "editing";
}) {
  const rows = buildActGuideRows(acts, progress);
  return <div className="six-act-guide-panel">
    {rows.map(({ act, done }) => {
      const beats = Array.isArray(act.beats) ? act.beats : [];
      return <div key={act.act} className={`six-act-guide-card ${done ? "done" : ""}`}>
        <div className="script-section-head">
          <strong>{ACT_LABELS[act.act] ?? act.act}{typeof act.targetSec === "number" ? ` · ${act.targetSec}s` : ""}</strong>
        </div>
        <p className="script-section-text">{act.narration}</p>
        {act.visual ? <p className="script-act-meta"><span>配图建议：</span>{act.visual}</p> : null}
        {act.note ? <p className="script-act-meta"><span>备注：</span>{act.note}</p> : null}
        {beats.length > 0 ? <div className="script-act-beats">{beats.map((beat, idx) => <span key={idx} className="script-act-chip">{beat.keyword}</span>)}</div> : null}
        <label className="six-act-guide-checkbox"><input type="checkbox" checked={done} onChange={(e) => onToggle(act.act, e.target.checked)} />{mode === "recording" ? "这一幕录完了" : "这一幕剪完了"}</label>
      </div>;
    })}
  </div>;
}
```

- [ ] Step 3: 在 `content-detail.tsx` 里，`recording`/`editing` 两个 `activeTab` 分支各自加一层判别——原内容整体包一层 `sixActScript ? <SixActGuidePanel ... /> : <原有 JSX 不变>`：
  ```tsx
  {activeTab === "recording" ? <div className="drawer-section"><div className="stage-detail-strip"><span>录制阶段</span><Badge tone="recording" color={stageColors.recording}>录制</Badge><small>完成后进入剪辑</small></div><StageScheduleField item={item} stage="recording" stageEvents={stageEvents} schedule={schedule} unschedule={unschedule} />{sixActScript ? <SixActGuidePanel acts={sixActScript.acts} progress={item.recordingActProgress} mode="recording" onToggle={(actKey, done) => update({ recordingActProgress: { ...item.recordingActProgress, [actKey]: done } })} /> : <><label className="field full"><span>录制备注</span><textarea className="large" value={item.recordingNotes} onChange={(e) => update({ recordingNotes: e.target.value })} placeholder="记录机位、口播、录屏、演示路径和补拍素材…" /></label><div className="checklist"><strong>录制完成清单</strong>{["机位与画面可用", "收音清晰", "口播或演示路径完整", "必要素材与补拍镜头齐全"].map((text) => <label key={text}><input type="checkbox" />{text}</label>)}</div></>}</div> : null}
  ```
  （`editing` 分支同理，`item.editingNotes`/`editingActProgress`/`mode="editing"`，checklist 文案不变：`["开头 5 秒直接进入场景", "案例或演示重点清楚", "字幕清楚可读", "封面与标题已确认", \`${item.tier}档制作投入已控制\`]`）
- [ ] Step 4: `npm run typecheck && npm run test` 全绿
- [ ] Step 5: `npm run dev` 走查：①打开一条已生成六幕脚本的内容，切到录制/剪辑步骤，看到逐幕清单、勾选后刷新页面勾选状态保留 ②打开一条没有脚本或旧三段式脚本的内容，录制/剪辑仍是原来的空白备注框
- [ ] Step 6: commit `feat(cockpit): 录制/剪辑阶段六幕逐幕指导清单`

---

## Task 6: 样式 + 收尾走查

**Files:**
- Modify: `src/app/cockpit.css`（新增 `.stage-stepper*`/`.six-act-guide-panel*`/`.content-detail-*` 相关样式，参照文件内已有 `.panel`/`.script-act-card`/`.lint-strip` 等既有类名的写法与设计变量，无彩色 emoji）

**Interfaces:** 无（纯样式）

- [ ] Step 1: 补齐步骤条（圆点/连线/已完成绿色 `--ok-color` 或既有绿色变量/当前金色 `--gold`/未到灰色）、六幕指导卡片、整页顶部 header 的样式，跑 `npm run dev` 走查明暗两种主题下的视觉效果
- [ ] Step 2: 全链路真实走查（无 mock）：①从每一个已知会调用 `openContent` 的入口（抖音看板、今日推进、灵感库"已转为内容"、内容数据分析"待复盘"）分别点开一条内容，确认都落地在正确页面/正确步骤 ②在整页里完成一次"改标题→切到脚本步骤生成六幕稿→切到录制步骤勾选 2 幕→刷新页面确认都保留" ③打开一条库里已有的旧三段式内容，确认录制/剪辑仍是旧渲染、能正常编辑保存 ④删除一条测试用内容（"删除此内容"按钮），确认返回看板后卡片消失
- [ ] Step 3: `npm run typecheck && npm run test && npm run build` 全绿
- [ ] Step 4: 更新 `README.md`：在合适的十四期相关段落（若无则新增）说明"内容详情已从抽屉改为整页 + 步骤条，录制/剪辑阶段对六幕稿有逐幕指导清单"
- [ ] Step 5: commit `docs(cockpit): 内容详情整页收尾, README 对齐`

---

## Self-Review 记录

- Spec 覆盖：§0 决策表（看板不动/整页路由/步骤条自动定位不锁顺序/六幕指导/复用现有数据加载）逐条对应 Task 3/4/5 ✓；§1 现状问题（硬编码 overview/平级 tab/录制剪辑空壳）Task 3-5 修复 ✓；§2 路由与数据加载（真实路由+复用整仓库加载，本计划把"归属校验"细化为隐式依赖并在 Global Constraints 里说明偏离原因）✓；§3 步骤条 Task 1+4 ✓；§4 六幕指导 Task 5 ✓；§5 发布/复盘不改动——本计划 Task 3/4 只搬运容器，不碰这两个 tab 内部 JSX ✓；§6 数据结构 Task 1 ✓；§7 YAGNI 未越界（未新建 API、未碰侧栏/看板、未碰 AI 视频引擎）✓；§8 风险——共享 hook 抽取风险对应 Task 2 的"逐行核对+手工走查"、新旧路由混淆风险对应 Task 3 走查项、打勾字段与旧字段并存风险 Task 1 已限定影响面、步骤条与阶段推进解耦风险 Task 4 步骤条 onSelect 只调 `setTab` 不调 `changeStage` ✓。
- 类型一致性：`ContentDrawerTab`（`content-detail.tsx` 原名保留，未改名）与 `WorkStage` 之间的映射表——Task 3 引入的 `STAGE_TO_TAB`/`TAB_TO_STAGE`（`content-detail-client.tsx`/`Cockpit.tsx` 共用一份）与 `content-detail.tsx` 内部原有的 `TAB_STAGE`（原 content-drawer.tsx 第 1076 行，属于"逐字不动"的 700 行范围内）是同一张映射表的三份独立小拷贝——刻意不合并：合并需要跨越 Task 4"逐字不动"的保护边界，静态的 6 条目映射表出错代价低、改动频率也低，接受这一处小重复换取改动面更小。
- 已知不确定点（实施核实记账本）：`scriptDraftIdOverrides`/`setScriptDraftIdOverrides` 状态是否只被 Cockpit.tsx 第 1178 行的 `<ContentDrawer>` 渲染消费——Task 3 删除该渲染时需要先搜索确认没有其它消费点，若有则保留该 state、只删渲染那一行；`content-detail-client.tsx` 里 `scriptDraftIdOverride`/`onScriptDraftLinked` 这两个 `ContentDrawer` prop 本次先传 `undefined`/不传（新整页每次都是全新挂载，不存在"同一浏览器会话内抽屉不关闭直接切换 item"的场景，原注释里描述的覆盖表问题不适用于整页——`item.scriptDraftId` 服务端字段本身已经够用）。
