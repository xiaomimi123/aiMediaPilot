# 平台页面融入驾驶舱 (cockpit 二期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 创作/数据/账号/设置 四个平台页面的功能长进驾驶舱六视图：抽屉内 AI 生成回填、dashboard 5 widget 迁入复盘/大目标、账号状态条、设置卡合并；`/agent` 向导、`/dashboard`、`/settings` 退役 redirect，侧栏「平台」组解散，存留页纸质风重塑。

**Architecture:** 本期零新建模、零后端管线改动。生成复用 `/api/v1/scripts/generate` + `/api/v1/scripts`（两段式），映射层为纯函数；迁移 widget 保留 `/api/v1/dashboard/summary` 作数据源（比 spec 原文更简，收尾回写）；服务端写 CockpitInspiration 必须走 `bumpCockpitRev`（一期 I1 教训）。Spec: `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`。

**Tech Stack:** Next 14.2 App Router / React 18 / Prisma 5.22 / vitest / cockpit CSS 类体系（`src/app/cockpit.css`）。

## Global Constraints

- 回填映射**只写有来源的字段，绝不把用户已填内容清成空串**（映射函数返回 `Partial`，调用方浅合并）。
- 平台键与现有一致：`'douyin' | 'xiaohongshu' | 'gongzhonghao'`；UI 文案 抖音/小红书/公众号。
- 所有 cockpit 数据的服务端直写（新灵感路由）写后必须调用 `bumpCockpitRev(userId)`（`src/lib/cockpit/server-store.ts`），并在 fail-soft try/catch 内。
- 客户端改 cockpit state 一律走 `updateContent`/`setState` → 既有防抖保存管线，不得绕过 rev。
- API 一律 `ok()/fail()`（`src/lib/api.ts`）+ `getOrCreateDefaultUser()`；路由测试沿用 `vi.hoisted` mock 约定。
- 旧 URL 不许 404：`/agent`（精确）→ `/?view=pipeline`，`/dashboard` → `/?view=review`，`/settings`、`/settings/baseline` → `/`，全部 `permanent: false`；`/agent/discover`、`/accounts`、`/content/*` 保留。
- 每 Task 结束 `npm run typecheck && npm run test` 过后 commit；commit message 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 迁移的 dashboard widget 逻辑/图表零改动，只换外层容器类与配色变量（`.panel` 体系、`var(--ink)/--clay` 等）。

---

## Task 1: 生成结果 → 脚本骨架 映射纯函数

**Files:**
- Create: `src/lib/cockpit/script-mapping.ts`
- Test: `tests/lib/cockpit/script-mapping.test.ts`

**Interfaces:**
- Consumes: 三平台生成响应形状（`DouyinScriptResponseSchema`：`hooks[{text,rationale}]/retentionBeats[{startSec,endSec,beat}]/titles[{text,hookType}]/cover{textOverlay,shotIdea,colorTone}`；`XHS`：`titles/coverText/intro/body/tags[]/shotIdeas[{idx,description}]`；`Article`：`titles/abstract/outline[]/body/cta`）；cockpit `ScriptDraft` 骨架键：`headline/hook/conclusion/body/example/ending`。
- Produces: `mapGeneratedToScript(platform: 'douyin'|'xiaohongshu'|'gongzhonghao', result: unknown): Partial<ScriptDraft>` —— Task 2 调用。

- [ ] **Step 1: 写失败测试**（每平台一组 + 空值防御）：

```ts
// douyin: headline←titles[0].text; hook←hooks[0].text + (rationale 换行注释);
//   body←retentionBeats 格式化行 "0-3s：beat"; example←cover 三要素格式化;
//   conclusion/ending 无来源 → 不出现在返回对象里 (undefined 键也不能有)
// xiaohongshu: headline←titles[0].text; hook←intro; conclusion←coverText;
//   body←body; example←shotIdeas 格式化 "1. description"; ending←tags 以 #tag 空格拼接
// gongzhonghao: headline←titles[0].text; hook←abstract; body←outline 编号行 + 空行 + body;
//   ending←cta; conclusion/example 无来源 → 缺省
// 防御: titles 为空数组 / result 非对象 → 返回 {}
```

- [ ] **Step 2:** `npx vitest run tests/lib/cockpit/script-mapping.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3:** 实现（纯函数，无 fetch/prisma；对 `result` 做窄化解析，宽容缺字段）。
- [ ] **Step 4:** 测试 PASS；`npm run typecheck && npm run test`。
- [ ] **Step 5: Commit** — `feat(cockpit): 三平台生成结果→脚本骨架映射纯函数`

## Task 2: 抽屉内 AI 生成（就地化）

**Files:**
- Modify: `src/components/cockpit/content-drawer.tsx`（script tab，~75 行区域）
- Modify: `src/components/cockpit/Cockpit.tsx`（若需向抽屉传 `updateContent` 之外的新回调——现有 props 已含 `updateContent`，预计不动）
- Modify: `src/app/cockpit.css`（如需 ≤10 行小样式，复用现有类优先）

**Interfaces:**
- Consumes: `POST /api/v1/scripts/generate` `{topic, niche, platform}` → flat 平台字段；`POST /api/v1/scripts` `{topic, niche, platform, output, cockpitContentId}` → `{id}`（已回填 `scriptDraftId` FK）；`GET /api/v1/user/default-niche`；Task 1 `mapGeneratedToScript`；`POST /api/v1/checklist/title-feedback` `{title, niche, platform}`。
- Produces: script tab 的「用 AI 写脚本」从跳转 `<Link>` 改为就地生成按钮 + 平台下拉。

- [ ] **Step 1:** 把 `.section-title-row` 里的 `<Link className="ai-button small">` 替换为：平台 `<select>`（默认 douyin，三选项）+ `<button className="ai-button small">`。点击流程：`generating` 态（按钮文案「生成中…」disabled）→ ①拉 default-niche（失败用 `'general'`）→ ②POST generate → ③POST scripts（带 `cockpitContentId: item.id`，保存 AI 原稿并落 FK）→ ④`updateContent(item.id, { script: { ...item.script, ...mapGeneratedToScript(platform, result) } })`（浅合并，遵守「不清空」约束）→ toast 「AI 脚本已生成并回填」。任一步失败 → toast 错误文案（`json.message`），不改 state。
- [ ] **Step 2:** 标题反馈：`headline` 字段 `onBlur` 且值长度 ≥3 时调 title-feedback（1.5s 防抖、同值不重发），返回建议渲染为字段下方一行 `<small className="field-hint">`（新增 ≤5 行 CSS，配色用 `var(--muted)`）。失败静默。
- [ ] **Step 3:** 手工验证（dev + 浏览器）：抽屉建内容 → 选平台 → 生成 → 字段回填且未清空已有内容 → 刷新持久 → `/content/script/{id}` 能看到 AI 原稿。无 AI key 时报错 toast 不崩。
- [ ] **Step 4:** `npm run typecheck && npm run test`；**Commit** — `feat(cockpit): 抽屉内 AI 生成回填 + 标题实时建议`

## Task 3: discover 灵感直入灵感池

**Files:**
- Create: `src/app/api/v1/cockpit/inspirations/route.ts`
- Modify: `src/app/agent/discover/page.tsx`（动作替换）
- Modify: `src/components/cockpit/views/inspirations.tsx`（右上加「抓灵感 →」链接）
- Test: `tests/api/cockpit/inspirations.test.ts`

**Interfaces:**
- Consumes: `bumpCockpitRev`（`@/lib/cockpit/server-store`）；discover 条目字段 `title/hookLine/rationale`。
- Produces: `POST /api/v1/cockpit/inspirations` body `{text: string (1–2000)}` → `ok({id})`；写 `CockpitInspiration {id: randomUUID, userId, text, convertedContentIds: [], createdAt/updatedAt: ISO}` 后调 `bumpCockpitRev`。

- [ ] **Step 1:** TDD 路由测试：正常写入 + bumpCockpitRev 被调、text 空/超长 400、非法 JSON 400。FAIL → 实现 → PASS。
- [ ] **Step 2:** discover 页：`<PoolButton …>` 替换为「存入灵感池」按钮（`text = title + '\n' + hookLine + '\n' + rationale`，POST 新路由，成功后按钮变「已存入 ✓」disabled；重复存入按 text 前 20 字符查重可省略——允许重复，灵感池本就轻量）。「用这个生成脚本 →」链接改为跳 `/?view=pipeline` 提示（或直接移除该链接——生成已就地化；**移除**，卡片只留存入灵感池）。
- [ ] **Step 3:** 灵感池视图 `.inspiration-wall-heading` 行加 `<Link href="/agent/discover" className="ai-button small">抓灵感 →</Link>`。
- [ ] **Step 4:** 手工验证：discover 存入 → 回 `/?view=inspirations` 出现新卡（注意：discover 页存入 bump 了 rev，已开的 cockpit 标签下次保存会 409 横幅——预期行为，验证横幅出现即通过）。
- [ ] **Step 5:** `npm run typecheck && npm run test`；**Commit** — `feat(cockpit): discover 灵感直入灵感池 (服务端写+rev 联动)`

## Task 4: 数据迁移 — 复盘实验室「预测与校准」+ 大目标「内容表现」

**Files:**
- Create: `src/components/cockpit/analytics/use-dashboard-summary.ts`（共享 hook：fetch `/api/v1/dashboard/summary` 一次 + loading/error 态）
- Create: `src/components/cockpit/analytics/prediction-panel.tsx`（组合 PredictionAccuracy(+Locked) / CalibrationMatrix(+Locked) / BiggestMisses）
- Create: `src/components/cockpit/analytics/performance-panel.tsx`（组合 NicheDistribution / TopPerformers）
- Move: `src/components/dashboard/{prediction-accuracy,prediction-accuracy-locked,calibration-matrix,calibration-locked,biggest-misses,niche-distribution,top-performers}.tsx` → `src/components/cockpit/analytics/`（`git mv`，import 路径更新）
- Modify: `src/components/cockpit/views/review.tsx`（`rules-panel` 后追加 `<PredictionPanel />`）
- Modify: `src/components/cockpit/views/goals.tsx`（`follower-analytics-panel` 后追加 `<PerformancePanel />`）

**Interfaces:**
- Consumes: `DashboardSummary` 及切片类型（`src/lib/dashboard/types.ts`，不动）；`data.calibration === null` 时的 Locked 降级分支照抄旧 dashboard/page.tsx 的判断。
- Produces: 两个自取数 panel 组件（views 无 props 变化，Cockpit.tsx 不动）。

- [ ] **Step 1:** `git mv` 七个 widget + 建 hook 与两个 panel；panel 外层用 `<section className="panel">` + `.panel-heading h2` 标题（预测与校准 / 内容表现），内部 grid 沿用 widget 自身布局。
- [ ] **Step 2:** 重塑：widget 内部逻辑零改动，仅把 shadcn 暗色类（`bg-card`、`text-muted-foreground` 等）替换为 cockpit 变量类——只改**容器与文字色**，图表/表格结构不动；每个文件的改动预期 <15 行。loading 态渲染 `null`，error 渲染一行 `<small>`。
- [ ] **Step 3:** 手工对照：迁移后两个视图的数据与旧 `/dashboard` 页逐块一致（旧页此时还在，开两窗对照）。
- [ ] **Step 4:** `npm run typecheck && npm run test`；**Commit** — `feat(cockpit): dashboard 5 widget 迁入复盘实验室/大目标`

## Task 5: 账号状态条 + 手动同步 + 设置卡合并

**Files:**
- Modify: `src/lib/cockpit/extras-types.ts` + `src/lib/cockpit/extras.ts`（扩展 extras）
- Create: `src/app/api/v1/douyin/auto-sync/trigger/route.ts`
- Modify: `src/components/cockpit/views/goals.tsx`（follower panel header 加状态条）
- Modify: `src/components/cockpit/views/settings.tsx`（加三张卡）
- Create: `src/components/cockpit/settings-cards/ai-provider-card.tsx`、`baseline-card.tsx`（表单逻辑从 `src/app/settings/page.tsx` 与 `src/components/settings/baseline-form.tsx` 移植）
- Test: 扩展 `tests/api/cockpit/workspace.test.ts`（extras 断言）+ 新 `tests/api/douyin/auto-sync-trigger.test.ts`

**Interfaces:**
- Consumes: `PlatformAccount {nickname, loginStatus, followerCount, lastSyncAt}`；`user.lastAutoSyncAt`；`autoSyncQueue`（`src/jobs/queue.ts`）；既有 `/api/v1/ai/config*`、`PUT /api/v1/user/baseline`；retroMedian 计算逻辑（`src/app/settings/baseline/page.tsx` 里的 ActualMetric 中位数，抽为 `src/lib/settings/baseline-stats.ts` 纯函数复用）。
- Produces: `CockpitExtras` 增加 `account: { nickname: string; loginStatus: string; followerCount: number; lastSyncAt: string | null; lastAutoSyncAt: string | null } | null` 与 `settings: { baselinePlays: string | null; retroMedian: number | null; retroCount: number }`；`POST /api/v1/douyin/auto-sync/trigger` → `ok({queued: true})`（`autoSyncQueue.add('auto-sync', {}, {jobId: 'manual-' + Date.now()})`）。

- [ ] **Step 1:** extras 扩展 + workspace 测试断言（无绑定账号 → `account: null`）。
- [ ] **Step 2:** trigger 路由 + 测试（queue mock 断言 add 参数；queue 不可用（redis 未连）→ fail 503 文案「任务队列不可用，请确认 worker 已启动」）。
- [ ] **Step 3:** goals 状态条（follower panel header 内一行）：`绑定：{nickname|未绑定} · 上次同步 {lastAutoSyncAt|—} · [立即同步] · [管理账号 →](/accounts)`；立即同步点击 → POST trigger → toast。
- [ ] **Step 4:** 设置视图三张卡（沿用 `.panel.settings-card` 结构）：AI Provider（列表+新增+删除+测试连接，逻辑照搬旧页）、内容基准（baseline 表单 + retroMedian 提示）、账号管理（一句说明 + 链接 `/accounts`——双入口之二）。
- [ ] **Step 5:** 手工验证四处功能等价旧页；`npm run typecheck && npm run test`；**Commit** — `feat(cockpit): 账号状态条+手动同步入队 + 设置卡合并`

## Task 6: 三页退役 + redirects + 侧栏收编

**Files:**
- Delete: `src/app/agent/page.tsx`、`src/app/dashboard/`、`src/app/settings/`（整目录）、`src/components/dashboard/{stats-bar,overall-score-trend,next-steps,account-recent,quick-create,empty-state}.tsx`、`src/components/settings/baseline-form.tsx`（逻辑已移植）
- Modify: `next.config.js`（新增 `redirects()`）、`src/components/cockpit/sidebar.tsx`（`EXTERNAL_NAV_ITEMS` 清空并移除渲染段）、`src/components/cockpit/external-shell.tsx`（对应清理）
- Modify: 全局 grep `'/agent'`（精确链接，排除 `/agent/discover`）、`'/dashboard'`、`'/settings'` 的存活引用改指新位置（如 `/content/script/[id]` 页里的入口）

**Interfaces:**
- Produces: `redirects()`：`{source: '/agent', destination: '/?view=pipeline'}`、`{source: '/dashboard', destination: '/?view=review'}`、`{source: '/settings', destination: '/'}`、`{source: '/settings/baseline', destination: '/'}`，全部 `permanent: false`。`/agent/discover` 不受影响（redirect 为精确匹配）。

- [ ] **Step 1:** 删除前 grep 每个待删组件的存活消费方（一期 T13 教训——`ScriptForm`/`ScriptResult` 被 `/content/script/new` 使用需确认去留：**保留** `/content/script/new` 及两组件，作为独立深度写稿入口，仅 `/agent` 壳退役）。
- [ ] **Step 2:** 执行删除 + redirects + 侧栏收编（`平台` 分组整段移除；`ExternalShell` 仍渲染 cockpit 视图链接组）。
- [ ] **Step 3:** `npm run build`（redirect 需 build 验证）+ 手工 curl：`/agent` → 307 到 `/?view=pipeline`，`/agent/discover` → 200，`/dashboard` → 307，`/settings` → 307。
- [ ] **Step 4:** `npm run typecheck && npm run test && npm run build`；**Commit** — `chore(cockpit): /agent /dashboard /settings 退役 redirect + 侧栏平台组解散`

## Task 7: 存留页纸质风重塑

**Files:**
- Modify: `src/app/agent/discover/page.tsx`、`src/components/accounts/{account-grid,account-card,empty-state}.tsx`、`src/app/accounts/bind/page.tsx`、`src/app/content/preflight/**`、`src/app/content/script/**`、`src/app/content/retro-sync/**`（及其组件）中的视觉层
- Modify: `src/app/globals.css`（`.bg-brand-gradient` 若无存活引用则删除定义）

**Interfaces:**
- Produces: 存留页统一 cockpit 观感：容器 `.panel`、标题 `.panel-heading`、按钮 `.ai-button`/既有按钮类、色彩走 CSS 变量；蓝紫渐变仅允许保留在「生成/发布」主 CTA（统一决断：**全部退役**，grep `bg-brand-gradient` 清零后删定义）。

- [ ] **Step 1:** 逐页替换类名（纯样式，不动逻辑与测试）；每页改完浏览器截图核对明暗两模式。
- [ ] **Step 2:** grep `bg-brand-gradient|text-brand-gradient` → 清零 → 删 globals.css 中定义与 `--brand-from/--brand-to` 变量。
- [ ] **Step 3:** `npm run typecheck && npm run test`；**Commit** — `style(cockpit): 存留页纸质风重塑, 蓝紫渐变退役`

## Task 8: 收尾 — 文档回写 + 端到端验证

**Files:**
- Modify: `README.md`（IA 更新：平台组解散、redirect 表、新功能位置）、`docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`（追加「实际实施结论」节：dashboard/summary 端点保留作数据源、ScriptForm 保留于 /content/script/new、其余偏差如有）

- [ ] **Step 1:** 文档回写。
- [ ] **Step 2: 端到端清单**：①抽屉三平台各生成一次回填正确且不清空 ②discover 存灵感→灵感池出现→已开标签 409 横幅 ③复盘/大目标新区块数据与迁移前一致 ④立即同步入队（worker 在跑时观察日志）⑤设置卡三项功能等价 ⑥四个旧 URL redirect 正确、/agent/discover 与 /content/* 正常 ⑦明暗模式下存留页无「白底黑字残留」 ⑧`npm run build && npm run test && npm run typecheck` 全绿。
- [ ] **Step 3: Commit** — `docs(cockpit): 二期融合收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：A1(T1/T2) A2(T3) A3(T6) ✓；B(T4/T6) ✓；C(T5) ✓；D(T5 设置卡 + T6 侧栏 + T7 重塑) ✓；收尾(T8) ✓。
- 与 spec 的预置偏差（T8 回写）：summary 端点保留；`/content/script/new` + ScriptForm/ScriptResult 保留（深度写稿入口）；title-feedback 挂 headline onBlur。
- 类型一致性：`mapGeneratedToScript` 签名 T1=T2 ✓；`CockpitExtras.account/settings` T5 定义=消费方 ✓；redirect 表 Global Constraints=T6 ✓。
- 一期教训内嵌：删除前 grep 消费方（T6 Step 1）、服务端直写 bump rev（T3）、入口不消失（账号双入口 T5、旧 URL redirect T6）。
