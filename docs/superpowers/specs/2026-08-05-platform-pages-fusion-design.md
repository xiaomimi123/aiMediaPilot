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
