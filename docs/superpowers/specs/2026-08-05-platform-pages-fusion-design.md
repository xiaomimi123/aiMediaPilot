# 平台页面融入驾驶舱设计（cockpit 二期）

**日期:** 2026-08-05
**前置:** `2026-08-04-cockpit-adoption-design.md`（一期：creator-cockpit 整体移植，已合入 main）
**目标:** 一期把 创作/数据/账号/设置 四个旧页面「挂」进了新壳；本期把它们的功能**长**进驾驶舱六视图，消除双产品观感与页面跳转，侧栏「平台」组解散。

## 0. 范围（用户已确认，四块全做）

| 块 | 去处 |
|---|---|
| A. AI 写稿就地化 | 内容抽屉·脚本 tab 内直接生成回填；discover 灵感直入灵感池；`/agent` 向导退役 |
| B. 数据融入 | 预测准确率/校准/Misses → 复盘实验室；Niche/Top → 大目标；`/dashboard` 退役 |
| C. 账号状态融入 | 绑定状态+同步入口嵌入大目标粉丝区块；绑定流程页保留 |
| D. 设置合并+视觉统一 | AI key/baseline 并入 cockpit 设置视图；`/settings` 退役；存留页纸质风重塑 |

## A. AI 写稿就地化

### A1. 抽屉内生成

- 内容抽屉·脚本 tab 的「用 AI 写脚本」由跳转链接改为**就地生成按钮**：点击 → 调用现有 `/api/v1/scripts` 生成管线（DeepSeek + `SCHEMA_BY_PLATFORM` zod 校验，零新轮子）→ 生成中按钮转 loading（沿用 cockpit 既有样式）。
- **平台选择**：按钮旁小型下拉（抖音/小红书/公众号），默认取 `profile.primaryPlatform` 映射（抖音）。
- **结果回填**：AI output 映射进 cockpit script 骨架字段（标题方向←titles[0]、开头 3 秒←hook、一句话结论←conclusion、内容结构←body/sections 拼接、案例←example、结尾←ending；各平台 schema 差异在映射层吸收，映射函数为纯函数可测）。完整 AI 原稿仍存 `ScriptDraft` 行并回填 `scriptDraftId` FK（保留 AI 存档与分发登记链）。
- 回填走 cockpit 标准 `updateContent` → 自动保存管线（不绕过 rev 机制）。
- 生成时若 content 停在 `topic` 阶段，沿用一期 picked 语义：**不自动推进**，用户确认脚本后自行推进（保持原版「用户掌控阶段」哲学）。

### A2. discover 灵感直入灵感池

- `/agent/discover`（热点抓取页）**保留路由**但动作改向：原「入选题池」（写 TopicIdea）改为「存入灵感池」（写 `CockpitInspiration`，文本=标题+要点摘要）。
- 灵感池视图右上加「抓灵感 →」入口链接到该页。
- `TopicIdea` 表停止新写入（旧数据只读保留）。

### A3. `/agent` 向导退役

- `/agent` 路由改为 redirect 到 `/`（携带 `?view=pipeline`）；`/agent/discover` 保留。
- 一期 T10 的 `?topic=&cockpitId=` 闭环由 A1 就地生成取代；`title-feedback` API 保留（A1 的标题方向字段失焦时调用展示一行评分建议——轻量集成，非弹窗）。

## B. 数据融入复盘实验室 / 大目标

- **复盘实验室**底部新增「预测与校准」区块：迁移 dashboard 的 PredictionAccuracy、Calibration、Misses 三个 widget（组件搬移 + 纸质风重塑；数据仍来自 `src/lib/dashboard/aggregate.ts`，聚合逻辑零改动）。
- **大目标**核心指标区下方新增「内容表现」区块：迁移 Niche、Top 两个 widget。
- StatsBar / OverallScoreTrend / NextSteps：**不迁移**（StatsBar 与驾驶舱首屏信息重复；OverallScoreTrend 样本长期个位数价值低；NextSteps 已被「推进」视图取代）——记入退役清单，将来需要再从 git 史找回。
- `/dashboard` 路由 redirect 到 `/?view=review`；`/api/v1/dashboard/summary` 若仅剩 dashboard 使用则一并退役（迁移的 widget 改用其现有细分数据源）。

## C. 账号状态融入大目标

- 大目标「账号粉丝趋势」区块头部加一行状态条：绑定账号昵称/未绑定提示 · 上次 auto-sync 时间（`user.lastAutoSyncAt`）· 「立即同步」按钮（调用现有手动同步 API）· 「管理账号 →」链接至 `/accounts`。
- `/accounts` 页面保留（扫码绑定/浏览器会话是重流程），纸质风重塑；侧栏常驻入口移除后，入口=大目标状态条 + cockpit 设置视图内链接（**双入口**，防止一期教训「账号入口消失」重演）。

## D. 设置合并 + 视觉统一 + 侧栏收编

- cockpit「设置与备份」视图新增两张卡：AI Provider（key/模型，搬 `/settings` 现有表单逻辑）与 Baseline（账号基准播放数）；`/settings` redirect 到 `/`（cockpit 设置无独立 URL，redirect 首页即可）。
- **侧栏「平台」组解散**：创作/数据/设置三项移除；账号如上双入口。`ExternalShell` 仅剩 `/accounts`、`/agent/discover`、`/content/*` 子页使用。
- **纸质风重塑**存留页：`/accounts`、`/agent/discover`、`/content/preflight|script|retro-sync`——替换蓝紫渐变与 shadcn 深色卡片为 cockpit panel/badge/按钮类；重塑为样式层改动，不动业务逻辑。
- `.bg-brand-gradient` 全站清点：仅保留发布/CTA 类点缀或全部退役（实施时统一决断并记录）。

## 不做（YAGNI）

- 不在抽屉内做多轮改稿对话（一期 /agent 也没有）；不迁 StatsBar/OverallScoreTrend/NextSteps；不做 dashboard 数据的新图表；不动爬虫/预测/复盘任何后端管线；不新增 Prisma 模型（本期零建模，纯前端重组 + 动作改向）。

## 风险

| 风险 | 对策 |
|---|---|
| A1 回填映射错字段 | 映射纯函数 + 每平台 schema 一组用例 |
| widget 搬移断数据 | 数据 hook 原样搬，先渲染对齐再删旧页 |
| 入口消失（一期教训） | 账号双入口；所有 redirect 保留旧 URL 可达 |
| 侧栏改动回归 | `ExternalShell`/`sidebar.tsx` 双模式已有测试基线，改动后全量回归 |

## 实施顺序

1. **A**（AI 就地化，价值最大先行）：映射纯函数 + 抽屉生成 UI + discover 改向 + /agent 退役
2. **B**（数据迁移）：widget 搬移重塑 ×2 视图 + /dashboard 退役
3. **C+D**（状态条/设置卡/侧栏收编/重塑）：一批完成
4. **收尾**：redirect 清点、退役清单、README/spec 回写、端到端走查

---

## 实际实施结论（Task 8 回写）

8 个 Task 全部完成（`.superpowers/sdd/2026-08-05-platform-pages-fusion/progress.md` 账本），与本 spec 存在以下已知偏差，逐条记录供后续参考：

### (a) `/api/v1/dashboard/summary` 端点保留，未按原计划退役

Spec 原文（B 节）写"`/api/v1/dashboard/summary` 若仅剩 dashboard 使用则一并退役"。实际实施（T4）中，迁移到复盘实验室「预测与校准」区块与大目标「内容表现」区块的两个新面板（`prediction-panel.tsx`、`performance-panel.tsx`）仍靠 `use-dashboard-summary.ts`（module-level in-flight promise 缓存 hook）请求这同一个端点取数——"仅剩 dashboard 使用"的前提从未成立，因此端点原样保留，未做任何改动。`src/app/dashboard/page.tsx` 本身虽在 T6 被删除，但其消费的聚合逻辑 `src/lib/dashboard/aggregate.ts` 与该 API 路由都活着，现在是二期两个新面板的数据源。

### (b) ScriptForm/ScriptResult + `/content/script/new` 保留为深度写稿入口

Spec A1/A3 描述"抽屉内就地生成"取代 `/agent` 向导，但从未提议删除 `ScriptForm`/`ScriptResult` 组件或 `/content/script/new` 路由。T6 删除 `/agent` 壳页前逐一 grep 了这两个组件的存活消费方：唯一消费方是 `/content/script/new/page.tsx`（ScriptForm）与 `/content/script/[id]/page.tsx`（ScriptResult），均为独立深度写稿入口，按 brief 要求原样保留。二者与抽屉内就地生成是互补关系而非替代关系：抽屉内生成偏「快速起草不出抽屉」，`/content/script/new` 仍是唯一支持完整多区块编辑、以及历史 `?ideaId=` 选题采纳回写链路的入口。

### (c) `/settings` `/settings/baseline` redirect 目的地从 `/` 升级为 `/?view=settings`

T6 第一轮实现按 spec D 节字面（"cockpit 设置无独立 URL，redirect 首页即可"）把两条 redirect 都指向裸 `/`，落地后发现 `Cockpit.tsx` 的 `initialViewFromSearchParams`（`~line 483`）只识别 `DEFAULT_NAVIGATION_ORDER` 里的 6 个可拖拽视图，不认字面量 `"settings"`（尽管 `NavView` 类型允许、侧栏「设置与备份」按钮本就是靠 `setView("settings")` 切过去的）——同时 `src/components/content/prediction-card.tsx` 里两处硬链 `/settings/baseline` 经 307 落到 `/` 后会停在 momentum 视图，形成死链。review round 1 判定这是真实的用户可达性缺口，修复方案：`initialViewFromSearchParams` 补一条 `settings` 分支，`next.config.js` 两条 redirect 目的地都改为 `/?view=settings`，`prediction-card.tsx` 两处链接同步改指。这使得 spec 未明确提及的「settings 视图可通过 URL 直达」成为实际实现的一部分。

### (d) StatsBar/OverallScoreTrend/NextSteps/AccountRecent/QuickCreate 退役清单

Spec B 节明确写"不迁移"的只有 StatsBar / OverallScoreTrend / NextSteps 三项。实际实施（T6）中，旧 `/dashboard` 页面自身还引用了另外两个非 spec 提及的组件——`AccountRecent`、`QuickCreate`（以及 dashboard 专属的 `EmptyState`，与 `accounts/empty-state.tsx` 是两个不同文件）。这三者是页面自身的展示/CTA 组件，不属于"7 个 widget"清单，随页面整体删除时一并处理，删除前 grep 确认其唯一消费方就是被删的 `dashboard/page.tsx` 本身，无其他存活引用，因此安全删除。**实际退役清单是 6 个组件**：`stats-bar.tsx`、`overall-score-trend.tsx`、`next-steps.tsx`、`account-recent.tsx`、`quick-create.tsx`、`dashboard/empty-state.tsx`，均随 `src/components/dashboard/` 整个目录一起 `git rm`（其余 7 个真正的数据 widget 全部 `git mv` 到 `src/components/cockpit/analytics/` 保留使用）。

### (e) `POST /api/v1/cockpit/inspirations` create+bump 事务化（主写路由不 fail-soft）

Spec A2 未讨论这条新路由的错误处理策略。T3 review round 1 指出：既有的三个 `bumpCockpitRev` 调用先例（picked/auto-sync/retro-worker）都是 fail-soft（inner try/catch + `console.warn`，因为它们是次要旁路 hook）；但本路由的 cockpit 写入*就是*主操作，如果沿用 fail-soft，会让「行已成功写入」变成「客户端收到 500 失败」（信号不实），且会重新打开一期教训过的覆盖窗口——行落库但 rev 未失效，已打开的标签页下次整页保存会悄悄覆盖掉刚写入的灵感。裁决：`bumpCockpitRev` 加可选 `client: Prisma.TransactionClient | PrismaClient` 参数，本路由把 `create` + `bumpCockpitRev` 包进同一个 `prisma.$transaction`，且**不吞掉 bump 失败**（异常传播为 `fail(500)`）；三个既有 fail-soft 调用点不受影响（不传第二参数，用默认顶层 `prisma`，行为不变）。

### (f) 其他 T1-T7 报告中发现的实际偏差

- **`title-feedback` 集成方式**：spec A3 只说"轻量集成，非弹窗"，未定具体触发点；实际实现（T2）挂在抽屉脚本 tab `headline` 字段的 `onBlur`，1.5s 防抖 + 同值不重发，失败静默（不设 hint、不弹 toast）。
- **灵感入池链路事实上单一化**：spec A2 只说"discover 改向"，未提及一期遗留的「选题池」（`TopicIdea`/`PoolButton`/`/agent?topic=&ideaId=`）链路的命运。T6 删除 `/agent` 首页壳页后，`PoolButton` 组件的唯一消费方随之消失，变成 0 消费方的死代码（brief 要求保留组件本身，删除决策留给后续 cleanup）；`ideaId` query param 兼容读取（`ScriptForm`）与 `ADOPTED` 回写（`script-result.tsx`）逻辑仍在但已无任何 UI 会生成带 `ideaId` 的链接——这条链路从"仍在但少用"变成"代码活着但完全不可达"，超出 spec 原本预期的范围，已记入 README §9 遗留清理候选。
- **`settings.tsx` 第三张卡未按 brief 字面单独拆文件**：T5 brief 明确写"拆 ai-provider-card.tsx、baseline-card.tsx"，账号管理卡是纯静态链接（无状态无副作用），直接内联在 `settings.tsx`，未单独拆分——不算 spec 偏差但值得记录，未来若要加账号状态摘要需要先拆文件。
- **T5 fix round 1**：`settings.tsx` 里保留的旧「AI 辅助」静态卡（写死 `OPENAI_API_KEY` 环境变量说明）与新 `AIProviderCard` 内容重复且已过时（真实配置早走 `AIConfig` 表 + 加密存储），review 判定不应等到 T6 才清理，当场删除。
- **T6 straggler 二轮修复**：第一轮 grep 排除子路径 href 时用 `grep -v` 按整行过滤，误伤了活在 `/agent/patterns`、`/agent/inspiration` 目录内、内容其实是裸 `/agent` 硬链接的两处 straggler；改用精确正则 `['"\`]/agent(['"\`?]|$)` 重新扫描后发现并修复：`agent/patterns/page.tsx` 「去写脚本 →」、`agent/inspiration/page.tsx` 「用这个生成」标签，均改指 `/content/script/new`。
- **T7 蓝紫渐变退役的杠杆点**：没有逐个改 12 处 `variant="brand"` 调用点，而是只改 `src/components/ui/button.tsx` 的 `brand` variant 定义本身（一处改动覆盖全部调用点），另有 6 处字面量 `bg-brand-gradient`/`text-brand-gradient` 用法逐个替换，`src/components/inspiration/insight-panel.tsx` 虽不在 brief 文件清单内但因被 `/agent/inspiration` 页引用且含渐变类，为满足「zero references」硬性要求一并处理。
