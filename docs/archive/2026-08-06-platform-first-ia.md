# 产出优先信息架构重组 (cockpit 三期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏重组为 灵感库选题 / 今日推进(今日·本周·档期) / 创作(抖音·小红书·bilibili·X·YouTube 五个平台流水线页) / 内容总览 / 内容数据分析(目标+复盘) / 设置；`CockpitContent` 增加 `platform` 字段；机制层（抽屉/409/生成/爬虫）零改动。Spec: `docs/superpowers/specs/2026-08-06-platform-first-ia-design.md`。

**Architecture:** 本期是**视图重挂 + 一个数据字段**：现有视图组件本体尽量不改，改的是「挂在哪、怎么进」。平台页 = 参数化复用的看板（platform 过滤 prop）+ 产出区 + 分发区。NavView 联合类型扩展平台项；侧栏改为固定分组结构（去掉拖拽排序——spec 已允许）。这是 vendor 纯函数层移植后的**第一次主动演化**（platform 字段），改动面刻意最小。

**Tech Stack:** 同前（Next 14.2 / React 18 / Prisma 5.22 db push / vitest / cockpit CSS 字形语言）。

## Global Constraints

- **禁用彩色 emoji**：所有新 UI 用 cockpit 单色字形（✣ ◫ ▦ ◎ ▸ 等既有气质字符）或纯文字。
- 平台键统一：`'douyin' | 'xiaohongshu' | 'bilibili' | 'x' | 'youtube' | 'gongzhonghao'`（后三个新增到类型层；`gongzhonghao` 保留但不进侧栏）。UI 文案：抖音/小红书/bilibili/X/YouTube。全能力平台 = douyin、xiaohongshu；基础能力 = bilibili、x、youtube。
- vendor 层改动仅限本计划明列的字段级演化；每处在代码注释标 `三期 IA 演化`。视图合并 = 重挂不重写：momentum/schedule/goals/review 组件本体逻辑不改。
- 看板复用禁止复制：平台看板与内容总览共用同一组件，差异只经 props。
- cockpit state 改动一律走既有防抖保存管线；服务端直写必须 `bumpCockpitRev`（本期预计无新增直写）。
- 每 Task 结束 `npm run typecheck && npm run test` 过后 commit（涉及路由/构建的加 `npm run build`）；commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 旧 `?view=` 值全部可达（映射表见 Task 6），不许 404/死胡同。

---

## Task 1: platform 字段 — 类型、schema、组装、默认

**Files:**
- Modify: `src/lib/cockpit/model.ts`（`ContentItem` 增 `platform: ContentPlatformEx`；新导出 `CONTENT_PLATFORMS`/`PLATFORM_LABELS`；`ContentPlatformEx` 类型 = 六平台联合——若 `@/lib/platform` 的 `ContentPlatform` 仅三平台则在 model.ts 定义扩展联合并注释关系）
- Modify: `prisma/schema.prisma`（`CockpitContent` 增 `platform String @default("douyin")` + `@@index([userId, platform])`）
- Modify: `src/lib/cockpit/server-store.ts`（GET 组装带出 platform；save upsert 写入 platform）
- Modify: `src/components/cockpit/Cockpit.tsx`（`createContent`/blank 内容构造处默认 `platform: profile.primaryPlatform 映射 ?? 'douyin'`——查该构造函数实际位置；灵感转内容同样带默认）
- Test: 扩展 `tests/api/cockpit/workspace.test.ts`（platform 组装/写回断言）；`tests/lib/cockpit/` 受影响用例补 platform 字段

**Interfaces:**
- Produces: `ContentItem.platform`（必填，服务端组装对缺失行回退 `'douyin'`）；Prisma 列默认值使存量行自动为 douyin（无需迁移脚本）。Task 2/5/6 依赖 `CONTENT_PLATFORMS`（侧栏顺序：douyin, xiaohongshu, bilibili, x, youtube）与 `PLATFORM_LABELS`。

- [ ] Step 1: 类型与常量 + schema + `npm run db:push`
- [ ] Step 2: server-store 组装/写回 + Cockpit.tsx 构造默认；vendor 纯函数（workflow/schedule/calculations）确认不需感知 platform（它们只读不构造 ContentItem——验证后在报告说明）
- [ ] Step 3: 测试更新至全绿；commit `feat(cockpit): ContentItem.platform 字段 (三期 IA 演化)`

## Task 2: NavView 扩展 + 侧栏固定分组重构

**Files:**
- Modify: `src/components/cockpit/Cockpit.tsx`（`NavView` 联合扩展：`'inspirations' | 'momentum' | 'pipeline' | 'analytics' | 'settings' | \`platform-${平台}\``；view 路由 JSX 更新；`initialViewFromSearchParams` 接受新值集）
- Modify: `src/components/cockpit/sidebar.tsx`（固定分组结构：灵感库选题/今日推进 → 创作组五平台 → 内容总览/内容数据分析；**移除拖拽排序**（`navigationOrder` 停用但 prefs 字段保留不删）；分组标题「创作」用 `.sidebar-group-label` 类小样式（≤10 行 CSS））
- Modify: `src/components/cockpit/external-shell.tsx`（外部页侧栏与移动导航同步新结构：视图链接 `/?view=<新 id>`；移动端捷径 = 今日推进 + 内容总览 + /accounts）
- Modify: `src/app/cockpit.css`（分组标签小样式）

**Interfaces:**
- Consumes: Task 1 `CONTENT_PLATFORMS`/`PLATFORM_LABELS`。
- Produces: 视图 id 集与 URL 规约（`?view=platform-douyin` 等）；`视图标题文案`：灵感库选题/今日推进/内容总览/内容数据分析（`DEFAULT_PAGE_TITLES` 键沿用旧 id 的迁移策略：本期新增视图标题以常量写死，不入 prefs——避免动 vendor PageTitles 结构）。Task 3/4/5 把视图挂到这些 id 上；**本 Task 先以占位渲染**（platform-* 与 analytics 暂渲染现有 pipeline/goals 视图，Task 4/5 替换），保证每步可运行。

- [ ] Step 1: NavView + 侧栏 + external-shell + 初始视图解析；灵感池标题文案改「灵感库选题」
- [ ] Step 2: 手工验证六组侧栏项全部可点可达（占位内容可）；`npm run typecheck && npm run test`
- [ ] Step 3: commit `feat(cockpit): 侧栏固定分组重构 + NavView 平台项 (占位)`

## Task 3: 今日推进合并（momentum + 档期 tab）

**Files:**
- Modify: `src/components/cockpit/views/momentum.tsx`（现有 今日/本周 toggle 扩为 今日/本周/档期 三段；档期 tab 渲染 `<ScheduleView …/>` 原组件，props 原样透传）
- Modify: `src/components/cockpit/Cockpit.tsx`（`momentumPeriod` state 扩类型 `'today'|'week'|'schedule'`；schedule 独立视图从路由 JSX 移除；ScheduleView 所需 props 传入 momentum）
- Modify: `src/components/cockpit/views/schedule.tsx`（**零逻辑改动**；仅当作为子组件渲染需去掉重复 page 外壳时允许包一层条件 className——优先不动）

**Interfaces:**
- Produces: `?view=momentum` 默认今日；档期经 tab 进入。Task 6 的旧值映射 `schedule → momentum(档期 tab)` 依赖一个可寻址机制：`?view=momentum&tab=schedule` 由 Cockpit 初始解析支持。

- [ ] Step 1: 实现 + 手工走查（今日勾选/档期拖拽在 tab 内行为与原版一致）
- [ ] Step 2: `npm run typecheck && npm run test`；commit `feat(cockpit): 今日推进合并档期 tab`

## Task 4: 内容数据分析合并（goals + review 一页分区）

**Files:**
- Create: `src/components/cockpit/views/analytics.tsx`（页壳：页首 `.page-heading` + 区块导航（目标/复盘 两段锚点或 tab）+ 依序渲染 `<GoalsView/>` 与 `<ReviewView/>` 本体——两组件**不改逻辑**，若其自带 page 外壳造成双标题，允许加一个 `embedded?: boolean` prop 隐藏自身 heading（各 ≤5 行改动））
- Modify: `src/components/cockpit/Cockpit.tsx`（analytics 视图挂载，goals/review 独立路由移除；两视图 props 透传）

**Interfaces:**
- Produces: `?view=analytics` + `&tab=goals|review` 寻址（Task 6 映射依赖）。

- [ ] Step 1: 实现 + 手工走查（目标编辑/复盘录入/预测校准区块均正常）
- [ ] Step 2: `npm run typecheck && npm run test`；commit `feat(cockpit): 内容数据分析视图 (目标+复盘合并)`

## Task 5: 平台流水线页

**Files:**
- Modify: `src/components/cockpit/views/pipeline.tsx`（参数化：接受可选 `platformFilter?: 平台` prop——过滤 `contents`；接受可选 `hideHeading`。不复制组件）
- Create: `src/components/cockpit/views/platform.tsx`（`PlatformView({ platform, state, …透传 })`：①产出区——「+ 新建内容」（构造时 `platform` 置为当前平台，走既有 createContent 路径）+ 能力分级说明行（全能力：提示抽屉内 AI 生成可用；基础能力：文字说明「手写脚本骨架 + 分发登记」，无生成按钮）；②`<PipelineBoard platformFilter=…/>`；③分发区——列出目标为该平台的分发记录卡片）
- Create: `src/app/api/v1/cockpit/distributions/route.ts`（GET `?platform=` → 该用户 `Distribution` where platform，join scriptDraft.topic 返回 `{items:[{id, platform, url?, publishedAt?, sourceTopic}]}`——只读，envelope ok/fail；**先查 Distribution 模型实际字段再定返回形状**，以实际为准）
- Modify: `src/components/cockpit/Cockpit.tsx`（五个 platform-* 视图挂 PlatformView）
- Test: 新 `tests/api/cockpit/distributions.test.ts`（house mock 约定：正常/空/缺 platform 400）

**Interfaces:**
- Consumes: Task 1 platform 字段、Task 2 视图 id。
- Produces: 五个平台页可用；分发区数据端点。

- [ ] Step 1: pipeline 参数化（先行小改）→ 平台页壳 → 分发端点 TDD → 组装
- [ ] Step 2: 手工走查：抖音页新建内容→出现在该平台看板与内容总览；分发登记后卡片出现在目标平台分发区
- [ ] Step 3: `npm run typecheck && npm run test`；commit `feat(cockpit): 平台流水线页 (产出/看板/分发三区)`

## Task 6: 兼容映射 + 生成默认平台 + 总览平台标

**Files:**
- Modify: `src/components/cockpit/Cockpit.tsx`（`initialViewFromSearchParams` 旧值映射：`schedule→momentum+tab`、`goals→analytics+tab=goals`、`review→analytics+tab=review`；`inspirations/momentum/pipeline/settings` 原值照旧）
- Modify: `src/components/cockpit/content-drawer.tsx`（生成平台下拉默认值 = `item.platform`（六平台中全能力三平台可选生成；基础能力平台默认下拉隐藏或禁用生成——与 Task 5 能力分级一致，实施时取简单一致的方案并报告））
- Modify: 内容总览/平台看板卡片增加平台文字小标（`PLATFORM_LABELS`，`.badge` 类，无 emoji）
- Modify: `README.md` 兼容段落同步（redirect 目的地无需改——`/?view=pipeline` 等仍有效）

- [ ] Step 1: 实现三处 + 手工验证旧 URL 全部落到正确位置
- [ ] Step 2: `npm run typecheck && npm run test && npm run build`；commit `feat(cockpit): 旧视图映射 + 生成默认平台 + 平台标`

## Task 7: 收尾 — 文档 + 端到端

**Files:**
- Modify: `README.md`（§3 IA 重写为三期结构）、spec 追加「实际实施结论」
- 清理：`navigationOrder` 相关死代码若 Task 2 留了残枝在此清（prefs 字段保留）

- [ ] Step 1: 文档回写
- [ ] Step 2: 端到端清单：①六组侧栏项+五平台页全可达 ②旧 `?view=` 六个值映射正确 ③平台页新建→总览/平台看板双出现+platform 正确落库 ④抽屉生成默认平台跟随内容 ⑤今日勾选/档期拖拽/目标编辑/复盘录入在新挂载点行为不变 ⑥移动端导航 ⑦明暗模式 ⑧`npm run build && npm run test && npm run typecheck` 全绿 ⑨全站无彩色 emoji（复用清理脚本扫描）
- [ ] Step 3: commit `docs(cockpit): 三期 IA 收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 侧栏(T2) ✓ §2 平台页(T5) ✓ §3 模型(T1)+生成默认(T6) ✓ §4 收编(T3/T4) ✓ §5 兼容(T6) ✓ 无 emoji 铁律(Global+T7 ⑨) ✓。
- 一二期教训内嵌：重挂不重写（T3/T4 组件本体零改动）、复用禁复制（T5 pipeline 参数化）、旧 URL 不死（T6）、真点按钮走查（T3/T4/T5 手工步骤 + T7 清单）、vendor 偏离显式记录（T1 注释 + T7 spec 回写）。
- 类型一致性：平台联合 T1 定义、T2/T5/T6 消费 ✓；`?view=…&tab=…` 寻址 T3/T4 产出 = T6 消费 ✓。
