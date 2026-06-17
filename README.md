# MediaPilot

> AI 自媒体智能体 — 帮助 **小白用户** 上手做自媒体,生成抖音/小红书/公众号 ready-to-paste 内容。

**当前状态:** 单用户 MVP,正在从"个人视频分析工具"**pivot** 到"小白自媒体智能体"。 83 commits / 14 sub-project 已交付的基础功能 + 待重构的 IA。

---

## 1. Product Vision (post-pivot)

### 新定位

**用户:** 想做自媒体但不知道怎么开始的小白 (现在: 1 个 default-user, 设计预留可扩 SaaS)
**核心交互:** 向导式智能体 — 选平台 → 选垂类 → 输 topic → 出 platform-ready 内容
**平台:** 抖音 / 小红书 / 公众号 (3 平台同时支持,文风差异由 platform-specific prompts 处理)
**不做:** 一键发布。 只输出 → 用户复制粘贴去发。

### 原 vision (pivot 前) — 保留为高级模式

视频上传 → AI 4 维诊断 → L1 播放量预测 → 发布后 retro 复盘 → calibration 闭环。
这条线 (Phase 1 + L1 + retro) **保留**,作为深度功能。 新主流不再强推。

---

## 2. 14 Sub-projects 全景

### 仍然核心 (post-pivot)

| ID | 内容 | 状态 |
|---|---|---|
| **E** | Script 生成 (DeepSeek + zod schema) | ✅ 抖音 prompt ready, 待扩 小红书 + 公众号 |
| **F** + **K2** | Script ↔ Analysis 双向链 (URL `?fromScript=` + DB FK) | ✅ |
| **H** + **I** | UI 风格 (Stitch 设计,蓝紫渐变,中文化) | ✅ |
| **G** | Mobile 响应式 (drawer + 卡 stack) | ✅ |
| **M** | finalTitle 实时 AI 反馈 (DeepSeek 评分 + 改进建议) | ✅ 抖音 ready, 待扩多平台 |

### 改造能用

| ID | 内容 | 待改 |
|---|---|---|
| **A** | /settings/baseline (账号视频通常播放数) | 概念偏视频,新场景下需重设计 |
| **J** | 发前 publish checklist (5 项 + isReady) | 视频专属逻辑,文章需另一套 |

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

## 3. 新 IA 提案 (Pivot 后)

### Sidebar nav 简化 (替换现有"总览/创作/内容/设置"4 项)

```
🪄 智能体        → /agent          [NEW · 主入口]
📚 我的作品      → /content        [合并 scripts + analyses 列表]
📊 数据          → /dashboard      [现有 Dashboard, NextSteps 仍在]
⚙️ 设置          → /settings       [现有 /settings/baseline + 后续扩]
```

底部 CTA: **+ 新内容** (替代现有 "+ 新分析") → 跳 /agent

### `/agent` 向导流程 (核心新功能)

```
Step 1: 你想给哪个平台做内容?
  ◯ 抖音 (短视频脚本)
  ◯ 小红书 (图文笔记)
  ◯ 公众号 (长文章)

Step 2: 你的内容垂类?
  [AI 知识 ▾] (与现有 KNOWN_NICHES 同)

Step 3: 你想做的 topic 是?
  [_____________________________________]

[ 生成 → ]
```

输出渲染按 platform 切换:
- 抖音 → 现有 ScriptResult (hooks / beats / titles / cover)
- 小红书 → 新 XHSResult (titles / coverText / intro / body / tags / shotIdeas)
- 公众号 → 新 ArticleResult (titles / abstract / outline / body / cta)

### `/content` 综合内容库

合并:
- 现有 /content/script (脚本列表)
- 现有 /content/preflight (分析列表)

Tab 切换 OR 统一列表 + 类型 badge。 倾向后者,简单。

---

## 4. Roadmap — 分阶段实施

不一次性 5 天大重构,分小步走,每步可发布。

### **Phase A: Script 多平台化 (1.5 天)** ← 推荐立即开始

1. ScriptDraft 加 `platform` 列 (`'douyin' | 'xiaohongshu' | 'gongzhonghao'`)
2. 拆分 prompts:
   - `script-generate-douyin.ts` (现有 `script-generate.ts` 改名 + platform meta)
   - `script-generate-xiaohongshu.ts` (新, schema: titles / intro / body / tags / coverText / shotIdeas)
   - `script-generate-gongzhonghao.ts` (新, schema: titles / abstract / outline / body / cta)
3. POST `/api/v1/scripts/generate` 加 `platform` 参数 → 路由到对应 prompt
4. UI ScriptForm 加 Step 1 platform 选择器
5. UI ScriptResult 按 platform 渲染不同 schema
6. 单测覆盖每平台 prompt schema (mock LLM, 3 个 case 每平台)

### **Phase B: IA 重组 (1 天)**

1. 新 `/agent` 路由 (= 现有 `/content/script/new` 重命名 + 改成顶级入口)
2. Sidebar nav 简化 4 项
3. 底部 CTA 改 "+ 新内容" → `/agent`
4. `/content` 合并 scripts + analyses (现有 2 个独立列表合一,统一 + 类型 badge)
5. 老入口仍可访问 (向后兼容)

### **Phase C: M 多平台化 (0.5 天)**

`POST /api/v1/checklist/title-feedback` 加 `platform` 参数。 不同平台的"好标题"标准:
- 抖音: 强钩子, ≤ 25 字, 数字/反差
- 小红书: emoji, 长一些 (15-30 字), 有标签感
- 公众号: 沉稳, 长 (15-30 字), 信息含量

### **Phase D: J 改造为多平台 publish checklist (1 天, 可选)**

- 抖音: 沿用现有 5 项 + 钩子重写
- 小红书: 改成 笔记标题 / 封面文字 / 标签 / 配图数 都对了
- 公众号: 标题 / 摘要 / 配图 / 二维码 / 引导关注 都备了

### **Phase E: SaaS 准备 (1+ 周, 未来)**

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

---

## 7. 目录结构 (重要文件)

```
src/
├── app/
│   ├── dashboard/                # 数据看板 (Phase 3 + B + L)
│   ├── content/
│   │   ├── preflight/            # 视频分析 (Phase 1, L1)
│   │   ├── script/               # 脚本生成 (E)
│   │   └── retro-sync/           # 抖音半自动复盘 (C)
│   ├── settings/baseline/        # 设置 (A)
│   └── api/v1/                   # 所有 API routes
├── components/
│   ├── content/                  # script-form, script-result, publish-checklist, prediction-card, etc
│   ├── dashboard/                # 8 widgets
│   ├── settings/                 # baseline-form
│   └── layout/                   # sidebar (4 nav), header, main-layout
├── lib/
│   ├── llm/                      # DeepSeekTextLLM + OpenAIVisionLLM + prompts/
│   ├── prediction/               # L1 formula + baseline
│   ├── dashboard/                # aggregate + calibration + prediction-accuracy
│   ├── douyin/                   # cheat-on-content adapter + fuzzy + auto-sync
│   ├── checklist/                # J types + isReady
│   └── prisma.ts
├── jobs/
│   ├── queue.ts                  # 5 BullMQ queues
│   └── workers/                  # 4 workers (bind, analyze, retro, auto-sync)
prisma/
└── schema.prisma                 # User / ContentAnalysis / ActualMetric / ScriptDraft (+ Phase 2 stuff)
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
| 不做 native auto-publish | 平台 API 限制重 + 法律风险; 改成 copy-paste UX |
| Stitch 风格 (蓝紫渐变) | 用户自己拿 AI 设计稿确认的, 不是我猜 |

---

## 9. 下一步 (立即可做的事)

1. **Confirm 上面 Phase A 范围** → 我开始干
2. **本地真用一次** — 用 default-user 上传一条真视频走完整流程, 找出 brainstorm 没料到的痛点
3. **Phase B IA 重组** — 在 Phase A 完成后

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
(Plan files in `docs/superpowers/plans/` 对应每个 spec)
