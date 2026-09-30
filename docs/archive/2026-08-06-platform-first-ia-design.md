# 产出优先信息架构重组（cockpit 三期）

**日期:** 2026-08-06
**前置:** 一期 `2026-08-04-cockpit-adoption-design.md`（整体移植）、二期 `2026-08-05-platform-pages-fusion-design.md`（平台页面融合）
**问题诊断（用户自述并经确认）:** 一二期把 creator-cockpit 的信息架构原样接管——它是「流程优先」（灵感→推进→档期→总览→目标→复盘）；而用户的产品心智是**产出优先、按平台组织创作**。代码层无问题，病灶在 IA 层。本期只动信息架构，不动机制（抽屉、409 防护、AI 生成、爬虫回填等全部保留）。

## 0. 已确认的关键决策

| 决策点 | 结论 |
|---|---|
| 创作与流水线关系 | **每平台独立流水线**：创作栏五平台，每平台自己的看板与产出工具 |
| 多平台内容表示 | **主平台创作 + 分发标记**：内容在主平台流水线完整推进；其他平台以分发卡片呈现（沿用 `Distribution` 模型），不重走流程 |
| 全局层构成 | 灵感库选题 / **今日推进（含档期，跨平台一张表）** / 创作（五平台） / 内容总览 / 内容数据分析 |
| 平台集合 | 抖音、小红书（全能力）+ bilibili、X、YouTube（基础能力）；公众号退出侧栏、生成能力保留在代码 |
| **UI 图标铁律** | **全站禁用彩色 emoji**；新 UI 一律用 cockpit 单色字形（✣ ◫ ▦ ◎ ▸ 类，从 cockpit.css 既有气质选）或纯文字 |

## 1. 新侧栏（全局层）

```
✣ 灵感库选题        ← 现灵感池改名 + 抓灵感入口不变
◫ 今日推进          ← 现「推进」+「档期规划」合并：页内 tab 今日 / 本周 / 档期
─ 创作 ────────
  抖音 / 小红书 / bilibili / X / YouTube   ← 纯文字或单色字形项
─────────────
▦ 内容总览          ← 全局跨平台流水线看板（不变）
◎ 内容数据分析      ← 大目标 + 复盘实验室（含预测校准/内容表现）收编一页，页内分区
⚙ 设置             ← 底部不变
```

侧栏拖拽排序语义按新结构调整或简化（实施时定，若与分组冲突可去掉拖拽）。

## 2. 平台流水线页

每平台页三区块：

1. **产出区**（页首）：「+ 新建内容」（主平台自动设为该平台）+ AI 生成入口。全能力平台就地生成（复用抽屉/generate-flow 能力）；基础能力平台提供手写脚本骨架，AI prompt 后续按需加。
2. **平台流水线看板**：只显示 `platform = 该平台` 的内容，阶段推进与内容总览同款交互（数据过滤复用，不复制逻辑）。
3. **分发区**：`Distribution` 中目标为该平台的记录卡片（链接/登记数据），标明来源内容。

能力分级徽标用文字/单色字符。

## 3. 数据模型（一处刻意的 vendor 偏离）

- `CockpitContent` 与 cockpit `ContentItem` 增加 `platform` 字段（`'douyin'|'xiaohongshu'|'bilibili'|'x'|'youtube'|'gongzhonghao'`，默认 `douyin`）。这是移植后**第一次主动演化 vendor 数据模型**——一期「纯逻辑零改动」是移植期约束而非永久枷锁，此处显式解除并记录。涉及 `model.ts`/`server-store`/workspace 校验的连带小改按最小面处理。
- 存量内容迁移：全部标 `douyin`（用户主阵地）。
- 分发区零新表，读现有 `Distribution`（经 `scriptDraftId` 链）。
- 新建内容时抽屉生成的默认平台 = 内容的 `platform`（替代现在固定 douyin 的默认值）。

## 4. 收编去向

| 现视图 | 去向 |
|---|---|
| 灵感池 | 灵感库选题（改名） |
| 推进（今日/本周） | 今日推进 tab 今日/本周 |
| 档期规划 | 今日推进 tab 档期 |
| 内容总览 | 不变 |
| 大目标 | 内容数据分析·目标区 |
| 复盘实验室（含预测与校准） | 内容数据分析·复盘区 |
| 设置 | 不变（含账号卡双入口） |

## 5. 兼容

- 旧 `?view=` 值映射跳转：`momentum→今日推进`、`schedule→今日推进(档期 tab)`、`goals/review→内容数据分析(对应区)`、`inspirations→灵感库选题`、`pipeline→内容总览`、`settings→设置`。
- 移动端导航同步收编；`/accounts` 双入口保持；`/agent/discover` 与 `/content/*` 子页不动。

## 不做（YAGNI）

- 不做 B站/X/YouTube 的爬虫与 AI prompt（后续按需）；不做每平台独立档期/今日（全局一张表）；不动后端管线与并发模型；不做多用户。

## 风险

| 风险 | 对策 |
|---|---|
| vendor 纯函数层首次改动引入回归 | 改动面最小化（加字段+默认值），vendor 移植测试全量回归 + 新增 platform 相关用例 |
| 视图合并（推进+档期、目标+复盘）破坏交互 | 合并为页内 tab/分区，组件本体不改只重挂 |
| 平台看板与总览逻辑分叉 | 看板组件参数化复用（platform 过滤 prop），禁止复制 |
| 侧栏重构回归 | sidebar/external-shell 全量回归 + 走查 |

## 实际实施结论 (T1-T7 回写, 2026-08-13)

以下是 spec 未预见或需要精确记录的实施细节, 按 T7 brief 逐条回写；账本原文见
`.superpowers/sdd/2026-08-06-platform-first-ia/progress.md`, 各任务细节见同目录
`task-N-report.md`。

### (a) NavView / view-routing 纯模块化 (T3 抽取, spec 未预见)

`NavView`/`PlatformNavId`/`isPlatformNavView` 与 `?view=`/`?tab=` 解析函数
(`resolveInitialView`/`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab`) 最初内联
在 `Cockpit.tsx`（`initialViewFromSearchParams`）与 `sidebar.tsx`（类型定义）两处, T2 review
中零测试覆盖。T3 fix round 1 抽成独立纯逻辑模块 `src/lib/cockpit/view-routing.ts`——原因是
`Cockpit.tsx`/`sidebar.tsx` 都是 `"use client"` 组件文件（`sidebar.tsx` 还引入 `next/link`),
留在那边既不能脱离 React/Next 单测, 也容易在后续扩展（T6 的精确历史链接映射）时被顺手牵连
组件渲染代码。`sidebar.tsx` 现在反过来 `import type` 这两个类型, 避免环形依赖。这不是 spec
原计划的一部分, 是 review 驱动的架构决策, 单测 `tests/lib/cockpit/view-routing.test.ts`
（T3 15 例 + T4 9 例 + T6 2 例, 共 26 例）全部挂在这个模块上。

### (b) tab 寻址门控语义与 legacy 折叠精确行为

`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab` 都有相同的**门控**写法: 只有当
`resolvedView` 恰好等于自己对应的视图（`"momentum"`/`"analytics"`）时才读取 `?tab=`；否则
无条件返回默认 tab（`"today"`/`"goals"`）, 不理会 URL 里出现的 `?tab=` 值。这是为了堵住一个
潜伏陷阱: `?view=inspirations&tab=schedule` 这种深链如果不门控, `momentumPeriod` 状态会在
mount 时被污染成 `"schedule"`, 之后 SPA 内部任何跳回 momentum 视图的操作都会意外落在档期
（T3 fix round 1 修复并留了专门回归用例复现该场景）。

legacy 折叠的精确优先级: `?view=schedule`/`?view=goals`/`?view=review` 这类旧值携带的"原始
视图身份"在 `resolveInitialView` 折叠阶段就已经丢失（三者统一变成 `"momentum"`/`"analytics"`)。
`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab` 因此各自**重新读一次原始 `view`
参数**——若原始值是 legacy id, 直接决定 tab, **优先级高于 `?tab=`**。例如
`?view=schedule&tab=week` 最终落在**档期** tab, 不是 `week`（`raw view` 赢, `tab` 参数被忽略）；
`?view=goals&tab=review` 同理最终落在**目标** tab。这一行为在 T3/T4/T6 三处测试文件里各有对应
用例钉住, 是刻意设计, 不是遗漏。

### (c) embedded prop 方案 (GoalsView / ReviewView / pipeline hideHeading)

T4 把「大目标」「复盘实验室」两个独立视图合并进「内容数据分析」一个容器 (`AnalyticsView`)
时, 容器自己的标题栏和 `GoalsView`/`ReviewView` 各自原有的 `.page-heading` 套在一起会形成
同屏两份页面标题堆叠。`GoalsView` 的标题栏里还带着「配置目标指标」这个真正的功能入口按钮,
无法整段裁掉, 容器层也不能在不复制内部 `showConfig` 等状态的前提下把按钮摘出来单独渲染。
最终方案（spec 未预见, 属 T4 授权的 fallback）: 给 `GoalsView`/`ReviewView` 各加一个
`embedded?: boolean`（默认 `false`）prop, 为真时用空 `<div />` 占位替换标题文字部分（保留
flex 布局让按钮仍贴右对齐), 组件本体渲染逻辑与全部 handler 零改动。T5 平台流水线页遇到
同款问题（`ContentOverviewView` 内嵌进 `PlatformView` 时与容器标题重复）, 直接复用同一套
思路加了 `hideHeading?: boolean` prop（同样默认 `false`, 同样只影响标题渲染分支）。两处都是
"容器层处理不可避免时的逃生舱", 不是被合并组件的默认行为——`Cockpit.tsx` 里现在唯一的调用
点都传 `embedded`/`hideHeading` 为真, 只有历史上未合并的孤立场景才会不传。

### (d) x → twitter 分发映射桥

cockpit 六平台集合的 `ContentPlatformEx`（`douyin|xiaohongshu|bilibili|x|youtube|gongzhonghao`）
与分发登记表单实际使用的 `DISTRIBUTION_PLATFORMS`（`src/lib/pipeline/platforms.ts`, 8 个注册表
key）之间只有一处命名不一致: cockpit 侧的 `"x"` 对应分发侧的 `"twitter"`。T5 在
`src/lib/cockpit/distribution-platform.ts` 建了唯一一张桥接表
`COCKPIT_TO_DISTRIBUTION_PLATFORM`, 平台流水线页的分发区 API (`GET
/api/v1/cockpit/distributions?platform=`) 用它把 URL 上的 cockpit 平台 id 转成
`Distribution.platform` 实际存的值再查库。这张表刻意没有直接 `export` 在
`route.ts` 里——踩过一个坑: Next App Router 对 `app/**/route.ts` 的导出做类型级白名单校验
（只认 `GET`/`POST`/... 和少数 config 导出), 多导出一个普通常量会在 `next dev`/`next build`
生成 `.next/types/.../route.ts` 后让 `tsc --noEmit` 报错（`Property 'X' is incompatible with
index signature`), 且这个错误在 `.next/types` 缓存未更新前不会立刻暴露, 曾一度误判 typecheck
已过。移到独立 lib 文件后问题消失。

### (e) 拖拽排序移除, `navigationOrder` prefs 保留

Spec §1 原话"侧栏拖拽排序语义按新结构调整或简化（实施时定, 若与分组冲突可去掉拖拽）"——T2
判定三段固定分组（工作台/创作/总览）与拖拽排序语义冲突（拖拽的前提是可任意重排的单一列表,
固定分组结构不再满足这个前提), 选择完全去掉: `sidebar.tsx` 里 `draggable`/`onDragStart`/
`onDragOver`/`onDrop`/`onDragEnd`/`onKeyDown`(Alt+↑↓)/`nav-drag-handle` 全部删除,
`CockpitSidebarProps` 同步去掉 `navItems`/`draggedNavId`/`navDropTarget`/`setDraggedNavId`/
`setNavDropTarget`/`reorderNavigation`/`moveNavigationBy`/`reviewDueCount`。但
`WorkspaceState.navigationOrder` 字段本身、`DEFAULT_NAVIGATION_ORDER` 常量、
`migrations.ts`/`server-store.ts` 里对应的读写逻辑**均未删除**（按 brief"停用但不删字段"的
指示, 数据契约保持向后兼容); `Cockpit.tsx` 里唯一剩下的 `state.navigationOrder` 引用是
`onReset` 时原样透传用户现有设置。对应的死 CSS（`.sidebar nav .nav-item { cursor: grab }`/
`.dragging`/`.drop-target`/`.nav-drag-handle` 相关规则, 均已确认作用域限定在 `.sidebar
nav .nav-item` 下、与 kanban 内容卡拖拽和档期日历拖拽用的是完全不同的类名不冲突）已在 T7
一并清理, 详见下方 (g)。

### (f) `reviewDueCount` 徽标迁移至 analytics 项

`reviewDueCount`（已发布且过 T+3 未复盘的内容数, 原挂在旧「复盘实验室」独立侧栏项上的角标）
在 T2 拆掉「复盘」侧栏项时被一并移除（当时唯一的消费方随按钮一起消失）。T4 把复盘视图合并
进「内容数据分析」时按原样恢复了这段计算逻辑（`git show` 定位 T2 前一次 commit 的原始实现
逐字搬回, 未改写判定规则), 挂到合并后的「内容数据分析」侧栏项上（`analyticsBadgeCount`
prop), 视觉复用未删除过的 `.nav-item em` 徽标样式, 零 CSS 改动。

### (g) 其他实际偏差 (账本 `progress.md` 逐条核对)

从 Task 1-6 账本的 `Task N: minor (deferred)` / `备注` 条目里核对当前状态, 未被 (a)-(f)
覆盖的补记如下:

- **CreateContentModal 旁路直建 (T5)**: 平台页「+ 新建内容」按钮**没有**复用既有的
  `CreateContentModal`（"新建空白" / "从灵感池选择"两选一弹层）。弹层的两条分支本身都不支持
  预置 `platform`, 硬塞两头改造成本高；平台页本身已经是"选了要做哪个平台"的入口, T5 新增了
  平行于 `createBlankContent()` 的 `createContentForPlatform(platform)`, 直接创建 + 打开抽屉,
  跳过弹层——spec 未预见这个选择点, 是 T5 实施时"挑轻的路径"的记录。`createContentForPlatform`
  与 `createBlankContent` 有约 5 行逻辑重复（循例, 未抽取公共函数）。
- **平台标裸 `.badge` (T6)**: 内容总览/平台页看板卡片上的平台文字小标用的是裸
  `<span className="badge">` 而非项目已有的 `<Badge>` 组件（后者会额外加 `badge-${tone}`
  修饰类, 这里没有对应的 tone 语义), 功能等价, 记为风格债, 未处理。
- **`ContentOverviewView` 分发平台映射表缺 kuaishou/weibo**: `COCKPIT_TO_DISTRIBUTION_PLATFORM`
  只覆盖 cockpit 五平台（+ gongzhonghao 六平台), `DISTRIBUTION_PLATFORMS` 注册表里的
  `kuaishou`/`weibo` 目前在 cockpit 侧不可达（没有对应的侧栏平台页), 加第六/七个 cockpit
  平台时需要同步补这张表, 否则该平台的分发区会查不到数据。
- **`migrations.ts` 备份导入路径未补 `platform`**: T1 只给"存量数据一次性迁移"
  (`migrate-mapping.ts`) 和"API 组装防御性回退"(`server-store.ts`) 补了 `platform` 兜底,
  没有动 `migrations.ts` 里"导入旧版 JSON 备份文件"这条路径（`normalizeContent` 用
  `as unknown as ContentItem` 类型断言绕过了编译期检查, 不会被 typecheck 捕获)。若导入的
  旧备份文件本身缺 `platform` 字段, 产出的 `ContentItem` 运行时会缺这个字段——是一个潜在
  健壮性缺口, 当前无 UI 入口触发（备份导入 UI 未移植, 见 README §3 Cockpit 数据层), 严格
  来说不在任何一个 task 的文件清单里, 留给后续 follow-up。
- **`primaryPlatformToContentPlatform` 无直测**: T1 新增的这个纯函数（`profile.primaryPlatform`
  自由文本关键词映射到六平台之一）没有独立单测覆盖, 只被间接调用方（`createBlankContent`/
  `createContentFromInspiration`）的集成测试覆盖到部分分支。
- **`resolveInitialAnalyticsTab` 信任 `resolvedView` 同源**: T4 记录为理论性风险——该函数
  假设传入的 `resolvedView` 参数就是同一次调用里 `resolveInitialView` 的返回值（`Cockpit.tsx`
  唯一调用点确实如此), 但函数签名本身不强制这个约束, 若未来出现另一个调用点传入不同源的
  `resolvedView`, 门控逻辑仍然成立但语义会变得难以推理。当前只有一个调用点, 未处理。
- **遗留测试内容清理 (T6 报告标记"控制器清理")**: T6 走查在 `?view=platform-bilibili` 下
  新建的测试内容（`未命名内容`, id `08950cb2-...`）及配套的 bilibili 测试分发记录, T7 复核
  数据库确认**已不存在**（`CockpitContent`/`Distribution` 表均查无匹配记录), 该项已自然
  清理, 无需控制器额外操作。
- **375px 移动导航截图 (T2 备注)**: T2 因浏览器工具故障未能截图验证, 改为代码走查判定低
  风险（`.mobile-nav` 渲染结构与 CSS 断点零改动, 只是数据源从 `navigationOrder` 派生换成
  固定的 `MOBILE_NAV_ITEMS` 常量）。T7 未获得浏览器工具授权做真实走查, 该项转入 T7 报告的
  「待人工走查清单」。
- **档期拖拽像素级复测 (T3 备注)**: `views/schedule.tsx` 在 T3/T4 全程零逻辑改动（`git diff`
  确认), 只是挂载点从独立视图变成 `MomentumView` 内的一个 tab, T3/T4 均判定为低风险未做
  逐像素回归。T7 同样未获浏览器工具授权复测, 转入待人工走查清单。
