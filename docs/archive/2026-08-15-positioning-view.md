# 账号定位独立视图 (cockpit 十一期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 账号定位从「设置」页独立为侧栏第一栏视图（体系报告置顶 + 人设定位卡 + 风格档案卡），设置页只留配置三件。Spec: `docs/superpowers/specs/2026-08-15-positioning-view-design.md`。

**Architecture:** 新增 `NavView` 值 `'positioning'` + 新视图组件；两张既有卡片**原样迁移不重写**（仅换挂载点）；体系报告展示与导出从卡片内提到视图顶部（复用十期 `systemSummary` 数据与 Blob 下载逻辑）。

**Tech Stack:** 同前（无新依赖、无 DB 改动、无 API 改动）。

## Global Constraints

- **零 API / 零数据改动**：本期不碰 prisma schema、不改任何 `/api/v1/*` 路由——用户正在真实建档，数据必须无损。
- 人设定位卡（`PersonaCard`）与风格档案卡（`StyleProfileCard`）**组件本体不重写、props 不变**，只改挂载位置；两卡内部的起草/保存互斥、confirm 前置、ref 取最新值等既有逻辑一律不动。
- 侧栏「工作台」组第一项插入 `{ id: 'positioning', label: '账号定位' }`；图标用**单色字形**（沿既有 icon 体系，无彩色 emoji）。
- 插入首项会打乱下标依赖——全仓 grep `WORKBENCH_NAV_ITEMS[` 与任何按下标取导航项的代码，改为按 id 查找（九期同类改动先例；六期 external-shell 已改过一次，需复核仍成立）。
- `?view=positioning` 可直达；旧地址 `?view=settings` 行为不变（设置页仍在，只是页内无定位卡），**不做重定向、不做「已迁移」提示**。
- 设置页迁移后只剩 `AIProviderCard` / `BaselineCard` / `RadarConfigCard` 三张。
- 每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 视图路由 + 侧栏首项

**Files:** Modify `src/lib/cockpit/view-routing.ts`（`NavView` 联合加 `'positioning'`；`resolveInitialView` 支持 `?view=positioning`）；Modify `src/components/cockpit/sidebar.tsx`（`WORKBENCH_NAV_ITEMS` 首位插入 positioning 项，icon 名沿用既有字形集——先读 `Icon` 组件支持的 name 列表，选一个语义贴近「定位/靶心」的既有字形，**不新增图标资源**）；Modify `src/components/cockpit/external-shell.tsx`（移动端导航复核：确认按 id 查找而非下标，若发现下标依赖则改）；Test `tests/lib/cockpit/view-routing.test.ts` 补 positioning 用例。
**Interfaces:** Produces：`NavView` 含 `'positioning'`（T2 视图挂载消费）。
**Test:** `resolveInitialView('positioning')` → `'positioning'`；未知值仍回落既有默认；既有 15 条路由用例零回归；`WORKBENCH_NAV_ITEMS[0].id === 'positioning'` 且长度 +1。
- [ ] Step 1: 全仓 grep 下标依赖（`WORKBENCH_NAV_ITEMS[`、`NAV_ITEMS[`）并记录到报告；TDD 实现；commit `feat(cockpit): 账号定位视图路由 + 侧栏首项`

## Task 2: 定位视图 + 两卡迁移 + 体系报告置顶

**Files:** Create `src/components/cockpit/views/positioning.tsx`（三段结构：①顶部体系报告区——`systemSummary` 非空时 `<pre>` 展示 + 「导出 .md」Blob 下载按钮，为空时展示引导文案「完成访谈与调研后，这里会生成你的定位一页纸」；②`<PersonaCard />`；③`<StyleProfileCard />`。**体系报告区自行 GET `/api/v1/persona/profile` 取 systemSummary**——与 PersonaCard 各自取数会有一次重复请求，接受（YAGNI，不为省一次 GET 引入跨组件状态提升）；PersonaCard 内部原有的报告展示/导出**保留不动**，避免改卡片本体）；Modify `src/components/cockpit/views/settings.tsx`（移除 `PersonaCard`/`StyleProfileCard` 引入与挂载，只剩三张配置卡）；Modify `src/components/cockpit/Cockpit.tsx`（`activeView === 'positioning'` 时渲染新视图）；Modify `src/app/cockpit.css`（如需，新视图区块样式沿 `.panel` 体系）。
**Interfaces:** Consumes T1 的 `NavView`。
**Test:** 无纯函数新增——本任务以 **dev 手工走查**为验收（清单：①侧栏第一项「账号定位」可点进 ②体系报告为空时显示引导、非空时显示内容且能导出 md ③人设定位卡在新位置可正常起草/保存/市场调研/生成报告 ④风格档案卡在新位置可正常编辑保存与删样本 ⑤设置页只剩三张配置卡且各自功能正常 ⑥`?view=positioning` 直达 ⑦移动端导航首项正确 ⑧明暗主题下新视图渲染正常）。走查中真实调用会花几毛钱（起草/调研），属预期。
- [ ] Step 1: 实现 + 走查（浏览器扩展若不可用，改用 API 级验证 + 代码走读并在报告标注验证层级）；commit `feat(cockpit): 账号定位视图 (体系报告置顶 + 两卡迁移)`

## Task 3: 收尾 — 文档

**Files:** README（侧栏结构段更新：工作台组首项为「账号定位」；设置页卡片列表更新）；spec 回写「## 5. 实际实施结论」（至少覆盖：下标依赖 grep 结果、体系报告重复 GET 的取舍、走查验证层级、平台侧写待办的再确认）。
- [ ] Step 1: 文档；Step 2: `npm run typecheck && npm run test && npm run build` 全绿（改了组件必须 build；注意 dev/build 冲突：先 pkill dev、build 完再重启）；Step 3: commit `docs(cockpit): 十一期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 视图三段 + 侧栏首项 + 两卡迁移(T1/T2) ✓ §2 路由兼容与下标依赖(T1) ✓ §3 YAGNI 未越界（平台侧写/版本历史/富文本/迁移提示均未做） ✓ §4 风险：下标依赖(T1 grep)、迁移后行为(T2 走查四动作)、用户正在建档(Global Constraints 零 API/零数据改动) ✓。
- 类型一致性：`NavView` 单一定义在 view-routing.ts，T1 扩展、T2 消费 ✓；两张卡 props 不变故无新接口 ✓。
- 已知不确定点（实施核实记账本）：`Icon` 组件可用字形名（T1 标注：读实现选既有字形，不新增资源）；external-shell 移动端导航是否已完全按 id 查找（T1 标注复核）。
