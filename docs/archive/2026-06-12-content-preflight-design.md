# 内容预诊断 (Content Pre-flight) — Design

**Project**: MediaPilot (自媒体智能管理平台)
**Phase**: 3 — Content Creation (Direction A v1)
**Date**: 2026-06-12
**Spec status**: Approved by user, pending implementation plan
**Prior phases**: Phase 1 (框架 + OpenAI Key) 已上线;Phase 2 Plan 1 (XHS 端到端绑定) 已完成;Phase 2 Plan 2 (抖音 crawler 校准 / 同步引擎 / profile 隔离) **已暂缓**

---

## 0. 背景

用户 2026-06-12 表态:开发重心从"账号绑定 / 矩阵基础设施"转向"内容创作"。三个候选方向 (A: 上传分析 / B: 播放量预测 / C: 拉历史视频批量分析) 经讨论选定 **A 为首战**, B 因有 GitHub 参考实现 ([cheat-on-content](https://github.com/XBuilderLAB/cheat-on-content.git)) 留待 A 完成后评估,C 自然降级为 A 完成后扩展数据源。

本文档定义 Direction A v1: **"上传视频 → AI 评估 → 优化建议"** 的内容预诊断功能。

---

## 1. 目标与范围

### 1.1 用户故事

> 我刚剪完一个视频,AI 知识类内容。我把视频拖进 MediaPilot,可选填一下我已有的标题/文案/封面草稿。MediaPilot 在 1-3 分钟内给我一份诊断报告,告诉我开头 3 秒钩子够不够强、整段视频在哪几秒可能让人划走、我的标题/文案/封面好不好(如果没填就给我 3 个候选)。我看完报告再决定要不要回去剪辑器再改一刀,然后才发抖音。

### 1.2 v1 必须达成 (verifiable)

1. 浏览器 `/content/preflight/new` 上传视频(支持 mp4/mov/webm,≤500MB,≤15 分钟),可选填标题草稿、文案草稿、封面图。
2. 后台异步跑分析,前端 SSE 推送进度;短视频(≤60s)在 1 分钟内出报告。
3. 报告包含 4 个维度的 AI 评估,**专为 AI 知识类视频垂类定制**:
   - **钩子** (开头 3 秒): 评分 1-5 + 改进建议 + 关键帧定位
   - **完播风险** (全段): 标出高/中/低风险时段 + 原因 + 建议
   - **标题/文案** (Mixed mode): 用户填了 → 评价 + 重写候选;没填 → AI 生成 3 个候选
   - **封面** (Mixed mode): 用户上传 → 评价 + 改进;没上传 → 从视频抽 3 张候选并推选
4. 综合 `overallScore` (1-100) + `topActionItems[3-5]` 跨维度凝练"现在去改这几件事"。
5. 报告自动入库 (Postgres),`/content/preflight` 列表页按时间倒序显示历史分析。
6. 报告页显示 `llmUsage` (token 数 + 预估美元成本)。
7. 用户可在进度页取消正在跑的分析;FAILED 状态可手动"重新分析" (复用已成功的预处理产物)。

### 1.3 v1 明确不做

- 发后复盘 (拿真实播放/完播/互动数据回填) → A v2
- BGM / 标签 / 互动设计 这 3 个分析维度 → A v2 视价值再加
- 跨视频对比 / 趋势分析 → Phase 3 Dashboard
- 播放量预测 → Direction B (单独 brainstorm)
- 矩阵 / 抖音 crawler 校准 → 已暂缓
- 30 天文件自动清理 → A v2 (v1 用户手动删)
- 多 niche 切换 → v1 固定 `ai-knowledge`,字段已留好
- 关联具体 PlatformAccount → A v2

### 1.4 默认值 (摊在桌面避免歧义)

| 项 | 取值 | 理由 |
|---|---|---|
| Niche | `ai-knowledge` (硬编码) | 用户当前唯一垂类,prompt 专家化 |
| 上传上限 | 500MB / 15 分钟 / mp4·mov·webm | 单用户本地够用 |
| 多模态 LLM | OpenAI GPT-4o (默认) | 用户已配 OpenAI Key;抽象 `IVisionLLM` 后期可换 |
| 综合模型 | GPT-4o-mini | 省钱,综合判断不需要 vision |
| 音频转写 | OpenAI Whisper API (`whisper-1`) | 带时间戳输出驱动完播风险定位 |
| 文件存储 | 本地 `./uploads/<analysisId>/` | v1 单机够用 |
| 队列 | 复用现有 BullMQ + Redis | 新加 `analyze` queue |
| 错误策略 | Fail-soft (单维度失败不阻断其他) | 用户能拿到部分价值 |
| 估算成本 | ~$0.10-0.25/次 (25-40k tokens) | 100 次/月 ≈ $10-25 |

---

## 2. 架构

### 2.1 数据流

```
[浏览器 /content/preflight/new]
   │
   │ POST multipart: 视频 + 可选 (标题草稿 / 文案草稿 / 封面图)
   ▼
[POST /api/v1/content/analyses]
   │ 校验 (size/format/duration) → 落 ./uploads/<id>/
   │ DB 建 ContentAnalysis (status=QUEUED)
   │ bullmq.add('content-analyze', { analysisId })
   │ return { analysisId } —— 不阻塞
   ▼
[浏览器跳 /content/preflight/<id>]
   │
   │ 打开 SSE /api/v1/content/analyses/<id>/events
   │ 显示进度: 预处理 → AI 分析中 → 完成 (报告)
   ▲
   │
[BullMQ: content-analyze-worker]
   │
   ├─① 预处理 (status=PREPROCESSING)
   │   - ffmpeg 抽帧 (按时长分级)
   │   - ffmpeg 抽音轨 → Whisper API (verbose_json 带时间戳)
   │   - ffmpeg 抽 3 张候选封面帧
   │
   ├─② AI 并行评估 4 维度 (status=ANALYZING)
   │   - 钩子 / 完播风险 / 标题文案 / 封面
   │   - 全部完成后再 synthesize
   │
   ├─③ 落库 (status=COMPLETED)
   │   写 report JSONB + llmUsage
   │
   └─失败 → status=FAILED + errorMessage,SSE 推送
```

### 2.2 关键技术决策

| 决策 | 选型 | 理由 |
|---|---|---|
| **异步 + 入库** | BullMQ + Postgres | 大视频处理 1-3 分钟,同步阻塞 UX 不可接受;入库为 A v2 复盘 / B 预测训练数据 / 跨视频对比铺路 |
| **复用 Phase 2 基础设施** | 现有 worker 容器 + Redis + Bull | 不引入新栈,只新加 `analyze` queue 和一个 handler |
| **多模态 LLM 抽象** | `IVisionLLM` 接口 + `OpenAIVisionLLM` 实现 | 短期绑 OpenAI,长期可换 Claude/Gemini |
| **Structured Output** | OpenAI structured outputs + Zod schema | 强保证 LLM 输出符合 `ReportV1` 子契约,自动重试到合法 |
| **ffmpeg 处理** | child_process + ffmpeg 依赖 | 业界标准;开发期需 `brew install ffmpeg` 装到 worker 宿主机;生产期独立 worker 容器时加 `apt-get install ffmpeg` (该容器尚未创建,留待 deployment 阶段) |
| **报告 JSONB** | Postgres JSONB + `schemaVersion` 字段 | LLM 输出会在 v1→v2 演进,JSONB 平滑迁移 |
| **帧抽样分级** | ≤60s → 1fps;60-180s → 1/3 fps;>180s → 1/6 fps | 平衡覆盖度与 token 成本;前 3s 固定 2fps high-density |

### 2.3 新建/修改文件清单

**新建**:

```
prisma/schema.prisma                                # 增 ContentAnalysis + enum
src/lib/video/ffmpeg.ts                            # ffmpeg 命令封装 (抽帧/抽音/抽封面)
src/lib/video/sampling.ts                          # 时长 → 抽样策略
src/lib/llm/vision.ts                              # IVisionLLM + OpenAIVisionLLM
src/lib/llm/whisper.ts                             # Whisper 调用
src/lib/llm/prompts/base.ts                        # 共享 system preamble
src/lib/llm/prompts/ai-knowledge/expert-persona.ts # AI 知识类专家人设
src/lib/llm/prompts/ai-knowledge/hook.ts           # 钩子 prompt + Zod schema
src/lib/llm/prompts/ai-knowledge/retention.ts      # 完播风险 prompt + Zod schema
src/lib/llm/prompts/ai-knowledge/title-caption.ts  # 标题文案 (mixed mode)
src/lib/llm/prompts/ai-knowledge/cover.ts          # 封面 (mixed mode)
src/lib/llm/prompts/ai-knowledge/synthesize.ts     # 综合评分 + topActionItems
src/jobs/workers/content-analyze-worker.ts         # 主 worker
src/app/api/v1/content/analyses/route.ts           # POST create / GET list
src/app/api/v1/content/analyses/[id]/route.ts      # GET detail / DELETE
src/app/api/v1/content/analyses/[id]/events/route.ts   # SSE
src/app/api/v1/content/analyses/[id]/cancel/route.ts   # POST cancel
src/app/api/v1/content/analyses/[id]/retry/route.ts    # POST retry (复用预处理)
src/app/content/preflight/page.tsx                 # 列表页
src/app/content/preflight/new/page.tsx             # 上传页
src/app/content/preflight/[id]/page.tsx            # 报告 / 进度页
src/components/content/upload-form.tsx
src/components/content/progress-stages.tsx         # 三阶段进度条
src/components/content/report-view.tsx             # 报告主组件
src/components/content/dimension-card.tsx          # 单维度卡片
src/components/content/cover-candidates.tsx
tests/lib/video/sampling.test.ts
tests/lib/llm/prompts/ai-knowledge/*.test.ts
tests/jobs/content-analyze-worker.test.ts
tests/api/content/analyses.test.ts
```

**修改**:

```
src/jobs/queue.ts                                  # 加 ANALYZE queue 常量 + queue 实例
src/jobs/workers/index.ts                          # 启动 content-analyze-worker
src/app/layout.tsx (或顶部 nav 组件)                # 加 "内容创作" 一级入口
.env.example / .env                                # 已有 OPENAI_API_KEY,补 OPENAI_VISION_MODEL=gpt-4o (可选)
README.md                                          # 加 Direction A 验收清单 + ffmpeg 宿主机依赖说明 (brew install ffmpeg)
package.json                                       # 加 openai (若未装) + zod (若未装)
```

---

## 3. 数据模型

### 3.1 `prisma/schema.prisma` 增量

```prisma
model ContentAnalysis {
  id               String                @id @default(cuid())
  userId           String
  user             User                  @relation(fields: [userId], references: [id])

  // 视频源
  videoPath        String                // 相对路径 ./uploads/<id>/original.<ext>
  videoFilename    String                // 用户原始文件名
  videoSizeBytes  Int
  videoDurationSec Float                 // ffmpeg probe
  videoMimeType    String

  // 用户输入草稿 (Mixed mode 判定: null → 生成; 非 null → 评价)
  draftTitle       String?
  draftCaption     String?
  draftCoverPath   String?               // ./uploads/<id>/draft-cover.<ext>

  // 配置
  niche            String                @default("ai-knowledge")

  // 状态机
  status           ContentAnalysisStatus @default(QUEUED)
  errorMessage     String?
  retryCount       Int                   @default(0)

  // 进度 (SSE 推送)
  progress         Json?                 // { stage, percent, label }

  // 预处理产物 (worker 写)
  framesDir        String?
  audioPath        String?
  transcriptPath   String?
  coverCandidates  Json?                 // [{ path, timestampSec }, ...]

  // AI 评估结果
  report           Json?                 // ReportV1 (schemaVersion + 4 维度 + synthesize)

  // 成本审计
  llmUsage         Json?                 // { byCall: [{ model, promptTokens, completionTokens, estCostUSD }], total: {...} }

  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
  startedAt        DateTime?             // worker pick 时填
  completedAt      DateTime?

  @@index([userId, createdAt])
  @@index([status])
}

enum ContentAnalysisStatus {
  QUEUED
  PREPROCESSING
  ANALYZING
  COMPLETED
  FAILED
  CANCELLED
}
```

### 3.2 `report` JSONB 形状 (TypeScript 契约,Zod 强校验)

```typescript
type ReportV1 = {
  schemaVersion: 1
  niche: 'ai-knowledge'

  hook: {
    rating: 1 | 2 | 3 | 4 | 5
    summary: string                                      // "前 3 秒缺反差,镜头静态"
    suggestions: string[]                                // 可执行: "把 0:01 那句改成提问"
    keyObservations: { timestampSec: number; note: string }[]
    error?: string                                       // fail-soft 时填
  }

  retention: {
    riskPoints: {
      startSec: number
      endSec: number
      severity: 'low' | 'medium' | 'high'
      reason: string                                     // "0:18-0:24 重复概念解释"
      suggestion: string
    }[]
    overallSummary: string
    error?: string
  }

  titleCaption: {
    mode: 'evaluate' | 'generate'
    titleFeedback?: { rating: 1 | 2 | 3 | 4 | 5; issues: string[]; rewrites: string[] }   // evaluate
    captionFeedback?: { rating: 1 | 2 | 3 | 4 | 5; issues: string[]; rewrites: string[] }
    generatedTitles?: string[]                           // generate, 3 个
    generatedCaptions?: string[]
    error?: string
  }

  cover: {
    mode: 'evaluate' | 'generate'
    feedback?: { rating: 1 | 2 | 3 | 4 | 5; issues: string[]; suggestions: string[] }     // evaluate
    candidates?: { coverCandidateIdx: number; timestampSec: number; reason: string }[]    // generate
    recommendedIdx?: number                              // generate 时 AI 推选哪一张
    error?: string
  }

  overallScore: number | null                            // 1-100; null 表示 synthesize 失败
  topActionItems: string[]                               // 3-5 条
}
```

### 3.3 关键设计决策

| 决策 | 说明 |
|---|---|
| `report` 用 JSONB | LLM 输出 v1→v2 会改 schema,JSONB + `schemaVersion` 平滑迁移 |
| `llmUsage` 独立字段 | 用户最关心烧钱;按 call 拆分便于审计哪个维度贵 |
| `niche` 用 string 不用 enum | 后期切垂类无需 enum 迁移 |
| 暂不挂 `PlatformAccount` | v1 不强制选给哪个号发;`accountId` 字段留到 A v2 |
| 预处理产物路径落表 | (a) 报告页快速渲染封面候选 (b) 删除分析时清理文件 (c) `retry` API 复用已成功的预处理 |
| `retryCount` 字段 | UI 限制 ≤3 次手动重试;超过引导用户新开分析 |

### 3.4 不引入的东西

- ❌ 单独 `ContentAnalysisReport` 子表 — JSONB 完全够用
- ❌ `framesCount/audioSize` 这类元数据列 — 文件系统能查
- ❌ 跨视频聚合表 — Phase 3 Dashboard 才需要

---

## 4. AI 评估提示词架构

### 4.1 LLM 调用矩阵

| 维度 | 输入 | 模型 | 视觉 | 预估 tokens | Mixed 分支 |
|---|---|---|---|---|---|
| Hook | 0-3s 高密度帧 (6 张, 每 0.5s) + transcript[0-3s] | GPT-4o | ✓ | ~3-5k | 无 |
| Retention | 全段抽样帧 (30-60 张) + 全 transcript w/ timestamps | GPT-4o | ✓ | ~10-20k | 无 |
| Title/Caption | 全 transcript + `(draftTitle, draftCaption)` | GPT-4o | ✗ | ~2-3k | 有: 草稿 → 评价;null → 生成 3 个 |
| Cover | 3 张候选封面 + `draftCoverPath` + transcript 首段 | GPT-4o | ✓ | ~2-3k | 有: 上传 → 评价;null → 从候选推选 |
| Synthesize | 4 个维度子报告 | GPT-4o-mini | ✗ | ~3k | 无 |

4 个维度 LLM 调用 **并行** 发出 (`Promise.allSettled`),全部完成后串行调 synthesize。

**总成本预估**: 25-40k tokens / 次, ~$0.10-0.25 / 次 (GPT-4o pricing 2026-06)。
**总耗时**:
- 短视频 (≤60s): 4 维度并行 ~20-40s + synthesize ~5s ≈ 30-60s
- 长视频 (>3min): retention 一维度可能 1-2 分钟,总耗时 2-3 分钟

### 4.2 提示词模块结构

```
src/lib/llm/prompts/
├── base.ts                              # Niche-agnostic preamble (输出格式、JSON 严格性等)
└── ai-knowledge/
    ├── expert-persona.ts                # AI 知识类专家人设 (4 维度共享前置上下文)
    ├── hook.ts
    ├── retention.ts
    ├── title-caption.ts                 # 内部 mixed mode 分支
    ├── cover.ts                         # 内部 mixed mode 分支
    └── synthesize.ts
```

每个模块导出统一形状:

```typescript
export const HOOK = {
  systemPrompt: string                                  // expert-persona + 维度专属
  buildUserMessage(input: HookInput): OpenAI.Messages.ChatCompletionContentPart[]
  responseSchema: ZodSchema<ReportV1['hook']>
}
```

### 4.3 LLM 调用抽象

`src/lib/llm/vision.ts`:

```typescript
export interface IVisionLLM {
  callStructured<T>(opts: {
    systemPrompt: string
    userMessage: OpenAI.Messages.ChatCompletionContentPart[]
    responseSchema: ZodSchema<T>
    model?: 'gpt-4o' | 'gpt-4o-mini'
    maxTokens?: number
  }): Promise<{ result: T; usage: TokenUsage }>
}

export class OpenAIVisionLLM implements IVisionLLM {
  // openai.beta.chat.completions.parse() 走 structured outputs
  // 自动 3 次重试 (指数 backoff) + 1 次 schema 不合法重新生成
}

export type TokenUsage = {
  model: string
  promptTokens: number
  completionTokens: number
  estCostUSD: number  // 按 OpenAI 当时定价计算
}
```

### 4.4 Niche 专家提示词精神 (v1: AI 知识类)

写在 `expert-persona.ts`,作为 5 个 prompt 共享前置:

> 你是抖音 AI 知识类视频运营专家。这个垂类的爆款规律:
>
> - 开头 3 秒避免堆砌专业术语 (劝退非技术受众);用反差、类比、反常识结论开场
> - 信息密度高但每 5-7 秒须有一个"信息单元"切换,避免单镜头讲太久
> - 标题用具体数字 / 反常识结论 / "你不知道的 X" 句式,避免"今天讲讲..."这种泛开头
> - 封面文字尽量少而清晰;有真人表情比纯文字效果好
> - 完播风险点常出现在: 术语堆砌段、长 monologue、缺乏视觉变化的解释段
> - 互动设计应自然嵌入 ("评论区告诉我你的看法"),避免硬性引流话术
> - 受众通常对 AI/技术有兴趣但不一定有深度背景;评估时考虑"是否能让一个普通人看懂并觉得有价值"

后续可根据用户实际反馈在 `expert-persona.ts` 单点迭代,4 个维度 prompt 自动跟新。

### 4.5 AI 层错误处理

| 场景 | 策略 |
|---|---|
| 单次 LLM call 失败 (网络/超时) | 3 次指数 backoff |
| Schema validation 失败 | 重试 1 次 (重新生成) |
| 某维度 3+1 次仍失败 | **Fail-soft**: 该维度 `error: "..."`,其他 3 维度继续 |
| Synthesize 失败 | 跳过,`overallScore=null`,UI 不显示综合分 |
| ffmpeg/Whisper 失败 | 整体 `status=FAILED`,不进 LLM 阶段 |

---

## 5. 错误处理、测试、UI、验收

### 5.1 端到端错误处理矩阵

| 阶段 | 失败 | 处理 | 用户可见 |
|---|---|---|---|
| 上传 | 文件 > 500MB / 非 video MIME / 时长 > 15min | API 400 拒收 | 红字提示 |
| 上传 | 磁盘写入失败 | API 500, DB 不建 row | 红字 + 重试提示 |
| Queue | Redis 挂 | API 500 | 红字 + 提示重启服务 |
| Worker | 没 pick up (5 分钟仍 QUEUED) | SSE 推警告 | "队列拥堵, worker 可能未启动" |
| 预处理 (ffmpeg) | 未装 / 视频损坏 | `status=FAILED + errorMessage` | 报告页错误 + [重新分析] |
| 预处理 (Whisper) | 静音 / API 失败 | transcript=空串, **不阻断** | LLM summary 提及"音轨无语音" |
| AI 单维度 | 见 §4.5 fail-soft | 该维度 `error`, 其他维度继续 | 该卡片警告色 + 错误展示 |
| Synthesize | 输入不全 | 跳过, `overallScore=null` | UI 不显示综合分 |
| 磁盘满 | 写入失败 | `status=FAILED + errorMessage="disk full"` | 提示手动清理 ./uploads/ |
| 用户取消 | 用户在进度页点取消 | API 写 `CANCELLED` → worker 下一 poll 检出 → 退出 | 跳列表,row 标"已取消" |

**重试策略**: FAILED 状态可点 `[重新分析]` 复用已成功的 `framesDir/audioPath/transcriptPath/coverCandidates`,直接进 AI 阶段 (`retryCount++`)。上限 3 次。

### 5.2 测试策略

| 层 | 覆盖 | 工具 | CI |
|---|---|---|---|
| `lib/video/sampling` | 时长 → 抽样次数 (3 档) | vitest 纯函数 | ✓ |
| `lib/video/ffmpeg` | 命令行参数构造正确 (不实际跑) | vitest + 字符串断言 | ✓ |
| `lib/llm/prompts/ai-knowledge/*` | `buildXxxPrompt(fixture)` 输出结构 + ZodSchema 接受合法响应 | vitest + JSON fixtures | ✓ |
| `lib/llm/vision` | mock OpenAI client → token usage 累计正确 | vitest + vi.mock | ✓ |
| `content-analyze-worker` | mock `IVisionLLM` + mock ffmpeg → fail-soft 行为正确 | vitest 集成 | ✓ |
| API `POST /analyses` | multipart 校验, 拒收过大文件 | vitest + FormData | ✓ |
| API SSE | 流格式 + 终止条件 | vitest | ✓ |
| 真 LLM smoke | 1 个 5s sample 视频跑全管线 | 手动 / npm script | ✗ |
| 手动 E2E | 真账号真视频走一遍 | 浏览器 | ✗ |

测试框架: vitest (与现有项目一致)。

### 5.3 UI 草图 (文字版)

**`/content/preflight` 列表页**

```
内容预诊断                            [+ 新分析]
─────────────────────────────────────────────
我的分析 (12)                筛选: [全部 ▾]

╔ 📹 ChatGPT 不告诉你的 5 个技巧.mp4 ╗
║ 2026-06-12 14:32 · 67 秒 · ✓ 完成    ║
║ overallScore 78/100                  ║
║ Top: 改钩子、压缩 0:18-0:24          ║
╚══════════════════════════════════════╝

╔ 📹 Cursor vs Claude Code.mp4         ╗
║ 2026-06-12 13:01 · 分析中 (62%)      ║
║ [▓▓▓▓▓▓▓▓░░░░] 完播分析中            ║
╚══════════════════════════════════════╝
```

**`/content/preflight/new` 上传页**

```
新分析
─────────────────────────────────────────────
[拖拽视频或点击选择]
mp4 / mov / webm · ≤ 500MB · ≤ 15 分钟

可选 (留空 AI 帮你生成):
┌─ 标题草稿 ─────────────────────────┐
│                                    │
└────────────────────────────────────┘
┌─ 文案草稿 ─────────────────────────┐
│                                    │
└────────────────────────────────────┘
┌─ 封面 (留空将从视频抽 3 帧) ───────┐
│ [拖拽或选择图片]                    │
└────────────────────────────────────┘

垂类: AI 知识 (设置里改)
                            [开始分析 →]
```

**`/content/preflight/[id]` 报告页**

```
ChatGPT 不告诉你的 5 个技巧.mp4
2026-06-12 14:32 · 67 秒 · 烧 $0.18
─────────────────────────────────────────────
综合 78/100   (大数字 + 进度环)

🔥 现在去改的 3 件事:
  1. 把 0:01 改成提问 "你以为提示词只能写指令？"
  2. 0:18-0:24 重复了概念,删
  3. 封面文字 "5 个技巧" 太小,加粗放大

────────── 4 维度详情 ──────────

┌─ 🪝 钩子 ★★★☆☆ ─────────┐  ┌─ ⏱ 完播风险 ★★★★☆ ───┐
│ 前 3 秒缺反差             │  │ 高风险段: 0:18-0:24    │
│ 建议:                     │  │ 中风险段: 0:42-0:51    │
│  - 把 0:01 改成提问       │  │ ...                    │
└───────────────────────────┘  └────────────────────────┘

┌─ 📝 标题/文案 ★★★★☆ ────┐  ┌─ 🖼 封面 (推选) ───────┐
│ 标题: 评价 + 重写候选     │  │ [候选 1] [候选 2] ...  │
│ 文案: AI 生成 3 个        │  │ AI 推荐: 候选 2        │
└───────────────────────────┘  └────────────────────────┘

[导出报告 PDF]  [重新分析]  [删除]
```

### 5.4 v1 验收标准

- [ ] 浏览器 `/content/preflight/new` 上传 30 秒 AI 知识类 sample 视频 → 1 分钟内拿到完整报告
- [ ] 报告 4 维度全部有合理输出
- [ ] 报告页显示 `llmUsage` (token 数 + 美元成本)
- [ ] 手动取消正在跑的任务 → `status=CANCELLED` 立刻生效
- [ ] kill worker 进程 → 已入队任务在重启后继续
- [ ] 故意上传无音轨视频 → 不报错, transcript 空, LLM summary 中提及
- [ ] 故意上传 600MB 视频 → API 400 拒收
- [ ] DB 查询有合理数据:
  ```sql
  SELECT id, status, "videoDurationSec", report->'overallScore', "llmUsage"->'total'
  FROM "ContentAnalysis" ORDER BY "createdAt" DESC LIMIT 5;
  ```
- [ ] `npm run typecheck` 0 错 + `npm test` 全绿
- [ ] 总开发时间预估 7-10 天 (单人, 1.5x buffer)

---

## 6. Open Questions / Risks

### 6.1 待真账号验收时回看

- `expert-persona.ts` 里关于 AI 知识类垂类的爆款规律是 brainstorm 阶段的最佳猜测,真账号跑过几个视频后需要根据用户反馈快速迭代
- GPT-4o 对中文短视频帧描述的细节程度,需要在真视频上验证。若太粗,考虑加 `image_url` 的 `detail: 'high'` (但成本翻倍)
- 完播风险点的"严重程度"评级 (low/medium/high) 的实际可解释性,要看 AI 给出的 reason 是否真的有指导意义

### 6.2 长视频 (>5min) 的 retention 维度可能超 LLM context

- v1 抽样上限 100 帧 + transcript 长 → 若 >5min 视频导致 GPT-4o 上下文超限,需要分段处理 (per-minute roll-up)
- 当前 spec **不实现分段**;若用户主要拍 <3min 视频,v1 不会遇到
- 实现期若 hit,加 graceful degrade: 超 context 自动降采样 + UI 提示

### 6.3 OpenAI Vision API 对视频音轨的间接利用

- 当前管线: 视频 → ffmpeg 抽帧 + 抽音轨 → Whisper 转写 → GPT-4o 看帧 + 看文字 transcript
- 不直接喂音频给 GPT-4o (GPT-4o audio modality 不在 vision API 内)
- 这意味着 BGM 类信号 (节奏感、情绪) 在 v1 完全捕捉不到 — 与 §1.3 "BGM 不做"对齐

### 6.4 与 Direction B (播放量预测) 的衔接

- v1 自动入库的 `report` JSONB 就是 B 的潜在训练数据:`(report 特征, 真实播放量) → 模型`
- A v2 加入发后复盘后,数据更完整
- 评估 [cheat-on-content](https://github.com/XBuilderLAB/cheat-on-content.git) 后再决定 B 是 fork 集成还是另起

### 6.5 矩阵账号的关联

- v1 不挂 `PlatformAccount`,即用户上传时不强制选"这是给哪个号准备的"
- A v2 加入复盘时,必须挂 `accountId` 才能拉真实数据
- v1 → A v2 迁移时 `accountId` 字段加 (nullable),向后兼容

---

## 7. 完成定义 (Definition of Done)

本 spec 通过用户 review 后,直接交给 `writing-plans` skill 产出分 task 的实现计划 (`docs/superpowers/plans/2026-06-12-content-preflight-plan.md`)。

实现期间任何 spec 偏离 (新增字段、改 API 形状、维度调整) 须回到本文档更新,确保 spec 与 code 一致。

---

**Author**: Claude (Opus 4.7) + 用户 (AI 知识类抖音博主) brainstorm 协作完成
**Next**: writing-plans skill → 实现计划
