# 内容预诊断 v2 — 发后复盘 (Content Pre-flight Retro) — Design

**Project**: MediaPilot (自媒体智能管理平台)
**Phase**: 3 — Content Creation (Direction A v2)
**Date**: 2026-06-12
**Spec status**: Approved by user, pending implementation plan
**Predecessor**: A v1 已上线 (`docs/superpowers/specs/2026-06-12-content-preflight-design.md`)

---

## 0. 背景

A v1 让用户**发布前**上传视频 → AI 4 维度评估 (钩子/完播/标题文案/封面) → 优化建议。已完成、已 push 到 origin、用户手动 E2E 通过。

A v2 闭环:**发布后**关联抖音上线的视频 → 自动 / 手动拉取真实播放/完播/互动 → AI 落差总结 (对比 A v1 预判 vs 实际)。让用户每条视频都"对账",形成校准飞轮。

**重要外部依赖**: 抖音数据采集走 [cheat-on-content](https://github.com/XBuilderLAB/cheat-on-content.git) 的 Douyin adapter (Python + Playwright + creator.douyin.com XHR 拦截,MIT 许可)。adapter 已在中文观点视频博主 25+ 视频跑过验证,比我们 Phase 2 Plan 1 自己 scrape HTML 更稳。我们走 Python 子进程调用,不重写。

**与 cheat-on-content 主 skill 的关系**: cheat-on-content 是 Claude Code skill 包,做"剧本 → 盲打分 → 盲预测 → T+3d 复盘 → rubric 进化"5 阶段闭环 — 是创作者的工作流工具。MediaPilot 做的是"单条视频的预诊断 ↔ 实际"对照页面 — 是 web 仪表盘。两者**互补不重叠**:用户在 Claude Code 里跑 cheat 工作流,在 MediaPilot 看图形化对比。我们只借 adapter,不抢 skill 的工作流。

---

## 1. 目标与范围

### 1.1 必须达成 (verifiable)

1. ContentAnalysis 详情页用户能粘贴抖音视频 URL + 发布时间 → 系统解析 aweme_id
2. 支持长链 (`https://www.douyin.com/video/<digits>`) 和短链 (`v.douyin.com/<slug>`,HEAD 展开)
3. 粘贴后自动安排 T+3d delayed BullMQ job 拉真实数据
4. 同时有"立刻拉一次"按钮 (任意 retroStatus 都可触发,COMPLETED 时按钮叫"重新拉取")
5. worker 调用 cheat-on-content 的 Python adapter (subprocess) 拉取 5 项核心 + 3 项留存指标:
   - 核心: 播放/点赞/评论/转发/收藏
   - 留存: 完播率/3s 留存/转粉率
6. 数据落 `ActualMetric` 表 (1:N 给未来快照留接口,v2 只用 1 条 T+3d 快照)
7. **AI 落差总结**: GPT-4o-mini 看 (A v1 report + actualMetrics) → 生成跨 4 维度的"预测 vs 实际"段落,每维度含 accuracy enum (on-target / over-estimated / under-estimated / unknown)
8. UI 详情页新增"📊 发后复盘"section,4 种状态机 (空 / SCHEDULED / RUNNING / COMPLETED 或 FAILED)
9. cookie 失效或 adapter 失败 → retroStatus=FAILED + 错误提示 + 重试按钮
10. llmUsage.total.estCostUSD 累加新的 gpt-4o-mini 落差总结调用

### 1.2 v2 明确不做

- 多快照 T+1d / T+3d / T+7d 增长曲线 (单快照 T+3d 够;1:N 表结构留接口)
- rubric 进化建议 (这是 cheat-on-content 主 skill 的事)
- 跨视频对比仪表盘 (Phase 3 Dashboard)
- 数据自动推送通知 (邮件/Slack)
- 评论关键词聚类 (adapter 能产出,v2 不用;留 topComments JSON 字段)
- 视频版本对比 (重发同一脚本的不同剪辑)

### 1.3 默认值 (摊在桌面避免歧义)

| 项 | 取值 | 理由 |
|---|---|---|
| Adapter 路径 | env `CHEAT_ADAPTER_PATH` 指向 `~/.claude/skills/cheat-on-content/adapters/perf-data/douyin-session/` | 用户全局安装 cheat 后的默认位置 |
| Adapter 内容项目目录 | env `CHEAT_CONTENT_PROJECT_DIR` 指向用户自己的内容项目根 (含 `.auth/`) | adapter 期望 CWD,cookie 持久化 |
| Python 解释器 | env `PYTHON_BIN`,默认 `python3` | 用户 venv 激活后调 |
| Retro 时机 | publishedAt + 3 天 | cheat-on-content 同款 |
| AI 落差总结模型 | gpt-4o-mini | 输入 ~3-5k token,成本 ~$0.005/次 |
| Adapter 超时 | 5 分钟 child_process timeout | cheat README 提到偶尔评论页 >5min,作为硬上限 |
| 短链 HEAD 超时 | 3 秒 | 避免长卡;失败要求用户填长链 |
| Cookie 探测 | 跑 `python crawler.py list` 看退出码 | cheat README 推荐做法 |

---

## 2. 架构

### 2.1 数据流

```
[ContentAnalysis 详情页 (A v1 已有)]
   │
   │ 用户粘贴抖音 URL + 发布时间
   ▼
[POST /api/v1/content/analyses/:id/publish]
   │ 解析 URL → 提取 aweme_id (/\/video\/(\d+)/, 短链 HEAD 展开)
   │ 校验: 同 awemeId 未关联到其他 analysis; publishedAt 非未来时间
   │ DB 更新: douyinUrl, awemeId, publishedAt, retroStatus='SCHEDULED'
   │ delayMs = max(0, publishedAt + 3d - now)
   │ retroQueue.add('retro', { analysisId }, { delay: delayMs, jobId: 'retro-<id>' })
   ▼
[T+3d 后 / 立刻 — content-retro-worker pick up]
   │
   ├─① 阶段 cookie 探测 (status=RUNNING)
   │   - spawn `python crawler.py list` 退出码 0?
   │   - 否 → status=FAILED + "cookie 失效"
   │
   ├─② 阶段 fetch 数据
   │   - spawn `python review.py video <aweme_id> /tmp/retro-<id>/script.md`
   │     CWD = CHEAT_CONTENT_PROJECT_DIR (含 .auth/)
   │   - adapter 写 /tmp/retro-<id>/report.md
   │
   ├─③ 阶段 parse report.md
   │   - 正则提取 5 核心指标 + 3 留存指标 + Top 20 评论
   │   - 缺失字段 = null (不阻断)
   │
   ├─④ 阶段 落 ActualMetric
   │   - INSERT row,snapshotAt + daysAfterPublish 计算
   │
   ├─⑤ 阶段 AI 落差总结
   │   - 5th LLM call (gpt-4o-mini, structured output via Zod)
   │   - 输入: (A v1 report 4 维度) + (ActualMetric 实际指标)
   │   - 输出: RetroReportV1 (4 维度 gap + overallTakeaway + accuracy enum)
   │
   └─⑥ 阶段 落最终
       - updateMany WHERE retroStatus != CANCELLED
       - retroStatus=COMPLETED, retroCompletedAt, retroReport, llmUsage 累加
```

**同步触发**: "立刻拉一次"按钮 = `retroQueue.add(..., { delay: 0 })`,同管道。

### 2.2 关键技术决策

| 项 | 选型 | 理由 |
|---|---|---|
| **Adapter 集成** | `child_process.execFile('python', ['adapter/review.py', ...])` | A 方案;CWD 控制 `.auth/` 复用,零移植成本 |
| **Adapter 输入** | `aweme_id` (从 URL 解析) | review.py 现成 CLI |
| **Adapter 输出解析** | 正则解析 `report.md` | renderer 已渲染结构化 md;比直接调 crawler.py 内部 API 稳 (我们不进版本号陷阱) |
| **Delayed job** | `bullmq.add({ delay: ms })` | 原生支持;进程重启后 job 仍在队列 |
| **新 queue** | `RETRO: 'content-retro'` | 与 `analyze` 分开,retro 任务不挤压新分析吞吐 |
| **状态字段** | ContentAnalysis 加 `retroStatus` 独立轨道 | A v1 `status` 含义不变 (COMPLETED = 预诊断完成);retro 是后置流程 |
| **AI 落差模型** | GPT-4o-mini + structured output + Zod | 沿用 vision.ts 抽象 (实际 text-only,无 image_url parts) |
| **Cookie 失效检测** | `crawler.py list` 退出码探测 | cheat README 推荐做法;轻量 ~3-5s |
| **派生比率** | BasisPoints * 100 (Int) | 避 float 比较;12.34% 存 1234 |
| **大数字段** | BigInt (plays/likes/comments/shares/collects) | 1M+ 播放常见,行业惯例 |

### 2.3 新建 / 修改文件清单

**新建**:

```
src/lib/douyin/aweme.ts                                    # URL → aweme_id (纯函数 + 短链 HEAD 展开)
src/lib/douyin/adapter.ts                                  # Python subprocess wrapper (probe + fetch)
src/lib/douyin/report-parser.ts                            # report.md → ActualMetricInput
src/lib/llm/prompts/ai-knowledge/retro-gap.ts              # AI 落差总结 prompt + Zod
src/jobs/workers/content-retro-worker.ts                   # retro 主 worker
src/app/api/v1/content/analyses/[id]/publish/route.ts      # POST 粘贴 URL + 调度
src/app/api/v1/content/analyses/[id]/retro-now/route.ts    # POST 立刻拉一次
src/components/content/retro-section.tsx                   # 详情页 "📊 发后复盘" 容器
src/components/content/publish-link-form.tsx               # URL + publishedAt 表单
src/components/content/actual-metrics-table.tsx            # 实际指标 8 项表
src/components/content/retro-gap-view.tsx                  # AI 落差段落渲染 (复用 DimensionCard)

tests/lib/douyin/aweme.test.ts                             # 长链 / 短链 mock
tests/lib/douyin/report-parser.test.ts                     # 用真实 fixture md
tests/lib/llm/prompts/ai-knowledge/retro-gap.test.ts       # Zod schema 边界
tests/jobs/content-retro-worker.test.ts                    # mock adapter + LLM
tests/api/content/publish.test.ts                          # publish + retro-now route 校验

tests/fixtures/douyin-report-sample.md                     # 真实 adapter 输出 fixture (用户小号视频跑出来)
```

**修改**:

```
prisma/schema.prisma                                       # ContentAnalysis 加 retro* 字段 + RetroStatus enum + ActualMetric 新表
src/jobs/queue.ts                                          # +RETRO queue + retroQueue export
src/jobs/workers/index.ts                                  # +startContentRetroWorker
src/app/content/preflight/[id]/page.tsx                    # 加 <RetroSection /> 在报告下方
src/app/api/v1/content/analyses/[id]/route.ts              # GET projection 加 retro 字段 (douyinUrl/awemeId/publishedAt/retroStatus/retroReport/retroErrorMessage)
src/lib/llm/vision.ts                                      # 复用,无需改 (gpt-4o-mini 已支持)
.env.example                                               # CHEAT_ADAPTER_PATH, PYTHON_BIN, CHEAT_CONTENT_PROJECT_DIR
README.md                                                  # A v2 安装说明 (cheat-on-content 前置依赖 + .env 三项)
```

---

## 3. 数据模型

### 3.1 `prisma/schema.prisma` 增量

```prisma
model ContentAnalysis {
  // ... A v1 现有字段不动 ...

  // ===== Phase 3 / Direction A v2 新增 =====
  douyinUrl         String?               // 完整 URL
  douyinAwemeId     String?               // 解析出的 aweme_id (snowflake long, 当字符串)
  publishedAt       DateTime?             // 用户填的发布时间
  retroStatus       RetroStatus?          // null = 没粘贴; SCHEDULED/RUNNING/COMPLETED/FAILED/CANCELLED
  retroErrorMessage String?
  retroReport       Json?                 // RetroReportV1 (见 §3.2)
  retroStartedAt    DateTime?
  retroCompletedAt  DateTime?

  actualMetrics     ActualMetric[]        // 1:N (v2 通常 1 条)

  @@index([douyinAwemeId])                // 软查重 (不 unique,允许换关联)
  @@index([retroStatus])                  // worker 找待运行的
}

enum RetroStatus {
  SCHEDULED                               // 已粘贴 URL,delayed job 入队等 T+3d
  RUNNING                                 // worker 正在拉
  COMPLETED
  FAILED
  CANCELLED                               // 用户点取消 / 删除 retro
}

model ActualMetric {
  id                  String           @id @default(cuid())
  analysisId          String
  analysis            ContentAnalysis  @relation(fields: [analysisId], references: [id], onDelete: Cascade)

  // 快照元数据
  snapshotAt          DateTime         @default(now())
  daysAfterPublish    Float            // T+N (浮点,精度到小时)
  source              String           @default("douyin-creator-center")  // 留扩展位

  // 核心指标 (BigInt — 1M+ 播放常见)
  plays               BigInt
  likes               BigInt
  comments            BigInt
  shares              BigInt
  collects            BigInt

  // 派生比率 (BasisPoints * 100; 1234 = 12.34%) — Int 避 float
  likeRateBp          Int?              // likes / plays
  commentRateBp       Int?              // comments / plays
  shareRateBp         Int?              // shares / plays

  // 留存指标
  completionRateBp    Int?              // 完播率
  retention3sBp       Int?              // 3s 留存
  followConversionBp  Int?              // 转粉率

  // 评论 Top 20 (可选, [{ text, likes }, ...])
  topComments         Json?

  // 原始 adapter 报告 (调试用,30 天清理同上传视频)
  rawReportPath       String?           // /tmp/retro-<id>/report.md → 移到 ./uploads/<analysisId>/retro-<snapshotAt>.md

  createdAt           DateTime         @default(now())

  @@index([analysisId, snapshotAt])
}
```

### 3.2 `retroReport` JSONB 形状 (TypeScript 契约, Zod 强校验)

```typescript
type AccuracyVerdict = 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown';

type RetroReportV1 = {
  schemaVersion: 1
  niche: 'ai-knowledge'

  hookGap: {
    predictedRating: 1 | 2 | 3 | 4 | 5         // 抄 A v1
    relevantActual: { retention3sBp?: number; completionRateBp?: number }
    takeaway: string                            // "钩子预判 ★3,实际 3s 留存 65%,验证了 hook 评分偏低的判断"
    accuracy: AccuracyVerdict
  }

  retentionGap: {
    predictedRiskPoints: number                 // count of riskPoints in A v1
    relevantActual: { completionRateBp?: number }
    takeaway: string
    accuracy: AccuracyVerdict
  }

  titleCaptionGap: {
    mode: 'evaluate' | 'generate' | 'unknown'   // from A v1
    relevantActual: { likeRateBp?: number; shareRateBp?: number }
    takeaway: string
    accuracy: AccuracyVerdict
  }

  coverGap: {
    mode: 'evaluate' | 'generate' | 'unknown'
    relevantActual: { plays: number /* 直接的曝光指标 */ }
    takeaway: string
    accuracy: AccuracyVerdict
  }

  // 跨维度
  overallTakeaway: string                       // 1-2 句话
  predictedOverallScore: number | null          // 抄 A v1
  inferredActualScore: number | null            // 1-100, AI 主观转换
}
```

### 3.3 关键设计决策

| 决策 | 说明 |
|---|---|
| `plays` 用 `BigInt` | 1M+ 播放常见;Int 32-bit max ~2.1B 仍够但 BigInt 是行业惯例,Prisma 映射 `bigint` PostgreSQL 类型 |
| 比率 `BasisPoints * 100` 整数 | 12.34% 存 1234;避 float 比较 + SQL 聚合方便 |
| `source` String 不用 enum | v2 固定 `'douyin-creator-center'`;未来 B 站/XHS adapter 加新值无需迁移 enum |
| `topComments` JSON 不拆表 | v2 不查询单条评论;Phase 6 竞品分析时再拆 |
| `daysAfterPublish` 浮点 | 调度可能 T+2.97d 或 T+3.05d,精度有用 |
| `rawReportPath` 字符串路径 | 调试可回看;30 天清理同上传视频策略 (推迟实现) |
| `accuracy` enum 4 值 | `on-target/over/under/unknown` (数据缺失时);未来 dashboard 聚合"哪个维度系统性高估"用 |
| `@@index([douyinAwemeId])` 不 unique | 允许用户重新关联 (粘错时);软查重在 API 层做 |

### 3.4 不引入

- ❌ 单独 `Comment` 表 — JSON 数组够,Phase 6 再说
- ❌ `cookieStatus` 表 — adapter 输出已经告诉 success/fail
- ❌ `rubricVersion` 字段 — A v2 不动 rubric

---

## 4. 关键流程

### 4.1 粘贴 URL

```
POST /api/v1/content/analyses/<id>/publish
  body: { url: string, publishedAt: ISO 8601 }

1. 解析 url:
   - 长链 `https://www.douyin.com/video/<digits>/?...` → regex 直接提取
   - 短链 `https://v.douyin.com/<slug>` → HEAD 请求 (timeout 3s) 拿 Location → 长链解析
   - 都失败 → 400 "无法解析抖音视频 ID"
2. 校验:
   - publishedAt 在未来 → 400 "发布时间不能在未来"
   - 同 awemeId 已关联其他 analysis (软查重) → 400 "该视频已关联到分析 <otherId>"
3. 拒绝并发: 若 retroStatus='RUNNING' → 400 "复盘正在进行中,请先取消"
4. 重置子状态 (允许任意状态重新关联,UI "重设链接"走同一 API):
   - prisma.actualMetric.deleteMany({ where: { analysisId: id } })
   - DB UPDATE:
     - douyinUrl, douyinAwemeId, publishedAt
     - retroStatus = 'SCHEDULED'
     - retroReport = null, retroErrorMessage = null
     - retroStartedAt = null, retroCompletedAt = null
5. 调度:
   - delayMs = max(0, publishedAt.getTime() + 3 * 86400000 - Date.now())
   - retroQueue.add('retro', { analysisId }, { delay: delayMs, jobId: `retro-${id}-${Date.now()}` })  // 加 ts 避免 BullMQ dedup 旧 jobId
6. return 200 { scheduledAt: publishedAt + 3d ISO }
```

### 4.2 立刻拉一次

```
POST /api/v1/content/analyses/<id>/retro-now

1. 校验: 必须有 douyinAwemeId (否则 400 "请先填抖音链接")
2. DB UPDATE: retroStatus='SCHEDULED', retroErrorMessage=null
3. 入队: retroQueue.add('retro', { analysisId }, { delay: 0, jobId: `retro-${id}-now-${Date.now()}` })
   (新 jobId 避 BullMQ dedup;COMPLETED 状态走"重新拉取"语义,新建 ActualMetric 行,不动旧的)
4. return 200
```

### 4.3 worker 完整 pipeline

`handleRetro` 6 阶段,每阶段失败 → retroStatus=FAILED + retroErrorMessage,worker 退出。

```typescript
async function handleRetro(job: Job<{ analysisId: string }>) {
  const { analysisId } = job.data;
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis?.douyinAwemeId) return;
  if (analysis.retroStatus === 'CANCELLED') return;

  await setRetroStatus(analysisId, 'RUNNING', { retroStartedAt: new Date() });

  // 阶段 1: Cookie 探测
  const cookieOk = await probeDouyinCookie();
  if (!cookieOk) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: '抖音 cookie 失效,请在 cheat-on-content 项目目录重新扫码',
    });
    return;
  }

  // 阶段 2: Adapter 拉数据
  let reportPath: string;
  try {
    reportPath = await runDouyinAdapter(analysis.douyinAwemeId);
  } catch (e) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: `数据采集失败: ${e instanceof Error ? e.message : String(e)}`,
    });
    return;
  }

  // 阶段 3: Parse
  const parsed = await parseReportMd(reportPath);

  // 阶段 4: 落 ActualMetric
  await prisma.actualMetric.create({
    data: {
      analysisId,
      snapshotAt: new Date(),
      daysAfterPublish: (Date.now() - analysis.publishedAt!.getTime()) / 86400000,
      ...parsed,
      rawReportPath: reportPath,
    },
  });

  // 阶段 5: AI 落差总结 (fail-soft)
  let retroReport: RetroReportV1 | null = null;
  let llmUsageDelta: TokenUsage | null = null;
  try {
    const llm = new OpenAIVisionLLM({ apiKey: process.env.OPENAI_API_KEY!, defaultModel: 'gpt-4o-mini' });
    const r = await llm.callStructured({
      systemPrompt: RETRO_GAP.systemPrompt,
      userMessage: RETRO_GAP.buildUserMessage({ report: analysis.report, actual: parsed }),
      responseSchema: RETRO_GAP.responseSchema,
      model: 'gpt-4o-mini',
    });
    retroReport = r.result;
    llmUsageDelta = r.usage;
  } catch {
    // AI 失败不阻断,UI 显"AI 总结失败,可点重新生成" (推迟到 v2.5 加重试按钮;v2 用户手动 retro-now)
  }

  // 阶段 6: 落最终 (cancel 竞态保护)
  const newLlmUsage = llmUsageDelta ? mergeLlmUsage(analysis.llmUsage, llmUsageDelta) : analysis.llmUsage;
  await prisma.contentAnalysis.updateMany({
    where: { id: analysisId, retroStatus: { not: 'CANCELLED' } },
    data: {
      retroStatus: 'COMPLETED',
      retroCompletedAt: new Date(),
      retroReport: retroReport as any,
      llmUsage: newLlmUsage as any,
    },
  });
}
```

### 4.4 Python adapter 子进程调用

```typescript
async function probeDouyinCookie(): Promise<boolean> {
  const { adapterPath, contentDir, pythonBin } = readAdapterEnv();
  try {
    await execFileAsync(
      pythonBin,
      [path.join(adapterPath, 'crawler.py'), 'list'],
      { cwd: contentDir, timeout: 30_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function runDouyinAdapter(awemeId: string): Promise<string> {
  const { adapterPath, contentDir, pythonBin } = readAdapterEnv();
  const outputDir = path.join(os.tmpdir(), `retro-${awemeId}-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  await fs.writeFile(scriptPath, `# placeholder\nawemeId: ${awemeId}\n`);

  const { stdout, stderr } = await execFileAsync(
    pythonBin,
    [path.join(adapterPath, 'review.py'), 'video', awemeId, scriptPath],
    { cwd: contentDir, timeout: 5 * 60_000 }
  );

  const reportPath = path.join(outputDir, 'report.md');
  if (!existsSync(reportPath)) {
    throw new Error(`adapter 未生成 report.md\nstdout: ${stdout.slice(-200)}\nstderr: ${stderr.slice(-200)}`);
  }
  return reportPath;
}

function readAdapterEnv() {
  const adapterPath = process.env.CHEAT_ADAPTER_PATH;
  const contentDir = process.env.CHEAT_CONTENT_PROJECT_DIR;
  if (!adapterPath || !contentDir) {
    throw new Error('CHEAT_ADAPTER_PATH 或 CHEAT_CONTENT_PROJECT_DIR 未配置');
  }
  return { adapterPath, contentDir, pythonBin: process.env.PYTHON_BIN || 'python3' };
}
```

### 4.5 `report.md` 解析

cheat-on-content `renderer.py` 输出结构稳定 (已确认源码),用正则提取 5 类:

```typescript
function parseReportMd(filePath: string): ActualMetricInput {
  const md = fs.readFileSync(filePath, 'utf-8');
  return {
    plays:              extractBigInt(md, /播放[:\s]+(\d[\d,]*)/),
    likes:              extractBigInt(md, /点赞[:\s]+(\d[\d,]*)/),
    comments:           extractBigInt(md, /评论[:\s]+(\d[\d,]*)/),
    shares:             extractBigInt(md, /转发[:\s]+(\d[\d,]*)/),
    collects:           extractBigInt(md, /收藏[:\s]+(\d[\d,]*)/),
    completionRateBp:   extractBp(md, /完播率[:\s]+([\d.]+)%/),
    retention3sBp:      extractBp(md, /3s\s*留存[:\s]+([\d.]+)%/),
    followConversionBp: extractBp(md, /转粉率[:\s]+([\d.]+)%/),
    topComments:        extractCommentsList(md),
    // 派生 (computed at parse time)
    likeRateBp:         computeRateBp(likes, plays),
    commentRateBp:      computeRateBp(comments, plays),
    shareRateBp:        computeRateBp(shares, plays),
  };
}
```

字段缺失 → null,worker 不抛错。AI 落差段落 input 标 `unknown` accuracy。

---

## 5. 错误处理、测试、UI、验收

### 5.1 错误矩阵 (新增项, A v1 已有的不重)

| 阶段 | 失败 | 处理 | 用户可见 |
|---|---|---|---|
| 粘贴 URL | URL 不含 `/video/<digits>/` 且短链解析失败 | API 400 | "无法解析抖音视频 ID,请用完整链接" |
| 粘贴 URL | 短链 HEAD 超时 3s | 降级 → 提示 | "短链解析超时,请粘贴展开后的链接" |
| 粘贴 URL | 同 awemeId 已关联其他分析 (软查重) | API 400 | "该视频已关联到分析 <id>" |
| 粘贴 URL | publishedAt 在未来 | API 400 | "发布时间不能在未来" |
| Cookie 探测 | `crawler.py list` 退出码非 0 | retroStatus=FAILED | "抖音 cookie 失效,请到 cheat-on-content 项目重扫码" |
| Cookie 探测 | Python ENOENT | retroStatus=FAILED | "Python 未配置,请设置 PYTHON_BIN" |
| Adapter 路径错 | `CHEAT_ADAPTER_PATH` 路径不存在 | retroStatus=FAILED | "Adapter 路径无效,请检查 .env" |
| Adapter 超时 | 5 分钟未输出 report.md | retroStatus=FAILED | "数据采集超时,可能评论页加载慢;请稍后重试" |
| Adapter 退出非 0 | 抖音改了接口字段 | retroStatus=FAILED + stderr 末 200 字符 | "Adapter 失败: <stderr>" + 提示去 github 看是否有新版 |
| report.md 缺失关键字段 | adapter 拿到部分数据 | 缺失字段 null,流程继续 | UI 表格该格显 "—" |
| Top 20 评论解析失败 | 评论格式变化 | 跳过 topComments,流程继续 | UI 评论区折叠 "暂无评论" |
| AI 落差总结失败 | LLM 网络/schema | retroReport=null,但保留 ActualMetric | UI 显示原始指标 + "AI 总结失败,可点重新拉取" |
| 用户在 RUNNING 期间删 retro | updateMany 跳过 | 已盖 cancel 竞态保护 | — |

### 5.2 测试策略

| 层 | 覆盖 | 工具 | CI? |
|---|---|---|---|
| `lib/douyin/aweme.ts` | URL → aweme_id (长链 / 短链 mock HEAD) | vitest | ✓ |
| `lib/douyin/report-parser.ts` | 用 fixture md 解析对比 8 字段 + Top 20 | vitest + fixture | ✓ |
| `lib/douyin/adapter.ts` | mock `child_process` → env / CWD / timeout 验证 | vitest + vi.mock | ✓ |
| `lib/llm/prompts/ai-knowledge/retro-gap.ts` | buildUserMessage(fixture) + Zod 接受合法响应 + 拒绝越界 | vitest | ✓ |
| `content-retro-worker.test.ts` | mock adapter + LLM → 全管道 + AI 失败 fail-soft + cancel race | vitest 集成 | ✓ |
| `POST /publish` | 长链 / 短链 / 重复 awemeId / 未来时间 4 case | vitest + Request | ✓ |
| `POST /retro-now` | 状态校验 (无 awemeId 拒收) | vitest | ✓ |
| 真 adapter smoke | 小号视频跑完整 retro | 手动 | ✗ |
| 手动 E2E | 详情页粘贴 + cron / 立刻拉 | 浏览器 | ✗ |

**关键 fixture**: `tests/fixtures/douyin-report-sample.md` 必须来自**真实 cheat-on-content adapter 输出**。实现期间第一步是 clone cheat,用户小号视频跑一次,把 report.md 复制到 fixtures 目录。这是唯一的"实地校准"环节。

### 5.3 UI 草图 (详情页新增 section)

```
─────────────────────────────────────────
📊 发后复盘
─────────────────────────────────────────

[空状态]
┌─ 📤 已发布到抖音? ────────────────────┐
│ 抖音视频链接: [_________________]    │
│ 发布时间:    [____-__-__ __:__]      │
│              [保存并安排 T+3d 复盘 →] │
└──────────────────────────────────────┘

[SCHEDULED 状态]
✓ 已关联: https://www.douyin.com/video/72345...
⏰ 计划于 2026-06-15 14:30 (3 天后) 自动拉取
[立刻拉一次] [重设链接]

[RUNNING 状态]
🔄 正在拉取真实数据... (创作者中心 → 视频详情)
[取消] [刷新状态]

[COMPLETED 状态]
✓ T+3.0 天采集 · 2026-06-15 14:32

实际指标
┌────────────────────────────────────┐
│ 播放    12,345    点赞   1,234     │
│ 评论    234       转发    45       │
│ 收藏    123       完播率 32.1%      │
│ 3s 留存 65.4%     转粉率 1.2%      │
└────────────────────────────────────┘

🎯 AI 落差总结
[4 个 DimensionCard,每个显示 predicted vs actual + accuracy badge + takeaway]

📌 综合: "钩子和封面方向都对,但完播率比预期低 10%..."
预判综合 78/100,实测推算 65/100

Top 20 评论 (折叠)

[重新拉取数据] [重设链接 (改换关联视频)]
```

### 5.4 v2 验收清单

- [ ] 详情页粘贴长链 + publishedAt → retroStatus=SCHEDULED + UI 显示 "3 天后自动拉取"
- [ ] 粘贴短链 (v.douyin.com/XX) → HEAD 自动展开 → 同上
- [ ] 粘贴 URL 含 publishedAt 是 4 天前 → 立刻入队 (delay=0)
- [ ] 同 awemeId 重复粘贴 → 400 错误
- [ ] 点 "立刻拉一次" → worker pick → 调 Python adapter → 解析 → 落 ActualMetric → AI 落差总结生成
- [ ] cookie 失效场景 (用过期 .auth/) → retroStatus=FAILED + 提示重扫码
- [ ] Python 不存在 / adapter path 错 → retroStatus=FAILED + 配置错误提示
- [ ] adapter 部分字段缺失 (3s 留存抓不到) → 字段 null,流程继续,UI 表格显 "—"
- [ ] AI 落差段落失败 → ActualMetric 保留,可手动重试 AI 步骤 (走"重新拉取")
- [ ] DB 验证:
  ```sql
  SELECT a.id, a."douyinAwemeId", a."retroStatus", m.plays, m."completionRateBp"
  FROM "ContentAnalysis" a LEFT JOIN "ActualMetric" m ON m."analysisId"=a.id
  WHERE a."retroStatus"='COMPLETED' LIMIT 5;
  ```
- [ ] llmUsage.total.estCostUSD 已包含 retro 的 gpt-4o-mini 调用
- [ ] `npm run typecheck` 0 错 + `npm test` 全绿
- [ ] 总开发时间预估 4-5 天 (单人,含 fixture 准备)

---

## 6. Open Questions / Risks

### 6.1 cheat-on-content 升级风险

- adapter 是上游项目内的代码,他们可能改接口
- 我们子进程调用,只要 `python review.py video <aweme_id> <script_path>` CLI 形态不变,我们不受影响
- 上游 review.py 改 CLI → 我们 retroStatus=FAILED + adapter 退出非 0 错误,用户去看 github 升级 cheat-on-content + 我们看是否要改命令行参数
- 风险等级: ★★ (低,3-6 个月可能 1 次小调整)

### 6.2 抖音创作者中心改前端 / 反爬

- adapter 走 XHR JSON 拦截,比 HTML scrape 稳但仍受影响
- cheat-on-content README 提到接口"每隔几个月会变一次"
- 出问题时 retroStatus=FAILED,需要上游修
- 我们能做的: 错误消息引导用户去看 adapter README 的 failure modes 表

### 6.3 cookie 短期过期

- 抖音创作者中心 cookie 有效期不固定 (经验值约 7-14 天)
- 用户偶尔需要 `cd ~/my-content && source .venv/bin/activate && python crawler.py login` 重扫码
- 我们 UI 提示要明确

### 6.4 AI 落差总结的输出质量

- 这是 v2 独有的价值点,但完全靠 prompt 工程
- 类似 A v1 expert-persona.ts 的迭代点
- 实现完后用户真账号跑几次,反馈调整 retro-gap.ts 的 systemPrompt

### 6.5 多账号问题 (单用户假设)

- v2 假设单用户单抖音账号,creator.douyin.com cookie 只对应一个账号
- 用户切账号 = 改 `.auth/` 内容 (cheat-on-content 自己有 login 命令)
- 多账号场景 (e.g. 用户主号 + 小号) 推迟到 Phase 6 矩阵阶段

### 6.6 与 cheat-on-content 主 skill 工作流的边界

- cheat-on-content 主 skill 在用户内容项目 `<content-project>/predictions/` 写盲预测 markdown
- 我们读不到这些 (位置在另一个目录)
- v2 不打通这层,只用 adapter
- 未来可加 cheat-on-content state.json 读取打通预测对比,但 v2 不做

---

## 7. 完成定义 (Definition of Done)

本 spec 通过用户 review 后,直接交给 `writing-plans` skill 产出分 task 的实现计划 (`docs/superpowers/plans/2026-06-12-content-preflight-v2-plan.md`)。

实现期间任何 spec 偏离 (新增字段、改 API 形状、维度调整) 须回到本文档更新,确保 spec 与 code 一致。

---

**Author**: Claude (Opus 4.7) + 用户 (AI 知识类抖音博主) brainstorm 协作完成
**Predecessor spec**: `2026-06-12-content-preflight-design.md`
**Next**: writing-plans skill → 实现计划
