# Content Pre-flight v2 (发后复盘) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 A v1 (内容预诊断) 闭环成"发后复盘": 用户粘贴抖音视频链接 → T+3d 自动 (或手动立刻) 拉真实播放数据 → AI 跨 4 维度生成"预测 vs 实际"落差总结。

**Architecture:** Next.js 14 App Router 提供 publish/retro-now API 和详情页 retro section; Postgres 加 `ActualMetric` 表 + ContentAnalysis 加 retro* 字段; BullMQ 新 RETRO queue + delayed jobs; worker (`content-retro-worker.ts`) 6 阶段流水: Cookie 探测 → Python adapter 子进程拉 report.md → 正则解析 → 落 ActualMetric → GPT-4o-mini 生成落差总结 → 落库; cheat-on-content 的 Douyin adapter 通过 `child_process.execFile('python', ['review.py', ...])` 集成, CWD 控制 cookie 复用。

**Tech Stack:** Next.js 14 · TypeScript · Prisma (PostgreSQL BigInt) · BullMQ · ioredis · openai 4.x · zod · child_process · Python 3 + Playwright (外部依赖,通过 cheat-on-content 装)

**Spec:** `docs/superpowers/specs/2026-06-12-content-preflight-v2-design.md`

**Predecessor:** A v1 已上线, plan: `docs/superpowers/plans/2026-06-12-content-preflight-plan.md`

**Scope** (本计划不包含):
- 多快照 T+1d/T+3d/T+7d 增长曲线 → 推迟
- rubric 进化建议 → cheat-on-content 主 skill 的事
- 跨视频对比仪表盘 → Phase 3 Dashboard
- 自动通知推送 → 推迟
- 评论关键词聚类 → adapter 能输出但 v2 不消费
- 多账号管理 → Phase 6 矩阵

---

## File Structure

```
新建:
src/lib/douyin/aweme.ts                                        # URL → aweme_id (长链正则 + 短链 HEAD 展开)
src/lib/douyin/adapter.ts                                      # Python subprocess wrapper (probe + fetch)
src/lib/douyin/report-parser.ts                                # report.md → ActualMetricInput
src/lib/llm/prompts/ai-knowledge/retro-gap.ts                  # AI 落差总结 prompt + Zod
src/jobs/workers/content-retro-worker.ts                       # retro 主 worker
src/app/api/v1/content/analyses/[id]/publish/route.ts          # POST 粘贴 URL + 调度
src/app/api/v1/content/analyses/[id]/retro-now/route.ts        # POST 立刻拉一次
src/components/content/publish-link-form.tsx                   # URL + publishedAt 表单
src/components/content/actual-metrics-table.tsx                # 8 项实际指标表
src/components/content/retro-gap-view.tsx                      # AI 落差段落 (复用 DimensionCard)
src/components/content/retro-section.tsx                       # 4 状态容器 (空/SCHEDULED/RUNNING/COMPLETED/FAILED)

tests/lib/douyin/aweme.test.ts
tests/lib/douyin/report-parser.test.ts
tests/lib/douyin/adapter.test.ts
tests/lib/llm/prompts/ai-knowledge/retro-gap.test.ts
tests/jobs/content-retro-worker.test.ts
tests/api/content/publish.test.ts
tests/fixtures/douyin-report-sample.md                         # 真实 adapter 输出 (用户小号视频跑出来)

修改:
prisma/schema.prisma                                           # +ContentAnalysis 8 字段 + RetroStatus enum + ActualMetric 表
src/jobs/queue.ts                                              # +RETRO queue + retroQueue export
src/jobs/workers/index.ts                                      # +startContentRetroWorker
src/app/content/preflight/[id]/page.tsx                        # 加 <RetroSection />
src/app/api/v1/content/analyses/[id]/route.ts                  # GET projection 加 retro 字段 + BigInt 序列化
.env.example                                                   # +CHEAT_ADAPTER_PATH, +PYTHON_BIN, +CHEAT_CONTENT_PROJECT_DIR
README.md                                                      # A v2 安装说明 (cheat-on-content 前置)
```

---

## Test Strategy

- **纯函数** (`aweme.ts`, `report-parser.ts`, `prompts/retro-gap.ts`) 100% vitest 覆盖
- **`adapter.ts`** mock `child_process` 验证 env + CWD + timeout 传递
- **worker** mock adapter + LLM,验证 6 阶段 + cancel race + AI fail-soft
- **API** vitest + Request,验证拒收逻辑 + projection
- **真 adapter smoke**: Task 3 step 3.1 用户提供真实 fixture
- **手动 E2E**: Task 10 验收清单

测试框架: vitest (与项目一致)

---

## Git

每个 task 末尾 `git commit`,沿用 A v1 风格 `feat(phase3): ...` / `fix(phase3): ...`。

---

## Task 1: Prisma schema + RETRO queue + worker stub

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/jobs/queue.ts`
- Modify: `src/jobs/workers/index.ts`
- Create: `src/jobs/workers/content-retro-worker.ts` (stub)
- Modify: `.env.example`

- [ ] **Step 1.1: prisma schema 加字段**

在 `prisma/schema.prisma` 的 `ContentAnalysis` model 末尾 (`@@index` 之前) 追加 8 字段:

```prisma
  // ===== Phase 3 / Direction A v2 =====
  douyinUrl         String?
  douyinAwemeId     String?
  publishedAt       DateTime?
  retroStatus       RetroStatus?
  retroErrorMessage String?
  retroReport       Json?
  retroStartedAt    DateTime?
  retroCompletedAt  DateTime?

  actualMetrics     ActualMetric[]
```

在 ContentAnalysis 的 `@@index` 列表里追加 2 个 index:

```prisma
  @@index([douyinAwemeId])
  @@index([retroStatus])
```

在文件末尾(ContentAnalysisStatus enum 后)追加 RetroStatus enum:

```prisma
enum RetroStatus {
  SCHEDULED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}
```

继续追加 ActualMetric model:

```prisma
model ActualMetric {
  id                  String           @id @default(cuid())
  analysisId          String
  analysis            ContentAnalysis  @relation(fields: [analysisId], references: [id], onDelete: Cascade)

  snapshotAt          DateTime         @default(now())
  daysAfterPublish    Float
  source              String           @default("douyin-creator-center")

  plays               BigInt
  likes               BigInt
  comments            BigInt
  shares              BigInt
  collects            BigInt

  likeRateBp          Int?
  commentRateBp       Int?
  shareRateBp         Int?

  completionRateBp    Int?
  retention3sBp       Int?
  followConversionBp  Int?

  topComments         Json?

  rawReportPath       String?

  createdAt           DateTime         @default(now())

  @@index([analysisId, snapshotAt])
}
```

- [ ] **Step 1.2: 推到数据库**

```bash
npx prisma db push
```

预期: `🚀 Your database is now in sync with your Prisma schema.`

- [ ] **Step 1.3: 验证 DB 表已建**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "ActualMetric"'
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "ContentAnalysis"' | grep -E 'douyin|retro'
```

预期: ActualMetric 表 16 列;ContentAnalysis 多 8 个 douyin/retro 字段。

- [ ] **Step 1.4: queue.ts 加 RETRO queue**

替换 `src/jobs/queue.ts` 全文:

```typescript
import { Queue } from 'bullmq';
import { redis } from '@/lib/redis';

export const QUEUES = {
  BIND: 'bind-session',
  SYNC: 'sync',
  ANALYZE: 'content-analyze',
  RETRO: 'content-retro',
} as const;

export const bindQueue = new Queue(QUEUES.BIND, { connection: redis });
export const syncQueue = new Queue(QUEUES.SYNC, { connection: redis });
export const analyzeQueue = new Queue(QUEUES.ANALYZE, { connection: redis });
export const retroQueue = new Queue(QUEUES.RETRO, { connection: redis });
```

- [ ] **Step 1.5: worker stub**

创建 `src/jobs/workers/content-retro-worker.ts`:

```typescript
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';

export function startContentRetroWorker() {
  const worker = new Worker(
    QUEUES.RETRO,
    async () => {
      throw new Error('content-retro-worker not yet implemented (Task 6)');
    },
    { connection: redis }
  );
  worker.on('failed', (job, err) => {
    console.error('[content-retro-worker] failed', job?.id, err);
  });
  return worker;
}
```

- [ ] **Step 1.6: workers/index.ts 启动**

替换 `src/jobs/workers/index.ts`:

```typescript
import 'dotenv/config';
import { startBindWorker } from './bind-worker';
import { startContentAnalyzeWorker } from './content-analyze-worker';
import { startContentRetroWorker } from './content-retro-worker';
import { closeAll } from '@/crawler/browser-pool';

const bind = startBindWorker();
const analyze = startContentAnalyzeWorker();
const retro = startContentRetroWorker();

const shutdown = async () => {
  console.log('Shutting down workers...');
  await bind.close();
  await analyze.close();
  await retro.close();
  await closeAll();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('Workers started: bind, analyze, retro');
```

- [ ] **Step 1.7: .env.example 加 3 个变量**

`.env.example` 末尾追加:

```
# Phase 3 / Direction A v2 — Douyin adapter (cheat-on-content)
# CHEAT_ADAPTER_PATH=/Users/your-name/.claude/skills/cheat-on-content/adapters/perf-data/douyin-session
# CHEAT_CONTENT_PROJECT_DIR=/Users/your-name/my-content
# PYTHON_BIN=python3
```

- [ ] **Step 1.8: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 1.9: Commit**

```bash
git add prisma/schema.prisma src/jobs/queue.ts src/jobs/workers .env.example
git commit -m "feat(phase3-v2): scaffolding — ContentAnalysis retro fields + ActualMetric + RETRO queue + worker stub"
```

---

## Task 2: lib/douyin/aweme — URL → aweme_id

**Files:**
- Create: `src/lib/douyin/aweme.ts`
- Create: `tests/lib/douyin/aweme.test.ts`

TDD task. Two functions: long-link regex + short-link HEAD expansion.

- [ ] **Step 2.1: 写失败测试**

`tests/lib/douyin/aweme.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { extractAwemeIdFromLongUrl, resolveDouyinUrl } from '@/lib/douyin/aweme';

describe('extractAwemeIdFromLongUrl', () => {
  it('从标准长链提取 aweme_id', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789')).toBe('7234567890123456789');
  });

  it('忽略 query 和 hash', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789?modal=1#x')).toBe('7234567890123456789');
  });

  it('带斜杠尾巴也能提取', () => {
    expect(extractAwemeIdFromLongUrl('https://www.douyin.com/video/7234567890123456789/')).toBe('7234567890123456789');
  });

  it('非 douyin URL 返回 null', () => {
    expect(extractAwemeIdFromLongUrl('https://example.com/video/123')).toBeNull();
  });

  it('短链返回 null (应走 resolveDouyinUrl)', () => {
    expect(extractAwemeIdFromLongUrl('https://v.douyin.com/abc123')).toBeNull();
  });
});

describe('resolveDouyinUrl', () => {
  beforeEach(() => vi.clearAllMocks());

  it('长链直接返回 aweme_id', async () => {
    const result = await resolveDouyinUrl('https://www.douyin.com/video/7234567890123456789');
    expect(result).toBe('7234567890123456789');
  });

  it('短链 HEAD 后从 Location 提取', async () => {
    const fetchMock = vi.fn(async () => ({
      headers: new Headers({ location: 'https://www.douyin.com/video/7234567890123456789/?u=1' }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBe('7234567890123456789');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://v.douyin.com/abc123',
      expect.objectContaining({ method: 'HEAD', redirect: 'manual' })
    );
  });

  it('短链 HEAD 超时返回 null', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('aborted');
    });
    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBeNull();
  });

  it('短链 HEAD 拿到的 location 不是 douyin 视频链返回 null', async () => {
    const fetchMock = vi.fn(async () => ({
      headers: new Headers({ location: 'https://example.com/' }),
    } as Response));
    const result = await resolveDouyinUrl('https://v.douyin.com/abc123', { fetch: fetchMock as any });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2.2: 跑测试验证失败**

```bash
npm test -- aweme
```

预期: FAIL (模块不存在)。

- [ ] **Step 2.3: 实现**

`src/lib/douyin/aweme.ts`:

```typescript
const LONG_URL_REGEX = /douyin\.com\/video\/(\d+)/;

/** 从抖音长链 (含 douyin.com/video/<digits>) 提取 aweme_id。失败返回 null。 */
export function extractAwemeIdFromLongUrl(url: string): string | null {
  const m = LONG_URL_REGEX.exec(url);
  return m ? m[1] : null;
}

export interface ResolveOptions {
  timeoutMs?: number;
  /** 注入 fetch 便于测试 */
  fetch?: typeof globalThis.fetch;
}

/**
 * 解析任意抖音视频 URL (长链 / 短链 v.douyin.com/<slug>) 为 aweme_id。
 * 短链走 HEAD 请求拿 Location header。 超时 / 解析失败返回 null。
 */
export async function resolveDouyinUrl(url: string, opts: ResolveOptions = {}): Promise<string | null> {
  const direct = extractAwemeIdFromLongUrl(url);
  if (direct) return direct;

  if (!/v\.douyin\.com/.test(url)) return null;

  const timeoutMs = opts.timeoutMs ?? 3000;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    const location = resp.headers.get('location');
    if (!location) return null;
    return extractAwemeIdFromLongUrl(location);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2.4: 跑测试验证通过**

```bash
npm test -- aweme
```

预期: PASS (9 tests)。

- [ ] **Step 2.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/douyin/aweme.ts tests/lib/douyin/aweme.test.ts
git commit -m "feat(phase3-v2): douyin URL → aweme_id parser (long link + short link HEAD)"
```

---

## Task 3: tests/fixtures/douyin-report-sample.md + lib/douyin/report-parser

**Files:**
- Create: `tests/fixtures/douyin-report-sample.md`
- Create: `src/lib/douyin/report-parser.ts`
- Create: `tests/lib/douyin/report-parser.test.ts`

> **关键前置**: 此 task 需要真实 cheat-on-content 输出的 report.md。如果用户已经装好 cheat-on-content 并在内容项目跑过一次 retro, 复制那份 report.md 即可。否则用下面的 step 3.1 的合成 sample (cheat-on-content `renderer.py` 输出格式推断)。

- [ ] **Step 3.1: 创建 fixture**

如果你手头有真实 report.md (推荐), 复制到 `tests/fixtures/douyin-report-sample.md`。

否则用下面合成 sample (基于 cheat-on-content `adapters/perf-data/douyin-session/renderer.py` 推断的格式):

```markdown
# 视频复盘报告

## 视频元信息

- 标题: ChatGPT 提示词的 3 个高级技巧
- 发布时间: 2026-06-09 14:32:00
- 时长: 67 秒

## 数据快照

- 播放: 12,345
- 点赞: 1,234
- 评论: 234
- 转发: 45
- 收藏: 123

## 留存指标

- 完播率: 32.10%
- 3s 留存: 65.40%
- 转粉率: 1.20%

## Top 20 评论

- (123 赞) 这个我也踩过!
- (89 赞) 太干货了感谢
- (67 赞) 第二个技巧我没想到
- (45 赞) 试了一下确实有效
- (32 赞) 期待下一期
```

- [ ] **Step 3.2: 写失败测试**

`tests/lib/douyin/report-parser.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import path from 'path';
import { parseReportMd } from '@/lib/douyin/report-parser';

const FIXTURE = path.join(__dirname, '../../fixtures/douyin-report-sample.md');

describe('parseReportMd', () => {
  it('解析所有 8 个核心 + 留存字段', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.plays).toBe(12345n);
    expect(r.likes).toBe(1234n);
    expect(r.comments).toBe(234n);
    expect(r.shares).toBe(45n);
    expect(r.collects).toBe(123n);
    expect(r.completionRateBp).toBe(3210);
    expect(r.retention3sBp).toBe(6540);
    expect(r.followConversionBp).toBe(120);
  });

  it('计算 3 个派生比率 Bp', async () => {
    const r = await parseReportMd(FIXTURE);
    // 1234 / 12345 = 9.9959...% ≈ 999 Bp
    expect(r.likeRateBp).toBeGreaterThanOrEqual(990);
    expect(r.likeRateBp).toBeLessThanOrEqual(1010);
    // 234 / 12345 = 1.895...% ≈ 189
    expect(r.commentRateBp).toBeGreaterThanOrEqual(180);
    expect(r.commentRateBp).toBeLessThanOrEqual(200);
    // 45 / 12345 = 0.364...% ≈ 36
    expect(r.shareRateBp).toBeGreaterThanOrEqual(30);
    expect(r.shareRateBp).toBeLessThanOrEqual(40);
  });

  it('解析 Top 5 评论 (含赞数)', async () => {
    const r = await parseReportMd(FIXTURE);
    expect(r.topComments).toHaveLength(5);
    expect(r.topComments?.[0]).toEqual({ text: '这个我也踩过!', likes: 123 });
    expect(r.topComments?.[4]).toEqual({ text: '期待下一期', likes: 32 });
  });

  it('缺失字段返回 null 不抛错', async () => {
    const tmpPath = path.join(__dirname, 'minimal-report.md');
    const fs = await import('fs/promises');
    await fs.writeFile(tmpPath, '# 视频复盘报告\n## 数据快照\n- 播放: 100\n- 点赞: 10\n- 评论: 1\n- 转发: 0\n- 收藏: 0\n');
    const r = await parseReportMd(tmpPath);
    expect(r.plays).toBe(100n);
    expect(r.completionRateBp).toBeNull();
    expect(r.retention3sBp).toBeNull();
    expect(r.followConversionBp).toBeNull();
    expect(r.topComments).toBeNull();
    await fs.unlink(tmpPath);
  });
});
```

- [ ] **Step 3.3: 跑测试验证失败**

```bash
npm test -- report-parser
```

预期: FAIL。

- [ ] **Step 3.4: 实现**

`src/lib/douyin/report-parser.ts`:

```typescript
import { promises as fs } from 'fs';

export interface ActualMetricInput {
  plays: bigint;
  likes: bigint;
  comments: bigint;
  shares: bigint;
  collects: bigint;
  completionRateBp: number | null;
  retention3sBp: number | null;
  followConversionBp: number | null;
  likeRateBp: number | null;
  commentRateBp: number | null;
  shareRateBp: number | null;
  topComments: { text: string; likes: number }[] | null;
}

function extractBigInt(md: string, regex: RegExp): bigint {
  const m = regex.exec(md);
  if (!m) return 0n;
  return BigInt(m[1].replace(/,/g, ''));
}

function extractOptionalBigInt(md: string, regex: RegExp): bigint | null {
  const m = regex.exec(md);
  if (!m) return null;
  return BigInt(m[1].replace(/,/g, ''));
}

/** 百分比 (12.34%) → BasisPoints * 100 (1234) */
function extractBp(md: string, regex: RegExp): number | null {
  const m = regex.exec(md);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * 100);
}

function computeRateBp(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  // 用 Number 转换前确保不会溢出 (BigInt 在 BigInt 范围内除法,再 × 10000 转 Number)
  const ratio = Number((numerator * 1000000n) / denominator); // 1e6 倍精度
  return Math.round(ratio / 100); // → BasisPoints * 100
}

function extractTopComments(md: string): { text: string; likes: number }[] | null {
  const section = md.match(/##\s*Top \d+ 评论\s*([\s\S]*?)(?=\n##\s|\n*$)/);
  if (!section) return null;
  const items: { text: string; likes: number }[] = [];
  const lineRegex = /^-\s*\((\d+)\s*赞\)\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(section[1])) !== null) {
    items.push({ likes: parseInt(m[1], 10), text: m[2].trim() });
  }
  return items.length > 0 ? items : null;
}

export async function parseReportMd(filePath: string): Promise<ActualMetricInput> {
  const md = await fs.readFile(filePath, 'utf-8');

  const plays = extractBigInt(md, /播放[:\s]+([\d,]+)/);
  const likes = extractBigInt(md, /点赞[:\s]+([\d,]+)/);
  const comments = extractBigInt(md, /评论[:\s]+([\d,]+)/);
  const shares = extractBigInt(md, /转发[:\s]+([\d,]+)/);
  const collects = extractBigInt(md, /收藏[:\s]+([\d,]+)/);

  return {
    plays,
    likes,
    comments,
    shares,
    collects,
    completionRateBp: extractBp(md, /完播率[:\s]+([\d.]+)%/),
    retention3sBp: extractBp(md, /3s\s*留存[:\s]+([\d.]+)%/),
    followConversionBp: extractBp(md, /转粉率[:\s]+([\d.]+)%/),
    likeRateBp: computeRateBp(likes, plays),
    commentRateBp: computeRateBp(comments, plays),
    shareRateBp: computeRateBp(shares, plays),
    topComments: extractTopComments(md),
  };
}
```

- [ ] **Step 3.5: 跑测试验证通过**

```bash
npm test -- report-parser
```

预期: PASS (4 tests)。

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/douyin/report-parser.ts tests/lib/douyin/report-parser.test.ts tests/fixtures/douyin-report-sample.md
git commit -m "feat(phase3-v2): report.md parser — 8 metrics + 3 derived rates + top comments"
```

---

## Task 4: lib/douyin/adapter — Python 子进程

**Files:**
- Create: `src/lib/douyin/adapter.ts`
- Create: `tests/lib/douyin/adapter.test.ts`

TDD with `child_process` mock。

- [ ] **Step 4.1: 写失败测试**

`tests/lib/douyin/adapter.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'path';

const execFileMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: any) => execFileMock(cmd, args, opts, cb),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: vi.fn(async () => undefined), writeFile: vi.fn(async () => undefined) };
});

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, existsSync: vi.fn(() => true) };
});

import { probeDouyinCookie, runDouyinAdapter } from '@/lib/douyin/adapter';

beforeEach(() => {
  execFileMock.mockReset();
  process.env.CHEAT_ADAPTER_PATH = '/adapter';
  process.env.CHEAT_CONTENT_PROJECT_DIR = '/content';
  process.env.PYTHON_BIN = 'python3';
});

describe('probeDouyinCookie', () => {
  it('退出码 0 返回 true', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: '', stderr: '' }));
    expect(await probeDouyinCookie()).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(
      'python3',
      [path.join('/adapter', 'crawler.py'), 'list'],
      expect.objectContaining({ cwd: '/content', timeout: 30000 }),
      expect.any(Function)
    );
  });

  it('退出码非 0 返回 false', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(new Error('exit 1'), null));
    expect(await probeDouyinCookie()).toBe(false);
  });
});

describe('runDouyinAdapter', () => {
  it('happy path 返回 report.md 路径', async () => {
    execFileMock.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: 'ok', stderr: '' }));
    const reportPath = await runDouyinAdapter('7234567890');
    expect(reportPath).toMatch(/retro-7234567890-\d+\/report\.md$/);
    expect(execFileMock).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([path.join('/adapter', 'review.py'), 'video', '7234567890']),
      expect.objectContaining({ cwd: '/content', timeout: 300000 }),
      expect.any(Function)
    );
  });

  it('未配置 env 抛错', async () => {
    delete process.env.CHEAT_ADAPTER_PATH;
    await expect(runDouyinAdapter('7234567890')).rejects.toThrow(/未配置/);
  });

  it('adapter 错误 stderr 末 200 字符入 error message', async () => {
    const longErr = 'x'.repeat(500);
    execFileMock.mockImplementation((_c, _a, _o, cb) => {
      const err: any = new Error('exit 1');
      err.stderr = longErr;
      cb(err, null);
    });
    await expect(runDouyinAdapter('7234567890')).rejects.toThrow(/x{200}/);
  });
});
```

- [ ] **Step 4.2: 跑测试验证失败**

```bash
npm test -- adapter
```

预期: FAIL。

- [ ] **Step 4.3: 实现**

`src/lib/douyin/adapter.ts`:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

interface AdapterEnv {
  adapterPath: string;
  contentDir: string;
  pythonBin: string;
}

function readAdapterEnv(): AdapterEnv {
  const adapterPath = process.env.CHEAT_ADAPTER_PATH;
  const contentDir = process.env.CHEAT_CONTENT_PROJECT_DIR;
  if (!adapterPath || !contentDir) {
    throw new Error('CHEAT_ADAPTER_PATH 或 CHEAT_CONTENT_PROJECT_DIR 未配置');
  }
  return {
    adapterPath,
    contentDir,
    pythonBin: process.env.PYTHON_BIN || 'python3',
  };
}

/** 跑 crawler.py list 检测 cookie。 退出码 0 = 有效。 */
export async function probeDouyinCookie(): Promise<boolean> {
  let env: AdapterEnv;
  try {
    env = readAdapterEnv();
  } catch {
    return false;
  }

  try {
    await execFileAsync(
      env.pythonBin,
      [path.join(env.adapterPath, 'crawler.py'), 'list'],
      { cwd: env.contentDir, timeout: 30_000 }
    );
    return true;
  } catch {
    return false;
  }
}

/** 跑 review.py video <aweme_id> 拉取数据。 返回 report.md 绝对路径。 */
export async function runDouyinAdapter(awemeId: string): Promise<string> {
  const { adapterPath, contentDir, pythonBin } = readAdapterEnv();

  const outputDir = path.join(os.tmpdir(), `retro-${awemeId}-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });
  const scriptPath = path.join(outputDir, 'script.md');
  await fs.writeFile(scriptPath, `# placeholder\nawemeId: ${awemeId}\n`);

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      [path.join(adapterPath, 'review.py'), 'video', awemeId, scriptPath],
      { cwd: contentDir, timeout: 5 * 60_000 }
    );

    const reportPath = path.join(outputDir, 'report.md');
    if (!existsSync(reportPath)) {
      throw new Error(
        `adapter 未生成 report.md\nstdout 末段: ${stdout.slice(-200)}\nstderr 末段: ${stderr.slice(-200)}`
      );
    }
    return reportPath;
  } catch (err) {
    const e = err as Error & { stderr?: string };
    if (e.stderr) {
      throw new Error(`adapter 子进程失败: ${e.stderr.slice(-200)}`);
    }
    throw err;
  }
}
```

- [ ] **Step 4.4: 跑测试验证通过**

```bash
npm test -- adapter
```

预期: PASS (5 tests)。

- [ ] **Step 4.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 4.6: Commit**

```bash
git add src/lib/douyin/adapter.ts tests/lib/douyin/adapter.test.ts
git commit -m "feat(phase3-v2): douyin adapter wrapper — probe cookie + run review.py subprocess"
```

---

## Task 5: prompts/ai-knowledge/retro-gap

**Files:**
- Create: `src/lib/llm/prompts/ai-knowledge/retro-gap.ts`
- Create: `tests/lib/llm/prompts/ai-knowledge/retro-gap.test.ts`

- [ ] **Step 5.1: 写失败测试**

`tests/lib/llm/prompts/ai-knowledge/retro-gap.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { RETRO_GAP, RetroGapResponseSchema } from '@/lib/llm/prompts/ai-knowledge/retro-gap';

describe('RETRO_GAP', () => {
  it('systemPrompt 含专家人设 + 落差分析关键词', () => {
    expect(RETRO_GAP.systemPrompt).toMatch(/AI 知识类/);
    expect(RETRO_GAP.systemPrompt).toMatch(/落差|对比|accuracy/);
  });

  it('buildUserMessage 含 A v1 报告 + 实际数据字段', () => {
    const parts = RETRO_GAP.buildUserMessage({
      report: {
        hook: { rating: 3, summary: 'x' },
        retention: { riskPoints: [{ startSec: 18, endSec: 24 }] },
        titleCaption: { mode: 'evaluate' },
        cover: { mode: 'generate' },
        overallScore: 78,
      } as any,
      actual: {
        plays: 12345n,
        likes: 1234n,
        comments: 234n,
        shares: 45n,
        collects: 123n,
        completionRateBp: 3210,
        retention3sBp: 6540,
        followConversionBp: 120,
        likeRateBp: 999,
        commentRateBp: 189,
        shareRateBp: 36,
        topComments: null,
      },
    });
    const text = (parts[0] as any).text;
    expect(text).toMatch(/钩子.*3/);
    expect(text).toMatch(/12345/);
    expect(text).toMatch(/完播率.*32\.10%|3210/);
  });
});

describe('RetroGapResponseSchema', () => {
  const validBase = {
    schemaVersion: 1,
    niche: 'ai-knowledge',
    hookGap: {
      predictedRating: 3,
      relevantActual: { retention3sBp: 6540 },
      takeaway: '钩子预判 ★3,实际 3s 留存 65%',
      accuracy: 'on-target',
    },
    retentionGap: {
      predictedRiskPoints: 1,
      relevantActual: { completionRateBp: 3210 },
      takeaway: 'x',
      accuracy: 'under-estimated',
    },
    titleCaptionGap: {
      mode: 'evaluate',
      relevantActual: {},
      takeaway: 'x',
      accuracy: 'unknown',
    },
    coverGap: {
      mode: 'generate',
      relevantActual: { plays: 12345 },
      takeaway: 'x',
      accuracy: 'over-estimated',
    },
    overallTakeaway: '综合',
    predictedOverallScore: 78,
    inferredActualScore: 65,
  };

  it('合法响应通过', () => {
    expect(() => RetroGapResponseSchema.parse(validBase)).not.toThrow();
  });

  it('accuracy 必须是 4 enum 之一', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, hookGap: { ...validBase.hookGap, accuracy: 'maybe' } })
    ).toThrow();
  });

  it('overallScore 接受 null', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, predictedOverallScore: null, inferredActualScore: null })
    ).not.toThrow();
  });

  it('inferredActualScore 超出 0-100 被拒', () => {
    expect(() =>
      RetroGapResponseSchema.parse({ ...validBase, inferredActualScore: 150 })
    ).toThrow();
  });
});
```

- [ ] **Step 5.2: 跑测试验证失败**

```bash
npm test -- retro-gap
```

预期: FAIL。

- [ ] **Step 5.3: 实现**

`src/lib/llm/prompts/ai-knowledge/retro-gap.ts`:

```typescript
import { z } from 'zod';
import { EXPERT_PERSONA } from './expert-persona';
import { JSON_STRICTNESS } from '../base';
import type { ContentPart } from '@/lib/llm/vision';
import type { ActualMetricInput } from '@/lib/douyin/report-parser';

const Accuracy = z.enum(['on-target', 'over-estimated', 'under-estimated', 'unknown']);
const Rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

export const RetroGapResponseSchema = z.object({
  schemaVersion: z.literal(1),
  niche: z.literal('ai-knowledge'),

  hookGap: z.object({
    predictedRating: Rating,
    relevantActual: z.object({
      retention3sBp: z.number().int().nullable().optional(),
      completionRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  retentionGap: z.object({
    predictedRiskPoints: z.number().int().nonnegative(),
    relevantActual: z.object({
      completionRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  titleCaptionGap: z.object({
    mode: z.enum(['evaluate', 'generate', 'unknown']),
    relevantActual: z.object({
      likeRateBp: z.number().int().nullable().optional(),
      shareRateBp: z.number().int().nullable().optional(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  coverGap: z.object({
    mode: z.enum(['evaluate', 'generate', 'unknown']),
    relevantActual: z.object({
      plays: z.number().int().nonnegative(),
    }),
    takeaway: z.string().min(1),
    accuracy: Accuracy,
  }),

  overallTakeaway: z.string().min(1),
  predictedOverallScore: z.number().int().min(0).max(100).nullable(),
  inferredActualScore: z.number().int().min(0).max(100).nullable(),
});

export type RetroGapResponse = z.infer<typeof RetroGapResponseSchema>;

export interface RetroGapInput {
  report: {
    hook?: { rating?: number; summary?: string } | { error: string };
    retention?: { riskPoints?: unknown[] } | { error: string };
    titleCaption?: { mode?: string } | { error: string };
    cover?: { mode?: string } | { error: string };
    overallScore?: number | null;
  };
  actual: ActualMetricInput;
}

function bpToPercent(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(2)}%`;
}

function getMode(dim: unknown): string {
  if (dim && typeof dim === 'object' && 'mode' in dim && typeof (dim as any).mode === 'string') {
    return (dim as any).mode;
  }
  return 'unknown';
}

function getRating(dim: unknown): number {
  if (dim && typeof dim === 'object' && 'rating' in dim && typeof (dim as any).rating === 'number') {
    return (dim as any).rating;
  }
  return 3;
}

function getRiskPointCount(dim: unknown): number {
  if (dim && typeof dim === 'object' && 'riskPoints' in dim && Array.isArray((dim as any).riskPoints)) {
    return (dim as any).riskPoints.length;
  }
  return 0;
}

export const RETRO_GAP = {
  systemPrompt: `${EXPERT_PERSONA}

任务: 对比 AI 预诊断 (4 维度评估) vs 抖音实际播放数据, 生成跨维度落差分析。

每个维度 (hook/retention/titleCaption/cover) 给出:
- predictedXxx: 抄 A v1 评分/字段
- relevantActual: 与该维度相关的实际指标 (e.g. hook ↔ 3s 留存; cover ↔ plays)
- takeaway: 1-2 句话对比预判 vs 实际, 用具体数字
- accuracy: on-target (预判与实际一致) / over-estimated (预判过乐观) / under-estimated (预判过保守) / unknown (相关字段缺失)

overallTakeaway: 1-2 句跨维度总结
predictedOverallScore: 抄 A v1
inferredActualScore: AI 主观转换实际指标为 1-100 综合分

${JSON_STRICTNESS}`,
  buildUserMessage(input: RetroGapInput): ContentPart[] {
    const r = input.report;
    const a = input.actual;
    const text = `=== A v1 预诊断 ===
钩子: ★${getRating(r.hook)} | summary: ${(r.hook as any)?.summary ?? '(N/A)'}
完播风险: ${getRiskPointCount(r.retention)} 个 riskPoints
标题/文案: mode=${getMode(r.titleCaption)}
封面: mode=${getMode(r.cover)}
综合分: ${r.overallScore ?? '(N/A)'}/100

=== 抖音实际数据 (T+3d) ===
播放: ${a.plays}
点赞: ${a.likes} (likeRate ${bpToPercent(a.likeRateBp)})
评论: ${a.comments} (commentRate ${bpToPercent(a.commentRateBp)})
转发: ${a.shares} (shareRate ${bpToPercent(a.shareRateBp)})
收藏: ${a.collects}
完播率: ${bpToPercent(a.completionRateBp)}
3s 留存: ${bpToPercent(a.retention3sBp)}
转粉率: ${bpToPercent(a.followConversionBp)}

生成 RetroReportV1 JSON。`;
    return [{ type: 'text', text }];
  },
  responseSchema: RetroGapResponseSchema,
};
```

- [ ] **Step 5.4: 跑测试验证通过**

```bash
npm test -- retro-gap
```

预期: PASS (7 tests)。

- [ ] **Step 5.5: Commit**

```bash
git add src/lib/llm/prompts/ai-knowledge/retro-gap.ts tests/lib/llm/prompts/ai-knowledge/retro-gap.test.ts
git commit -m "feat(phase3-v2): retro-gap prompt + Zod (predicted vs actual, 4 accuracy verdicts)"
```

---

## Task 6: content-retro-worker — 6 阶段 pipeline

**Files:**
- Create: `src/jobs/workers/content-retro-worker.ts` (替换 Task 1 stub)
- Create: `tests/jobs/content-retro-worker.test.ts`

- [ ] **Step 6.1: 写失败测试**

`tests/jobs/content-retro-worker.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { RETRO: 'content-retro' } }));

const prismaMock = {
  contentAnalysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  actualMetric: { create: vi.fn(async (args: any) => ({ id: 'm1', ...args.data })) },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/douyin/adapter', () => ({
  probeDouyinCookie: vi.fn(async () => true),
  runDouyinAdapter: vi.fn(async () => '/tmp/report.md'),
}));

vi.mock('@/lib/douyin/report-parser', () => ({
  parseReportMd: vi.fn(async () => ({
    plays: 12345n, likes: 1234n, comments: 234n, shares: 45n, collects: 123n,
    completionRateBp: 3210, retention3sBp: 6540, followConversionBp: 120,
    likeRateBp: 999, commentRateBp: 189, shareRateBp: 36, topComments: null,
  })),
}));

const llmCallMock = vi.fn();
vi.mock('@/lib/llm/vision', () => ({
  OpenAIVisionLLM: class { callStructured = llmCallMock; },
}));

import { runRetroPipeline } from '@/jobs/workers/content-retro-worker';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'sk-test';
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({
    id: 'a1',
    douyinAwemeId: '7234567890',
    publishedAt: new Date(Date.now() - 3 * 86400000),
    retroStatus: 'SCHEDULED',
    report: { hook: { rating: 3 }, retention: { riskPoints: [] }, titleCaption: { mode: 'evaluate' }, cover: { mode: 'generate' } },
    llmUsage: { total: { promptTokens: 1000, completionTokens: 100, estCostUSD: 0.01, model: 'aggregate' }, byCall: [] },
  });
  llmCallMock.mockResolvedValue({
    result: {
      schemaVersion: 1, niche: 'ai-knowledge',
      hookGap: { predictedRating: 3, relevantActual: { retention3sBp: 6540 }, takeaway: 'x', accuracy: 'on-target' },
      retentionGap: { predictedRiskPoints: 0, relevantActual: { completionRateBp: 3210 }, takeaway: 'x', accuracy: 'on-target' },
      titleCaptionGap: { mode: 'evaluate', relevantActual: {}, takeaway: 'x', accuracy: 'on-target' },
      coverGap: { mode: 'generate', relevantActual: { plays: 12345 }, takeaway: 'x', accuracy: 'on-target' },
      overallTakeaway: 'ok',
      predictedOverallScore: 78,
      inferredActualScore: 70,
    },
    usage: { model: 'gpt-4o-mini', promptTokens: 500, completionTokens: 200, estCostUSD: 0.005 },
  });
});

describe('runRetroPipeline', () => {
  it('happy path: cookie OK + fetch + parse + create + LLM + updateMany', async () => {
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).toHaveBeenCalled();
    expect(llmCallMock).toHaveBeenCalled();
    expect(prismaMock.contentAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1', retroStatus: { not: 'CANCELLED' } },
        data: expect.objectContaining({ retroStatus: 'COMPLETED' }),
      })
    );
  });

  it('cookie 失效 → retroStatus=FAILED, 不调 adapter', async () => {
    const { probeDouyinCookie } = await import('@/lib/douyin/adapter');
    (probeDouyinCookie as any).mockResolvedValueOnce(false);
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retroStatus: 'FAILED', retroErrorMessage: expect.stringMatching(/cookie/) }),
      })
    );
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('AI 失败 fail-soft: ActualMetric 仍写入, retroStatus 仍 COMPLETED, retroReport=null', async () => {
    llmCallMock.mockRejectedValueOnce(new Error('llm broken'));
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).toHaveBeenCalled();
    expect(prismaMock.contentAnalysis.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ retroStatus: 'COMPLETED', retroReport: null }),
      })
    );
  });

  it('analysis 不存在 → 早退, 无任何 update', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce(null);
    await runRetroPipeline('a1');
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });

  it('retroStatus=CANCELLED → 早退', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      ...await prismaMock.contentAnalysis.findUnique({ where: { id: 'a1' } }),
      retroStatus: 'CANCELLED',
    });
    await runRetroPipeline('a1');
    expect(prismaMock.actualMetric.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6.2: 跑测试验证失败**

```bash
npm test -- content-retro-worker
```

预期: FAIL。

- [ ] **Step 6.3: 实现**

替换 `src/jobs/workers/content-retro-worker.ts` 全文:

```typescript
import { Worker, type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { QUEUES } from '@/jobs/queue';
import { probeDouyinCookie, runDouyinAdapter } from '@/lib/douyin/adapter';
import { parseReportMd } from '@/lib/douyin/report-parser';
import { OpenAIVisionLLM, type TokenUsage } from '@/lib/llm/vision';
import { RETRO_GAP, type RetroGapResponse } from '@/lib/llm/prompts/ai-knowledge/retro-gap';
import type { RetroStatus } from '@prisma/client';

type JobData = { analysisId: string };

async function setRetroStatus(analysisId: string, status: RetroStatus, extra: Record<string, unknown> = {}) {
  await prisma.contentAnalysis.update({
    where: { id: analysisId },
    data: { retroStatus: status, ...extra },
  });
}

function mergeLlmUsage(existing: unknown, add: TokenUsage): unknown {
  const e = (existing as any) ?? { byCall: [], total: { model: 'aggregate', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  return {
    byCall: [...(e.byCall ?? []), add],
    total: {
      model: 'aggregate',
      promptTokens: (e.total?.promptTokens ?? 0) + add.promptTokens,
      completionTokens: (e.total?.completionTokens ?? 0) + add.completionTokens,
      estCostUSD: (e.total?.estCostUSD ?? 0) + add.estCostUSD,
    },
  };
}

export async function runRetroPipeline(analysisId: string): Promise<void> {
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: analysisId } });
  if (!analysis || !analysis.douyinAwemeId) return;
  if (analysis.retroStatus === 'CANCELLED') return;

  // 阶段 1: RUNNING + cookie 探测
  await setRetroStatus(analysisId, 'RUNNING', { retroStartedAt: new Date() });
  const cookieOk = await probeDouyinCookie();
  if (!cookieOk) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: '抖音 cookie 失效,请在 cheat-on-content 项目目录重新扫码登录',
    });
    return;
  }

  // 阶段 2: adapter 拉数据
  let reportPath: string;
  try {
    reportPath = await runDouyinAdapter(analysis.douyinAwemeId);
  } catch (err) {
    await setRetroStatus(analysisId, 'FAILED', {
      retroErrorMessage: `数据采集失败: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // 阶段 3: parse
  const parsed = await parseReportMd(reportPath);

  // 阶段 4: 落 ActualMetric
  const daysAfterPublish = (Date.now() - analysis.publishedAt!.getTime()) / 86400000;
  await prisma.actualMetric.create({
    data: {
      analysisId,
      snapshotAt: new Date(),
      daysAfterPublish,
      plays: parsed.plays,
      likes: parsed.likes,
      comments: parsed.comments,
      shares: parsed.shares,
      collects: parsed.collects,
      likeRateBp: parsed.likeRateBp,
      commentRateBp: parsed.commentRateBp,
      shareRateBp: parsed.shareRateBp,
      completionRateBp: parsed.completionRateBp,
      retention3sBp: parsed.retention3sBp,
      followConversionBp: parsed.followConversionBp,
      topComments: (parsed.topComments ?? Prisma.JsonNull) as any,
      rawReportPath: reportPath,
    },
  });

  // 阶段 5: AI 落差总结 (fail-soft)
  let retroReport: RetroGapResponse | null = null;
  let llmUsageDelta: TokenUsage | null = null;
  try {
    const llm = new OpenAIVisionLLM({ apiKey: process.env.OPENAI_API_KEY!, defaultModel: 'gpt-4o-mini' });
    const out = await llm.callStructured({
      systemPrompt: RETRO_GAP.systemPrompt,
      userMessage: RETRO_GAP.buildUserMessage({
        report: analysis.report as any,
        actual: parsed,
      }),
      responseSchema: RETRO_GAP.responseSchema,
      model: 'gpt-4o-mini',
    });
    retroReport = out.result;
    llmUsageDelta = out.usage;
  } catch (err) {
    console.error('[content-retro-worker] AI gap analysis failed:', err);
  }

  // 阶段 6: 落最终 (cancel race 保护 + llmUsage 累加)
  const newLlmUsage = llmUsageDelta ? mergeLlmUsage(analysis.llmUsage, llmUsageDelta) : analysis.llmUsage;
  await prisma.contentAnalysis.updateMany({
    where: { id: analysisId, retroStatus: { not: 'CANCELLED' } },
    data: {
      retroStatus: 'COMPLETED',
      retroCompletedAt: new Date(),
      retroReport: (retroReport ?? Prisma.JsonNull) as any,
      llmUsage: newLlmUsage as any,
    },
  });
}

async function handleRetro(job: Job<JobData>) {
  await runRetroPipeline(job.data.analysisId);
}

export function startContentRetroWorker() {
  const worker = new Worker<JobData>(QUEUES.RETRO, handleRetro, { connection: redis });
  worker.on('failed', (job, err) => {
    console.error('[content-retro-worker] failed', job?.id, err);
    if (job) {
      prisma.contentAnalysis
        .update({
          where: { id: job.data.analysisId },
          data: { retroStatus: 'FAILED', retroErrorMessage: err.message, retroCompletedAt: new Date() },
        })
        .catch(() => {});
    }
  });
  worker.on('completed', (job) => {
    console.log('[content-retro-worker] completed', job.id);
  });
  return worker;
}
```

- [ ] **Step 6.4: 跑测试验证通过**

```bash
npm test -- content-retro-worker
```

预期: PASS (5 tests)。

- [ ] **Step 6.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 6.6: Commit**

```bash
git add src/jobs/workers/content-retro-worker.ts tests/jobs/content-retro-worker.test.ts
git commit -m "feat(phase3-v2): content-retro-worker — 6-stage pipeline (cookie/fetch/parse/persist/AI/finalize)"
```

---

## Task 7: POST /publish + POST /retro-now + GET projection update

**Files:**
- Create: `src/app/api/v1/content/analyses/[id]/publish/route.ts`
- Create: `src/app/api/v1/content/analyses/[id]/retro-now/route.ts`
- Modify: `src/app/api/v1/content/analyses/[id]/route.ts` (GET projection 加 retro 字段 + BigInt 序列化)
- Create: `tests/api/content/publish.test.ts`

- [ ] **Step 7.1: 写失败测试**

`tests/api/content/publish.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = {
  contentAnalysis: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (args: any) => ({ id: 'a1', ...args.data })),
  },
  actualMetric: { deleteMany: vi.fn(async () => ({ count: 0 })) },
};
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/douyin/aweme', () => ({
  resolveDouyinUrl: vi.fn(async (url: string) => {
    if (url.includes('douyin.com/video/')) return url.match(/\/video\/(\d+)/)![1];
    return null;
  }),
}));

vi.mock('@/jobs/queue', () => ({ retroQueue: { add: vi.fn() } }));

import { POST as publishPOST } from '@/app/api/v1/content/analyses/[id]/publish/route';
import { POST as retroNowPOST } from '@/app/api/v1/content/analyses/[id]/retro-now/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({ id: 'a1', retroStatus: null });
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
});

function makeReq(body: any): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

describe('POST /publish', () => {
  it('长链 happy path', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.scheduledAt).toBeDefined();
    expect(prismaMock.actualMetric.deleteMany).toHaveBeenCalled();
  });

  it('publishedAt 在未来 → 400', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() + 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });

  it('URL 不解析 → 400', async () => {
    const res = await publishPOST(
      makeReq({ url: 'https://example.com/x', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });

  it('同 awemeId 已关联其他 analysis → 400', async () => {
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({ id: 'other', douyinAwemeId: '7234567890' });
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toMatch(/已关联/);
  });

  it('retroStatus=RUNNING → 400 (拒绝并发)', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', retroStatus: 'RUNNING' });
    const res = await publishPOST(
      makeReq({ url: 'https://www.douyin.com/video/7234567890', publishedAt: new Date(Date.now() - 86400000).toISOString() }),
      { params: { id: 'a1' } }
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /retro-now', () => {
  it('happy path', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: '7234567890' });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(200);
  });

  it('无 douyinAwemeId → 400', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'a1', douyinAwemeId: null });
    const res = await retroNowPOST(new Request('http://x', { method: 'POST' }), { params: { id: 'a1' } });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 7.2: 跑测试验证失败**

```bash
npm test -- publish
```

预期: FAIL。

- [ ] **Step 7.3: 实现 /publish**

`src/app/api/v1/content/analyses/[id]/publish/route.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveDouyinUrl } from '@/lib/douyin/aweme';
import { retroQueue } from '@/jobs/queue';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => null)) as { url?: string; publishedAt?: string } | null;
  if (!body?.url || !body?.publishedAt) return fail('url 和 publishedAt 必填', 400);

  const publishedAt = new Date(body.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) return fail('publishedAt 格式错误', 400);
  if (publishedAt.getTime() > Date.now()) return fail('发布时间不能在未来', 400);

  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!analysis) return fail('not found', 404);
  if (analysis.retroStatus === 'RUNNING') return fail('复盘正在进行中,请先取消', 400);

  const awemeId = await resolveDouyinUrl(body.url);
  if (!awemeId) return fail('无法解析抖音视频 ID,请用完整链接', 400);

  // 软查重: 同 awemeId 不可关联其他 analysis
  const conflict = await prisma.contentAnalysis.findFirst({
    where: { douyinAwemeId: awemeId, NOT: { id: params.id } },
    select: { id: true },
  });
  if (conflict) return fail(`该视频已关联到分析 ${conflict.id}`, 400);

  // 重置 retro 子状态
  await prisma.actualMetric.deleteMany({ where: { analysisId: params.id } });
  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: {
      douyinUrl: body.url,
      douyinAwemeId: awemeId,
      publishedAt,
      retroStatus: 'SCHEDULED',
      retroReport: null,
      retroErrorMessage: null,
      retroStartedAt: null,
      retroCompletedAt: null,
    },
  });

  const delayMs = Math.max(0, publishedAt.getTime() + 3 * 86400000 - Date.now());
  await retroQueue.add(
    'retro',
    { analysisId: params.id },
    { delay: delayMs, jobId: `retro-${params.id}-${Date.now()}`, removeOnComplete: true, removeOnFail: { age: 7 * 86400, count: 100 } }
  );

  return ok({ scheduledAt: new Date(publishedAt.getTime() + 3 * 86400000).toISOString() });
}
```

- [ ] **Step 7.4: 实现 /retro-now**

`src/app/api/v1/content/analyses/[id]/retro-now/route.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { retroQueue } from '@/jobs/queue';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const analysis = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!analysis) return fail('not found', 404);
  if (!analysis.douyinAwemeId) return fail('请先填抖音链接', 400);

  await prisma.contentAnalysis.update({
    where: { id: params.id },
    data: { retroStatus: 'SCHEDULED', retroErrorMessage: null },
  });

  await retroQueue.add(
    'retro',
    { analysisId: params.id },
    { delay: 0, jobId: `retro-${params.id}-now-${Date.now()}`, removeOnComplete: true, removeOnFail: { age: 7 * 86400, count: 100 } }
  );

  return ok({});
}
```

- [ ] **Step 7.5: 修改 GET projection (加 retro 字段 + ActualMetric + BigInt 序列化)**

替换 `src/app/api/v1/content/analyses/[id]/route.ts` 全文:

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

/** BigInt 转 string 让 JSON.stringify 不抛错。  */
function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as any).map(([k, v]) => [k, serializeBigInts(v)]));
  }
  return obj;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      videoFilename: true,
      videoDurationSec: true,
      videoMimeType: true,
      status: true,
      errorMessage: true,
      progress: true,
      retryCount: true,
      report: true,
      llmUsage: true,
      coverCandidates: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      // v2 retro 字段
      douyinUrl: true,
      douyinAwemeId: true,
      publishedAt: true,
      retroStatus: true,
      retroErrorMessage: true,
      retroReport: true,
      retroStartedAt: true,
      retroCompletedAt: true,
      actualMetrics: {
        orderBy: { snapshotAt: 'desc' },
        take: 1, // v2 单快照,取最新
      },
    },
  });
  if (!a) return fail('not found', 404);
  const covers = (a.coverCandidates as { path: string }[] | null) ?? [];
  return ok(serializeBigInts({
    id: a.id,
    videoFilename: a.videoFilename,
    videoDurationSec: a.videoDurationSec,
    videoMimeType: a.videoMimeType,
    status: a.status,
    errorMessage: a.errorMessage,
    progress: a.progress,
    retryCount: a.retryCount,
    report: a.report,
    llmUsage: a.llmUsage,
    coverCandidatesCount: covers.length,
    createdAt: a.createdAt,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    // v2
    douyinUrl: a.douyinUrl,
    douyinAwemeId: a.douyinAwemeId,
    publishedAt: a.publishedAt,
    retroStatus: a.retroStatus,
    retroErrorMessage: a.retroErrorMessage,
    retroReport: a.retroReport,
    retroStartedAt: a.retroStartedAt,
    retroCompletedAt: a.retroCompletedAt,
    actualMetric: a.actualMetrics[0] ?? null,  // 单条 (注意去掉 rawReportPath 不暴露磁盘路径)
  }));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);

  if (a.status === 'QUEUED' || a.status === 'PREPROCESSING' || a.status === 'ANALYZING') {
    return fail('任务运行中无法删除,请先取消', 400);
  }
  if (a.retroStatus === 'RUNNING') {
    return fail('复盘正在运行,请先取消', 400);
  }

  const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';
  const analysisDir = path.join(UPLOADS_ROOT, a.id);
  await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => {});

  await prisma.contentAnalysis.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
```

注意: 上面 `actualMetric` 字段包含 `rawReportPath`,但 GET 用 select 隐式拉了它。改为显式 select 去掉:

```typescript
      actualMetrics: {
        orderBy: { snapshotAt: 'desc' },
        take: 1,
        select: {
          id: true, snapshotAt: true, daysAfterPublish: true, source: true,
          plays: true, likes: true, comments: true, shares: true, collects: true,
          likeRateBp: true, commentRateBp: true, shareRateBp: true,
          completionRateBp: true, retention3sBp: true, followConversionBp: true,
          topComments: true, createdAt: true,
        },
      },
```

(把上面 GET handler 里的 `actualMetrics: { ... take: 1 }` 段替换为含 select 的完整版本)

- [ ] **Step 7.6: 跑测试验证通过**

```bash
npm test -- publish
```

预期: PASS (7 tests)。

- [ ] **Step 7.7: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 7.8: Commit**

```bash
git add src/app/api/v1/content/analyses/[id]/publish src/app/api/v1/content/analyses/[id]/retro-now src/app/api/v1/content/analyses/[id]/route.ts tests/api/content/publish.test.ts
git commit -m "feat(phase3-v2): POST /publish + POST /retro-now + GET projection (retro fields + BigInt serialize)"
```

---

## Task 8: PublishLinkForm + ActualMetricsTable 组件

**Files:**
- Create: `src/components/content/publish-link-form.tsx`
- Create: `src/components/content/actual-metrics-table.tsx`

UI 组件,无单测。

- [ ] **Step 8.1: PublishLinkForm**

`src/components/content/publish-link-form.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PublishLinkForm({
  analysisId,
  initialUrl,
  initialPublishedAt,
  onSaved,
}: {
  analysisId: string;
  initialUrl?: string | null;
  initialPublishedAt?: string | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(initialUrl ?? '');
  const [publishedAt, setPublishedAt] = useState(
    initialPublishedAt ? new Date(initialPublishedAt).toISOString().slice(0, 16) : ''
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!url.trim() || !publishedAt) {
      setError('请填写视频链接和发布时间');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/content/analyses/${analysisId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), publishedAt: new Date(publishedAt).toISOString() }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
        return;
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="text-sm font-semibold">📤 已发布到抖音?</div>
      <div className="space-y-1">
        <Label>抖音视频链接</Label>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.douyin.com/video/..." />
      </div>
      <div className="space-y-1">
        <Label>发布时间</Label>
        <Input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} />
      </div>
      {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
      <Button onClick={handleSubmit} disabled={submitting || !url || !publishedAt}>
        {submitting ? '保存中...' : '保存并安排 T+3d 复盘 →'}
      </Button>
    </div>
  );
}
```

- [ ] **Step 8.2: ActualMetricsTable**

`src/components/content/actual-metrics-table.tsx`:

```typescript
type Metric = {
  plays: string | number;
  likes: string | number;
  comments: string | number;
  shares: string | number;
  collects: string | number;
  completionRateBp: number | null;
  retention3sBp: number | null;
  followConversionBp: number | null;
  snapshotAt: string;
  daysAfterPublish: number;
};

function bpToPercent(bp: number | null): string {
  if (bp === null) return '—';
  return `${(bp / 100).toFixed(1)}%`;
}

function formatBig(v: string | number): string {
  const n = typeof v === 'string' ? Number(v) : v;
  return n.toLocaleString();
}

export function ActualMetricsTable({ metric }: { metric: Metric }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        T+{metric.daysAfterPublish.toFixed(1)} 天采集 · {new Date(metric.snapshotAt).toLocaleString()}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="播放" value={formatBig(metric.plays)} />
        <Stat label="点赞" value={formatBig(metric.likes)} />
        <Stat label="评论" value={formatBig(metric.comments)} />
        <Stat label="转发" value={formatBig(metric.shares)} />
        <Stat label="收藏" value={formatBig(metric.collects)} />
        <Stat label="完播率" value={bpToPercent(metric.completionRateBp)} />
        <Stat label="3s 留存" value={bpToPercent(metric.retention3sBp)} />
        <Stat label="转粉率" value={bpToPercent(metric.followConversionBp)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
```

- [ ] **Step 8.3: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 8.4: Commit**

```bash
git add src/components/content/publish-link-form.tsx src/components/content/actual-metrics-table.tsx
git commit -m "feat(phase3-v2): PublishLinkForm + ActualMetricsTable components"
```

---

## Task 9: RetroGapView + RetroSection 组件 + 详情页集成

**Files:**
- Create: `src/components/content/retro-gap-view.tsx`
- Create: `src/components/content/retro-section.tsx`
- Modify: `src/app/content/preflight/[id]/page.tsx`

- [ ] **Step 9.1: RetroGapView**

`src/components/content/retro-gap-view.tsx`:

```typescript
import { DimensionCard } from './dimension-card';

type Accuracy = 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown';

type RetroReport = {
  hookGap: { predictedRating: number; takeaway: string; accuracy: Accuracy };
  retentionGap: { predictedRiskPoints: number; takeaway: string; accuracy: Accuracy };
  titleCaptionGap: { mode: string; takeaway: string; accuracy: Accuracy };
  coverGap: { mode: string; takeaway: string; accuracy: Accuracy };
  overallTakeaway: string;
  predictedOverallScore: number | null;
  inferredActualScore: number | null;
};

const ACCURACY_LABEL: Record<Accuracy, string> = {
  'on-target': '✓ on-target',
  'over-estimated': '⚠ over-estimated',
  'under-estimated': '⚠ under-estimated',
  'unknown': '? unknown',
};

const ACCURACY_COLOR: Record<Accuracy, string> = {
  'on-target': 'text-green-600',
  'over-estimated': 'text-amber-600',
  'under-estimated': 'text-amber-600',
  'unknown': 'text-muted-foreground',
};

export function RetroGapView({ report }: { report: RetroReport }) {
  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">🎯 AI 落差总结</div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <DimensionCard emoji="🪝" title={`钩子 (预判 ★${report.hookGap.predictedRating})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.hookGap.accuracy]}`}>{ACCURACY_LABEL[report.hookGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.hookGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="⏱" title={`完播 (${report.retentionGap.predictedRiskPoints} 风险点)`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.retentionGap.accuracy]}`}>{ACCURACY_LABEL[report.retentionGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.retentionGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="📝" title={`标题文案 (${report.titleCaptionGap.mode})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.titleCaptionGap.accuracy]}`}>{ACCURACY_LABEL[report.titleCaptionGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.titleCaptionGap.takeaway}</p>
        </DimensionCard>
        <DimensionCard emoji="🖼" title={`封面 (${report.coverGap.mode})`}>
          <div className={`text-xs ${ACCURACY_COLOR[report.coverGap.accuracy]}`}>{ACCURACY_LABEL[report.coverGap.accuracy]}</div>
          <p className="mt-1 text-sm">{report.coverGap.takeaway}</p>
        </DimensionCard>
      </div>
      <div className="rounded-lg bg-muted p-3 text-sm">
        <div className="font-semibold">📌 综合</div>
        <p className="mt-1">{report.overallTakeaway}</p>
        {report.predictedOverallScore !== null && report.inferredActualScore !== null && (
          <p className="mt-1 text-muted-foreground">
            预判综合 {report.predictedOverallScore}/100,实测推算 {report.inferredActualScore}/100
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9.2: RetroSection (4 状态容器)**

`src/components/content/retro-section.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PublishLinkForm } from './publish-link-form';
import { ActualMetricsTable } from './actual-metrics-table';
import { RetroGapView } from './retro-gap-view';

type AnalysisV2 = {
  id: string;
  douyinUrl: string | null;
  douyinAwemeId: string | null;
  publishedAt: string | null;
  retroStatus: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  retroErrorMessage: string | null;
  retroReport: any | null;
  actualMetric: any | null;
};

export function RetroSection({ analysis, onChanged }: { analysis: AnalysisV2; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);

  const handleRetroNow = async () => {
    await fetch(`/api/v1/content/analyses/${analysis.id}/retro-now`, { method: 'POST' });
    onChanged();
  };

  // 状态: 空 (没填 URL)
  if (!analysis.retroStatus || showForm) {
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">📊 发后复盘</h2>
        <PublishLinkForm
          analysisId={analysis.id}
          initialUrl={analysis.douyinUrl}
          initialPublishedAt={analysis.publishedAt}
          onSaved={() => { setShowForm(false); onChanged(); }}
        />
      </div>
    );
  }

  // 计算 scheduledAt
  const scheduledAt = analysis.publishedAt
    ? new Date(new Date(analysis.publishedAt).getTime() + 3 * 86400000)
    : null;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">📊 发后复盘</h2>

      {/* 状态: SCHEDULED */}
      {analysis.retroStatus === 'SCHEDULED' && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="text-sm">✓ 已关联: <a href={analysis.douyinUrl!} target="_blank" rel="noreferrer" className="text-primary underline">{analysis.douyinUrl}</a></div>
          {scheduledAt && (
            <div className="text-sm text-muted-foreground">
              ⏰ 计划于 {scheduledAt.toLocaleString()} 自动拉取
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRetroNow}>立刻拉一次</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接</Button>
          </div>
        </div>
      )}

      {/* 状态: RUNNING */}
      {analysis.retroStatus === 'RUNNING' && (
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm">🔄 正在拉取真实数据... (创作者中心 → 视频详情)</div>
        </div>
      )}

      {/* 状态: FAILED */}
      {analysis.retroStatus === 'FAILED' && (
        <div className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4">
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            ✗ 拉取失败: {analysis.retroErrorMessage ?? '未知错误'}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleRetroNow}>重新拉取</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接</Button>
          </div>
        </div>
      )}

      {/* 状态: COMPLETED */}
      {analysis.retroStatus === 'COMPLETED' && analysis.actualMetric && (
        <div className="space-y-4">
          <ActualMetricsTable metric={analysis.actualMetric} />
          {analysis.retroReport ? (
            <RetroGapView report={analysis.retroReport} />
          ) : (
            <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
              ⚠ AI 落差总结生成失败,可点"重新拉取"再试
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleRetroNow}>重新拉取数据</Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>重设链接 (改换关联视频)</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 9.3: 详情页集成**

修改 `src/app/content/preflight/[id]/page.tsx` — 在 Analysis type 加 v2 字段, 在 ReportView 之后渲染 RetroSection。

找到现有 `type Analysis = { ... }` 替换为:

```typescript
type Analysis = {
  id: string;
  videoFilename: string;
  videoDurationSec: number;
  status: string;
  errorMessage: string | null;
  progress: { stage?: string; percent?: number; label?: string } | null;
  report: any | null;
  llmUsage: any | null;
  coverCandidatesCount: number;
  retryCount: number;
  // v2
  douyinUrl: string | null;
  douyinAwemeId: string | null;
  publishedAt: string | null;
  retroStatus: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  retroErrorMessage: string | null;
  retroReport: any | null;
  actualMetric: any | null;
};
```

在文件顶部 imports 加:

```typescript
import { RetroSection } from '@/components/content/retro-section';
```

在 `<ReportView />` (现有的) 后面的 div 内, 在按钮组之前插入:

```typescript
{data.status === 'COMPLETED' && (
  <RetroSection analysis={data} onChanged={() => {
    fetch(`/api/v1/content/analyses/${data.id}`).then((r) => r.json()).then((j) => {
      if (j.success) setData(j.data);
    });
  }} />
)}
```

- [ ] **Step 9.4: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 9.5: dev 浏览器验证**

```bash
npm run dev
# 在已 COMPLETED 的 A v1 分析上看到 "📊 发后复盘" section + 表单
```

- [ ] **Step 9.6: Commit**

```bash
git add src/components/content/retro-gap-view.tsx src/components/content/retro-section.tsx src/app/content/preflight/[id]/page.tsx
git commit -m "feat(phase3-v2): RetroSection 4-state container + RetroGapView + detail page integration"
```

---

## Task 10: 手动 E2E 验收 + README

**No code changes** — 手动端到端 + 文档。

⚠️ **前置**: 用户已装好 cheat-on-content + 在内容项目跑过一次 `初始化` + 已扫码登录抖音创作者中心,`.auth/` 有效。

- [ ] **Step 10.1: 配置 .env**

在项目 `.env` 加 3 行:

```bash
CHEAT_ADAPTER_PATH=/Users/<your-name>/.claude/skills/cheat-on-content/adapters/perf-data/douyin-session
CHEAT_CONTENT_PROJECT_DIR=/Users/<your-name>/my-content
PYTHON_BIN=python3
```

(实际路径替换成你的)

- [ ] **Step 10.2: 重启 worker**

```bash
# 终端 B
# ctrl-c 杀掉旧 worker
npm run worker:dev
# 期望日志: Workers started: bind, analyze, retro
```

- [ ] **Step 10.3: 浏览器走完整流程**

1. 打开已完成的某 A v1 分析详情页 → 应看到底部 "📊 发后复盘" + 表单
2. 粘贴你**小号**的一个真实抖音视频链接 + 发布时间 (填一个 4 天前的)
3. 点 [保存并安排] → 应跳到 SCHEDULED 状态 + 显示 "已关联"
4. 因 publishedAt 是 4 天前,delay=0 → worker 应该立刻 pick
5. 刷新页面 → RUNNING 状态 → 等约 30-60s → COMPLETED
6. 看到 8 项实际指标表 + 4 个 AI 落差卡片 + 综合段落

- [ ] **Step 10.4: 测试 cookie 失效**

```bash
# 临时改坏 cookie
cd /Users/<your-name>/my-content
mv .auth .auth-backup
```

- 点 "立刻拉一次" → 期望 FAILED + "cookie 失效"
- 恢复 cookie: `mv .auth-backup .auth`
- 点 "重新拉取" → 重新 happy path

- [ ] **Step 10.5: 测试拒收**

```bash
# 短链失败
curl -X POST http://localhost:3000/api/v1/content/analyses/<existing-id>/publish \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/x","publishedAt":"2026-06-01T00:00:00Z"}'
# 期: 400 + "无法解析"

# 未来时间
curl -X POST http://localhost:3000/api/v1/content/analyses/<existing-id>/publish \
  -H 'content-type: application/json' \
  -d "{\"url\":\"https://www.douyin.com/video/7234567890\",\"publishedAt\":\"$(date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)\"}"
# 期: 400 + "发布时间不能在未来"
```

- [ ] **Step 10.6: DB 验证**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c \
  'SELECT a.id, a."douyinAwemeId", a."retroStatus", m.plays, m."completionRateBp"
   FROM "ContentAnalysis" a LEFT JOIN "ActualMetric" m ON m."analysisId"=a.id
   WHERE a."retroStatus" IS NOT NULL ORDER BY a."createdAt" DESC LIMIT 5;'
```

期: 看到 COMPLETED 行有 plays 和 completionRateBp。

- [ ] **Step 10.7: 跑全套自动化测试 + typecheck**

```bash
npm run typecheck && npm test
```

期: 0 错 + 全绿 (含新增 ~25 个测试)。

- [ ] **Step 10.8: 更新 README**

在 README 末尾追加:

````markdown
## Phase 3 / Direction A v2 — 发后复盘

### 前置依赖

1. **cheat-on-content** (MIT,外部 skill,提供抖音 adapter):

   ```bash
   git clone https://github.com/XBuilderLAB/cheat-on-content.git ~/cheat-on-content
   cd ~/cheat-on-content && bash install.sh
   ```

2. **内容项目目录** (持久化抖音 cookie 用):

   ```bash
   mkdir -p ~/my-content && cd ~/my-content
   python3 -m venv .venv && source .venv/bin/activate
   pip install playwright>=1.44
   playwright install chromium
   python ~/.claude/skills/cheat-on-content/adapters/perf-data/douyin-session/crawler.py login
   ```

3. **MediaPilot `.env`**:

   ```
   CHEAT_ADAPTER_PATH=/Users/<you>/.claude/skills/cheat-on-content/adapters/perf-data/douyin-session
   CHEAT_CONTENT_PROJECT_DIR=/Users/<you>/my-content
   PYTHON_BIN=python3   # 或 venv 内 python
   ```

### A v2 验收

(参见 plan task 10)
````

- [ ] **Step 10.9: Commit**

```bash
git add README.md
git commit -m "docs(phase3-v2): README — cheat-on-content 前置 + .env 三项"
```

---

## 完成标志

- ✅ Task 1–9 commit 完整
- ✅ Task 10 E2E 全过
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿
- ✅ 真小号视频跑出来:8 项指标 + 4 维度落差卡片可视

→ 进 Direction B (播放量预测 reconsider) 或 Phase 3 Dashboard 或其他。

---

## 自审记录 (writing-plans 步骤 self-review)

**Spec 覆盖**: 5 节全覆盖
- §1.2 10 项必须达成 → Task 7 (publish/retro-now + projection) + Task 6 (worker 6 阶段) + Task 9 (UI 4 状态) 全覆盖
- §3.1 schema → Task 1
- §3.2 RetroReportV1 → Task 5 (Zod) + Task 6 (worker 拼装)
- §4 关键流程 → Task 6 worker + Task 7 APIs
- §5.1 错误矩阵 → Task 7 (校验 4 case) + Task 6 (cookie/adapter/AI fail-soft)
- §5.2 测试 → 每个 lib task 自带测试; worker mock; API mock
- §5.3 UI → Task 8 + 9
- §5.4 验收 → Task 10

**Placeholder scan**: 已扫,无 TBD/TODO。Task 3 step 3.1 fixture 来自用户真实跑出来的 report.md 或合成 sample — 这是显式选项,不算 placeholder。

**Type 一致性**: `ActualMetricInput` 在 report-parser.ts (Task 3) 定义,被 prompts/retro-gap.ts (Task 5) 和 worker (Task 6) import;`RetroGapResponse` 在 prompts (Task 5) 定义,worker (Task 6) 用;命名贯穿一致。
