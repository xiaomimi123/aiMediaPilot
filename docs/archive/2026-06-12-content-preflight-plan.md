# Content Pre-flight (Direction A v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把"上传视频 → AI 4 维度评估 (钩子/完播风险/标题文案/封面) → 优化建议"端到端打通,作为 Phase 3 内容创作方向的第一个可演示里程碑。

**Architecture:** Next.js 14 App Router 提供上传 + SSE + 报告页;Postgres 存 `ContentAnalysis` (含 JSONB report);BullMQ + Redis 异步分析;worker 进程 (复用 Phase 2 worker 容器) 调 ffmpeg 抽帧/抽音轨 + Whisper 转写 + GPT-4o 并行 4 维度评估 + GPT-4o-mini synthesize;OpenAI structured outputs + Zod 强校验 LLM 输出。

**Tech Stack:** Next.js 14 · TypeScript · Prisma · BullMQ · ioredis · openai 4.x · zod · ffmpeg (host binary) · Tailwind · vitest

**Spec:** `docs/superpowers/specs/2026-06-12-content-preflight-design.md`

**Scope** (本计划不包含,留给后续):
- 发后复盘 / 真实数据回填 → A v2
- BGM / 标签 / 互动设计这 3 个分析维度 → A v2
- 跨视频对比 / 趋势 → Phase 3 Dashboard
- 播放量预测 → Direction B
- 文件 30 天自动清理 → A v2
- 单独 worker Docker 镜像 (生产部署) → deployment phase

---

## File Structure

```
新建:
src/lib/video/sampling.ts                              # 时长 → 抽帧策略 (纯函数)
src/lib/video/ffmpeg.ts                                # ffmpeg 命令封装 (抽帧/抽音/抽封面/probe)
src/lib/llm/pricing.ts                                 # OpenAI token → USD 估算
src/lib/llm/vision.ts                                  # IVisionLLM + OpenAIVisionLLM
src/lib/llm/whisper.ts                                 # transcribe()
src/lib/llm/prompts/base.ts                            # 共享 JSON 输出规范
src/lib/llm/prompts/ai-knowledge/expert-persona.ts     # AI 知识类专家人设
src/lib/llm/prompts/ai-knowledge/hook.ts               # 钩子 prompt + Zod
src/lib/llm/prompts/ai-knowledge/retention.ts          # 完播风险 prompt + Zod
src/lib/llm/prompts/ai-knowledge/title-caption.ts      # 标题文案 (mixed mode) + Zod
src/lib/llm/prompts/ai-knowledge/cover.ts              # 封面 (mixed mode) + Zod
src/lib/llm/prompts/ai-knowledge/synthesize.ts         # 综合评分 + topActions + Zod
src/jobs/workers/content-analyze-worker.ts             # 主 worker (预处理 + AI + 落库)
src/app/api/v1/content/analyses/route.ts               # POST create / GET list
src/app/api/v1/content/analyses/[id]/route.ts          # GET / DELETE
src/app/api/v1/content/analyses/[id]/cancel/route.ts   # POST
src/app/api/v1/content/analyses/[id]/retry/route.ts    # POST
src/app/api/v1/content/analyses/[id]/events/route.ts   # SSE
src/app/content/preflight/page.tsx                     # 列表
src/app/content/preflight/new/page.tsx                 # 上传表单
src/app/content/preflight/[id]/page.tsx                # 进度 + 报告
src/components/content/upload-form.tsx
src/components/content/progress-stages.tsx
src/components/content/report-view.tsx
src/components/content/dimension-card.tsx
src/components/content/cover-candidates.tsx

tests/lib/video/sampling.test.ts
tests/lib/video/ffmpeg.test.ts
tests/lib/llm/vision.test.ts
tests/lib/llm/prompts/ai-knowledge/hook.test.ts
tests/lib/llm/prompts/ai-knowledge/retention.test.ts
tests/lib/llm/prompts/ai-knowledge/title-caption.test.ts
tests/lib/llm/prompts/ai-knowledge/cover.test.ts
tests/lib/llm/prompts/ai-knowledge/synthesize.test.ts
tests/jobs/content-analyze-worker.test.ts
tests/api/content/analyses.test.ts

修改:
package.json                                           # 加 zod
prisma/schema.prisma                                   # 加 ContentAnalysis + ContentAnalysisStatus + User.contentAnalyses
src/jobs/queue.ts                                      # 加 ANALYZE queue
src/jobs/workers/index.ts                              # 启动 content-analyze-worker
src/components/layout/sidebar.tsx (或 layout)          # 加 "内容创作" 一级入口
.env.example                                           # 加 OPENAI_VISION_MODEL=gpt-4o (可选)
README.md                                              # 加 Direction A 启动 + ffmpeg 依赖说明
```

---

## Test Strategy

- **纯函数**: `lib/video/sampling`, `lib/llm/pricing`, `lib/llm/prompts/*` 的 `buildXxxPrompt` + `responseSchema` 100% vitest 覆盖
- **Mock**: `vision.ts` mock OpenAI client 验证 token 累计 + 重试;`content-analyze-worker` mock `IVisionLLM` + `ffmpeg` 验证 fail-soft
- **API request shape**: vitest + FormData/Request 验证拒收逻辑
- **真 LLM smoke**: 不进 CI,Task 21 手动 sample 视频
- **手动 E2E**: Task 21 验收清单

测试框架: vitest (与现有项目一致)

---

## Git

每个 Task 末尾 `git commit`。Commit message 用现有项目风格 `feat(phase3): ...` / `fix(phase3): ...`。

---

## Task 1: 依赖 + Prisma schema + queue + worker 入口

**Files:**
- Modify: `package.json`
- Modify: `prisma/schema.prisma`
- Modify: `src/jobs/queue.ts`
- Modify: `src/jobs/workers/index.ts`
- Modify: `.env.example`

- [ ] **Step 1.1: 装 zod**

```bash
npm install zod@^3.23.0
```

预期: `package.json` 多一行 `"zod": "^3.23.0"`,无 lockfile 冲突。

- [ ] **Step 1.2: Prisma schema 加 ContentAnalysis + enum + User relation**

在 `prisma/schema.prisma` 末尾追加:

```prisma
// ==================== Phase 3 / Direction A: 内容预诊断 ====================

model ContentAnalysis {
  id               String                @id @default(cuid())
  userId           String
  user             User                  @relation(fields: [userId], references: [id])

  // 视频源 (相对路径,根目录 ./uploads/)
  videoPath        String
  videoFilename    String
  videoSizeBytes   Int
  videoDurationSec Float
  videoMimeType    String

  // 用户输入草稿 (null → AI 生成; 非 null → AI 评价)
  draftTitle       String?
  draftCaption     String?
  draftCoverPath   String?

  // 配置
  niche            String                @default("ai-knowledge")

  // 状态机
  status           ContentAnalysisStatus @default(QUEUED)
  errorMessage     String?
  retryCount       Int                   @default(0)

  // 进度 (SSE)
  progress         Json?

  // 预处理产物
  framesDir        String?
  audioPath        String?
  transcriptPath   String?
  coverCandidates  Json?

  // AI 结果
  report           Json?

  // 成本审计
  llmUsage         Json?

  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt
  startedAt        DateTime?
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

然后在 `User` model 内,既有 relations 列表里加一行:

```prisma
  contentAnalyses ContentAnalysis[]
```

- [ ] **Step 1.3: 推到数据库**

```bash
npx prisma db push
```

预期: `🚀 Your database is now in sync with your Prisma schema.`

- [ ] **Step 1.4: 验证 DB 表已建**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "ContentAnalysis"'
```

预期: 输出 21 列, id 主键, 2 个 index.

- [ ] **Step 1.5: queue.ts 加 ANALYZE queue**

替换 `src/jobs/queue.ts` 全文:

```typescript
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  BIND: 'bind-session',
  SYNC: 'sync',
  ANALYZE: 'content-analyze',
} as const;

export const bindQueue = new Queue(QUEUES.BIND, { connection: redis });
export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
export const analyzeQueue = new Queue(QUEUES.ANALYZE, { connection: redis });
```

- [ ] **Step 1.6: workers/index.ts 启动 content-analyze-worker (占位)**

为避免后续 task 改这里多次,先加 import 和启动语句但允许暂时未定义(用 try-catch 或先建个空文件)。

先建一个最小 stub 文件 `src/jobs/workers/content-analyze-worker.ts`:

```typescript
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';

export function startContentAnalyzeWorker() {
  const worker = new Worker(
    QUEUES.ANALYZE,
    async () => {
      throw new Error('content-analyze-worker not yet implemented (Task 12-13)');
    },
    { connection: redis }
  );
  return worker;
}
```

替换 `src/jobs/workers/index.ts`:

```typescript
import 'dotenv/config';
import { startBindWorker } from './bind-worker';
import { startContentAnalyzeWorker } from './content-analyze-worker';
import { closeAll } from '@/crawler/browser-pool';

const bind = startBindWorker();
const analyze = startContentAnalyzeWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await bind.close();
  await analyze.close();
  await closeAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: bind, analyze');
```

- [ ] **Step 1.7: .env.example 加可选变量**

`.env.example` 末尾追加:

```
# Phase 3 / Direction A
# OPENAI_VISION_MODEL=gpt-4o    # 默认 gpt-4o,如需省钱改 gpt-4o-mini
# OPENAI_SYNTHESIZE_MODEL=gpt-4o-mini
```

- [ ] **Step 1.8: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 1.9: Commit**

```bash
git add package.json package-lock.json prisma/schema.prisma src/jobs/queue.ts src/jobs/workers .env.example
git commit -m "feat(phase3): scaffolding — ContentAnalysis schema + ANALYZE queue + worker stub"
```

---

## Task 2: lib/video/sampling — 时长 → 抽帧策略 (纯函数, TDD)

**Files:**
- Create: `src/lib/video/sampling.ts`
- Create: `tests/lib/video/sampling.test.ts`

- [ ] **Step 2.1: 写失败测试**

`tests/lib/video/sampling.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeFrameSamplingPlan, computeHookFrameTimestamps } from '@/lib/video/sampling';

describe('computeFrameSamplingPlan', () => {
  it('短视频 (≤60s): 每 1s 抽 1 帧', () => {
    const plan = computeFrameSamplingPlan(45);
    expect(plan.intervalSec).toBe(1);
    expect(plan.expectedCount).toBe(45);
  });

  it('中等 (60-180s): 每 3s 抽 1 帧', () => {
    const plan = computeFrameSamplingPlan(120);
    expect(plan.intervalSec).toBe(3);
    expect(plan.expectedCount).toBe(40);
  });

  it('长 (>180s): 每 6s 抽 1 帧, 上限 100 帧', () => {
    const plan = computeFrameSamplingPlan(600);
    expect(plan.intervalSec).toBe(6);
    expect(plan.expectedCount).toBe(100);
  });

  it('边界 60s 走短视频策略', () => {
    expect(computeFrameSamplingPlan(60).intervalSec).toBe(1);
  });

  it('边界 180s 走中等策略', () => {
    expect(computeFrameSamplingPlan(180).intervalSec).toBe(3);
  });
});

describe('computeHookFrameTimestamps', () => {
  it('返回前 3 秒每 0.5s 一帧, 共 6 帧 (含 0 和 2.5)', () => {
    expect(computeHookFrameTimestamps()).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });
});
```

- [ ] **Step 2.2: 跑测试验证失败**

```bash
npm test -- sampling
```

预期: FAIL (模块不存在)。

- [ ] **Step 2.3: 实现**

`src/lib/video/sampling.ts`:

```typescript
export interface FrameSamplingPlan {
  intervalSec: number;
  expectedCount: number;
}

const MAX_FRAMES = 100;

/** 视频时长 → 抽帧间隔 + 预计帧数。 ≤60s 每 1s; 60-180s 每 3s; >180s 每 6s 但上限 100 帧。 */
export function computeFrameSamplingPlan(durationSec: number): FrameSamplingPlan {
  let intervalSec: number;
  if (durationSec <= 60) intervalSec = 1;
  else if (durationSec <= 180) intervalSec = 3;
  else intervalSec = 6;

  const raw = Math.floor(durationSec / intervalSec);
  return { intervalSec, expectedCount: Math.min(raw, MAX_FRAMES) };
}

/** 钩子分析专用: 前 3 秒每 0.5s 一帧。 */
export function computeHookFrameTimestamps(): number[] {
  return [0, 0.5, 1, 1.5, 2, 2.5];
}

/** 封面候选: t=0, t=duration/3, t=duration/2 三张。 */
export function computeCoverCandidateTimestamps(durationSec: number): number[] {
  return [0, durationSec / 3, durationSec / 2];
}
```

- [ ] **Step 2.4: 跑测试验证通过**

```bash
npm test -- sampling
```

预期: PASS (6 tests)。

- [ ] **Step 2.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/video/sampling.ts tests/lib/video/sampling.test.ts
git commit -m "feat(phase3): video sampling strategy — duration-tiered frame intervals"
```

---

## Task 3: lib/video/ffmpeg — 命令封装 + probe

**Files:**
- Create: `src/lib/video/ffmpeg.ts`
- Create: `tests/lib/video/ffmpeg.test.ts`

> ffmpeg 调用是 I/O,我们不在单测里实际跑 ffmpeg,只测命令参数构造是否正确。

- [ ] **Step 3.1: 写失败测试**

`tests/lib/video/ffmpeg.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildProbeArgs,
  buildExtractFramesArgs,
  buildExtractAudioArgs,
  buildExtractSingleFrameArgs,
  parseProbeOutput,
} from '@/lib/video/ffmpeg';

describe('buildProbeArgs', () => {
  it('构造 ffprobe 取 duration + format', () => {
    const args = buildProbeArgs('/tmp/a.mp4');
    expect(args).toContain('-show_format');
    expect(args).toContain('-of');
    expect(args).toContain('json');
    expect(args[args.length - 1]).toBe('/tmp/a.mp4');
  });
});

describe('buildExtractFramesArgs', () => {
  it('每 N 秒抽一帧, 输出到指定目录', () => {
    const args = buildExtractFramesArgs({
      videoPath: '/in.mp4',
      framesDir: '/out',
      intervalSec: 3,
    });
    expect(args).toContain('-i');
    expect(args).toContain('/in.mp4');
    expect(args.join(' ')).toMatch(/fps=1\/3/);
    expect(args).toContain('/out/frame_%04d.jpg');
  });
});

describe('buildExtractAudioArgs', () => {
  it('抽取 16kHz mono wav', () => {
    const args = buildExtractAudioArgs({ videoPath: '/in.mp4', audioPath: '/out.wav' });
    expect(args).toContain('-vn');
    expect(args.join(' ')).toMatch(/-ar 16000/);
    expect(args.join(' ')).toMatch(/-ac 1/);
    expect(args[args.length - 1]).toBe('/out.wav');
  });
});

describe('buildExtractSingleFrameArgs', () => {
  it('指定时间戳抽 1 帧', () => {
    const args = buildExtractSingleFrameArgs({
      videoPath: '/in.mp4',
      timestampSec: 2.5,
      outputPath: '/out/frame.jpg',
    });
    expect(args.join(' ')).toMatch(/-ss 2.5/);
    expect(args).toContain('-frames:v');
    expect(args).toContain('1');
    expect(args[args.length - 1]).toBe('/out/frame.jpg');
  });
});

describe('parseProbeOutput', () => {
  it('从 ffprobe JSON 解出 duration + mimeType', () => {
    const json = JSON.stringify({
      format: { duration: '67.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
    });
    const result = parseProbeOutput(json);
    expect(result.durationSec).toBeCloseTo(67.5);
    expect(result.formatName).toContain('mp4');
  });

  it('损坏的 JSON 抛错', () => {
    expect(() => parseProbeOutput('not json')).toThrow();
  });
});
```

- [ ] **Step 3.2: 跑测试验证失败**

```bash
npm test -- ffmpeg
```

预期: FAIL (模块不存在)。

- [ ] **Step 3.3: 实现**

`src/lib/video/ffmpeg.ts`:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';

export interface ProbeResult {
  durationSec: number;
  formatName: string;
}

export function buildProbeArgs(videoPath: string): string[] {
  return ['-v', 'error', '-show_format', '-of', 'json', videoPath];
}

export function parseProbeOutput(stdout: string): ProbeResult {
  const json = JSON.parse(stdout);
  const fmt = json.format ?? {};
  return {
    durationSec: parseFloat(fmt.duration ?? '0'),
    formatName: fmt.format_name ?? '',
  };
}

export async function probeVideo(videoPath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(FFPROBE_BIN, buildProbeArgs(videoPath));
  return parseProbeOutput(stdout);
}

export interface ExtractFramesOpts {
  videoPath: string;
  framesDir: string;
  intervalSec: number;
}

export function buildExtractFramesArgs(opts: ExtractFramesOpts): string[] {
  return [
    '-y',
    '-i', opts.videoPath,
    '-vf', `fps=1/${opts.intervalSec}`,
    '-q:v', '3',
    `${opts.framesDir}/frame_%04d.jpg`,
  ];
}

export async function extractFrames(opts: ExtractFramesOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractFramesArgs(opts));
}

export interface ExtractAudioOpts {
  videoPath: string;
  audioPath: string;
}

export function buildExtractAudioArgs(opts: ExtractAudioOpts): string[] {
  return [
    '-y',
    '-i', opts.videoPath,
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-f', 'wav',
    opts.audioPath,
  ];
}

export async function extractAudio(opts: ExtractAudioOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractAudioArgs(opts));
}

export interface ExtractSingleFrameOpts {
  videoPath: string;
  timestampSec: number;
  outputPath: string;
}

export function buildExtractSingleFrameArgs(opts: ExtractSingleFrameOpts): string[] {
  return [
    '-y',
    '-ss', String(opts.timestampSec),
    '-i', opts.videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    opts.outputPath,
  ];
}

export async function extractSingleFrame(opts: ExtractSingleFrameOpts): Promise<void> {
  await execFileAsync(FFMPEG_BIN, buildExtractSingleFrameArgs(opts));
}
```

- [ ] **Step 3.4: 跑测试验证通过**

```bash
npm test -- ffmpeg
```

预期: PASS (6 tests)。

- [ ] **Step 3.5: 真实 ffprobe smoke (可选,验证宿主机 ffmpeg 可用)**

```bash
ffprobe -version | head -1
```

预期: `ffprobe version 8.x ...` 或类似。如果命令找不到,装 `brew install ffmpeg`。

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/video/ffmpeg.ts tests/lib/video/ffmpeg.test.ts
git commit -m "feat(phase3): ffmpeg wrappers — probe / frames / audio / single-frame"
```

---

## Task 4: lib/llm/pricing + lib/llm/vision

**Files:**
- Create: `src/lib/llm/pricing.ts`
- Create: `src/lib/llm/vision.ts`
- Create: `tests/lib/llm/vision.test.ts`

- [ ] **Step 4.1: pricing.ts (纯函数)**

`src/lib/llm/pricing.ts`:

```typescript
// 2026-06 OpenAI 公开定价 (USD per 1M tokens)。新定价时只改这张表。
const PRICING: Record<string, { promptPerMTok: number; completionPerMTok: number }> = {
  'gpt-4o':        { promptPerMTok: 2.5,  completionPerMTok: 10.0 },
  'gpt-4o-mini':   { promptPerMTok: 0.15, completionPerMTok: 0.6 },
  'whisper-1':     { promptPerMTok: 0,    completionPerMTok: 0 }, // Whisper 按秒计费,此处不用
};

export function estimateCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (promptTokens * p.promptPerMTok + completionTokens * p.completionPerMTok) / 1_000_000;
}

/** Whisper 按音频秒计费, 当前 $0.006 / minute */
export function estimateWhisperCostUSD(audioSec: number): number {
  return (audioSec / 60) * 0.006;
}
```

- [ ] **Step 4.2: 写 vision 失败测试**

`tests/lib/llm/vision.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { OpenAIVisionLLM } from '@/lib/llm/vision';

const parseMock = vi.fn();
vi.mock('openai', () => ({
  default: class FakeOpenAI {
    beta = {
      chat: {
        completions: {
          parse: parseMock,
        },
      },
    };
  },
}));

beforeEach(() => parseMock.mockReset());

const Schema = z.object({ rating: z.number() });

describe('OpenAIVisionLLM.callStructured', () => {
  it('成功调用 → 返回 result + usage + estCostUSD', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: { rating: 4 } } }],
      usage: { prompt_tokens: 1000, completion_tokens: 100 },
      model: 'gpt-4o',
    });
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-test' });
    const out = await llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'hi' }],
      responseSchema: Schema,
    });
    expect(out.result).toEqual({ rating: 4 });
    expect(out.usage.promptTokens).toBe(1000);
    expect(out.usage.completionTokens).toBe(100);
    expect(out.usage.estCostUSD).toBeGreaterThan(0);
    expect(out.usage.model).toBe('gpt-4o');
  });

  it('OpenAI 抛错 → 3 次重试后再抛', async () => {
    parseMock.mockRejectedValue(new Error('network'));
    const llm = new OpenAIVisionLLM({ apiKey: 'sk-test', maxRetries: 3 });
    await expect(llm.callStructured({
      systemPrompt: 'sys',
      userMessage: [{ type: 'text', text: 'x' }],
      responseSchema: Schema,
    })).rejects.toThrow('network');
    expect(parseMock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 4.3: 跑测试验证失败**

```bash
npm test -- vision
```

预期: FAIL。

- [ ] **Step 4.4: 实现 vision.ts**

`src/lib/llm/vision.ts`:

```typescript
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { promises as fs } from 'fs';
import path from 'path';
import type { z, ZodSchema } from 'zod';
import { estimateCostUSD } from './pricing';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface TokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  estCostUSD: number;
}

export interface CallStructuredOpts<T> {
  systemPrompt: string;
  userMessage: ContentPart[];
  responseSchema: ZodSchema<T>;
  model?: 'gpt-4o' | 'gpt-4o-mini';
  maxTokens?: number;
}

export interface IVisionLLM {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }>;
}

export interface OpenAIVisionLLMOpts {
  apiKey: string;
  maxRetries?: number;
  defaultModel?: 'gpt-4o' | 'gpt-4o-mini';
}

export class OpenAIVisionLLM implements IVisionLLM {
  private client: OpenAI;
  private maxRetries: number;
  private defaultModel: 'gpt-4o' | 'gpt-4o-mini';

  constructor(opts: OpenAIVisionLLMOpts) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.maxRetries = opts.maxRetries ?? 3;
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
  }

  async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
    const model = opts.model ?? this.defaultModel;
    const userMessage = await this.encodeFileImages(opts.userMessage);

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const completion = await this.client.beta.chat.completions.parse({
          model,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: userMessage as any },
          ],
          response_format: zodResponseFormat(opts.responseSchema as z.ZodTypeAny, 'response'),
          max_tokens: opts.maxTokens,
        });
        const parsed = completion.choices[0]?.message.parsed as T;
        const usage = completion.usage;
        return {
          result: parsed,
          usage: {
            model: completion.model ?? model,
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            estCostUSD: estimateCostUSD(model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
          },
        };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        }
      }
    }
    throw lastError;
  }

  /** 把 image_url.url 里的 file:// 本地路径转 base64 data URL */
  private async encodeFileImages(parts: ContentPart[]): Promise<ContentPart[]> {
    const out: ContentPart[] = [];
    for (const part of parts) {
      if (part.type === 'image_url' && part.image_url.url.startsWith('file://')) {
        const filePath = part.image_url.url.slice('file://'.length);
        const buf = await fs.readFile(filePath);
        const ext = path.extname(filePath).slice(1) || 'jpeg';
        out.push({ type: 'image_url', image_url: { url: `data:image/${ext};base64,${buf.toString('base64')}` } });
      } else {
        out.push(part);
      }
    }
    return out;
  }
}
```

- [ ] **Step 4.5: 跑测试验证通过**

```bash
npm test -- vision
```

预期: PASS (2 tests)。

- [ ] **Step 4.6: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 4.7: Commit**

```bash
git add src/lib/llm/pricing.ts src/lib/llm/vision.ts tests/lib/llm/vision.test.ts
git commit -m "feat(phase3): IVisionLLM + OpenAI structured-output impl + token cost estimation"
```

---

## Task 5: lib/llm/whisper — 音频转写

**Files:**
- Create: `src/lib/llm/whisper.ts`

> Whisper API 调用,无单测 (mocking OpenAI 重复 Task 4 已覆盖);手动 smoke 在 Task 21。

- [ ] **Step 5.1: 实现**

`src/lib/llm/whisper.ts`:

```typescript
import OpenAI from 'openai';
import { createReadStream } from 'fs';
import { estimateWhisperCostUSD } from './pricing';

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  durationSec: number;
  estCostUSD: number;
}

export class WhisperClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async transcribe(audioPath: string): Promise<TranscriptionResult> {
    const resp = await this.client.audio.transcriptions.create({
      file: createReadStream(audioPath) as any,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const r = resp as unknown as {
      text: string;
      duration: number;
      segments?: { start: number; end: number; text: string }[];
    };
    return {
      text: r.text,
      durationSec: r.duration,
      segments: (r.segments ?? []).map((s) => ({
        startSec: s.start,
        endSec: s.end,
        text: s.text,
      })),
      estCostUSD: estimateWhisperCostUSD(r.duration),
    };
  }
}
```

- [ ] **Step 5.2: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 5.3: Commit**

```bash
git add src/lib/llm/whisper.ts
git commit -m "feat(phase3): Whisper transcribe wrapper with timestamped segments"
```

---

## Task 6: prompts/base + ai-knowledge/expert-persona

**Files:**
- Create: `src/lib/llm/prompts/base.ts`
- Create: `src/lib/llm/prompts/ai-knowledge/expert-persona.ts`

- [ ] **Step 6.1: base.ts**

`src/lib/llm/prompts/base.ts`:

```typescript
/** 所有维度共享的输出约定。Append 到 systemPrompt 尾部。 */
export const JSON_STRICTNESS = `
输出格式: 严格 JSON, 不要有任何 markdown 代码块标记, 不要有解释文字, 直接 JSON。
所有字符串字段使用中文。timestampSec 用秒数 (浮点),不要用 "0:18" 这种字符串。
`.trim();
```

- [ ] **Step 6.2: expert-persona.ts**

`src/lib/llm/prompts/ai-knowledge/expert-persona.ts`:

```typescript
/** AI 知识类垂类的专家上下文,4 个维度 prompt 共享前置。 */
export const EXPERT_PERSONA = `
你是抖音 AI 知识类视频运营专家。这个垂类的爆款规律:

- 开头 3 秒避免堆砌专业术语 (劝退非技术受众);用反差、类比、反常识结论开场
- 信息密度高但每 5-7 秒须有一个"信息单元"切换,避免单镜头讲太久
- 标题用具体数字 / 反常识结论 / "你不知道的 X" 句式,避免"今天讲讲..."这种泛开头
- 封面文字尽量少而清晰;有真人表情比纯文字效果好
- 完播风险点常出现在: 术语堆砌段、长 monologue、缺乏视觉变化的解释段
- 互动设计应自然嵌入 ("评论区告诉我你的看法"),避免硬性引流话术
- 受众通常对 AI/技术有兴趣但不一定有深度背景;评估时考虑"是否能让一个普通人看懂并觉得有价值"

按这套审美标准评估视频。
`.trim();
```

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/llm/prompts/base.ts src/lib/llm/prompts/ai-knowledge/expert-persona.ts
git commit -m "feat(phase3): shared prompt base + AI knowledge niche expert persona"
```

---

## Task 7: prompts/ai-knowledge/hook (维度 1)

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/hook.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/hook.test.ts`

- [ ] **Step 7.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/hook.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { HOOK, HookResponseSchema } from '@/lib/llm/prompts/ai-knowledge/hook';

describe('HOOK', () => {
  it('systemPrompt 含专家人设关键词', () => {
    expect(HOOK.systemPrompt).toMatch(/AI 知识类/);
    expect(HOOK.systemPrompt).toMatch(/钩子|前 3 秒/);
  });

  it('buildUserMessage 构造文本 + 图片', () => {
    const parts = HOOK.buildUserMessage({
      durationSec: 45,
      frameImagePaths: ['/tmp/a.jpg', '/tmp/b.jpg'],
      transcript03s: '今天讲讲 LLM',
    });
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as any).text).toMatch(/45/);
    expect((parts[0] as any).text).toMatch(/今天讲讲 LLM/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(2);
  });

  it('transcript 为空时显示 (无语音) 占位', () => {
    const parts = HOOK.buildUserMessage({
      durationSec: 30,
      frameImagePaths: ['/tmp/a.jpg'],
      transcript03s: '',
    });
    expect((parts[0] as any).text).toMatch(/无语音/);
  });
});

describe('HookResponseSchema', () => {
  it('接受合法响应', () => {
    const data = {
      rating: 3,
      summary: '钩子一般',
      suggestions: ['加反差'],
      keyObservations: [{ timestampSec: 0.5, note: '镜头静态' }],
    };
    expect(() => HookResponseSchema.parse(data)).not.toThrow();
  });

  it('rating 超出 1-5 被拒', () => {
    expect(() =>
      HookResponseSchema.parse({ rating: 7, summary: '', suggestions: [], keyObservations: [] })
    ).toThrow();
  });

  it('suggestions 为空数组被拒', () => {
    expect(() =>
      HookResponseSchema.parse({ rating: 3, summary: 'x', suggestions: [], keyObservations: [] })
    ).toThrow();
  });
});
```

- [ ] **Step 7.2: 跑测试验证失败**

```bash
npm test -- prompts/ai-knowledge/hook
```

预期: FAIL。

- [ ] **Step 7.3: 实现**

`src/lib/llm/prompts/ai-knowledge/hook.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface HookInput {
  durationSec: number;
  frameImagePaths: string[];                  // 6 张 (前 3 秒每 0.5s)
  transcript03s: string;
}

export const HookResponseSchema = z.object({
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  summary: z.string().min(1),
  suggestions: z.array(z.string()).min(1),
  keyObservations: z.array(z.object({
    timestampSec: z.number(),
    note: z.string(),
  })),
});

export type HookResponse = z.infer<typeof HookResponseSchema>;

export const HOOK = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评估视频前 3 秒钩子。给出 1-5 评分、一句话总结、可执行改进建议、关键帧观察。
- rating 1: 平淡无反差,大概率被划走
- rating 5: 强烈反差/钩子,大概率留住观看

${JSON_STRICTNESS}`,
  buildUserMessage(input: HookInput): ContentPart[] {
    const transcript = input.transcript03s.trim() || '(无语音)';
    return [
      {
        type: 'text',
        text: `视频总时长: ${input.durationSec}s\n前 3 秒 transcript:\n${transcript}\n\n下面是前 3 秒按 0.5s 间隔抽取的关键帧 (从 0s 到 2.5s):`,
      },
      ...input.frameImagePaths.map((p) => ({
        type: 'image_url' as const,
        image_url: { url: `file://${p}` },
      })),
    ];
  },
  responseSchema: HookResponseSchema,
};
```

- [ ] **Step 7.4: 跑测试验证通过**

```bash
npm test -- prompts/ai-knowledge/hook
```

预期: PASS (6 tests)。

- [ ] **Step 7.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/hook.ts tests/lib/llm/prompts/ai-knowledge/hook.test.ts
git commit -m "feat(phase3): hook prompt + Zod schema (dimension 1/4)"
```

---

## Task 8: prompts/ai-knowledge/retention (维度 2)

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/retention.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/retention.test.ts`

- [ ] **Step 8.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/retention.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { RETENTION, RetentionResponseSchema } from '@/lib/llm/prompts/ai-knowledge/retention';

describe('RETENTION', () => {
  it('buildUserMessage 含全段 transcript 时间戳 + 多张帧', () => {
    const parts = RETENTION.buildUserMessage({
      durationSec: 90,
      frameImagePaths: ['/a.jpg', '/b.jpg', '/c.jpg'],
      transcriptSegments: [
        { startSec: 0, endSec: 5, text: 'hello' },
        { startSec: 5, endSec: 10, text: 'world' },
      ],
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/0\.00-5\.00/);
    expect(text).toMatch(/hello/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
  });
});

describe('RetentionResponseSchema', () => {
  it('合法响应通过', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [{ startSec: 18, endSec: 24, severity: 'high', reason: 'x', suggestion: 'y' }],
      overallSummary: '整体可看',
    })).not.toThrow();
  });

  it('severity 必须是 low/medium/high', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [{ startSec: 0, endSec: 1, severity: 'meh', reason: '', suggestion: '' }],
      overallSummary: '',
    })).toThrow();
  });

  it('riskPoints 为空数组合法 (视频很流畅)', () => {
    expect(() => RetentionResponseSchema.parse({
      riskPoints: [],
      overallSummary: '流畅',
    })).not.toThrow();
  });
});
```

- [ ] **Step 8.2: 跑测试验证失败**

```bash
npm test -- prompts/ai-knowledge/retention
```

预期: FAIL。

- [ ] **Step 8.3: 实现**

`src/lib/llm/prompts/ai-knowledge/retention.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';
import type { TranscriptSegment } from '@/lib/llm/whisper';

export interface RetentionInput {
  durationSec: number;
  frameImagePaths: string[];                  // 30-60 张全段抽样
  transcriptSegments: TranscriptSegment[];
}

export const RetentionResponseSchema = z.object({
  riskPoints: z.array(z.object({
    startSec: z.number(),
    endSec: z.number(),
    severity: z.enum(['low', 'medium', 'high']),
    reason: z.string(),
    suggestion: z.string(),
  })),
  overallSummary: z.string().min(1),
});

export type RetentionResponse = z.infer<typeof RetentionResponseSchema>;

export const RETENTION = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 通览整段视频, 标出可能让观众划走 (低完播率) 的时段。每个风险点给 start/end 秒数、严重程度 (low/medium/high)、原因、改进建议。如果整段流畅可以返回空数组。

${JSON_STRICTNESS}`,
  buildUserMessage(input: RetentionInput): ContentPart[] {
    const transcript = input.transcriptSegments.length === 0
      ? '(无语音)'
      : input.transcriptSegments
          .map((s) => `[${s.startSec.toFixed(2)}-${s.endSec.toFixed(2)}] ${s.text}`)
          .join('\n');
    return [
      {
        type: 'text',
        text: `视频总时长: ${input.durationSec}s\n带时间戳的 transcript:\n${transcript}\n\n下面是全段抽样帧 (按时间顺序):`,
      },
      ...input.frameImagePaths.map((p) => ({
        type: 'image_url' as const,
        image_url: { url: `file://${p}` },
      })),
    ];
  },
  responseSchema: RetentionResponseSchema,
};
```

- [ ] **Step 8.4: 跑测试验证通过**

```bash
npm test -- prompts/ai-knowledge/retention
```

预期: PASS (4 tests)。

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/retention.ts tests/lib/llm/prompts/ai-knowledge/retention.test.ts
git commit -m "feat(phase3): retention risk prompt + Zod schema (dimension 2/4)"
```

---

## Task 9: prompts/ai-knowledge/title-caption (维度 3, mixed mode)

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/title-caption.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/title-caption.test.ts`

- [ ] **Step 9.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/title-caption.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { TITLE_CAPTION, TitleCaptionResponseSchema } from '@/lib/llm/prompts/ai-knowledge/title-caption';

describe('TITLE_CAPTION', () => {
  it('evaluate 模式 (有草稿) → systemPrompt 提及评价', () => {
    const parts = TITLE_CAPTION.buildUserMessage({
      transcriptText: 'demo',
      draftTitle: 'ChatGPT 提示词指南',
      draftCaption: '今天分享 5 个技巧',
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/草稿/);
    expect(text).toMatch(/ChatGPT 提示词指南/);
  });

  it('generate 模式 (草稿全 null) → 提示生成 3 个候选', () => {
    const parts = TITLE_CAPTION.buildUserMessage({
      transcriptText: 'demo',
      draftTitle: null,
      draftCaption: null,
    });
    expect((parts[0] as any).text).toMatch(/生成 3 个/);
  });
});

describe('TitleCaptionResponseSchema', () => {
  it('evaluate 模式响应', () => {
    expect(() => TitleCaptionResponseSchema.parse({
      mode: 'evaluate',
      titleFeedback: { rating: 4, issues: ['偏泛'], rewrites: ['新标题 1', '新标题 2'] },
      captionFeedback: { rating: 3, issues: [], rewrites: [] },
    })).not.toThrow();
  });

  it('generate 模式响应', () => {
    expect(() => TitleCaptionResponseSchema.parse({
      mode: 'generate',
      generatedTitles: ['标题 1', '标题 2', '标题 3'],
      generatedCaptions: ['文案 1', '文案 2', '文案 3'],
    })).not.toThrow();
  });

  it('mode 必须是 evaluate 或 generate', () => {
    expect(() => TitleCaptionResponseSchema.parse({ mode: 'other' })).toThrow();
  });
});
```

- [ ] **Step 9.2: 跑测试验证失败**

```bash
npm test -- title-caption
```

预期: FAIL。

- [ ] **Step 9.3: 实现**

`src/lib/llm/prompts/ai-knowledge/title-caption.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface TitleCaptionInput {
  transcriptText: string;
  draftTitle: string | null;
  draftCaption: string | null;
}

const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const FeedbackBlock = z.object({
  rating: Rating,
  issues: z.array(z.string()),
  rewrites: z.array(z.string()),
});

export const TitleCaptionResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('evaluate'),
    titleFeedback: FeedbackBlock.optional(),
    captionFeedback: FeedbackBlock.optional(),
  }),
  z.object({
    mode: z.literal('generate'),
    generatedTitles: z.array(z.string()).min(1),
    generatedCaptions: z.array(z.string()).min(1),
  }),
]);

export type TitleCaptionResponse = z.infer<typeof TitleCaptionResponseSchema>;

export const TITLE_CAPTION = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评价或生成视频的标题和文案。
- 用户提供了草稿: mode="evaluate", 给评分 + 问题点 + 至少 2 个重写候选 (titleFeedback/captionFeedback)
- 用户未提供草稿: mode="generate", 生成 3 个标题候选 + 3 个文案候选

${JSON_STRICTNESS}`,
  buildUserMessage(input: TitleCaptionInput): ContentPart[] {
    const hasAny = input.draftTitle !== null || input.draftCaption !== null;
    const mode = hasAny ? 'evaluate' : 'generate';

    let userText: string;
    if (mode === 'evaluate') {
      userText = `根据视频内容评价用户草稿。
视频 transcript:
${input.transcriptText || '(无语音)'}

用户草稿:
- 标题: ${input.draftTitle ?? '(未填)'}
- 文案: ${input.draftCaption ?? '(未填)'}

请仅评价已填字段, 未填字段对应的 *Feedback 留空 (不要返回)。`;
    } else {
      userText = `用户未提供标题/文案草稿。请基于视频内容生成 3 个标题候选 + 3 个文案候选。
视频 transcript:
${input.transcriptText || '(无语音)'}`;
    }

    return [{ type: 'text', text: userText }];
  },
  responseSchema: TitleCaptionResponseSchema,
};
```

- [ ] **Step 9.4: 跑测试验证通过**

```bash
npm test -- title-caption
```

预期: PASS (5 tests)。

- [ ] **Step 9.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/title-caption.ts tests/lib/llm/prompts/ai-knowledge/title-caption.test.ts
git commit -m "feat(phase3): title-caption prompt (mixed mode) + Zod schema (dimension 3/4)"
```

---

## Task 10: prompts/ai-knowledge/cover (维度 4, mixed mode)

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/cover.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/cover.test.ts`

- [ ] **Step 10.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/cover.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { COVER, CoverResponseSchema } from '@/lib/llm/prompts/ai-knowledge/cover';

describe('COVER', () => {
  it('evaluate 模式 (用户上传了封面)', () => {
    const parts = COVER.buildUserMessage({
      transcriptFirstChunk: 'demo',
      userCoverPath: '/tmp/user.jpg',
      candidatePaths: [],
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/已上传封面/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(1);
  });

  it('generate 模式 (无上传, 3 张候选)', () => {
    const parts = COVER.buildUserMessage({
      transcriptFirstChunk: 'demo',
      userCoverPath: null,
      candidatePaths: ['/a.jpg', '/b.jpg', '/c.jpg'],
    });
    expect((parts[0] as any).text).toMatch(/3 张候选/);
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(3);
  });
});

describe('CoverResponseSchema', () => {
  it('evaluate 响应', () => {
    expect(() => CoverResponseSchema.parse({
      mode: 'evaluate',
      feedback: { rating: 4, issues: ['文字小'], suggestions: ['放大字号'] },
    })).not.toThrow();
  });

  it('generate 响应', () => {
    expect(() => CoverResponseSchema.parse({
      mode: 'generate',
      candidates: [
        { coverCandidateIdx: 0, timestampSec: 0, reason: '画面清晰' },
        { coverCandidateIdx: 1, timestampSec: 22, reason: '有表情' },
      ],
      recommendedIdx: 1,
    })).not.toThrow();
  });
});
```

- [ ] **Step 10.2: 跑测试验证失败**

```bash
npm test -- cover
```

预期: FAIL。

- [ ] **Step 10.3: 实现**

`src/lib/llm/prompts/ai-knowledge/cover.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface CoverInput {
  transcriptFirstChunk: string;
  userCoverPath: string | null;
  candidatePaths: string[];                   // 3 张候选 (mode=generate 时使用)
}

const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const CoverResponseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('evaluate'),
    feedback: z.object({
      rating: Rating,
      issues: z.array(z.string()),
      suggestions: z.array(z.string()),
    }),
  }),
  z.object({
    mode: z.literal('generate'),
    candidates: z.array(z.object({
      coverCandidateIdx: z.number().int().min(0),
      timestampSec: z.number(),
      reason: z.string(),
    })),
    recommendedIdx: z.number().int().min(0),
  }),
]);

export type CoverResponse = z.infer<typeof CoverResponseSchema>;

export const COVER = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 评价封面 (用户上传时) 或从候选中推选封面 (未上传时)。
- evaluate: 给 1-5 评分 + 问题点 + 改进建议
- generate: 评每张候选适合度 + 给出 recommendedIdx (从 0 开始的索引)

${JSON_STRICTNESS}`,
  buildUserMessage(input: CoverInput): ContentPart[] {
    const transcript = input.transcriptFirstChunk.trim() || '(无语音)';

    if (input.userCoverPath) {
      return [
        {
          type: 'text',
          text: `视频主题 (开头 transcript): ${transcript}\n\n下面是用户已上传封面, 请评价:`,
        },
        { type: 'image_url', image_url: { url: `file://${input.userCoverPath}` } },
      ];
    }

    const parts: ContentPart[] = [
      {
        type: 'text',
        text: `视频主题 (开头 transcript): ${transcript}\n\n用户未上传封面。下面是从视频抽出的 3 张候选 (按顺序索引 0/1/2), 请评估并推选:`,
      },
    ];
    for (const p of input.candidatePaths) {
      parts.push({ type: 'image_url', image_url: { url: `file://${p}` } });
    }
    return parts;
  },
  responseSchema: CoverResponseSchema,
};
```

- [ ] **Step 10.4: 跑测试验证通过**

```bash
npm test -- cover
```

预期: PASS (4 tests)。

- [ ] **Step 10.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/cover.ts tests/lib/llm/prompts/ai-knowledge/cover.test.ts
git commit -m "feat(phase3): cover prompt (mixed mode) + Zod schema (dimension 4/4)"
```

---

## Task 11: prompts/ai-knowledge/synthesize

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/synthesize.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/synthesize.test.ts`

- [ ] **Step 11.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/synthesize.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SYNTHESIZE, SynthesizeResponseSchema } from '@/lib/llm/prompts/ai-knowledge/synthesize';

describe('SYNTHESIZE', () => {
  it('buildUserMessage 含 4 个维度子报告', () => {
    const parts = SYNTHESIZE.buildUserMessage({
      hook: { rating: 3 },
      retention: { riskPoints: [] },
      titleCaption: { mode: 'evaluate' },
      cover: { mode: 'generate' },
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/hook/);
    expect(text).toMatch(/retention/);
    expect(text).toMatch(/titleCaption/);
    expect(text).toMatch(/cover/);
  });
});

describe('SynthesizeResponseSchema', () => {
  it('overallScore 1-100', () => {
    expect(() => SynthesizeResponseSchema.parse({
      overallScore: 78,
      topActionItems: ['改 0:01 钩子', '压缩 0:18'],
    })).not.toThrow();
  });

  it('overallScore 超出 0-100 被拒', () => {
    expect(() => SynthesizeResponseSchema.parse({ overallScore: 120, topActionItems: ['x'] })).toThrow();
  });

  it('topActionItems 至少 1 条', () => {
    expect(() => SynthesizeResponseSchema.parse({ overallScore: 50, topActionItems: [] })).toThrow();
  });
});
```

- [ ] **Step 11.2: 跑测试验证失败**

```bash
npm test -- synthesize
```

预期: FAIL。

- [ ] **Step 11.3: 实现**

`src/lib/llm/prompts/ai-knowledge/synthesize.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';

export interface SynthesizeInput {
  hook: unknown;
  retention: unknown;
  titleCaption: unknown;
  cover: unknown;
}

export const SynthesizeResponseSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  topActionItems: z.array(z.string()).min(1).max(5),
});

export type SynthesizeResponse = z.infer<typeof SynthesizeResponseSchema>;

export const SYNTHESIZE = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 综合 4 个维度的评估子报告, 给出 1-100 的综合评分 + 3-5 条"现在去改"的高优先级 action items。
- overallScore: 权重参考 = 钩子 30%, 完播 30%, 标题/文案 20%, 封面 20%
- topActionItems: 跨维度凝练, 每条具体可执行 (不要说"提升观感", 要说"把 0:01 改成提问句")

${JSON_STRICTNESS}`,
  buildUserMessage(input: SynthesizeInput): ContentPart[] {
    return [
      {
        type: 'text',
        text: `4 个维度子报告 (JSON):
hook: ${JSON.stringify(input.hook, null, 2)}
retention: ${JSON.stringify(input.retention, null, 2)}
titleCaption: ${JSON.stringify(input.titleCaption, null, 2)}
cover: ${JSON.stringify(input.cover, null, 2)}

综合给出 overallScore 和 topActionItems。`,
      },
    ];
  },
  responseSchema: SynthesizeResponseSchema,
};
```

- [ ] **Step 11.4: 跑测试验证通过**

```bash
npm test -- synthesize
```

预期: PASS (4 tests)。

- [ ] **Step 11.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/synthesize.ts tests/lib/llm/prompts/ai-knowledge/synthesize.test.ts
git commit -m "feat(phase3): synthesize prompt + Zod schema (overall score + top actions)"
```

---

## Task 12: content-analyze-worker — 预处理阶段

**Files:**
- Modify: `src/jobs/workers/content-analyze-worker.ts`
- Create: `tests/jobs/content-analyze-worker.test.ts`

> 这一 Task 只实现预处理 (ffmpeg + Whisper);Task 13 加 AI 阶段。

- [ ] **Step 12.1: 写预处理失败测试**

`tests/jobs/content-analyze-worker.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runPreprocess } from '@/jobs/workers/content-analyze-worker';

vi.mock('@/lib/video/ffmpeg', () => ({
  probeVideo:           vi.fn(async () => ({ durationSec: 45, formatName: 'mp4' })),
  extractFrames:        vi.fn(async () => undefined),
  extractAudio:         vi.fn(async () => undefined),
  extractSingleFrame:   vi.fn(async () => undefined),
}));

vi.mock('@/lib/llm/whisper', () => ({
  WhisperClient: class {
    async transcribe() {
      return { text: 'demo', segments: [], durationSec: 45, estCostUSD: 0.005 };
    }
  },
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
});

beforeEach(() => vi.clearAllMocks());

describe('runPreprocess', () => {
  it('45 秒视频抽 45 帧 + 音轨 + 3 张候选封面', async () => {
    const result = await runPreprocess({
      analysisId: 'a1',
      videoPath: './uploads/a1/original.mp4',
      uploadsRoot: './uploads',
      openaiApiKey: 'sk-x',
    });
    expect(result.framesDir).toBe('./uploads/a1/frames');
    expect(result.audioPath).toBe('./uploads/a1/audio.wav');
    expect(result.transcriptPath).toBe('./uploads/a1/transcript.json');
    expect(result.coverCandidates).toHaveLength(3);
    expect(result.durationSec).toBe(45);
    expect(result.whisperCostUSD).toBeCloseTo(0.005);
  });
});
```

- [ ] **Step 12.2: 跑测试验证失败**

```bash
npm test -- content-analyze-worker
```

预期: FAIL (runPreprocess 不存在)。

- [ ] **Step 12.3: 实现预处理 + worker 框架**

替换 `src/jobs/workers/content-analyze-worker.ts` 全文:

```typescript
import { Worker, type Job } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import {
  probeVideo,
  extractFrames,
  extractAudio,
  extractSingleFrame,
} from '@/lib/video/ffmpeg';
import {
  computeFrameSamplingPlan,
  computeCoverCandidateTimestamps,
} from '@/lib/video/sampling';
import { WhisperClient } from '@/lib/llm/whisper';
import type { ContentAnalysisStatus } from '@prisma/client';

type JobData = { analysisId: string };

async function setStatus(analysisId: string, status: ContentAnalysisStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { status, ...extra },
  });
}

export interface PreprocessResult {
  framesDir: string;
  audioPath: string;
  transcriptPath: string;
  coverCandidates: { path: string; timestampSec: number }[];
  durationSec: number;
  whisperCostUSD: number;
}

export interface PreprocessOpts {
  analysisId: string;
  videoPath: string;
  uploadsRoot: string;
  openaiApiKey: string;
}

export async function runPreprocess(opts: PreprocessOpts): Promise<PreprocessResult> {
  const analysisDir = path.join(opts.uploadsRoot, opts.analysisId);
  const framesDir = path.join(analysisDir, 'frames');
  const coversDir = path.join(analysisDir, 'covers');
  const audioPath = path.join(analysisDir, 'audio.wav');
  const transcriptPath = path.join(analysisDir, 'transcript.json');

  await fs.mkdir(framesDir, { recursive: true });
  await fs.mkdir(coversDir, { recursive: true });

  const { durationSec } = await probeVideo(opts.videoPath);
  const plan = computeFrameSamplingPlan(durationSec);

  await extractFrames({ videoPath: opts.videoPath, framesDir, intervalSec: plan.intervalSec });
  await extractAudio({ videoPath: opts.videoPath, audioPath });

  const whisper = new WhisperClient(opts.openaiApiKey);
  const transcription = await whisper.transcribe(audioPath);
  await fs.writeFile(transcriptPath, JSON.stringify(transcription), 'utf-8');

  const coverTimestamps = computeCoverCandidateTimestamps(durationSec);
  const coverCandidates = await Promise.all(
    coverTimestamps.map(async (t, i) => {
      const outputPath = path.join(coversDir, `cover_${i}.jpg`);
      await extractSingleFrame({ videoPath: opts.videoPath, timestampSec: t, outputPath });
      return { path: outputPath, timestampSec: t };
    })
  );

  return {
    framesDir,
    audioPath,
    transcriptPath,
    coverCandidates,
    durationSec,
    whisperCostUSD: transcription.estCostUSD,
  };
}

async function handleAnalyze(job: Job<JobData>) {
  const { analysisId } = job.data;
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);
  if (analysis.status === 'CANCELLED') return;

  const uploadsRoot = process.env.UPLOADS_ROOT || './uploads';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  await setStatus(analysisId, 'PREPROCESSING', { startedAt: new Date() });

  const pre = await runPreprocess({
    analysisId,
    videoPath: analysis.videoPath,
    uploadsRoot,
    openaiApiKey: apiKey,
  });

  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: {
      framesDir: pre.framesDir,
      audioPath: pre.audioPath,
      transcriptPath: pre.transcriptPath,
      coverCandidates: pre.coverCandidates,
      videoDurationSec: pre.durationSec,
    },
  });

  // Task 13 接 AI 阶段
  throw new Error('AI stage not yet implemented (Task 13)');
}

export function startContentAnalyzeWorker() {
  const worker = new Worker<JobData>(QUEUES.ANALYZE, handleAnalyze, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[content-analyze] failed', job?.id, err);
    if (job) {
      prisma.contentAnalysis
        .update({
          where: { id: job.data.analysisId },
          data: { status: 'FAILED', errorMessage: err.message, completedAt: new Date() },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job) => {
    console.log('[content-analyze] completed', job.id);
  });
  return worker;
}
```

- [ ] **Step 12.4: 跑测试验证通过**

```bash
npm test -- content-analyze-worker
```

预期: PASS (1 test)。

- [ ] **Step 12.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 12.6: Commit**

```bash
git add src/jobs/workers/content-analyze-worker.ts tests/jobs/content-analyze-worker.test.ts
git commit -m "feat(phase3): content-analyze-worker — preprocess stage (ffmpeg + Whisper)"
```

---

## Task 13: content-analyze-worker — AI 阶段 + fail-soft + synthesize + 落库

**Files:**
- Modify: `src/jobs/workers/content-analyze-worker.ts`
- Modify: `tests/jobs/content-analyze-worker.test.ts`

- [ ] **Step 13.1: 测试 fail-soft (新增 test)**

在 `tests/jobs/content-analyze-worker.test.ts` 文件末尾追加:

```typescript
import { runAIAnalysis } from '@/jobs/workers/content-analyze-worker';
import { HookResponseSchema } from '@/lib/llm/prompts/ai-knowledge/hook';
import { RetentionResponseSchema } from '@/lib/llm/prompts/ai-knowledge/retention';

describe('runAIAnalysis (fail-soft)', () => {
  const baseInput = {
    durationSec: 45,
    framesDir: '/frames',
    audioPath: '/audio.wav',
    transcript: { text: 'demo', segments: [], durationSec: 45 },
    coverCandidates: [{ path: '/c.jpg', timestampSec: 0 }],
    draftTitle: null,
    draftCaption: null,
    draftCoverPath: null,
  };

  it('1 个维度失败,其他维度继续', async () => {
    const calls: string[] = [];
    const fakeLLM = {
      async callStructured(opts: any) {
        const sys = opts.systemPrompt as string;
        if (sys.match(/前 3 秒钩子/)) {
          calls.push('hook');
          throw new Error('hook LLM broken');
        }
        calls.push('other');
        // 任意符合 schema 的回答
        if (opts.responseSchema === RetentionResponseSchema) {
          return { result: { riskPoints: [], overallSummary: 'ok' }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
        }
        return { result: { mode: 'generate', generatedTitles: ['t1','t2','t3'], generatedCaptions: ['c1','c2','c3'] }, usage: { model: 'gpt-4o', promptTokens: 100, completionTokens: 50, estCostUSD: 0.001 } };
      },
    } as any;

    // 用 mock vision 跑;framesDir 内必须有帧文件 — mock fs.readdir
    const fsp = await import('fs/promises');
    vi.spyOn(fsp, 'readdir').mockResolvedValue(['frame_0001.jpg'] as any);

    const result = await runAIAnalysis(baseInput, { llm: fakeLLM, synthesizeLLM: fakeLLM });
    expect(calls).toContain('hook');
    expect(result.report.hook).toHaveProperty('error');
    expect(result.report.retention).not.toHaveProperty('error');
    expect(result.report.titleCaption).not.toHaveProperty('error');
  });
});
```

- [ ] **Step 13.2: 跑测试验证失败**

```bash
npm test -- content-analyze-worker
```

预期: FAIL (runAIAnalysis 不存在)。

- [ ] **Step 13.3: 实现 runAIAnalysis + 接入 handleAnalyze**

在 `src/jobs/workers/content-analyze-worker.ts` 顶部追加 imports:

```typescript
import { OpenAIVisionLLM, type IVisionLLM, type TokenUsage } from '@/lib/llm/vision';
import { HOOK } from '@/lib/llm/prompts/ai-knowledge/hook';
import { RETENTION } from '@/lib/llm/prompts/ai-knowledge/retention';
import { TITLE_CAPTION } from '@/lib/llm/prompts/ai-knowledge/title-caption';
import { COVER } from '@/lib/llm/prompts/ai-knowledge/cover';
import { SYNTHESIZE } from '@/lib/llm/prompts/ai-knowledge/synthesize';
import type { TranscriptionResult } from '@/lib/llm/whisper';
import { computeHookFrameTimestamps } from '@/lib/video/sampling';
```

在文件中部追加导出:

```typescript
export interface AIAnalysisInput {
  durationSec: number;
  framesDir: string;
  audioPath: string;
  transcript: { text: string; segments: { startSec: number; endSec: number; text: string }[]; durationSec: number };
  coverCandidates: { path: string; timestampSec: number }[];
  draftTitle: string | null;
  draftCaption: string | null;
  draftCoverPath: string | null;
}

export interface AIAnalysisDeps {
  llm: IVisionLLM;
  synthesizeLLM: IVisionLLM;
}

export interface AIAnalysisResult {
  report: Record<string, any>;
  llmUsage: { byCall: TokenUsage[]; total: TokenUsage };
}

function emptyTotal(): TokenUsage {
  return { model: 'aggregate', promptTokens: 0, completionTokens: 0, estCostUSD: 0 };
}

function accumulate(total: TokenUsage, u: TokenUsage): TokenUsage {
  return {
    model: 'aggregate',
    promptTokens: total.promptTokens + u.promptTokens,
    completionTokens: total.completionTokens + u.completionTokens,
    estCostUSD: total.estCostUSD + u.estCostUSD,
  };
}

async function listFramePaths(framesDir: string): Promise<string[]> {
  const files = await fs.readdir(framesDir);
  return files.filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(framesDir, f));
}

export async function runAIAnalysis(input: AIAnalysisInput, deps: AIAnalysisDeps): Promise<AIAnalysisResult> {
  const allFrames = await listFramePaths(input.framesDir);

  // 前 3 秒帧 (Task 2 提供时间戳列表) — 从 frames 里取前 6 张
  const hookFrames = allFrames.slice(0, computeHookFrameTimestamps().length);
  const retentionFrames = allFrames;

  // transcript 0-3s 段
  const transcript03s = input.transcript.segments
    .filter((s) => s.startSec < 3)
    .map((s) => s.text)
    .join(' ');

  // 4 维度并行
  const callTracking: { name: string; usage: TokenUsage }[] = [];
  const tracked = async <T>(name: string, fn: () => Promise<{ result: T; usage: TokenUsage }>): Promise<T | { error: string }> => {
    try {
      const out = await fn();
      callTracking.push({ name, usage: out.usage });
      return out.result;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  };

  const [hookResult, retentionResult, titleCaptionResult, coverResult] = await Promise.all([
    tracked('hook', () => deps.llm.callStructured({
      systemPrompt: HOOK.systemPrompt,
      userMessage: HOOK.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: hookFrames,
        transcript03s,
      }),
      responseSchema: HOOK.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('retention', () => deps.llm.callStructured({
      systemPrompt: RETENTION.systemPrompt,
      userMessage: RETENTION.buildUserMessage({
        durationSec: input.durationSec,
        frameImagePaths: retentionFrames,
        transcriptSegments: input.transcript.segments,
      }),
      responseSchema: RETENTION.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('titleCaption', () => deps.llm.callStructured({
      systemPrompt: TITLE_CAPTION.systemPrompt,
      userMessage: TITLE_CAPTION.buildUserMessage({
        transcriptText: input.transcript.text,
        draftTitle: input.draftTitle,
        draftCaption: input.draftCaption,
      }),
      responseSchema: TITLE_CAPTION.responseSchema,
      model: 'gpt-4o',
    })),
    tracked('cover', () => deps.llm.callStructured({
      systemPrompt: COVER.systemPrompt,
      userMessage: COVER.buildUserMessage({
        transcriptFirstChunk: input.transcript.segments.slice(0, 3).map((s) => s.text).join(' '),
        userCoverPath: input.draftCoverPath,
        candidatePaths: input.coverCandidates.map((c) => c.path),
      }),
      responseSchema: COVER.responseSchema,
      model: 'gpt-4o',
    })),
  ]);

  // synthesize 仅在 4 维度全部成功时跑
  const allOk =
    !('error' in (hookResult as any)) &&
    !('error' in (retentionResult as any)) &&
    !('error' in (titleCaptionResult as any)) &&
    !('error' in (coverResult as any));

  let overallScore: number | null = null;
  let topActionItems: string[] = [];

  if (allOk) {
    try {
      const synOut = await deps.synthesizeLLM.callStructured({
        systemPrompt: SYNTHESIZE.systemPrompt,
        userMessage: SYNTHESIZE.buildUserMessage({
          hook: hookResult,
          retention: retentionResult,
          titleCaption: titleCaptionResult,
          cover: coverResult,
        }),
        responseSchema: SYNTHESIZE.responseSchema,
        model: 'gpt-4o-mini',
      });
      overallScore = synOut.result.overallScore;
      topActionItems = synOut.result.topActionItems;
      callTracking.push({ name: 'synthesize', usage: synOut.usage });
    } catch {
      // synthesize 失败不阻断,留 null
    }
  }

  const total = callTracking.reduce((acc, c) => accumulate(acc, c.usage), emptyTotal());

  return {
    report: {
      schemaVersion: 1,
      niche: 'ai-knowledge',
      hook: hookResult,
      retention: retentionResult,
      titleCaption: titleCaptionResult,
      cover: coverResult,
      overallScore,
      topActionItems,
    },
    llmUsage: { byCall: callTracking.map((c) => c.usage), total },
  };
}
```

替换 `handleAnalyze` 函数 (用上一 task 末尾 throw 那个版本) 全文为:

```typescript
async function handleAnalyze(job: Job<JobData>) {
  const { analysisId } = job.data;
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);
  if (analysis.status === 'CANCELLED') return;

  const uploadsRoot = process.env.UPLOADS_ROOT || './uploads';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  let framesDir = analysis.framesDir;
  let audioPath = analysis.audioPath;
  let transcriptPath = analysis.transcriptPath;
  let coverCandidates = (analysis.coverCandidates as { path: string; timestampSec: number }[] | null) ?? null;
  let durationSec = analysis.videoDurationSec;

  // 如果未预处理 (新任务) 或 retry 后未保留产物 → 跑预处理
  if (!framesDir || !audioPath || !transcriptPath || !coverCandidates) {
    await setStatus(analysisId, 'PREPROCESSING', { startedAt: new Date() });
    const pre = await runPreprocess({
      analysisId,
      videoPath: analysis.videoPath,
      uploadsRoot,
      openaiApiKey: apiKey,
    });
    framesDir = pre.framesDir;
    audioPath = pre.audioPath;
    transcriptPath = pre.transcriptPath;
    coverCandidates = pre.coverCandidates;
    durationSec = pre.durationSec;
    await prisma.contentAnalysis.update({
      where: { id: analysisId },
      data: { framesDir, audioPath, transcriptPath, coverCandidates, videoDurationSec: durationSec },
    });
  }

  // 取消检查
  const recheck = await prisma.contentAnalysis.findUnique({ where: { id: analysisId }, select: { status: true } });
  if (recheck?.status === 'CANCELLED') return;

  await setStatus(analysisId, 'ANALYZING');

  const transcriptJson = JSON.parse(await fs.readFile(transcriptPath, 'utf-8')) as {
    text: string;
    segments: { startSec: number; endSec: number; text: string }[];
    durationSec: number;
  };

  const llm = new OpenAIVisionLLM({ apiKey, defaultModel: 'gpt-4o' });
  const synthesizeLLM = new OpenAIVisionLLM({ apiKey, defaultModel: 'gpt-4o-mini' });

  const ai = await runAIAnalysis(
    {
      durationSec,
      framesDir,
      audioPath,
      transcript: transcriptJson,
      coverCandidates,
      draftTitle: analysis.draftTitle,
      draftCaption: analysis.draftCaption,
      draftCoverPath: analysis.draftCoverPath,
    },
    { llm, synthesizeLLM }
  );

  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      report: ai.report,
      llmUsage: ai.llmUsage,
    },
  });
}
```

- [ ] **Step 13.4: 跑测试验证通过**

```bash
npm test -- content-analyze-worker
```

预期: PASS (2 tests, 含 fail-soft)。

- [ ] **Step 13.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 13.6: Commit**

```bash
git add src/jobs/workers/content-analyze-worker.ts tests/jobs/content-analyze-worker.test.ts
git commit -m "feat(phase3): content-analyze-worker — AI parallel + fail-soft + synthesize + persist"
```

---

## Task 14: POST /api/v1/content/analyses + GET list

**Files:**
- Create: `src/app/api/v1/content/analyses/route.ts`
- Create: `tests/api/content/analyses.test.ts`

- [ ] **Step 14.1: 写失败测试**

`tests/api/content/analyses.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    contentAnalysis: {
      create: vi.fn(async (args: any) => ({ id: 'a1', ...args.data, createdAt: new Date() })),
      findMany: vi.fn(async () => [{ id: 'a1', status: 'COMPLETED', createdAt: new Date(), videoFilename: 'x.mp4', report: { overallScore: 80 } }]),
    },
  },
}));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/jobs/queue', () => ({ analyzeQueue: { add: vi.fn() } }));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) };
});

import { POST, GET } from '@/app/api/v1/content/analyses/route';

beforeEach(() => vi.clearAllMocks());

function makeMultipart(videoSize: number, videoType = 'video/mp4', fields: Record<string, string> = {}): Request {
  const fd = new FormData();
  const buf = new Uint8Array(videoSize);
  fd.append('video', new Blob([buf], { type: videoType }), 'test.mp4');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request('http://x', { method: 'POST', body: fd });
}

describe('POST /api/v1/content/analyses', () => {
  it('拒收非 video MIME', async () => {
    const fd = new FormData();
    fd.append('video', new Blob([new Uint8Array(100)], { type: 'image/png' }), 'a.png');
    const req = new Request('http://x', { method: 'POST', body: fd });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  it('拒收 > 500MB', async () => {
    const res = await POST(makeMultipart(501 * 1024 * 1024));
    expect(res.status).toBe(400);
  });

  it('happy path 入库 + 入队', async () => {
    const res = await POST(makeMultipart(1024));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.analysisId).toBe('a1');
  });
});

describe('GET /api/v1/content/analyses', () => {
  it('返回列表', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data[0].id).toBe('a1');
  });
});
```

- [ ] **Step 14.2: 跑测试验证失败**

```bash
npm test -- analyses
```

预期: FAIL。

- [ ] **Step 14.3: 实现**

`src/app/api/v1/content/analyses/route.ts`:

```typescript
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { analyzeQueue } from '@/jobs/queue';

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-matroska)$/;

const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';

export async function POST(req: NextRequest | Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('multipart 解析失败', 400);
  }

  const video = form.get('video');
  if (!(video instanceof File)) return fail('缺少 video 字段', 400);
  if (!ALLOWED_VIDEO_MIME.test(video.type)) return fail(`不支持的视频格式: ${video.type}`, 400);
  if (video.size > MAX_BYTES) return fail(`视频超过 500MB 上限 (${(video.size / 1024 / 1024).toFixed(1)} MB)`, 400);

  const draftTitle = (form.get('draftTitle') as string | null) || null;
  const draftCaption = (form.get('draftCaption') as string | null) || null;
  const draftCover = form.get('draftCover');

  const user = await getOrCreateDefaultUser();
  const analysisId = randomUUID().slice(0, 12);
  const analysisDir = path.join(UPLOADS_ROOT, analysisId);
  await fs.mkdir(analysisDir, { recursive: true });

  const ext = video.name.split('.').pop() || 'mp4';
  const videoPath = path.join(analysisDir, `original.${ext}`);
  const videoBuffer = Buffer.from(await video.arrayBuffer());
  await fs.writeFile(videoPath, videoBuffer);

  let draftCoverPath: string | null = null;
  if (draftCover instanceof File && draftCover.size > 0) {
    const coverExt = draftCover.name.split('.').pop() || 'jpg';
    draftCoverPath = path.join(analysisDir, `draft-cover.${coverExt}`);
    await fs.writeFile(draftCoverPath, Buffer.from(await draftCover.arrayBuffer()));
  }

  const analysis = await prisma.contentAnalysis.create({
    data: {
      id: analysisId,
      userId: user.id,
      videoPath,
      videoFilename: video.name,
      videoSizeBytes: video.size,
      videoDurationSec: 0,                    // worker probe 后回填
      videoMimeType: video.type,
      draftTitle,
      draftCaption,
      draftCoverPath: draftCoverPath || undefined,
    },
  });

  await analyzeQueue.add(
    'analyze',
    { analysisId: analysis.id },
    { jobId: `analyze-${analysis.id}`, removeOnComplete: true, removeOnFail: false }
  );

  return ok({ analysisId: analysis.id });
}

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const list = await prisma.contentAnalysis.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      videoFilename: true,
      videoDurationSec: true,
      status: true,
      createdAt: true,
      completedAt: true,
      report: true,
      llmUsage: true,
      progress: true,
    },
  });
  return ok(
    list.map((a) => ({
      id: a.id,
      videoFilename: a.videoFilename,
      videoDurationSec: a.videoDurationSec,
      status: a.status,
      createdAt: a.createdAt,
      completedAt: a.completedAt,
      overallScore: (a.report as any)?.overallScore ?? null,
      topActionItems: ((a.report as any)?.topActionItems ?? []) as string[],
      estCostUSD: (a.llmUsage as any)?.total?.estCostUSD ?? null,
      progress: a.progress,
    }))
  );
}
```

- [ ] **Step 14.4: 跑测试验证通过**

```bash
npm test -- analyses
```

预期: PASS (4 tests)。

- [ ] **Step 14.5: Commit**

```bash
git add src/app/api/v1/content/analyses/route.ts tests/api/content/analyses.test.ts
git commit -m "feat(phase3): POST /content/analyses (upload+enqueue) + GET list"
```

---

## Task 15: GET / DELETE /api/v1/content/analyses/[id]

**Files:**
- Create: `src/app/api/v1/content/analyses/[id]/route.ts`

- [ ] **Step 15.1: 实现**

`src/app/api/v1/content/analyses/[id]/route.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  return ok(a);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);

  // 删除磁盘文件 (整个 analysis 目录)
  const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';
  const analysisDir = path.join(UPLOADS_ROOT, a.id);
  await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => {});

  await prisma.contentAnalysis.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
```

- [ ] **Step 15.2: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 15.3: Commit**

```bash
git add src/app/api/v1/content/analyses/[id]/route.ts
git commit -m "feat(phase3): GET/DELETE /content/analyses/[id]"
```

---

## Task 16: POST cancel + retry

**Files:**
- Create: `src/app/api/v1/content/analyses/[id]/cancel/route.ts`
- Create: `src/app/api/v1/content/analyses/[id]/retry/route.ts`

- [ ] **Step 16.1: cancel route**

`src/app/api/v1/content/analyses/[id]/cancel/route.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  if (a.status === 'COMPLETED' || a.status === 'FAILED') return fail('已结束的任务无法取消', 400);
  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });
  return ok({ id: params.id });
}
```

- [ ] **Step 16.2: retry route**

`src/app/api/v1/content/analyses/[id]/retry/route.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { analyzeQueue } from '@/jobs/queue';

const MAX_RETRIES = 3;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  if (a.status !== 'FAILED') return fail('仅 FAILED 状态可重试', 400);
  if (a.retryCount >= MAX_RETRIES) return fail(`已达重试上限 ${MAX_RETRIES} 次`, 400);

  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: {
      status: 'QUEUED',
      errorMessage: null,
      retryCount: { increment: 1 },
      startedAt: null,
      completedAt: null,
    },
  });

  await analyzeQueue.add(
    'analyze',
    { analysisId: a.id },
    { jobId: `analyze-${a.id}-retry-${a.retryCount + 1}`, removeOnComplete: true, removeOnFail: false }
  );

  return ok({ id: params.id, retryCount: a.retryCount + 1 });
}
```

- [ ] **Step 16.3: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 16.4: Commit**

```bash
git add src/app/api/v1/content/analyses/[id]/cancel src/app/api/v1/content/analyses/[id]/retry
git commit -m "feat(phase3): POST cancel + retry (max 3 retries, reuse preprocessed artifacts)"
```

---

## Task 17: SSE events

**Files:**
- Create: `src/app/api/v1/content/analyses/[id]/events/route.ts`

> 复用 Phase 2 的 `src/lib/sse.ts` 工具(已存在)。

- [ ] **Step 17.1: 实现**

`src/app/api/v1/content/analyses/[id]/events/route.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { sseResponse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;

  async function* gen() {
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
    const startedAt = Date.now();
    const MAX_MS = 15 * 60 * 1000;
    let lastSnapshot = '';

    while (Date.now() - startedAt < MAX_MS) {
      const a = await prisma.contentAnalysis.findUnique({
        where: { id },
        select: { status: true, progress: true, errorMessage: true, completedAt: true },
      });
      if (!a) {
        yield JSON.stringify({ error: 'not found' });
        return;
      }
      const snap = JSON.stringify({
        status: a.status,
        progress: a.progress,
        errorMessage: a.errorMessage,
      });
      if (snap !== lastSnapshot) {
        lastSnapshot = snap;
        yield snap;
      }
      if (terminal.has(a.status)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    yield JSON.stringify({ status: 'TIMEOUT' });
  }

  return sseResponse(gen());
}
```

- [ ] **Step 17.2: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 17.3: Commit**

```bash
git add src/app/api/v1/content/analyses/[id]/events/route.ts
git commit -m "feat(phase3): SSE events for content analysis progress"
```

---

## Task 18: 顶部导航 + 列表页

**Files:**
- Modify: `src/app/layout.tsx` (或现有 sidebar/nav 组件)
- Create: `src/app/content/preflight/page.tsx`

> 现有项目 layout 结构如果不确定,先 `ls src/app/` 看一下顶层导航在哪。

- [ ] **Step 18.1: 探查现有导航**

```bash
find src/app src/components -maxdepth 3 -name '*nav*' -o -name 'layout.tsx' -o -name '*sidebar*' 2>/dev/null
```

记下结果。下一 step 编辑该文件加 "内容创作 → 内容预诊断" 入口。

- [ ] **Step 18.2: 加导航条目**

在找到的导航文件里,加一项指向 `/content/preflight` 的链接。具体改动取决于现有 navigation 的形态 (sidebar item 数组 / JSX hard-coded)。**重要**: 沿用现有项目 navigation 的风格,不要引入新结构。例如若是 array:

```typescript
{ href: '/content/preflight', label: '内容预诊断', icon: 'Video' /* or similar lucide-react icon */ }
```

- [ ] **Step 18.3: 列表页**

`src/app/content/preflight/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type AnalysisRow = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  topActionItems: string[];
  estCostUSD: number | null;
  progress: { stage?: string; percent?: number; label?: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  QUEUED: '排队中',
  PREPROCESSING: '预处理中',
  ANALYZING: 'AI 分析中',
  COMPLETED: '✓ 完成',
  FAILED: '✗ 失败',
  CANCELLED: '已取消',
};

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return new Date(iso).toLocaleDateString();
}

export default function PreflightListPage() {
  const [rows, setRows] = useState<AnalysisRow[] | null>(null);

  useEffect(() => {
    const tick = () => {
      fetch('/api/v1/content/analyses').then((r) => r.json()).then((j) => {
        if (j.success) setRows(j.data);
      });
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);

  if (rows === null) return <p className="text-sm text-muted-foreground">加载中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">内容预诊断</h1>
        <Link href="/content/preflight/new"><Button>+ 新分析</Button></Link>
      </div>
      {rows.length === 0 && (
        <div className="rounded-lg border bg-muted/30 p-12 text-center">
          <p className="text-sm text-muted-foreground">还没有分析。点 [+ 新分析] 上传第一个视频。</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Link key={r.id} href={`/content/preflight/${r.id}`}>
            <Card className="cursor-pointer transition-shadow hover:shadow-md">
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-center justify-between">
                  <div className="truncate font-semibold">📹 {r.videoFilename}</div>
                  <Badge variant={r.status === 'COMPLETED' ? 'success' : r.status === 'FAILED' ? 'destructive' : 'default'}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatTimeAgo(r.createdAt)} · {r.videoDurationSec ? `${Math.round(r.videoDurationSec)} 秒` : ''}
                  {r.estCostUSD !== null ? ` · 烧 $${r.estCostUSD.toFixed(3)}` : ''}
                </div>
                {r.status === 'COMPLETED' && r.overallScore !== null && (
                  <div className="text-sm">
                    overallScore <span className="font-semibold">{r.overallScore}/100</span>
                    {r.topActionItems.length > 0 && (
                      <span className="text-muted-foreground"> · Top: {r.topActionItems.slice(0, 2).join('、')}</span>
                    )}
                  </div>
                )}
                {(r.status === 'PREPROCESSING' || r.status === 'ANALYZING') && r.progress?.label && (
                  <div className="text-sm text-muted-foreground">{r.progress.label}</div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 18.4: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 18.5: dev 浏览器验证**

```bash
npm run dev
# 浏览器打开 http://localhost:3000/content/preflight
```

预期: 空状态 + [+ 新分析] 按钮 + 顶部导航有"内容预诊断"入口。

- [ ] **Step 18.6: Commit**

```bash
git add src/app/content/preflight/page.tsx src/app/layout.tsx
# 如果改的是 sidebar 而非 layout, 改成对应文件
git commit -m "feat(phase3): /content/preflight list page + nav entry"
```

---

## Task 19: 上传表单页

**Files:**
- Create: `src/app/content/preflight/new/page.tsx`
- Create: `src/components/content/upload-form.tsx`

- [ ] **Step 19.1: upload-form 组件**

`src/components/content/upload-form.tsx`:

```typescript
'use client';
import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

export function UploadForm() {
  const router = useRouter();
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!videoFile) {
      setError('请先选择视频文件');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('video', videoFile);
      if (coverFile) fd.append('draftCover', coverFile);
      if (title.trim()) fd.append('draftTitle', title.trim());
      if (caption.trim()) fd.append('draftCaption', caption.trim());

      const res = await fetch('/api/v1/content/analyses', { method: 'POST', body: fd });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        setSubmitting(false);
        return;
      }
      router.push(`/content/preflight/${json.data.analysisId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-12 text-center cursor-pointer"
            onClick={() => videoInputRef.current?.click()}
          >
            <div className="text-3xl">📹</div>
            {videoFile ? (
              <>
                <div className="font-medium">{videoFile.name}</div>
                <div className="text-xs text-muted-foreground">{(videoFile.size / 1024 / 1024).toFixed(1)} MB · 点击重选</div>
              </>
            ) : (
              <>
                <div className="font-medium">拖拽视频或点击选择</div>
                <div className="text-xs text-muted-foreground">mp4 / mov / webm · ≤ 500MB · ≤ 15 分钟</div>
              </>
            )}
            <input
              ref={videoInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <Label>标题草稿 (留空 AI 生成 3 个候选)</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ChatGPT 不告诉你的 5 个技巧" />
          </div>
          <div className="space-y-1">
            <Label>文案草稿 (留空 AI 生成 3 个候选)</Label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
              placeholder="..."
            />
          </div>
          <div className="space-y-1">
            <Label>封面 (留空将从视频抽 3 帧)</Label>
            <Input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
            {coverFile && <p className="text-xs text-muted-foreground">已选: {coverFile.name}</p>}
          </div>
          <div className="text-xs text-muted-foreground">
            垂类: <span className="font-medium">AI 知识</span> (后期可在设置里改)
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submitting || !videoFile}>
          {submitting ? '上传中...' : '开始分析 →'}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 19.2: 新分析页**

`src/app/content/preflight/new/page.tsx`:

```typescript
import { UploadForm } from '@/components/content/upload-form';

export default function NewAnalysisPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">新分析</h1>
      <UploadForm />
    </div>
  );
}
```

- [ ] **Step 19.3: typecheck + 浏览器验证**

```bash
npm run typecheck
```

```bash
npm run dev
# http://localhost:3000/content/preflight/new
```

预期: 上传区 + 3 个可选字段 + [开始分析] 按钮。

- [ ] **Step 19.4: Commit**

```bash
git add src/app/content/preflight/new src/components/content/upload-form.tsx
git commit -m "feat(phase3): /content/preflight/new — upload form with optional drafts"
```

---

## Task 20: 报告 / 进度页 + 维度卡片 + 封面候选

**Files:**
- Create: `src/app/content/preflight/[id]/page.tsx`
- Create: `src/components/content/progress-stages.tsx`
- Create: `src/components/content/report-view.tsx`
- Create: `src/components/content/dimension-card.tsx`
- Create: `src/components/content/cover-candidates.tsx`

- [ ] **Step 20.1: 进度组件**

`src/components/content/progress-stages.tsx`:

```typescript
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';

const STAGES = [
  { key: 'QUEUED', label: '排队中' },
  { key: 'PREPROCESSING', label: '预处理 (抽帧/转写)' },
  { key: 'ANALYZING', label: 'AI 分析中' },
  { key: 'COMPLETED', label: '完成' },
];

export function ProgressStages({ status, errorMessage }: { status: string; errorMessage?: string | null }) {
  const isFailed = status === 'FAILED' || status === 'CANCELLED';
  const idx = STAGES.findIndex((s) => s.key === status);
  const pctMap: Record<string, number> = { QUEUED: 5, PREPROCESSING: 30, ANALYZING: 70, COMPLETED: 100 };
  const pct = pctMap[status] ?? (isFailed ? 50 : 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        {STAGES.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              'rounded-full px-3 py-1',
              isFailed && i <= idx ? 'bg-destructive/10 text-destructive' :
              i < idx ? 'bg-primary/20 text-primary' :
              i === idx ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
      <Progress value={pct} />
      {errorMessage && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{errorMessage}</div>}
    </div>
  );
}
```

- [ ] **Step 20.2: 维度卡片**

`src/components/content/dimension-card.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

export function DimensionCard({
  emoji, title, rating, children, error,
}: {
  emoji: string;
  title: string;
  rating?: number;
  children?: React.ReactNode;
  error?: string;
}) {
  return (
    <Card className={cn(error && 'border-destructive/40')}>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <div className="font-semibold">{emoji} {title}</div>
          {rating !== undefined && <Stars rating={rating} />}
        </div>
        {error ? (
          <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">⚠ {error}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 20.3: 封面候选**

`src/components/content/cover-candidates.tsx`:

```typescript
'use client';

export function CoverCandidates({
  analysisId,
  count,
  recommendedIdx,
  reasons,
}: {
  analysisId: string;
  count: number;
  recommendedIdx?: number;
  reasons?: { coverCandidateIdx: number; reason: string }[];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: count }, (_, i) => {
        const isRecommended = i === recommendedIdx;
        const reason = reasons?.find((r) => r.coverCandidateIdx === i)?.reason;
        return (
          <div key={i} className={`relative rounded-md border ${isRecommended ? 'border-primary ring-2 ring-primary/30' : 'border-border'} p-1`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/v1/content/analyses/${analysisId}/cover/${i}`} alt={`候选 ${i + 1}`} className="aspect-video w-full rounded object-cover" />
            {isRecommended && <div className="absolute right-1 top-1 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">推荐</div>}
            {reason && <div className="mt-1 text-xs text-muted-foreground">{reason}</div>}
          </div>
        );
      })}
    </div>
  );
}
```

> 该组件依赖一个图片代理端点 `/api/v1/content/analyses/[id]/cover/[idx]`,Task 20.6 加。

- [ ] **Step 20.4: report-view**

`src/components/content/report-view.tsx`:

```typescript
import { DimensionCard } from './dimension-card';
import { CoverCandidates } from './cover-candidates';

type Report = {
  hook?: { rating: number; summary: string; suggestions: string[]; keyObservations: { timestampSec: number; note: string }[]; error?: string };
  retention?: { riskPoints: { startSec: number; endSec: number; severity: string; reason: string; suggestion: string }[]; overallSummary: string; error?: string };
  titleCaption?: any;
  cover?: any;
  overallScore: number | null;
  topActionItems: string[];
};

export function ReportView({ analysisId, report, coverCandidateCount }: { analysisId: string; report: Report; coverCandidateCount: number }) {
  return (
    <div className="space-y-6">
      {/* 综合分 + topActions */}
      <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 p-6">
        <div className="flex items-center gap-6">
          {report.overallScore !== null && (
            <div className="text-center">
              <div className="text-4xl font-bold">{report.overallScore}</div>
              <div className="text-xs text-muted-foreground">/100</div>
            </div>
          )}
          <div className="flex-1">
            <div className="mb-2 text-sm font-semibold">🔥 现在去改的:</div>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {report.topActionItems.map((a, i) => <li key={i}>{a}</li>)}
            </ol>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DimensionCard
          emoji="🪝" title="钩子 (前 3 秒)"
          rating={report.hook?.rating}
          error={report.hook?.error}
        >
          <p className="text-sm">{report.hook?.summary}</p>
          {(report.hook?.suggestions ?? []).length > 0 && (
            <>
              <div className="mt-2 text-xs font-semibold text-muted-foreground">建议:</div>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {(report.hook?.suggestions ?? []).map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </DimensionCard>

        <DimensionCard
          emoji="⏱" title="完播风险"
          error={report.retention?.error}
        >
          <p className="text-sm">{report.retention?.overallSummary}</p>
          {(report.retention?.riskPoints ?? []).length > 0 && (
            <div className="mt-2 space-y-1 text-sm">
              {(report.retention?.riskPoints ?? []).map((r, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2 text-xs">
                  <span className={r.severity === 'high' ? 'text-destructive' : r.severity === 'medium' ? 'text-amber-600' : 'text-muted-foreground'}>
                    [{r.startSec.toFixed(1)}-{r.endSec.toFixed(1)}s · {r.severity}]
                  </span>{' '}
                  {r.reason} → <em>{r.suggestion}</em>
                </div>
              ))}
            </div>
          )}
        </DimensionCard>

        <DimensionCard emoji="📝" title="标题 / 文案" error={report.titleCaption?.error}>
          {report.titleCaption?.mode === 'generate' && (
            <div className="space-y-2 text-sm">
              <div>
                <div className="text-xs font-semibold text-muted-foreground">AI 生成的标题候选:</div>
                <ul className="list-disc pl-4">{(report.titleCaption.generatedTitles ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-muted-foreground">AI 生成的文案候选:</div>
                <ul className="list-disc pl-4">{(report.titleCaption.generatedCaptions ?? []).map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
              </div>
            </div>
          )}
          {report.titleCaption?.mode === 'evaluate' && (
            <div className="space-y-2 text-sm">
              {report.titleCaption.titleFeedback && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">标题评价 (★{report.titleCaption.titleFeedback.rating}):</div>
                  <ul className="list-disc pl-4">{report.titleCaption.titleFeedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  <div className="mt-1 text-xs font-semibold text-muted-foreground">重写候选:</div>
                  <ul className="list-disc pl-4">{report.titleCaption.titleFeedback.rewrites.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {report.titleCaption.captionFeedback && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">文案评价 (★{report.titleCaption.captionFeedback.rating}):</div>
                  <ul className="list-disc pl-4">{report.titleCaption.captionFeedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </DimensionCard>

        <DimensionCard emoji="🖼" title="封面" error={report.cover?.error}>
          {report.cover?.mode === 'evaluate' && report.cover.feedback && (
            <>
              <div className="text-sm">评分 ★{report.cover.feedback.rating}</div>
              <ul className="list-disc pl-4 text-sm">{report.cover.feedback.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
              <div className="mt-1 text-xs font-semibold text-muted-foreground">建议:</div>
              <ul className="list-disc pl-4 text-sm">{report.cover.feedback.suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          {report.cover?.mode === 'generate' && (
            <CoverCandidates
              analysisId={analysisId}
              count={coverCandidateCount}
              recommendedIdx={report.cover.recommendedIdx}
              reasons={report.cover.candidates}
            />
          )}
        </DimensionCard>
      </div>
    </div>
  );
}
```

- [ ] **Step 20.5: 详情页**

`src/app/content/preflight/[id]/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ProgressStages } from '@/components/content/progress-stages';
import { ReportView } from '@/components/content/report-view';

type Analysis = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  errorMessage: string | null;
  report: any | null;
  llmUsage: any | null;
  coverCandidates: { path: string; timestampSec: number }[] | null;
  retryCount: number;
};

export default function PreflightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Analysis | null>(null);

  useEffect(() => {
    if (!params?.id) return;
    const es = new EventSource(`/api/v1/content/analyses/${params.id}/events`);
    es.onmessage = () => {
      // 收到 status 变化通知时拉详情
      fetch(`/api/v1/content/analyses/${params.id}`).then((r) => r.json()).then((j) => {
        if (j.success) setData(j.data);
      });
    };
    es.onerror = () => es.close();
    fetch(`/api/v1/content/analyses/${params.id}`).then((r) => r.json()).then((j) => {
      if (j.success) setData(j.data);
    });
    return () => es.close();
  }, [params?.id]);

  if (!data) return <p className="text-sm text-muted-foreground">加载中...</p>;

  const handleCancel = async () => {
    await fetch(`/api/v1/content/analyses/${data.id}/cancel`, { method: 'POST' });
  };
  const handleRetry = async () => {
    await fetch(`/api/v1/content/analyses/${data.id}/retry`, { method: 'POST' });
  };
  const handleDelete = async () => {
    if (!confirm('确认删除该分析? 视频和报告会一并删除。')) return;
    await fetch(`/api/v1/content/analyses/${data.id}`, { method: 'DELETE' });
    router.push('/content/preflight');
  };

  const isRunning = data.status === 'PREPROCESSING' || data.status === 'ANALYZING' || data.status === 'QUEUED';
  const cost = data.llmUsage?.total?.estCostUSD;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">📹 {data.videoFilename}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          时长 {Math.round(data.videoDurationSec)} 秒
          {cost !== undefined ? ` · 烧 $${cost.toFixed(3)}` : ''}
          {data.retryCount > 0 ? ` · 已重试 ${data.retryCount} 次` : ''}
        </p>
      </div>

      <ProgressStages status={data.status} errorMessage={data.errorMessage} />

      {data.status === 'COMPLETED' && data.report && (
        <ReportView
          analysisId={data.id}
          report={data.report}
          coverCandidateCount={data.coverCandidates?.length ?? 0}
        />
      )}

      <div className="flex gap-2">
        {isRunning && <Button variant="outline" onClick={handleCancel}>取消</Button>}
        {data.status === 'FAILED' && data.retryCount < 3 && <Button onClick={handleRetry}>重新分析</Button>}
        <Button variant="outline" onClick={handleDelete}>删除</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 20.6: cover 图片代理端点**

`src/app/api/v1/content/analyses/[id]/cover/[idx]/route.ts`:

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string; idx: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  const candidates = (a.coverCandidates as { path: string }[] | null) ?? [];
  const idx = parseInt(params.idx, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= candidates.length) return fail('out of range', 404);

  // 校验路径在 analysis 目录内 (防 path traversal)
  const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');
  const expectedPrefix = path.resolve(UPLOADS_ROOT, a.id);
  const resolved = path.resolve(candidates[idx].path);
  if (!resolved.startsWith(expectedPrefix)) return fail('forbidden', 403);

  const buf = await fs.readFile(resolved);
  return new Response(buf as any, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' },
  });
}
```

- [ ] **Step 20.7: typecheck + 浏览器验证**

```bash
npm run typecheck
```

```bash
npm run dev
# 在列表页 (Task 18) 点一个 row 跳详情页验证 UI 骨架渲染
```

预期: 详情页加载,即使没有真分析数据也能看到骨架 / 加载提示。

- [ ] **Step 20.8: Commit**

```bash
git add src/app/content/preflight/[id] src/components/content src/app/api/v1/content/analyses/[id]/cover
git commit -m "feat(phase3): /content/preflight/[id] — progress + report view + cover proxy"
```

---

## Task 21: 手动 E2E 验收

**No file changes** — 端到端走一遍 + 验收清单。

⚠ **测试前提**: 请用 AI 知识类 **小号** 拍的 30-60 秒测试视频 (不要用主号正式素材测试,避免 LLM 输出反馈影响你对自己内容的判断)。

- [ ] **Step 21.1: 起 dev + worker + 容器**

新开 3 个终端:

```bash
# 终端 A: 容器
docker compose up -d postgres redis
# 终端 B: worker
npm run worker:dev
# 终端 C: dev
npm run dev
```

- [ ] **Step 21.2: 走一遍上传**

1. 浏览器 → `http://localhost:3000/content/preflight`
2. 应该看到空状态。点 `+ 新分析`
3. 拖一个 30-60 秒的真实 AI 知识类视频进来 (mp4)
4. 标题 + 文案 + 封面 **故意混搭**: 标题填、文案不填、封面不传 — 测 Mixed mode
5. 点 `开始分析`
6. 跳到详情页,看到进度条 PREPROCESSING → ANALYZING → COMPLETED
7. 全程应在 1-3 分钟内完成

- [ ] **Step 21.3: 检验报告**

报告页应包含:
- [ ] 综合分 (1-100)
- [ ] Top 3-5 action items
- [ ] 钩子卡片 (rating + summary + suggestions)
- [ ] 完播风险卡片 (riskPoints 或 "整段流畅")
- [ ] 标题卡片 (评价你填的) + 文案卡片 (AI 生成 3 个)
- [ ] 封面卡片 (3 张候选 + 1 张推荐, 带边框高亮)
- [ ] 顶部能看到烧的美元成本

- [ ] **Step 21.4: 测取消**

1. 新开一次分析
2. 在 PREPROCESSING 阶段点 `取消`
3. status 应快速变为 CANCELLED
4. 列表页该 row 标 "已取消"

- [ ] **Step 21.5: 测拒收**

```bash
# 制造一个 600MB 假文件 (注意空间)
dd if=/dev/zero of=/tmp/big.mp4 bs=1m count=600

curl -X POST http://localhost:3000/api/v1/content/analyses \
  -F "video=@/tmp/big.mp4;type=video/mp4"
```

预期: HTTP 400,`message` 含"超过 500MB"。

```bash
rm /tmp/big.mp4
```

- [ ] **Step 21.6: 测 worker 重启**

1. 新开一次分析
2. 在 PREPROCESSING 阶段 `Ctrl+C` kill worker
3. 重启 worker (`npm run worker:dev`)
4. 该分析应继续完成 (Bull resume 默认行为)

- [ ] **Step 21.7: 测无音轨视频**

1. 找一个无声视频 (或用 ffmpeg `ffmpeg -i original.mp4 -an -c:v copy mute.mp4`)
2. 上传分析
3. 应该不报错,transcript 空, hook/retention summary 中提及 "无语音"

- [ ] **Step 21.8: DB 验证**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c \
  $'SELECT id, status, "videoDurationSec", report->\'overallScore\' AS score, "llmUsage"->\'total\'->\'estCostUSD\' AS cost FROM "ContentAnalysis" ORDER BY "createdAt" DESC LIMIT 5;'
```

预期: 看到最近 5 条记录,COMPLETED 的有 score 和 cost。

- [ ] **Step 21.9: 跑全套自动化测试 + typecheck**

```bash
npm run typecheck && npm test
```

预期: typecheck 0 错;测试全绿。

- [ ] **Step 21.10: 真账号反馈记录**

记下:
- AI 给的建议是否真的有指导意义 (主观)
- 哪些 prompt 建议你想立刻迭代 (`expert-persona.ts` 是最频繁的迭代点)
- 哪些 selector / UI 细节让你不爽

写到 `docs/superpowers/specs/2026-06-12-content-preflight-design.md` 末尾的 `## 8. 真账号反馈` 节里 (本 spec 暂无该节,可新建)。

- [ ] **Step 21.11: 验收 Commit (如果有 selector 微调)**

```bash
git add -A
git commit -m "fix(phase3): tune AI knowledge persona based on real-account feedback"
```

---

## 完成标志

- ✅ Task 1–20 全部 commit 完成
- ✅ Task 21 手动 E2E 验收清单全过
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿
- ✅ 真账号视频跑出来报告,综合分 + top actions 主观能用

→ **可以进入 A v2** (发后复盘 + 真实数据回填),或转去评估 [cheat-on-content](https://github.com/XBuilderLAB/cheat-on-content.git) 起 **Direction B**

---

## 自审记录 (writing-plans 步骤 self-review)

**Spec 覆盖**: 7 节全覆盖
- §1.2 7 项必须达成 → Task 14/18/19/20/13/16/18 全覆盖
- §3.1 schema → Task 1.2
- §3.2 ReportV1 → Task 7-11 (Zod) + Task 13 (worker 拼装)
- §4 LLM 矩阵 → Task 4 (vision) + Task 7-11 (prompts) + Task 13 (调度)
- §5.1 错误矩阵 → Task 14 (上传校验) + Task 13 (fail-soft) + Task 16 (cancel/retry)
- §5.2 测试 → 每个 lib task 自带测试
- §5.3 UI → Task 18-20
- §5.4 验收 → Task 21

**Placeholder scan**: 已扫;Task 18.1 探查 nav 文件后再决定具体修改位置 — 这是有意的,因为现有 nav 形态不确定,但已给出明确指令 (探查 + 改 array 加一项),不算 placeholder。

**Type 一致性**: `ContentPart` 在 vision.ts 和 prompts/*.ts 一致;`IVisionLLM.callStructured` 签名贯穿 vision/worker;`HookInput`/`HookResponseSchema` 命名规则在 4 个维度模块一致。
