# MediaPilot

> AI 自媒体工作台 — 自用创作闭环: 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据复盘。 主阵地抖音, 其他平台 (B站/YouTube/推特/小红书/公众号/快手/微博) 走分发登记。 设计预留 SaaS 扩展空间 (`userId` 隔离已在 schema, 未接 auth/计费)。

**当前状态:** 单用户 MVP。 经历三次定位调整: "个人视频分析工具" → "小白向导式智能体" → "自用自媒体工作台" → **"Creator Cockpit 整体移植"** (2026-08-04, 详见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`)。 首页 `/` 与全站外壳已换成移植自开源项目 [creator-cockpit](https://github.com/AverrryHu/creator-cockpit) 的纸质编辑部风格操作台; 紧接着完成**二期「平台页面融入驾驶舱」** (2026-08-05, 详见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`)——把一期挂壳的创作/数据/设置页面功能长进驾驶舱视图, 侧栏「平台」组解散。 本文档 §3 为当前实际 IA。

---

## 1. Product Vision (当前: 工作台定位)

### 当前定位

**用户:** 自己 (AI 知识类抖音博主), 保留未来扩展给其他博主的可能 (`userId` 隔离已在 schema 里, 未来接 SaaS 需要另加 auth/计费中间件)
**覆盖环节:** 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据/复盘, 完整创作闭环 (见 §3 `/` 工作台首页)
**平台策略:** 主阵地 + 分发登记。 抖音是主阵地 (创作闭环 + L1 预测 + 复盘全在这里); 其他平台只登记"这条内容分发到了哪", 不做独立创作流
**不做:** 一键发布、看板拖拽改状态、SaaS 计费 (本期范围外)

### 历史定位 1: 小白向导式智能体 (第一次 pivot, 已被工作台定位取代)

**用户:** 想做自媒体但不知道怎么开始的小白
**核心交互:** 向导式智能体 — 选平台 → 选垂类 → 输 topic → 出 platform-ready 内容
**平台:** 抖音 / 小红书 / 公众号 (3 平台同时支持,文风差异由 platform-specific prompts 处理)

这一版的产物 (多平台脚本生成、`/agent` 向导页) 被保留并整合进当前工作台, 但面向小白的教学引导 (三步教学卡、"第一次来"新手引导) 已在工作台重定位中压缩/移除 —— 自用工具不需要新手教程。

### 历史定位 0: 个人视频分析工具 (pivot 前) — 保留为深度功能

视频上传 → AI 4 维诊断 → L1 播放量预测 → 发布后 retro 复盘 → calibration 闭环。
这条线 (Phase 1 + L1 + retro) **保留**,是当前工作台看板"已拍待发/已发布/已复盘"三列的数据来源。

---

## 2. 14 Sub-projects 全景

### 仍然核心 (post-pivot)

| ID | 内容 | 状态 |
|---|---|---|
| **E** | Script 生成 (DeepSeek + zod schema) | ✅ 3 平台 (抖音/小红书/公众号) 各自 prompt + schema |
| **F** + **K2** | Script ↔ Analysis 双向链 (URL `?fromScript=` + DB FK) | ✅ |
| **H** + **I** | UI 风格 (Stitch 设计,蓝紫渐变,中文化) | ✅ 已被 Cockpit 纸质编辑部风格取代 —— `.bg-brand-gradient`/`.text-brand-gradient` 二期 (T7) 已全部退役 (`button.tsx` 的 `brand` variant 与其余 6 处字面量用法均改为 cockpit clay 强调色), 全仓库 `grep brand-gradient` 零残留 |
| **G** | Mobile 响应式 (drawer + 卡 stack) | ✅ |
| **M** | finalTitle 实时 AI 反馈 (DeepSeek 评分 + 改进建议) | ✅ `title-feedback` API 已支持 `platform` 参数 |

### 改造能用

| ID | 内容 | 待改 |
|---|---|---|
| **A** | 账号视频通常播放数 (baseline) | 概念偏视频,新场景下需重设计,当前不动; 二期 (T5) 已从 `/settings/baseline` 挪进 cockpit 设置视图「Baseline」卡, 旧路由已删除 (redirect → `/?view=settings`) |
| **J** | 发前 publish checklist (5 项 + isReady) | 仍是视频专属单一 schema,未按平台拆分 (Roadmap Phase D,未做) |

### 老视频管线 — 保留为深度功能

| ID | 内容 |
|---|---|
| **Phase 1** | 视频上传 + ffmpeg 预处理 + 4 维 AI 评估 (hook/retention/title-caption/cover) + Whisper 转录 + synthesize 综合评分 |
| **L1** | 播放区间预测 (baseline × scoreMultiplier × calibrationFactor) |
| **C** | Retro 半自动 (review.py list + 手动 dropdown 匹配) |
| **D** | Auto-sync cron 12h + bigram Dice 0.8 fuzzy match |
| **B** | Phase 3 Dashboard 7 widget (StatsBar / OverallScoreTrend / Calibration / PredictionAccuracy / Niche / Top / Misses) | 二期 (T4/T6) `/dashboard` 页整体退役: Calibration/PredictionAccuracy/Misses → 迁移进复盘实验室「预测与校准」区块; Niche/Top → 迁移进大目标「内容表现」区块; StatsBar/OverallScoreTrend 连同页面自身的 QuickCreate/AccountRecent/EmptyState 一并退役删除 (无迁移, 首屏信息与其他视图重复), 数据源 `GET /api/v1/dashboard/summary` **保留**未退役 (两个新 widget panel 仍靠它取数, 未按 spec 原计划"仅剩 dashboard 用就退役") |
| **L** | NextSteps "下一步" widget (待发 / 待复盘 / 草稿待拍 3 计数) | 二期 (T6) 随 `/dashboard` 一起退役删除, 未迁移 (职责已被「今日推进」视图取代) |

---

## 3. 当前 IA (Creator Cockpit 全面接管 + 二期融合)

首页 `/` 与全站外壳已替换为移植自开源项目 [creator-cockpit](https://github.com/AverrryHu/creator-cockpit) 的纸质编辑部风格操作台 (一期, 详见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`)。 旧工作台看板/内容库列表页/旧侧栏已删除。

**二期 (平台页面融入驾驶舱, 详见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`) 已完成**: 侧栏「平台」组 (创作/数据/设置三项外链) **已解散**——AI 写稿、数据看板、AI key/baseline 三块功能已分别**长进**驾驶舱六视图内部 (不再是独立挂壳页面); `/agent` `/dashboard` `/settings` 三个旧壳页已删除, 全部 redirect 回 `/` 的对应视图 (见下方 redirect 表)。 `/accounts` 保留为双入口 (侧栏不再常驻, 但大目标状态条 + 设置视图账号卡 + 移动端导航项三处可达)。 二期还把蓝紫渐变 (Stitch 风格残留) 全面退役, 存留的站外页面 (`/accounts`、`/agent/discover`、`/content/*`) 视觉统一为 cockpit 纸质编辑部风格。

### Sidebar

侧栏 (`src/components/cockpit/sidebar.tsx`) 现在只有一段, 全站统一:

```
灵感池 / 今日推进 / 档期规划 / Pipeline / 大目标 / 复盘实验室   ← Cockpit 六视图, 在 / 内切换 (可拖拽排序)
                                                              站外页面挂入壳时渲染成 /?view=<id> 静态链接
```

`settings` 是六视图之外的第七个 view state (不参与拖拽排序, 不在侧栏渲染), 只能通过「设置与备份」按钮或 `/?view=settings` 直达。 `/accounts` 不在侧栏里 (二期解散的「平台」组唯一残留的落地页), 入口见下方双入口说明。

### `/` — Cockpit 驾驶舱 (首页)

`src/app/page.tsx` 只 `dynamic import` 一个客户端组件 `Cockpit.tsx` (`ssr:false`), 内部按 `view` state 切换六个可拖拽视图 (`src/components/cockpit/views/*.tsx`: inspirations / momentum / schedule / pipeline / goals / review) + 一个不可拖拽的 `settings` 视图, 均是原样移植的纯 UI + 交互逻辑 (`src/lib/cockpit/{model,workflow,schedule,calculations}.ts` 与其测试一并搬运, 逻辑零改动)。 首次进入 (workspace 为空) 走 onboarding; 支持明暗主题 + 5 套设计风格切换, 侧栏可拖拽排序、可折叠; <820px 时侧栏收起, 换成底部 `.mobile-nav`。

### `/accounts` `/agent/discover` `/content/*` — 挂入 Cockpit 外壳

根布局 (`src/components/layout/main-layout.tsx`) 按路径判断: 非 `/` 时用 `ExternalShell` (`src/components/cockpit/external-shell.tsx`) 包一层, 复用同一个 `Sidebar`(`mode="external"`) + `.main-area` 容器 + 移动端 `.mobile-nav`, 主题/风格从 cockpit 写入的 localStorage 同步。 二期起 `ExternalShell` 仅剩 `/accounts`、`/agent/discover`(及其未挂导航的兄弟页 `inspiration`/`patterns`)、`/content/preflight|script|retro-sync` 使用 (`/agent` `/dashboard` `/settings` 三个壳页已删除)。 这些存留页面二期 (T7) 已做纸质风重塑 (样式层改动, 业务逻辑零改动)。

### 新功能位置表 (二期融合后)

| 功能 | 一期挂壳位置 (已删除) | 二期新位置 |
|---|---|---|
| AI 写稿 | `/agent` 向导页 | 内容抽屉「脚本」tab 就地生成按钮 (三平台下拉选择器 + 生成中态; 标题字段失焦 1.5s 防抖调用 `title-feedback` 展示一行建议) |
| 灵感抓取/热点 | `/agent` 首页推荐行「+ 入选题池」 | `/agent/discover` (保留路由) 每条主题卡「存入灵感池」→ 写 `CockpitInspiration`, 灵感池视图右上角「抓灵感 →」跳回该页 |
| 数据看板 (预测准确率/校准/Misses/Niche/Top) | `/dashboard` | 预测准确率·校准矩阵·Misses → 复盘实验室底部「预测与校准」区块; Niche·Top → 大目标「内容表现」区块 |
| AI key 配置 | `/settings` | cockpit 设置视图「AI Provider」卡 |
| 账号基准播放数 (baseline) | `/settings/baseline` | cockpit 设置视图「Baseline」卡 |
| 手动同步 | `/settings` 或账号页内触发 | 大目标「账号粉丝趋势」状态条「立即同步」按钮 (`POST /api/v1/douyin/auto-sync/trigger`) |
| 账号绑定/管理 (深流程) | 侧栏常驻「账号」入口 | **保留** `/accounts` 页面本身, 但侧栏入口移除, 改为双入口: 大目标状态条「管理账号 →」链接 + 设置视图账号管理卡 + 移动端底部导航「账号」格 |
| 深度写稿 (完整多区块生成, 非抽屉内快速生成) | `/agent` | `/content/script/new`(保留, `ScriptForm`/`ScriptResult` 组件未删除, 仍支持 `?topic=&ideaId=&platform=&niche=&inspirationId=` 预填) |

### redirect 表 (`next.config.js`)

| 旧 URL | 目的地 | 说明 |
|---|---|---|
| `/agent` | `/?view=pipeline` | 307, 精确匹配, `/agent/discover` 等子路径不受影响 |
| `/dashboard` | `/?view=review` | 307 (目的地查询值经三期兼容映射折叠进 analytics 视图 review tab, 见下方说明) |
| `/settings` | `/?view=settings` | 307 (二期实施中从最初的 `/` 升级为直达 settings 视图, 见 spec 实际实施结论) |
| `/settings/baseline` | `/?view=settings` | 307, 同上 |

保留可直接访问的路由 (不 redirect): `/agent/discover`、`/agent/inspiration`、`/agent/patterns`、`/accounts`、`/content/script`、`/content/script/new`(深度写稿入口)、`/content/script/[id]`、`/content/preflight`、`/content/retro-sync`。

**三期 (产出优先信息架构重组) 起旧 `?view=` 兼容映射**: redirect 表目的地里出现的 `schedule`/`goals`/`review` 三个旧 view 值不再是独立视图, 由 `src/lib/cockpit/view-routing.ts` (`resolveInitialView`/`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab`, 单测 `tests/lib/cockpit/view-routing.test.ts`) 精确折叠: `?view=schedule` → momentum 视图 + 档期 tab; `?view=goals` → analytics 视图 + 目标 tab; `?view=review` → analytics 视图 + 复盘 tab; `inspirations`/`momentum`/`pipeline`/`settings` 及五个 `platform-*` 原生直达; 其余非法/缺省值一律回退 momentum。

### `/content` 的变化

- 列表页 (`src/app/content/page.tsx`) 已删除, 由 Cockpit **Pipeline** 视图 (`/?view=pipeline`) 取代。
- 子路由保留: `/content/preflight`(视频分析 Phase 1/L1)、`/content/script`(AI 脚本生成详情页, 含分发登记; `/content/script/new` 为深度写稿入口)、`/content/retro-sync`(半自动复盘) —— 未挂进侧栏导航, 但仍是抽屉/inspiration/patterns 页跳转深度写稿、发布登记、复盘流程内部跳转的落点, 照常可直接访问。

### Cockpit 数据层

- **10 张 Prisma 表**: `CockpitContent` / `CockpitInspiration` / `CockpitStageEvent` / `CockpitReviewDay` / `CockpitLiveSession` / `CockpitScheduleObjectType` / `CockpitScheduleObject` / `CockpitGoalCycle` / `CockpitInsightRule` / `CockpitPrefs`, 字段形状与 vendor `model.ts` 的 TS 类型一一对应, 保证移植过来的纯函数直接可用。 `FollowerSnapshot` **不建表**: `GET /api/v1/cockpit/workspace` 时从既有的 `AccountMetric` (爬虫每日写入) 实时派生, `PUT` 忽略该字段。
- `GET/PUT /api/v1/cockpit/workspace`: GET 组装整个 `WorkspaceState` 返回; PUT 提交整个 `WorkspaceState` + 加载时拿到的 `rev`, 服务端 diff 落库, 若 `rev` 与当前不一致 (双标签页并发保存) 返回 **409**, 前端弹冲突提示, 不做自动合并 (单用户场景接受 last-write-wins + 显式提示, 不做 CRDT 之类的方案)。
- 前端存储适配器 `src/lib/cockpit/storage.ts` (`loadWorkspace`/`saveWorkspace`) 替换掉原版的 IndexedDB 读写, 是移植时唯一改动的一层; `src/lib/cockpit/migrations.ts` 只搬运了 vendor `storage.ts` 里 `migrateWorkspace` 这一个纯函数 (老版本 workspace 字段升级), 其余 IndexedDB 相关代码没有移植。
- 强能力集成点: **AI 写稿** (二期起内容抽屉脚本 tab「用 AI 写脚本」按钮就地调用生成管线并回填, 不再跳转 `/agent`; 保存定稿自动把关联 `CockpitContent` 的 script 阶段推进完成) · **爬虫指标回填** (auto-sync 命中已发视频写入播放/点赞/收藏/评论快照) · **粉丝快照** (`AccountMetric` 派生 `FollowerSnapshot` 喂 `calculateGoalHealth`) · **L1 预测对比** (复盘实验室展示预测区间 vs 实际播放, 结论可沉淀为 `InsightRule`)。
- 备份/导入导出 UI 未移植 —— 数据库本身就是持久化底座, 版本记录 (`版本记录` 弹窗) 里仍保留历史版本可查看/导出, 但没有单独的「导入导出 JSON」界面 (原版基于 IndexedDB 需要这个, 我们不需要)。

存量数据一次性迁移到 Cockpit 表见 §6; 老流水线 (`ScriptDraft`/`TopicIdea`/`Distribution`) 的阶段派生规则见 §3.5, 迁移脚本复用同一套判定。

### `vendor/creator-cockpit/`

移植源码的只读参考副本, 固定在 commit `197d49b93ff42d80211c1d832d1f8fa8db7c6660` ([AverrryHu/creator-cockpit](https://github.com/AverrryHu/creator-cockpit), MIT License, Copyright (c) 2026 Avery)。 `tsconfig.json` 显式 `exclude` 了 `vendor`, 不参与构建也不会被任何 `src/` 代码 `import` —— 纯粹留作逐行对照 (排查移植差异、日后想再搬一部分东西时的对照源), 不需要跟随其上游更新。

### 3.5 数据模型: 管线阶段派生 (支撑 `/content` 子路由与迁移脚本)

`ScriptDraft` 是老流水线的基本单元 (曾经是已删除的工作台看板的数据源, 现在是 `/content/script` 详情页和一次性迁移脚本的数据源)。 **阶段不落库, 按现有数据实时派生**, 判定唯一入口是纯函数 `deriveStage` (`src/lib/pipeline/stage.ts`), UI / API / 迁移脚本都调用它, 不内联复制规则, 避免双写不一致:

| 阶段 | 判定规则 |
|---|---|
| 📝 草稿 (`DRAFTING`) | `picked == null` |
| ✅ 定稿待拍 (`READY`) | `picked != null` 且无关联 `analysis` |
| 🎬 已拍待发 (`SHOT`) | 有关联 `analysis`, 且未发布 |
| 🚀 已发布 (`PUBLISHED`) | `analysis.publishedAt != null` **或** 存在任一 `Distribution` 记录 |
| 📊 已复盘 (`RETROED`) | `analysis.retroStatus === 'COMPLETED'` |

缺失数据 (analysis 被删导致悬空) 一律降级到更早阶段, 不抛错。 归档 (`ScriptDraft.archivedAt` 非空) 的卡不进看板。 没链接 `ScriptDraft` 的孤儿 `ContentAnalysis` (老数据, 直接上传视频分析) 也进看板, 从「已拍待发」起算。

新增 Prisma 模型:

- **`TopicIdea`** (选题池): `title` / `note` / `source` (`discover` | `inspiration` | `manual`) / `status` (`POOL` | `ADOPTED` | `DISCARDED`) / `scriptDraftId` (采纳后回链)。
- **`Distribution`** (分发登记): `scriptDraftId` + `platform` (代码注册表 key, 非 DB enum, 见 `src/lib/pipeline/platforms.ts`) + `url` + `publishedAt` + `note`。 抖音主阵地发布仍走 `ContentAnalysis.publishedAt` (喂 L1 预测 / retro 管线); `Distribution` 管其他平台的搬运登记, 未走视频分析直接发布的内容也可用 `platform='douyin'` 的 `Distribution` 兜底登记 (不参与 retro)。
- **`ScriptDraft.archivedAt`** (`DateTime?`): 放弃的内容标记归档, 不删数据。 字段与 `PATCH /api/v1/scripts/[id] { archived }` 路由仍在, 但触发它的「归档」按钮曾挂在已删除的旧工作台看板卡片上 —— 目前没有 UI 入口调用, 相当于遗留能力, 未来若做类似操作可直接复用这条路由。

分发平台注册表 (`src/lib/pipeline/platforms.ts`, 加新平台 = 加一行, 不改 DB schema): 抖音 / B站 / YouTube / X-推特 / 小红书 / 公众号 / 快手 / 微博 (共 8 个)。 与 `src/lib/platform.ts` 的采集端 `Platform` enum、创作端 `ContentPlatform` 是两套独立命名空间 —— 这里管"内容搬运到了哪"。

API: `POST/GET /api/v1/topics`、`PATCH /api/v1/topics/[id]`、`POST/GET /api/v1/scripts/[id]/distributions`、`DELETE /api/v1/distributions/[id]`。 (旧工作台看板专用的 `GET /api/v1/workbench` 聚合接口已随看板一起删除。)

### 关键交互流

1. **灵感抓取**: `/agent/discover` 页每条主题卡「存入灵感池」按钮 (`POST /api/v1/cockpit/inspirations`), 直接写入 Cockpit 灵感墙 (`CockpitInspiration`); Cockpit 灵感墙视图右上角「抓灵感 →」跳回该页。 二期起这是灵感进入系统的唯一活跃路径——`TopicIdea`(选题池) 表与配套的 `PoolButton`/`ideaId` 预填链路是 `/agent` 首页 (已随壳页一起删除) 的产物, 现无任何 UI 入口可达, 属遗留能力 (`PoolButton` 组件、`ScriptForm` 对 `ideaId` query param 的兼容读取、`script-result.tsx` 里 `ideaId` 存在时的 `ADOPTED` 回写均原样保留代码, 只是没有链接会带上 `ideaId` 了); `POST/GET /api/v1/topics` 等 API 仍在但无写入方。
2. **分发登记**: script 详情页 (`/content/script/[id]`) + 分发登记弹窗, 选平台 (注册表 key) + 贴 URL → 写一条 `Distribution` 记录, 显示「已分发 N 平台」徽标。
3. **复盘闭环**: 现有 retro / auto-sync 不动; Cockpit 复盘实验室视图承接「待复盘 / 复盘倒计时」的展示职责 (原来在旧看板已发布列)。

---

## 4. Roadmap — 分阶段实施 (Phase A-C 已完成)

不一次性 5 天大重构,分小步走,每步可发布。 **这是第一次 pivot (小白向导) 时定的 roadmap; Phase A-C 已完成, D 未做, E 仍是未来事项。** 工作台重定位 (第二次 pivot) 是独立的后续 spec, 见 `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md`, 其自身的 12 个 Task 均已完成 (数据层 → 工作台首页 → 交互流 → 本文档)。 Creator Cockpit 整体移植 (第三次 pivot, 见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`) 又是独立的后续 spec, 14 个 Task 均已完成 —— 替换了第二次 pivot 引入的工作台首页/看板/侧栏。 **平台页面融入驾驶舱 (二期, 见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`) 8 个 Task 均已完成** —— 把一期挂壳的 `/agent`/`/dashboard`/`/settings` 三页功能长进驾驶舱六视图, 侧栏「平台」组解散 (§3 为当前实际 IA)。 Phase A-C 的产物 (脚本多平台生成、`/content` 子路由) 保留不受影响。

### ✅ **Phase A: Script 多平台化** — 已完成

1. ✅ ScriptDraft 加 `platform` 列 (`'douyin' | 'xiaohongshu' | 'gongzhonghao'`)
2. ✅ 拆分 prompts: `script-generate-douyin.ts` / `script-generate-xiaohongshu.ts` / `script-generate-gongzhonghao.ts`
3. ✅ POST `/api/v1/scripts/generate` 加 `platform` 参数 → 路由到对应 prompt
4. ✅ UI ScriptForm 加 Step 1 platform 选择器
5. ✅ UI ScriptResult 按 platform 渲染不同 schema
6. ✅ 单测覆盖每平台 prompt schema

### ✅ **Phase B: IA 重组** — 已完成 (后续被工作台重定位进一步扩展为 6 项 sidebar, 见 §3)

1. ✅ `/agent` 顶级路由
2. ✅ Sidebar nav 简化
3. ✅ 底部 CTA 改 "+ 新内容" → `/agent`
4. ✅ `/content` 合并 scripts + analyses (统一列表 + 类型 badge)
5. ✅ 老入口仍可访问 (向后兼容)

### ✅ **Phase C: M 多平台化** — 已完成

`POST /api/v1/checklist/title-feedback` 已支持 `platform` 参数, 不同平台走不同"好标题"评价标准。

### ⬜ **Phase D: J 改造为多平台 publish checklist**（可选, 未做）

`src/lib/checklist/types.ts` 目前仍是单一 (视频专属) checklist schema, 未按平台 (抖音/小红书/公众号) 拆分发布前检查项。

### ⬜ **Phase E: SaaS 准备**（未来, 未做）

- NextAuth 登录
- 数据 userId 隔离 (DB schema 已经有 userId, 但中间件需要严格 user scope)
- Stripe 计费
- API quota / rate limit

**这阶段不在当前 sprint 范围。**

---

## 5. 技术债 & Known Issues

### Schema / Data

- `User.baselinePlays` (L1) — 视频专属概念, 新场景下 score multiplier 失去意义。 留着不动。
- `ContentAnalysis.publishChecklist` (J) — 视频专属。
- 新增 `ScriptDraft.platform` 后,现有数据是抖音,需 migration 设默认值。

### Code 重复

- `match-douyin` POST route + `runAutoSync` 中 "写 douyinAwemeId + enqueue retro" 逻辑重复 (~ 25 行)。 抽 helper 留 future。
- 多个 prompt 文件用同一 `getExpertPersona(niche)` + `JSON_STRICTNESS` 头尾, 但每个文件自己拼。 可以抽 `composeSystemPrompt(niche, taskDescription)` helper。

### LLM 配置

- 视频管线 vision LLM 是 Bailian Qwen-VL,文本 LLM 是 DeepSeek。
- API keys 当前在 `.env` (DEEPSEEK_API_KEY, OPENAI_API_KEY, OPENAI_BASE_URL 等)
- 多 user SaaS 时需用 AIConfig 表 (schema 已存在,但 worker 现在直读 env)

### 测试覆盖

- 554 tests 大多是 API 单测 + 纯函数 + mock prisma (含 Cockpit `model/workflow/schedule/calculations`/迁移映射的原版测试)
- UI 一律走手动 E2E (是有意识的取舍)
- Worker 集成测试缺 (auto-sync-worker, content-analyze-worker)

---

## 6. 本地开发

### 基础启动

```bash
# 1. 配置 .env (从 .env.example 复制 + 填 DEEPSEEK_API_KEY 等)
cp .env.example .env

# 2. 启 Postgres + Redis
docker compose up -d postgres redis

# 3. 同步 schema (无 migrations, 用 prisma db push)
npx prisma db push

# 4. 安装依赖
npm install

# 5. 跑 dev + worker (各开一个 terminal)
npm run dev          # http://localhost:3000
npm run worker:dev   # BullMQ workers (analyze / retro / auto-sync)
```

### 测试

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest, 554 tests across 68 files (含 Cockpit 纯逻辑层原版测试)
npm test -- <filter> # 跑某个 file
```

### Schema 改动

```bash
# 改完 prisma/schema.prisma 后
npx prisma db push   # 同步 + regenerate client
# (项目用 db push 而不是 migrations, dev 简单)
```

### 重启 dev / worker (改 schema 后必须)

dev server 和 worker 都缓存 prisma client。 schema 改后必须重启它们才能用新字段。

### 存量数据迁移到 Cockpit (一次性)

```bash
npx tsx scripts/migrate-cockpit.ts          # dry-run (默认): 只打印映射清单+汇总, 不写库
npx tsx scripts/migrate-cockpit.ts --apply  # 人工确认 dry-run 输出无误后再写库
```

把老表 (`ScriptDraft`/`ContentAnalysis`/`ActualMetric`/`TopicIdea`/`InspirationVideo`) 一次性映射进
`CockpitContent`/`CockpitStageEvent`/`CockpitInspiration`。阶段判定复用 `deriveStage`
(`src/lib/pipeline/stage.ts`)，纯映射函数见 `src/lib/cockpit/migrate-mapping.ts`。`--apply` 会先检查
目标用户名下 `CockpitContent` 是否已有数据，非空直接中止（防重复迁移）；旧表全程只读，不删不改。
`publishedAt`/`metrics.capturedAt` 这两个"日期部分"字段按 `Asia/Shanghai` (UTC+8) 取年月日
(`dateISOInShanghai`)，与运行时写入方约定一致，避免 UTC 午夜前后跑迁移脚本时日期错位一天。
**必须先在 `/` 完成一次 onboarding（`CockpitPrefs.setupComplete=true`）再执行 `--apply`**——迁移脚本
不经过全量保存的 compare-and-set，若 onboarding 未完成就先写库，页面之后触发的第一次自动保存会用
"空白开始"的全量状态把刚迁移进去的数据整个覆盖清空；`--apply` 会检测该顺序并主动中止。

---

## 7. 目录结构 (重要文件)

```
src/
├── app/
│   ├── page.tsx                  # `/` — 只 dynamic import Cockpit.tsx (ssr:false)
│   ├── cockpit.css                # 全站纸质编辑部风格 (主题变量 + 5 套 design style + mobile-nav)
│   ├── layout.tsx                 # 根布局, 套 MainLayout
│   ├── agent/                     # 二期起仅剩 discover/ inspiration/ patterns 三个子页面, 挂 ExternalShell (`/agent` 本体已删, redirect → `/?view=pipeline`)
│   ├── content/
│   │   ├── preflight/             # 视频分析 (Phase 1, L1) — 列表页已删, 子路由保留
│   │   ├── script/                # 脚本生成详情页 (E) + 分发登记, `script/new` 为深度写稿入口
│   │   └── retro-sync/            # 抖音半自动复盘 (C)
│   ├── accounts/                  # 账号绑定, 挂 ExternalShell (双入口之一)
│   └── api/v1/                    # 所有 API routes (含 topics/ distributions/ cockpit/workspace/ cockpit/inspirations/ douyin/auto-sync/trigger/)
├── components/
│   ├── cockpit/                   # Creator Cockpit 移植主体
│   │   ├── Cockpit.tsx             # 顶层组件: state + view 路由 (六视图 + settings) + 拖拽/主题/onboarding
│   │   ├── views/                 # 六可拖拽视图 (inspirations/momentum/schedule/pipeline/goals/review) + settings.tsx (第七视图, 不参与拖拽)
│   │   ├── analytics/              # 二期 (T4) 从 components/dashboard/ 迁移重塑: prediction-panel/performance-panel + 7 个搬迁 widget + use-dashboard-summary hook
│   │   ├── settings-cards/         # 二期 (T5) 新建: ai-provider-card, baseline-card
│   │   ├── sidebar.tsx             # 全站共用侧栏 (cockpit 模式 + external 模式), 二期起「平台」外链组已移除
│   │   ├── external-shell.tsx      # 站外页面外壳 (侧栏 + mobile-nav + 主题同步), 仅剩 /accounts /agent/discover /content/* 使用
│   │   ├── content-drawer.tsx      # 内容详情抽屉, 二期 (T2) 脚本 tab 加入就地 AI 生成 + 标题实时建议
│   │   ├── onboarding.tsx / shared.tsx
│   ├── content/                   # script-form, script-result (深度写稿入口用), publish-checklist, prediction-card, 分发登记弹窗 etc
│   └── layout/                    # main-layout.tsx (按路径决定是否套 ExternalShell)
├── lib/
│   ├── cockpit/                   # model/workflow/schedule/calculations (纯函数, 零改动移植) + storage.ts(API 适配器) + migrations.ts(migrateWorkspace) + migrate-mapping.ts(存量数据映射) + script-mapping.ts(二期 T1: 生成结果→脚本骨架映射纯函数) + extras.ts/extras-types.ts(复盘/大目标额外数据, 含二期新增 account/settings)
│   ├── llm/                       # DeepSeekTextLLM + OpenAIVisionLLM + prompts/
│   ├── pipeline/                  # deriveStage 纯函数 + platforms.ts 分发平台注册表
│   ├── prediction/                # L1 formula + baseline
│   ├── dashboard/                 # aggregate + calibration + prediction-accuracy (聚合逻辑零改动, 仍是 cockpit/analytics 面板与 `/api/v1/dashboard/summary` 的数据源)
│   ├── settings/                  # 二期 (T5) 新建: baseline-stats.ts (computeRetroStats 纯函数, 从旧 baseline 页抽出)
│   ├── douyin/                    # cheat-on-content adapter + fuzzy + auto-sync
│   ├── checklist/                 # J types + isReady
│   └── prisma.ts
├── jobs/
│   ├── queue.ts                   # 5 BullMQ queues
│   └── workers/                   # 4 workers (bind, analyze, retro, auto-sync)
scripts/
└── migrate-cockpit.ts             # 存量数据 → Cockpit 表, dry-run 默认 / --apply 写库
prisma/
└── schema.prisma                  # User / ContentAnalysis / ActualMetric / ScriptDraft / TopicIdea / Distribution / Cockpit* (10 张) 等
vendor/
└── creator-cockpit/                # 移植源固定副本 (pinned 197d49b, MIT), tsconfig 排除, 不参与构建, 只读参考
docs/superpowers/
├── specs/                         # 每个 sub-project 的 design spec
└── plans/                         # 每个 sub-project 的 task plan
```

---

## 8. 决策记录 (重要选择)

| 决策 | 理由 |
|---|---|
| Single-user (default-user) | 一开始就要 SaaS 是 over-build; 验证产品后再加 auth |
| Prisma `db push` (无 migrations) | dev 速度优先, 一次性单用户产品, migrations 复杂收益低 |
| BullMQ over Trigger.dev / Inngest | 自管 Redis 单机够用, 无云依赖 |
| LLM: DeepSeek (text) + Qwen-VL (vision) + Whisper (local Python) | 中文友好 + 成本低; 测过 kedaya 代理 503 / OpenAI 直接调 模型不可达后选定 |
| Stateless generate + opt-in save | 避免数据库膨胀;用户决定是否记下 |
| 不做 native auto-publish | 平台 API 限制重 + 法律风险; 改成 copy-paste UX / 分发登记 UX |
| Stitch 风格 (蓝紫渐变) | 用户自己拿 AI 设计稿确认的, 不是我猜 |
| 管线阶段不落库, 按数据派生 (`deriveStage`) | 避免状态与真实数据 (picked/analysis/distribution) 双写不一致 |
| 分发平台用代码注册表非 DB enum | 加平台 = 加一行代码, 不用改 schema / migration |
| 工作台看板不做拖拽 (历史决策, 该看板已被 Cockpit Pipeline 视图取代) | 状态由真实动作驱动 (选版本/传视频/登记链接), 拖拽会制造假状态 |
| Creator Cockpit 整体移植 (UI + 交互逻辑复制) 而非照抄视觉重新实现 | 用户认可其纸质编辑部风格与操作台交互逻辑; 移植省去重新设计+踩坑成本, 用 Prisma 换掉 IndexedDB 接入已有数据库 |
| Cockpit 纯逻辑层零改动复制, 只换存储层 | `model/workflow/schedule/calculations.ts` 是「输入 state → 输出新 state」纯函数, 与存储解耦, 换存储不动逻辑风险最低 |
| FollowerSnapshot 不建表, GET 时从 AccountMetric 派生 | 爬虫已经每日写 AccountMetric, 建独立表是重复数据, 派生更简单且不会不同步 |
| 不搬 IndexedDB 备份/导入导出 UI | 数据库本身就是持久化底座, 这套 UI 是原版应对"无后端"环境的权宜设计, 我们不需要 |
| 二期: 侧栏「平台」组解散, 功能长进驾驶舱视图而非留作独立挂壳页 | 消除双产品观感与页面跳转; `/agent`/`/dashboard`/`/settings` 挂壳页退役, 逻辑/数据源保留 (零后端改动) |
| 二期: 账号入口做双入口 (大目标状态条 + 设置视图 + 移动端导航) 而非单一入口 | 吸取一期教训 (侧栏入口消失曾导致功能不可达), 拆掉常驻侧栏项前必须确保至少两条可达路径 |
| 二期: `/content/script/new` (ScriptForm/ScriptResult) 保留为独立深度写稿入口, 不随 `/agent` 一起退役 | 抽屉内就地生成偏「快速起草」, 深度写稿页仍是唯一支持 `?ideaId=` 遗留链路兼容与完整多区块编辑的入口 |
| 二期: `/api/v1/dashboard/summary` 端点保留未退役 (偏离 spec 原计划) | 迁移进复盘实验室/大目标的 widget 面板仍靠它取数, 实施时判断"仅剩 dashboard 使用则退役"的前提不成立 |

---

## 9. 下一步

Phase A-C、工作台重定位 (Task 1-12)、Creator Cockpit 整体移植 (Task 1-14) 与平台页面融入驾驶舱 (二期, Task 1-8) 均已完成。 尚未做的:

1. **Phase D** — checklist 按平台拆分发布前检查项 (`src/lib/checklist/types.ts` 目前仍单一 schema)
2. **Phase E / SaaS 准备** — NextAuth 登录 + userId 中间件严格 scope + 计费, 本期范围外
3. **本地真用一段时间** — 用 default-user 走完整 Cockpit 闭环 (灵感→转内容→档期拖拽→今日勾选→阶段推进→发布登记→复盘录入), 找实际使用中的痛点
4. **人工走查一期 Task 14 未自动化验证项** — onboarding 冷启动、拖拽排期、双标签页 409 提示、明暗/5 风格切换、375px 移动端视觉 (见 `.superpowers/sdd/2026-08-04-cockpit-adoption/task-14-report.md`)
5. **人工走查二期 Task 8 未自动化验证项** — 抽屉三平台生成回填真机走查、discover 存灵感→灵感池 409 横幅、复盘/大目标新区块数据对照、立即同步真实入队观察、设置卡三项功能等价、明暗模式残留检查 (见 `.superpowers/sdd/2026-08-05-platform-pages-fusion/task-8-report.md` 待人工走查清单)
6. **遗留清理候选** — `PoolButton` 组件与 `TopicIdea`/`ideaId` 选题池链路现无任何 UI 入口 (二期起灵感只走 `CockpitInspiration`), 未来若确认不再需要可整体移除; cockpit 设置视图「账号管理」静态链接卡未单独拆文件 (内联在 `settings.tsx`), 后续扩展时再拆

---

## 附录: Sub-projects 详细 spec / plan 索引

- `docs/superpowers/specs/2026-06-12-content-preflight-design.md` (Phase 1 A v1)
- `docs/superpowers/specs/2026-06-12-content-preflight-v2-design.md` (Phase 1 A v2 retro)
- `docs/superpowers/specs/2026-06-14-dashboard-design.md` (Phase 3 B)
- `docs/superpowers/specs/2026-06-15-l1-prediction-design.md` (L1)
- `docs/superpowers/specs/2026-06-15-baseline-settings-design.md` (A)
- `docs/superpowers/specs/2026-06-15-prediction-accuracy-design.md` (B widget)
- `docs/superpowers/specs/2026-06-16-retro-sync-design.md` (C)
- `docs/superpowers/specs/2026-06-16-auto-sync-design.md` (D)
- `docs/superpowers/specs/2026-06-17-script-generate-design.md` (E)
- `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md` (工作台重定位, 第二次 pivot, Task 1-12)
- `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md` (Creator Cockpit 整体移植, 第三次 pivot, Task 1-14)
- `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md` (平台页面融入驾驶舱, 二期, Task 1-8)
(Plan files in `docs/superpowers/plans/` 对应每个 spec)
