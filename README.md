# MediaPilot

> AI 自媒体工作台 — 自用创作闭环: 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据复盘。 主阵地抖音, 其他平台 (B站/YouTube/推特/小红书/公众号/快手/微博) 走分发登记。 设计预留 SaaS 扩展空间 (`userId` 隔离已在 schema, 未接 auth/计费)。

**当前状态:** 单用户 MVP。 经历两次定位调整: "个人视频分析工具" → "小白向导式智能体" → **"自用自媒体工作台"** (2026-08-03, 详见 `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md`)。 本文档已按工作台定位更新, §3 为当前实际 IA。

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
| **H** + **I** | UI 风格 (Stitch 设计,蓝紫渐变,中文化) | ✅ |
| **G** | Mobile 响应式 (drawer + 卡 stack) | ✅ |
| **M** | finalTitle 实时 AI 反馈 (DeepSeek 评分 + 改进建议) | ✅ `title-feedback` API 已支持 `platform` 参数 |

### 改造能用

| ID | 内容 | 待改 |
|---|---|---|
| **A** | /settings/baseline (账号视频通常播放数) | 概念偏视频,新场景下需重设计,当前不动 |
| **J** | 发前 publish checklist (5 项 + isReady) | 仍是视频专属单一 schema,未按平台拆分 (Roadmap Phase D,未做) |

### 老视频管线 — 保留为深度功能

| ID | 内容 |
|---|---|
| **Phase 1** | 视频上传 + ffmpeg 预处理 + 4 维 AI 评估 (hook/retention/title-caption/cover) + Whisper 转录 + synthesize 综合评分 |
| **L1** | 播放区间预测 (baseline × scoreMultiplier × calibrationFactor) |
| **C** | Retro 半自动 (review.py list + 手动 dropdown 匹配) |
| **D** | Auto-sync cron 12h + bigram Dice 0.8 fuzzy match |
| **B** | Phase 3 Dashboard 7 widget (StatsBar / OverallScoreTrend / Calibration / PredictionAccuracy / Niche / Top / Misses) |
| **L** | NextSteps "下一步" widget (待发 / 待复盘 / 草稿待拍 3 计数) |

---

## 3. 当前 IA (工作台重定位后)

### Sidebar (6 项)

```
🏠 工作台   → /            [驾驶舱 + 管线看板, 首页]
🪄 创作     → /agent       [向导 + discover + inspiration 归入]
📚 内容库   → /content     [脚本 + 分析统一列表]
📊 数据     → /dashboard   [现有 7 widget Dashboard]
👤 账号     → /accounts    [抖音账号绑定 / auto-sync 回收入口]
⚙️ 设置     → /settings    [/settings/baseline + AI provider key]
```

底部 CTA: **+ 新内容** → `/agent`。

> spec §3.1 原方案是 5 项 (无 `/accounts`)。 实际多保留了 `/accounts` —— 它是抖音账号绑定和 auto-sync 复盘的唯一入口, IA 迁移时误删过一次, 现在显式保留避免"入口消失"。

### `/` 工作台首页 (驾驶舱 + 看板)

新首页 (`src/app/page.tsx`), 替换原来的引导页, 不再 redirect 到 `/dashboard`:

- **上半屏「今日驾驶舱」** (`src/components/workbench/cockpit.tsx`): 六格阶段计数 (选题池 / 草稿 / 定稿待拍 / 已拍待发 / 已发布 / 已复盘, 可点击跳看板列) + 右侧最近 7 天数据摘要 (复用 `/api/v1/dashboard/summary`, 不新写聚合) + 「抓灵感」快捷入口 → `/agent/discover`。
- **下半屏「内容管线看板」** (`src/components/workbench/kanban.tsx`): 六列, 选题池 → 草稿 → 定稿待拍 → 已拍待发 → 已发布 → 已复盘。 每条内容一张卡: 标题 / 平台徽标 / 分发数 / 停留天数; 已发布列显示复盘倒计时 (T+N 天)。 **不做拖拽** —— 状态由真实动作驱动 (选版本→定稿、传视频→已拍、登记链接→已发布), 拖拽会制造假状态。 已复盘列按 `stageSince` 只显示最近 10 条, 归档 (`archivedAt` 非空) 的卡不进看板。script 卡任何阶段都有「归档」按钮 (`PATCH /api/v1/scripts/[id]` `{ archived }`), 放弃的内容移出看板但不删数据, 可反悔 (再传 `archived: false`)。
- 数据来自单一聚合 API `GET /api/v1/workbench` (drafts + analyses + distributions 三表查询拼装, 避免 N+1)。

数据模型与阶段派生规则见 §3.5。

### `/agent` 创作向导

选平台 → 选垂类 → 输 topic → 生成 platform-ready 内容。 面向小白的三步教学卡和"第一次来"新手引导 (含 `has_seen_discover` cookie 逻辑) 已在工作台重定位中移除, 压缩成一行副标题 —— 自用工作台不需要教学。 灵感推荐区 (最近一次 inspiration insight 的 topic) 与「一键入选题池」按钮保留。

输出渲染按 platform 切换:
- 抖音 → ScriptResult (hooks / beats / titles / cover)
- 小红书 → XHSResult (titles / coverText / intro / body / tags / shotIdeas)
- 公众号 → ArticleResult (titles / abstract / outline / body / cta)

### `/content` 内容库

合并脚本列表 + 分析列表为统一列表 + 类型 badge (`src/app/content/page.tsx`), 已落地 (不是 tab 切换)。

### `/accounts` `/dashboard` `/settings`

功能不变, 见 §2 / §5 目录结构。

### 3.5 数据模型: 管线阶段派生 + 工作台新模型

`ScriptDraft` 是管线看板的基本单元。 **阶段不落库, 按现有数据实时派生**, 判定唯一入口是纯函数 `deriveStage` (`src/lib/pipeline/stage.ts`), UI / API 不内联复制规则, 避免双写不一致:

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
- **`ScriptDraft.archivedAt`** (`DateTime?`): 放弃的内容移出看板, 不删数据。

分发平台注册表 (`src/lib/pipeline/platforms.ts`, 加新平台 = 加一行, 不改 DB schema): 抖音 / B站 / YouTube / X-推特 / 小红书 / 公众号 / 快手 / 微博 (共 8 个)。 与 `src/lib/platform.ts` 的采集端 `Platform` enum、创作端 `ContentPlatform` 是两套独立命名空间 —— 这里管"内容搬运到了哪"。

新 API: `POST/GET /api/v1/topics`、`PATCH /api/v1/topics/[id]`、`POST/GET /api/v1/scripts/[id]/distributions`、`DELETE /api/v1/distributions/[id]`、`GET /api/v1/workbench`。

### 关键交互流

1. **选题入池**: discover / 灵感页每条推荐 topic 有「+ 入选题池」按钮 (`PoolButton`, 重复入池返回 409); 驾驶舱可手动添加。 看板选题池列卡片点「开写」→ 带 `topic` + `ideaId` 跳 `/agent?topic=&ideaId=` → 保存脚本自动 `PATCH` 该选题为 `ADOPTED` 并写入 `scriptDraftId`。
2. **分发登记**: script 详情页 + 分发登记弹窗, 选平台 (注册表 key) + 贴 URL → 写一条 `Distribution` 记录, 卡片显示「已分发 N 平台」徽标。
3. **复盘闭环**: 现有 retro / auto-sync 不动; 看板已发布列显示复盘倒计时, 复盘完成后卡片自动流入「已复盘」列。

---

## 4. Roadmap — 分阶段实施 (Phase A-C 已完成)

不一次性 5 天大重构,分小步走,每步可发布。 **这是第一次 pivot (小白向导) 时定的 roadmap; Phase A-C 已完成, D 未做, E 仍是未来事项。** 工作台重定位 (第二次 pivot) 是独立的后续 spec, 见 `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md`, 其自身的 12 个 Task 均已完成 (数据层 → 工作台首页 → 交互流 → 本文档)。

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

- 241 tests 大多是 API 单测 + 纯函数 + mock prisma
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
npm test             # vitest, 241 tests across 38 files
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

### 存量数据迁移到工作台 (Cockpit)

```bash
npx tsx scripts/migrate-cockpit.ts          # dry-run (默认): 只打印映射清单+汇总, 不写库
npx tsx scripts/migrate-cockpit.ts --apply  # 人工确认 dry-run 输出无误后再写库
```

把老表 (`ScriptDraft`/`ContentAnalysis`/`ActualMetric`/`TopicIdea`/`InspirationVideo`) 一次性映射进
`CockpitContent`/`CockpitStageEvent`/`CockpitInspiration`。阶段判定复用 `deriveStage`
(`src/lib/pipeline/stage.ts`)，纯映射函数见 `src/lib/cockpit/migrate-mapping.ts`。`--apply` 会先检查
目标用户名下 `CockpitContent` 是否已有数据，非空直接中止（防重复迁移）；旧表全程只读，不删不改。

---

## 7. 目录结构 (重要文件)

```
src/
├── app/
│   ├── page.tsx                  # `/` 工作台首页 (驾驶舱 + 看板)
│   ├── dashboard/                # 数据看板 (Phase 3 + B + L)
│   ├── agent/                    # 创作向导 + discover + inspiration + patterns
│   ├── content/
│   │   ├── preflight/            # 视频分析 (Phase 1, L1)
│   │   ├── script/                # 脚本生成 (E)
│   │   └── retro-sync/           # 抖音半自动复盘 (C)
│   ├── accounts/                 # 账号绑定
│   ├── settings/baseline/        # 设置 (A)
│   └── api/v1/                   # 所有 API routes (含 topics/ distributions/ workbench/)
├── components/
│   ├── content/                  # script-form, script-result, publish-checklist, prediction-card, etc
│   ├── workbench/                # cockpit, kanban, pool-button, 分发登记弹窗
│   ├── dashboard/                # 8 widgets
│   ├── settings/                 # baseline-form
│   └── layout/                   # sidebar (6 nav), header, main-layout
├── lib/
│   ├── llm/                      # DeepSeekTextLLM + OpenAIVisionLLM + prompts/
│   ├── pipeline/                 # deriveStage 纯函数 + platforms.ts 分发平台注册表
│   ├── prediction/               # L1 formula + baseline
│   ├── dashboard/                # aggregate + calibration + prediction-accuracy
│   ├── douyin/                   # cheat-on-content adapter + fuzzy + auto-sync
│   ├── checklist/                # J types + isReady
│   └── prisma.ts
├── jobs/
│   ├── queue.ts                  # 5 BullMQ queues
│   └── workers/                  # 4 workers (bind, analyze, retro, auto-sync)
prisma/
└── schema.prisma                 # User / ContentAnalysis / ActualMetric / ScriptDraft / TopicIdea / Distribution 等
docs/superpowers/
├── specs/                        # 每个 sub-project 的 design spec
└── plans/                        # 每个 sub-project 的 task plan
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
| 工作台看板不做拖拽 | 状态由真实动作驱动 (选版本/传视频/登记链接), 拖拽会制造假状态 |

---

## 9. 下一步

Phase A-C 与工作台重定位 (Task 1-12) 均已完成。 尚未做的:

1. **Phase D** — checklist 按平台拆分发布前检查项 (`src/lib/checklist/types.ts` 目前仍单一 schema)
2. **Phase E / SaaS 准备** — NextAuth 登录 + userId 中间件严格 scope + 计费, 本期范围外
3. **本地真用一段时间** — 用 default-user 走完整创作闭环 (选题池→开写→拍→登记分发→复盘), 找工作台实际使用中的痛点

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
(Plan files in `docs/superpowers/plans/` 对应每个 spec)
