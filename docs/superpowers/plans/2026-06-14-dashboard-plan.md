# Phase 3 Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/dashboard` 从 Placeholder 升级为跨视频聚合看板,展示 stats / 趋势 / Calibration 矩阵 / niche 分布 / Top 表现 / Top 失误,作为 MediaPilot 区别于一般运营工具的核心差异化 (AI 预判 vs 实际 calibration 视图)。

**Architecture:** Next.js 14 client component + 单一聚合 API (`GET /api/v1/dashboard/summary`) 一次性返回 6 个 widget 数据。 Prisma 5 个并发查询 + JS 端 calibration 聚合。 0 新表 (复用 ContentAnalysis + ActualMetric JSONB)。 Recharts LineChart 已在 deps。

**Tech Stack:** Next.js 14 App Router · TypeScript · Prisma · Recharts · Tailwind · vitest

**Spec:** `docs/superpowers/specs/2026-06-14-dashboard-design.md`

**Scope** (不在本计划):
- niche / date range 筛选条 → v2
- chart 点击钻入 → v2
- 视频并排对比 → v2
- AI 周报生成 → 单独 phase
- 预估播放量 L1 prediction → 下个 task (单独 brainstorm + plan)

---

## File Structure

```
新建:
src/lib/dashboard/types.ts                              # DashboardSummary + 子类型
src/lib/dashboard/calibration.ts                        # retroReport[] → 4×4 矩阵 + insight (纯函数)
src/lib/dashboard/aggregate.ts                          # 5 并发 Prisma 查询 + 聚合
src/app/api/v1/dashboard/summary/route.ts               # GET API
src/components/dashboard/stats-bar.tsx                  # 4 数字
src/components/dashboard/empty-state.tsx                # 0 条 CTA
src/components/dashboard/overall-score-trend.tsx        # Recharts LineChart
src/components/dashboard/calibration-matrix.tsx         # 4x4 table + insight + worstBucket 高亮
src/components/dashboard/calibration-locked.tsx         # 解锁门槛提示
src/components/dashboard/niche-distribution.tsx         # 简表
src/components/dashboard/top-performers.tsx             # Top 3 by plays
src/components/dashboard/biggest-misses.tsx             # Top 3 by gap

tests/lib/dashboard/calibration.test.ts                 # 纯函数 TDD
tests/lib/dashboard/aggregate.test.ts                   # mock prisma
tests/api/dashboard/summary.test.ts                     # API 4 档稀疏状态

修改:
src/app/dashboard/page.tsx                              # 替换 Placeholder, 组装 widgets
```

---

## Test Strategy

- **纯函数** (`calibration.ts`) 100% vitest 覆盖
- **`aggregate.ts`** mock prisma, 验证 5 并发查询 + BigInt 序列化
- **API** 4 档稀疏状态 (0 / 1 / 3+ / 10+) + 错误处理
- **UI 组件** 不做单测 (Phase 1 风格); 手动 E2E 验证
- 手动 E2E: Task 9 验收清单

测试框架: vitest

---

## Git

每个 task 末尾 `git commit`,沿用 `feat(phase3-dashboard): ...` / `fix(phase3-dashboard): ...` 风格。

---

## Task 1: types.ts + calibration.ts (TDD 纯函数)

**Files:**
- Create: `src/lib/dashboard/types.ts`
- Create: `src/lib/dashboard/calibration.ts`
- Create: `tests/lib/dashboard/calibration.test.ts`

### Step 1.1: types.ts

`src/lib/dashboard/types.ts`:

```typescript
export type AccuracyVerdict = 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown';

export interface AccuracyDistribution {
  onTarget: number;
  overEstimated: number;
  underEstimated: number;
  unknown: number;
  total: number;
  worstBucket: AccuracyVerdict | null;
}

export interface CalibrationData {
  sampleCount: number;
  matrix: {
    hookGap: AccuracyDistribution;
    retentionGap: AccuracyDistribution;
    titleCaptionGap: AccuracyDistribution;
    coverGap: AccuracyDistribution;
  };
  insight: string;
}

export interface TrendPoint {
  id: string;
  videoFilename: string;
  completedAt: string;
  overallScore: number | null;
  inferredActualScore: number | null;
}

export interface NicheRow {
  niche: string;
  label: string;
  count: number;
  avgOverallScore: number | null;
}

export interface TopPerformer {
  id: string;
  videoFilename: string;
  plays: string;  // BigInt serialized
  overallScore: number | null;
}

export interface BiggestMiss {
  id: string;
  videoFilename: string;
  predicted: number;
  inferred: number;
  gap: number;  // predicted - inferred
}

export interface DashboardSummary {
  stats: {
    totalAnalyses: number;
    totalSpendUSD: number;
    last7dCount: number;
    retroedCount: number;
  };
  trend: TrendPoint[];
  calibration: CalibrationData | null;
  nicheDistribution: NicheRow[];
  topPerformers: TopPerformer[];
  biggestMisses: BiggestMiss[];
}

/**
 * retroReport JSONB shape — 跟 RetroGapResponse 一致, 这里精简到 calibration 关心的字段
 */
export interface RetroReportLike {
  hookGap?: { accuracy?: string };
  retentionGap?: { accuracy?: string };
  titleCaptionGap?: { accuracy?: string };
  coverGap?: { accuracy?: string };
  predictedOverallScore?: number | null;
  inferredActualScore?: number | null;
}
```

- [ ] **Step 1.2: 写 calibration 失败测试**

`tests/lib/dashboard/calibration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { computeCalibration, generateInsight } from '@/lib/dashboard/calibration';
import type { RetroReportLike } from '@/lib/dashboard/types';

describe('computeCalibration', () => {
  it('< 3 样本返回 null', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    expect(computeCalibration(reports)).toBeNull();
  });

  it('3+ 样本: 算 4 维度 distribution + worstBucket', () => {
    const reports: RetroReportLike[] = [
      {
        hookGap: { accuracy: 'on-target' },
        retentionGap: { accuracy: 'over-estimated' },
        titleCaptionGap: { accuracy: 'on-target' },
        coverGap: { accuracy: 'unknown' },
      },
      {
        hookGap: { accuracy: 'on-target' },
        retentionGap: { accuracy: 'over-estimated' },
        titleCaptionGap: { accuracy: 'under-estimated' },
        coverGap: { accuracy: 'on-target' },
      },
      {
        hookGap: { accuracy: 'under-estimated' },
        retentionGap: { accuracy: 'on-target' },
        titleCaptionGap: { accuracy: 'on-target' },
        coverGap: { accuracy: 'on-target' },
      },
    ];
    const result = computeCalibration(reports);
    expect(result).not.toBeNull();
    expect(result!.sampleCount).toBe(3);
    expect(result!.matrix.hookGap.onTarget).toBe(2);
    expect(result!.matrix.hookGap.underEstimated).toBe(1);
    expect(result!.matrix.hookGap.worstBucket).toBe('under-estimated');
    expect(result!.matrix.retentionGap.overEstimated).toBe(2);
    expect(result!.matrix.retentionGap.worstBucket).toBe('over-estimated');
  });

  it('缺字段算 unknown', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },  // 缺 retention/titleCaption/cover
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    const result = computeCalibration(reports);
    expect(result!.matrix.retentionGap.unknown).toBe(3);
    expect(result!.matrix.retentionGap.total).toBe(3);
  });

  it('worstBucket=null 当全部 on-target', () => {
    const reports: RetroReportLike[] = [
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
      { hookGap: { accuracy: 'on-target' } },
    ];
    const result = computeCalibration(reports);
    expect(result!.matrix.hookGap.worstBucket).toBeNull();
  });
});

describe('generateInsight', () => {
  const mkDist = (over: number, under: number, on: number, unk: number) => ({
    onTarget: on,
    overEstimated: over,
    underEstimated: under,
    unknown: unk,
    total: over + under + on + unk,
    worstBucket: null,
  });

  it('over-estimated >= 40% 触发"系统性偏乐观"', () => {
    const matrix = {
      hookGap: mkDist(0, 0, 5, 0),
      retentionGap: mkDist(3, 0, 2, 0),  // 60% over
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    const msg = generateInsight(matrix);
    expect(msg).toMatch(/完播.*偏乐观/);
  });

  it('under-estimated >= 40% 触发"系统性偏保守"', () => {
    const matrix = {
      hookGap: mkDist(0, 4, 1, 0),  // 80% under
      retentionGap: mkDist(0, 0, 5, 0),
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    const msg = generateInsight(matrix);
    expect(msg).toMatch(/钩子.*偏保守/);
  });

  it('全 on-target → 整体校准良好', () => {
    const matrix = {
      hookGap: mkDist(0, 0, 5, 0),
      retentionGap: mkDist(0, 0, 5, 0),
      titleCaptionGap: mkDist(0, 0, 5, 0),
      coverGap: mkDist(0, 0, 5, 0),
    };
    expect(generateInsight(matrix)).toMatch(/良好|整体校准/);
  });
});
```

- [ ] **Step 1.3: 跑测试验证失败**

```bash
npm test -- dashboard/calibration
```

预期: FAIL (模块不存在)。

- [ ] **Step 1.4: 实现 calibration.ts**

`src/lib/dashboard/calibration.ts`:

```typescript
import type {
  AccuracyDistribution,
  AccuracyVerdict,
  CalibrationData,
  RetroReportLike,
} from './types';

const MIN_SAMPLES = 3;

const ACCURACY_VALUES: AccuracyVerdict[] = ['on-target', 'over-estimated', 'under-estimated', 'unknown'];

const DIM_LABELS: Record<string, string> = {
  hookGap: '钩子',
  retentionGap: '完播',
  titleCaptionGap: '标题/文案',
  coverGap: '封面',
};

function emptyDist(): AccuracyDistribution {
  return {
    onTarget: 0,
    overEstimated: 0,
    underEstimated: 0,
    unknown: 0,
    total: 0,
    worstBucket: null,
  };
}

function normalize(acc: string | undefined): AccuracyVerdict {
  if (acc && (ACCURACY_VALUES as string[]).includes(acc)) return acc as AccuracyVerdict;
  return 'unknown';
}

function addToDist(dist: AccuracyDistribution, verdict: AccuracyVerdict): void {
  switch (verdict) {
    case 'on-target': dist.onTarget++; break;
    case 'over-estimated': dist.overEstimated++; break;
    case 'under-estimated': dist.underEstimated++; break;
    case 'unknown': dist.unknown++; break;
  }
  dist.total++;
}

function finalizeWorstBucket(dist: AccuracyDistribution): void {
  // 找出非 on-target 占比最高的 bucket; 若全 on-target → null
  const buckets: Array<{ key: AccuracyVerdict; count: number }> = [
    { key: 'over-estimated', count: dist.overEstimated },
    { key: 'under-estimated', count: dist.underEstimated },
    { key: 'unknown', count: dist.unknown },
  ];
  buckets.sort((a, b) => b.count - a.count);
  dist.worstBucket = buckets[0].count > 0 ? buckets[0].key : null;
}

export function computeCalibration(reports: RetroReportLike[]): CalibrationData | null {
  if (reports.length < MIN_SAMPLES) return null;

  const matrix = {
    hookGap: emptyDist(),
    retentionGap: emptyDist(),
    titleCaptionGap: emptyDist(),
    coverGap: emptyDist(),
  };

  for (const r of reports) {
    addToDist(matrix.hookGap, normalize(r.hookGap?.accuracy));
    addToDist(matrix.retentionGap, normalize(r.retentionGap?.accuracy));
    addToDist(matrix.titleCaptionGap, normalize(r.titleCaptionGap?.accuracy));
    addToDist(matrix.coverGap, normalize(r.coverGap?.accuracy));
  }

  for (const dim of Object.values(matrix)) {
    finalizeWorstBucket(dim);
  }

  return {
    sampleCount: reports.length,
    matrix,
    insight: generateInsight(matrix),
  };
}

export function generateInsight(matrix: CalibrationData['matrix']): string {
  type DimKey = keyof typeof matrix;

  // 找 over-estimated 占比最高的维度
  const overRanking = (Object.entries(matrix) as Array<[DimKey, AccuracyDistribution]>)
    .map(([dim, dist]) => ({ dim, pct: dist.total > 0 ? dist.overEstimated / dist.total : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const worst = overRanking[0];
  if (worst.pct >= 0.4) {
    return `你的"${DIM_LABELS[worst.dim]}"预测系统性偏乐观 (${Math.round(worst.pct * 100)}% 实际表现低于预期), 后续可调低评分基线。`;
  }

  // 找 under-estimated 占比最高的维度
  const underRanking = (Object.entries(matrix) as Array<[DimKey, AccuracyDistribution]>)
    .map(([dim, dist]) => ({ dim, pct: dist.total > 0 ? dist.underEstimated / dist.total : 0 }))
    .sort((a, b) => b.pct - a.pct);
  const best = underRanking[0];
  if (best.pct >= 0.4) {
    return `你的"${DIM_LABELS[best.dim]}"预测系统性偏保守 (${Math.round(best.pct * 100)}% 实际优于预期), 可放心提升评分自信。`;
  }

  return '各维度预测整体校准良好, 继续保持。';
}
```

- [ ] **Step 1.5: 跑测试验证通过**

```bash
npm test -- dashboard/calibration
```

预期: PASS (7 tests)。

- [ ] **Step 1.6: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/dashboard/types.ts src/lib/dashboard/calibration.ts tests/lib/dashboard/calibration.test.ts
git commit -m "feat(phase3-dashboard): types + calibration matrix + insight heuristic"
```

---

## Task 2: aggregate.ts (5 并发 Prisma 查询)

**Files:**
- Create: `src/lib/dashboard/aggregate.ts`
- Create: `tests/lib/dashboard/aggregate.test.ts`

- [ ] **Step 2.1: 写失败测试**

`tests/lib/dashboard/aggregate.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    count: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
    groupBy: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/llm/prompts/expert-persona', () => ({
  KNOWN_NICHES: [
    { key: 'ai-knowledge', label: 'AI 知识' },
    { key: 'entertainment', label: '娱乐 / 体育 / 影视' },
  ],
}));

import { aggregateDashboard } from '@/lib/dashboard/aggregate';

beforeEach(() => {
  vi.clearAllMocks();
  // 默认返回空, 单测各自覆盖
  prismaMock.contentAnalysis.count.mockResolvedValue(0);
  prismaMock.contentAnalysis.aggregate.mockResolvedValue({ _sum: { } });
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.groupBy.mockResolvedValue([]);
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
});

describe('aggregateDashboard', () => {
  it('0 条返回 stats=0 + trend=[] + calibration=null', async () => {
    const result = await aggregateDashboard('user1');
    expect(result.stats.totalAnalyses).toBe(0);
    expect(result.trend).toEqual([]);
    expect(result.calibration).toBeNull();
  });

  it('< 3 retro 时 calibration=null', async () => {
    prismaMock.contentAnalysis.count.mockResolvedValueOnce(5);  // total
    prismaMock.contentAnalysis.count.mockResolvedValueOnce(1);  // last 7d
    prismaMock.contentAnalysis.count.mockResolvedValueOnce(2);  // retroed
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([
        { id: 'a', videoFilename: 'x', completedAt: new Date(), report: { overallScore: 70 }, retroReport: null },
      ])
      .mockResolvedValueOnce([
        { retroReport: { hookGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' } } },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.calibration).toBeNull();
  });

  it('3+ retro 时 calibration 不为 null', async () => {
    prismaMock.contentAnalysis.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])  // trend
      .mockResolvedValueOnce([    // retro source
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'over-estimated' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'over-estimated' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
        { retroReport: { hookGap: { accuracy: 'on-target' }, retentionGap: { accuracy: 'on-target' }, titleCaptionGap: { accuracy: 'on-target' }, coverGap: { accuracy: 'on-target' } } },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.calibration).not.toBeNull();
    expect(result.calibration!.sampleCount).toBe(3);
  });

  it('plays (BigInt) 序列化为 string', async () => {
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 12345n, analysis: { id: 'a1', videoFilename: 'x.mp4', report: { overallScore: 75 } } },
    ]);
    const result = await aggregateDashboard('user1');
    expect(result.topPerformers[0].plays).toBe('12345');
    expect(typeof result.topPerformers[0].plays).toBe('string');
  });

  it('biggestMisses 按 predicted - inferred 倒序', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])  // trend
      .mockResolvedValueOnce([])  // retro source (less than 3 → null calibration)
      .mockResolvedValueOnce([    // miss candidates
        { id: 'a1', videoFilename: 'lo.mp4', retroReport: { predictedOverallScore: 90, inferredActualScore: 50 } },
        { id: 'a2', videoFilename: 'hi.mp4', retroReport: { predictedOverallScore: 60, inferredActualScore: 55 } },
        { id: 'a3', videoFilename: 'mid.mp4', retroReport: { predictedOverallScore: 80, inferredActualScore: 30 } },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.biggestMisses).toHaveLength(3);
    expect(result.biggestMisses[0].id).toBe('a3');  // gap 50
    expect(result.biggestMisses[0].gap).toBe(50);
    expect(result.biggestMisses[1].id).toBe('a1');  // gap 40
    expect(result.biggestMisses[2].id).toBe('a2');  // gap 5
  });

  it('niche label 来自 KNOWN_NICHES, 未知 niche 用原字符串', async () => {
    prismaMock.contentAnalysis.groupBy.mockResolvedValueOnce([
      { niche: 'ai-knowledge', _count: { _all: 5 }, _avg: {} },
      { niche: 'custom-fitness', _count: { _all: 2 }, _avg: {} },
    ]);
    const result = await aggregateDashboard('user1');
    expect(result.nicheDistribution[0].label).toBe('AI 知识');
    expect(result.nicheDistribution[1].label).toBe('custom-fitness');
  });
});
```

- [ ] **Step 2.2: 跑测试验证失败**

```bash
npm test -- dashboard/aggregate
```

预期: FAIL。

- [ ] **Step 2.3: 实现 aggregate.ts**

`src/lib/dashboard/aggregate.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';
import { computeCalibration } from './calibration';
import type {
  DashboardSummary,
  RetroReportLike,
  TrendPoint,
  NicheRow,
  TopPerformer,
  BiggestMiss,
} from './types';

const TREND_LIMIT = 10;
const TOP_LIMIT = 3;

const nicheLabelMap = new Map(KNOWN_NICHES.map((n) => [n.key, n.label]));

function labelForNiche(niche: string): string {
  return nicheLabelMap.get(niche) ?? niche;
}

export async function aggregateDashboard(userId: string): Promise<DashboardSummary> {
  const last7dCutoff = new Date(Date.now() - 7 * 86400_000);

  const [
    totalAnalyses,
    last7dCount,
    retroedCount,
    spendAgg,
    trendRows,
    retroSourceRows,
    nicheRows,
    topPerformerRows,
    missCandidateRows,
  ] = await Promise.all([
    prisma.contentAnalysis.count({ where: { userId } }),
    prisma.contentAnalysis.count({ where: { userId, createdAt: { gte: last7dCutoff } } }),
    prisma.contentAnalysis.count({ where: { userId, retroStatus: 'COMPLETED' } }),
    prisma.contentAnalysis.aggregate({
      where: { userId },
      _sum: {},  // estCostUSD 在 JSONB 里, Prisma 不直接 sum; 走 raw 算
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: TREND_LIMIT,
      select: {
        id: true,
        videoFilename: true,
        completedAt: true,
        report: true,
        retroReport: true,
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, retroStatus: 'COMPLETED' },
      select: { retroReport: true },
    }),
    prisma.contentAnalysis.groupBy({
      by: ['niche'],
      where: { userId, status: 'COMPLETED' },
      _count: { _all: true },
    }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId } },
      orderBy: { plays: 'desc' },
      take: TOP_LIMIT,
      select: {
        plays: true,
        analysis: {
          select: { id: true, videoFilename: true, report: true },
        },
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId, retroStatus: 'COMPLETED', retroReport: { not: null } },
      select: { id: true, videoFilename: true, retroReport: true },
    }),
  ]);

  // ---- stats: 走 raw SQL 算 totalSpendUSD (JSONB) ----
  const spendRaw = await prisma.$queryRaw<{ total: number | null }[]>`
    SELECT COALESCE(SUM(("llmUsage"->'total'->>'estCostUSD')::float), 0)::float AS total
    FROM "ContentAnalysis" WHERE "userId" = ${userId}
  `;
  const totalSpendUSD = spendRaw[0]?.total ?? 0;

  // ---- trend (按 asc by completedAt 给前端图表用) ----
  const trend: TrendPoint[] = trendRows
    .map((r) => ({
      id: r.id,
      videoFilename: r.videoFilename,
      completedAt: r.completedAt!.toISOString(),
      overallScore: (r.report as any)?.overallScore ?? null,
      inferredActualScore: (r.retroReport as any)?.inferredActualScore ?? null,
    }))
    .reverse();

  // ---- calibration ----
  const retroReports: RetroReportLike[] = retroSourceRows
    .map((r) => r.retroReport as RetroReportLike | null)
    .filter((r): r is RetroReportLike => r !== null);
  const calibration = computeCalibration(retroReports);

  // ---- niche distribution: count + avg overallScore ----
  // groupBy 不支持 JSONB avg → 单独算
  const nicheDistribution: NicheRow[] = await Promise.all(
    nicheRows.map(async (row) => {
      const avgRaw = await prisma.$queryRaw<{ avg: number | null }[]>`
        SELECT AVG(("report"->>'overallScore')::float)::float AS avg
        FROM "ContentAnalysis"
        WHERE "userId" = ${userId} AND "status" = 'COMPLETED' AND "niche" = ${row.niche}
      `;
      return {
        niche: row.niche,
        label: labelForNiche(row.niche),
        count: row._count._all,
        avgOverallScore: avgRaw[0]?.avg ?? null,
      };
    })
  );
  nicheDistribution.sort((a, b) => b.count - a.count);

  // ---- topPerformers ----
  const topPerformers: TopPerformer[] = topPerformerRows.map((r) => ({
    id: r.analysis.id,
    videoFilename: r.analysis.videoFilename,
    plays: r.plays.toString(),  // BigInt → string
    overallScore: (r.analysis.report as any)?.overallScore ?? null,
  }));

  // ---- biggestMisses: 算 predicted - inferred, 取 top 3 ----
  const missesAll: BiggestMiss[] = missCandidateRows
    .map((r) => {
      const rr = r.retroReport as any;
      const predicted = rr?.predictedOverallScore;
      const inferred = rr?.inferredActualScore;
      if (typeof predicted !== 'number' || typeof inferred !== 'number') return null;
      return {
        id: r.id,
        videoFilename: r.videoFilename,
        predicted,
        inferred,
        gap: predicted - inferred,
      };
    })
    .filter((m): m is BiggestMiss => m !== null && m.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, TOP_LIMIT);

  return {
    stats: {
      totalAnalyses,
      totalSpendUSD,
      last7dCount,
      retroedCount,
    },
    trend,
    calibration,
    nicheDistribution,
    topPerformers,
    biggestMisses: missesAll,
  };
}
```

- [ ] **Step 2.4: 跑测试验证通过**

```bash
npm test -- dashboard/aggregate
```

预期: PASS (6 tests)。

- [ ] **Step 2.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/dashboard/aggregate.ts tests/lib/dashboard/aggregate.test.ts
git commit -m "feat(phase3-dashboard): aggregate — 5 concurrent prisma queries + BigInt serialize"
```

---

## Task 3: API `GET /api/v1/dashboard/summary`

**Files:**
- Create: `src/app/api/v1/dashboard/summary/route.ts`
- Create: `tests/api/dashboard/summary.test.ts`

- [ ] **Step 3.1: 写测试**

`tests/api/dashboard/summary.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

vi.mock('@/lib/dashboard/aggregate', () => ({
  aggregateDashboard: vi.fn(async (userId: string) => ({
    stats: { totalAnalyses: 5, totalSpendUSD: 0.42, last7dCount: 2, retroedCount: 3 },
    trend: [],
    calibration: null,
    nicheDistribution: [],
    topPerformers: [],
    biggestMisses: [],
  })),
}));

import { GET } from '@/app/api/v1/dashboard/summary/route';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/dashboard/summary', () => {
  it('返回 DashboardSummary', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.stats.totalAnalyses).toBe(5);
  });

  it('aggregate 抛错 → 500', async () => {
    const { aggregateDashboard } = await import('@/lib/dashboard/aggregate');
    (aggregateDashboard as any).mockRejectedValueOnce(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/db down|失败/);
  });
});
```

- [ ] **Step 3.2: 跑测试验证失败**

```bash
npm test -- dashboard/summary
```

预期: FAIL。

- [ ] **Step 3.3: 实现**

`src/app/api/v1/dashboard/summary/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { aggregateDashboard } from '@/lib/dashboard/aggregate';

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser();
    const summary = await aggregateDashboard(user.id);
    return ok(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`dashboard 加载失败: ${msg}`, 500);
  }
}
```

- [ ] **Step 3.4: 跑测试验证通过**

```bash
npm test -- dashboard/summary
```

预期: PASS (2 tests)。

- [ ] **Step 3.5: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 3.6: Commit**

```bash
git add src/app/api/v1/dashboard/summary/route.ts tests/api/dashboard/summary.test.ts
git commit -m "feat(phase3-dashboard): GET /api/v1/dashboard/summary"
```

---

## Task 4: StatsBar + EmptyState 组件

**Files:**
- Create: `src/components/dashboard/stats-bar.tsx`
- Create: `src/components/dashboard/empty-state.tsx`

无单测 (UI 简单)。

- [ ] **Step 4.1: stats-bar.tsx**

`src/components/dashboard/stats-bar.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';

interface Stats {
  totalAnalyses: number;
  totalSpendUSD: number;
  last7dCount: number;
  retroedCount: number;
}

export function StatsBar({ stats }: { stats: Stats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat emoji="📊" label="总分析" value={stats.totalAnalyses.toLocaleString()} />
      <Stat emoji="💰" label="总花费" value={`$${stats.totalSpendUSD.toFixed(3)}`} />
      <Stat emoji="📅" label="7 天上传" value={stats.last7dCount.toLocaleString()} />
      <Stat emoji="🔄" label="已复盘" value={stats.retroedCount.toLocaleString()} />
    </div>
  );
}

function Stat({ emoji, label, value }: { emoji: string; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-6">
        <div className="text-xs text-muted-foreground">{emoji} {label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4.2: empty-state.tsx**

`src/components/dashboard/empty-state.tsx`:

```typescript
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-muted/30 py-20 text-center">
      <div className="text-5xl">📊</div>
      <h2 className="mt-4 text-xl font-semibold">还没有分析数据</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        上传第一个视频, 让 AI 帮你诊断钩子 / 完播 / 标题 / 封面
      </p>
      <Link href="/content/preflight/new" className="mt-6">
        <Button size="lg">+ 新分析</Button>
      </Link>
    </div>
  );
}
```

- [ ] **Step 4.3: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 4.4: Commit**

```bash
git add src/components/dashboard/stats-bar.tsx src/components/dashboard/empty-state.tsx
git commit -m "feat(phase3-dashboard): StatsBar + EmptyState components"
```

---

## Task 5: OverallScoreTrend (Recharts LineChart)

**Files:**
- Create: `src/components/dashboard/overall-score-trend.tsx`

- [ ] **Step 5.1: 实现**

`src/components/dashboard/overall-score-trend.tsx`:

```typescript
'use client';
import { Card, CardContent } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';

interface TrendPoint {
  id: string;
  videoFilename: string;
  completedAt: string;
  overallScore: number | null;
  inferredActualScore: number | null;
}

function formatXLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function OverallScoreTrend({ trend }: { trend: TrendPoint[] }) {
  const chartData = trend.map((p) => ({
    label: formatXLabel(p.completedAt),
    filename: p.videoFilename,
    overallScore: p.overallScore,
    inferredActualScore: p.inferredActualScore,
  }));

  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">📈 overallScore 趋势</h3>
          <div className="text-xs text-muted-foreground">最近 {trend.length} 条</div>
        </div>
        {trend.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">还没有完成的分析</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis dataKey="label" stroke="#888" fontSize={12} />
                <YAxis domain={[0, 100]} stroke="#888" fontSize={12} />
                <Tooltip
                  formatter={(value: number | null) => (value === null ? '—' : value)}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.filename ?? ''}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Line
                  type="monotone"
                  dataKey="overallScore"
                  name="预判 overallScore"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="inferredActualScore"
                  name="实测推算"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5.2: typecheck**

```bash
npm run typecheck
```

预期: 0 错。 (Recharts 已在 deps, 类型 OK)

- [ ] **Step 5.3: Commit**

```bash
git add src/components/dashboard/overall-score-trend.tsx
git commit -m "feat(phase3-dashboard): OverallScoreTrend Recharts LineChart"
```

---

## Task 6: CalibrationMatrix + CalibrationLocked

**Files:**
- Create: `src/components/dashboard/calibration-matrix.tsx`
- Create: `src/components/dashboard/calibration-locked.tsx`

- [ ] **Step 6.1: calibration-locked.tsx**

`src/components/dashboard/calibration-locked.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';

export function CalibrationLocked({ sampleCount }: { sampleCount: number }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">🎯 AI 预判校准 (锁定中)</h3>
        <p className="text-sm text-muted-foreground">
          需要 ≥ 3 条 v2 复盘数据才能解锁。 你当前有 <b>{sampleCount}</b> 条已复盘。
        </p>
        <p className="text-xs text-muted-foreground">
          复盘 = 视频发到抖音后, 粘贴链接让 MediaPilot 拉真实播放数据, AI 自动算落差。
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6.2: calibration-matrix.tsx**

`src/components/dashboard/calibration-matrix.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CalibrationData, AccuracyVerdict } from '@/lib/dashboard/types';

const DIM_LABELS: Array<{ key: keyof CalibrationData['matrix']; label: string; emoji: string }> = [
  { key: 'hookGap', label: '钩子', emoji: '🪝' },
  { key: 'retentionGap', label: '完播', emoji: '⏱' },
  { key: 'titleCaptionGap', label: '标题/文案', emoji: '📝' },
  { key: 'coverGap', label: '封面', emoji: '🖼' },
];

function pct(count: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((count / total) * 100)}%`;
}

function cellClass(verdict: AccuracyVerdict, isWorst: boolean): string {
  if (isWorst) return 'bg-destructive/10 border border-destructive/40 font-semibold';
  if (verdict === 'on-target') return 'text-green-700';
  return 'text-muted-foreground';
}

export function CalibrationMatrix({ data }: { data: CalibrationData }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🎯 AI 预判校准</h3>
          <div className="text-xs text-muted-foreground">基于 {data.sampleCount} 条复盘</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">维度</th>
                <th className="py-2">✓ on-target</th>
                <th className="py-2">⚠ over</th>
                <th className="py-2">⚠ under</th>
                <th className="py-2">? unknown</th>
              </tr>
            </thead>
            <tbody>
              {DIM_LABELS.map(({ key, label, emoji }) => {
                const dist = data.matrix[key];
                return (
                  <tr key={key} className="border-b text-center">
                    <td className="py-2 text-left">{emoji} {label}</td>
                    <td className={cn('py-2', cellClass('on-target', dist.worstBucket === 'on-target'))}>
                      {pct(dist.onTarget, dist.total)} ({dist.onTarget})
                    </td>
                    <td className={cn('py-2', cellClass('over-estimated', dist.worstBucket === 'over-estimated'))}>
                      {pct(dist.overEstimated, dist.total)} ({dist.overEstimated})
                    </td>
                    <td className={cn('py-2', cellClass('under-estimated', dist.worstBucket === 'under-estimated'))}>
                      {pct(dist.underEstimated, dist.total)} ({dist.underEstimated})
                    </td>
                    <td className={cn('py-2', cellClass('unknown', dist.worstBucket === 'unknown'))}>
                      {pct(dist.unknown, dist.total)} ({dist.unknown})
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          💡 {data.insight}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6.3: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 6.4: Commit**

```bash
git add src/components/dashboard/calibration-matrix.tsx src/components/dashboard/calibration-locked.tsx
git commit -m "feat(phase3-dashboard): CalibrationMatrix + CalibrationLocked widgets"
```

---

## Task 7: NicheDistribution + TopPerformers + BiggestMisses

**Files:**
- Create: `src/components/dashboard/niche-distribution.tsx`
- Create: `src/components/dashboard/top-performers.tsx`
- Create: `src/components/dashboard/biggest-misses.tsx`

- [ ] **Step 7.1: niche-distribution.tsx**

`src/components/dashboard/niche-distribution.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';
import type { NicheRow } from '@/lib/dashboard/types';

export function NicheDistribution({ rows }: { rows: NicheRow[] }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">📂 内容垂类</h3>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">无数据</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">垂类</th>
                <th className="py-2 text-right">条数</th>
                <th className="py-2 text-right">平均分</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.niche} className="border-b">
                  <td className="py-2">{r.label}</td>
                  <td className="py-2 text-right tabular-nums">{r.count}</td>
                  <td className="py-2 text-right tabular-nums">
                    {r.avgOverallScore !== null ? Math.round(r.avgOverallScore) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7.2: top-performers.tsx**

`src/components/dashboard/top-performers.tsx`:

```typescript
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { TopPerformer } from '@/lib/dashboard/types';

function formatPlays(playsStr: string): string {
  const n = Number(playsStr);
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return n.toLocaleString();
}

export function TopPerformers({ items }: { items: TopPerformer[] }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">🏆 Top 表现</h3>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            还没有复盘数据 — 上传 + 粘贴抖音链接看真实播放
          </div>
        ) : (
          <ol className="space-y-2 text-sm">
            {items.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                <Link href={`/content/preflight/${p.id}`} className="flex-1 truncate hover:text-primary">
                  {p.videoFilename}
                </Link>
                <span className="font-semibold tabular-nums">{formatPlays(p.plays)}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7.3: biggest-misses.tsx**

`src/components/dashboard/biggest-misses.tsx`:

```typescript
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { BiggestMiss } from '@/lib/dashboard/types';

export function BiggestMisses({ items }: { items: BiggestMiss[] }) {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">📉 Top 失误 (过度乐观)</h3>
        {items.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            还没有失误数据 — 需要 ≥ 1 条复盘
          </div>
        ) : (
          <ol className="space-y-2 text-sm">
            {items.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">{i + 1}.</span>
                <Link href={`/content/preflight/${m.id}`} className="flex-1 truncate hover:text-primary">
                  {m.videoFilename}
                </Link>
                <span className="text-xs tabular-nums">
                  预 {m.predicted} → 实 {m.inferred}
                </span>
                <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive tabular-nums">
                  -{m.gap}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7.4: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 7.5: Commit**

```bash
git add src/components/dashboard/niche-distribution.tsx src/components/dashboard/top-performers.tsx src/components/dashboard/biggest-misses.tsx
git commit -m "feat(phase3-dashboard): NicheDistribution + TopPerformers + BiggestMisses widgets"
```

---

## Task 8: /dashboard/page.tsx 组装

**Files:**
- Modify: `src/app/dashboard/page.tsx` (替换 Placeholder)

- [ ] **Step 8.1: 替换 dashboard page**

`src/app/dashboard/page.tsx`:

```typescript
'use client';
import { useEffect, useState } from 'react';
import { StatsBar } from '@/components/dashboard/stats-bar';
import { EmptyState } from '@/components/dashboard/empty-state';
import { OverallScoreTrend } from '@/components/dashboard/overall-score-trend';
import { CalibrationMatrix } from '@/components/dashboard/calibration-matrix';
import { CalibrationLocked } from '@/components/dashboard/calibration-locked';
import { NicheDistribution } from '@/components/dashboard/niche-distribution';
import { TopPerformers } from '@/components/dashboard/top-performers';
import { BiggestMisses } from '@/components/dashboard/biggest-misses';
import type { DashboardSummary } from '@/lib/dashboard/types';

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/v1/dashboard/summary')
      .then((r) => r.json())
      .then((j) => {
        if (j.success) setData(j.data);
        else setError(j.message);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive">
        数据加载失败: {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">加载中...</p>;
  }

  // 0 条 — 大 CTA
  if (data.stats.totalAnalyses === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">数据总览</h1>
        <StatsBar stats={data.stats} />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">数据总览</h1>

      <StatsBar stats={data.stats} />

      <OverallScoreTrend trend={data.trend} />

      {data.calibration
        ? <CalibrationMatrix data={data.calibration} />
        : <CalibrationLocked sampleCount={data.stats.retroedCount} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <NicheDistribution rows={data.nicheDistribution} />
        <TopPerformers items={data.topPerformers} />
        <BiggestMisses items={data.biggestMisses} />
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: typecheck**

```bash
npm run typecheck
```

预期: 0 错。

- [ ] **Step 8.3: 浏览器验证**

```bash
# Dev server 应该已经跑着, 没的话起一下
# npm run dev
```

打开 `http://localhost:3000/dashboard`,应看到:
- 当前 1 条分析 → stats bar + trend (单点) + niche 表 + 锁定的 calibration
- 没崩

- [ ] **Step 8.4: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(phase3-dashboard): /dashboard page assembly with 4-tier sparse states"
```

---

## Task 9: 手动 E2E 验收

**No code changes** — 验证 4 档稀疏状态都正确。

- [ ] **Step 9.1: 当前 0 retro / 1 分析状态**

打开 `http://localhost:3000/dashboard`,期望:

- ✓ StatsBar 显示 totalAnalyses=1, 累计 spend > 0, 7 天 1, retroed 0
- ✓ overallScore 趋势图: 单点显示 (45 分,71c5b679-244)
- ✓ Calibration: 显示 `CalibrationLocked` 锁定提示 (sampleCount=0)
- ✓ Niche 表: 1 行 (AI 知识, count=1, avgScore=45)
- ✓ Top 表现: 空状态 ("还没有复盘数据")
- ✓ Top 失误: 空状态

- [ ] **Step 9.2: 加 3 条 mock retro 解锁 calibration**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
-- 插 3 个 mock COMPLETED retro analyses 
INSERT INTO \"ContentAnalysis\" (
  id, \"userId\", \"videoPath\", \"videoFilename\", \"videoSizeBytes\", \"videoDurationSec\", \"videoMimeType\",
  niche, status, \"retryCount\", report, \"llmUsage\",
  \"douyinUrl\", \"douyinAwemeId\", \"publishedAt\", \"retroStatus\", \"retroReport\",
  \"createdAt\", \"updatedAt\", \"completedAt\", \"retroCompletedAt\"
) VALUES
  ('test-d-1', 'default-user', '/x', 'mock-1.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70}'::jsonb, '{\"total\": {\"estCostUSD\": 0.05}}'::jsonb,
   'https://www.douyin.com/video/1', '1', NOW() - INTERVAL '5 days', 'COMPLETED',
   '{\"predictedOverallScore\": 70, \"inferredActualScore\": 60, \"hookGap\": {\"accuracy\": \"on-target\"}, \"retentionGap\": {\"accuracy\": \"over-estimated\"}, \"titleCaptionGap\": {\"accuracy\": \"on-target\"}, \"coverGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW() - INTERVAL '5 days', NOW(), NOW() - INTERVAL '5 days', NOW() - INTERVAL '2 days'),
  ('test-d-2', 'default-user', '/x', 'mock-2.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 80}'::jsonb, '{\"total\": {\"estCostUSD\": 0.05}}'::jsonb,
   'https://www.douyin.com/video/2', '2', NOW() - INTERVAL '4 days', 'COMPLETED',
   '{\"predictedOverallScore\": 80, \"inferredActualScore\": 40, \"hookGap\": {\"accuracy\": \"over-estimated\"}, \"retentionGap\": {\"accuracy\": \"over-estimated\"}, \"titleCaptionGap\": {\"accuracy\": \"on-target\"}, \"coverGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW() - INTERVAL '4 days', NOW(), NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
  ('test-d-3', 'default-user', '/x', 'mock-3.mp4', 1, 30, 'video/mp4', 'entertainment', 'COMPLETED', 0,
   '{\"overallScore\": 60}'::jsonb, '{\"total\": {\"estCostUSD\": 0.05}}'::jsonb,
   'https://www.douyin.com/video/3', '3', NOW() - INTERVAL '3 days', 'COMPLETED',
   '{\"predictedOverallScore\": 60, \"inferredActualScore\": 65, \"hookGap\": {\"accuracy\": \"under-estimated\"}, \"retentionGap\": {\"accuracy\": \"on-target\"}, \"titleCaptionGap\": {\"accuracy\": \"on-target\"}, \"coverGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW() - INTERVAL '3 days', NOW(), NOW() - INTERVAL '3 days', NOW()),
  ('test-d-4', 'default-user', '/x', 'mock-4.mp4', 1, 30, 'video/mp4', 'food', 'COMPLETED', 0,
   '{\"overallScore\": 50}'::jsonb, '{\"total\": {\"estCostUSD\": 0.05}}'::jsonb, null, null, null, null, null,
   NOW() - INTERVAL '2 days', NOW(), NOW() - INTERVAL '2 days', null)
;

INSERT INTO \"ActualMetric\" (id, \"analysisId\", \"daysAfterPublish\", source, plays, likes, comments, shares, collects, \"likeRateBp\", \"commentRateBp\", \"shareRateBp\", \"completionRateBp\")
VALUES
  ('m-d-1', 'test-d-1', 3.0, 'douyin-creator-center', 5000, 100, 20, 5, 30, 200, 40, 10, 3500),
  ('m-d-2', 'test-d-2', 3.0, 'douyin-creator-center', 1500, 30, 5, 1, 8, 200, 33, 7, 2200),
  ('m-d-3', 'test-d-3', 3.0, 'douyin-creator-center', 8000, 250, 40, 12, 60, 312, 50, 15, 4100);
"
```

刷新 `/dashboard`,期望:

- ✓ StatsBar: totalAnalyses=5, retroed=3
- ✓ overallScore 趋势: 多点
- ✓ Calibration: **矩阵显示** (sampleCount=3)
  - retentionGap 的 over-estimated 行高亮 (worstBucket)
  - insight 文案: "完播 预测系统性偏乐观 (67%...)"
- ✓ Niche 表: 3 行 (AI 知识 3, 娱乐 1, 美食 1) 按 count desc
- ✓ Top 表现: 3 条 (test-d-3 8000 plays 第一)
- ✓ Top 失误: test-d-2 (gap 40), test-d-1 (gap 10)

- [ ] **Step 9.3: 错误注入测试**

```bash
docker compose stop postgres
sleep 2
```

刷新 `/dashboard`,期望显示红色 error banner "数据加载失败: ..."

```bash
docker compose start postgres
sleep 3
```

刷新 → 正常恢复。

- [ ] **Step 9.4: 清理 mock 数据**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
DELETE FROM \"ActualMetric\" WHERE id LIKE 'm-d-%';
DELETE FROM \"ContentAnalysis\" WHERE id LIKE 'test-d-%';"
```

- [ ] **Step 9.5: 跑全测试**

```bash
npm run typecheck && npm test
```

预期: 0 typecheck errors, 全部测试通过 (122 + 15 新增 ≈ 137)。

- [ ] **Step 9.6: Commit (如果需要清理或微调)**

```bash
git status
# 如果有 untracked / changes
git add -A && git commit -m "chore(phase3-dashboard): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1–8 commit 完整
- ✅ Task 9 E2E 4 档稀疏状态 + 错误注入 全过
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿
- ✅ 浏览器 `/dashboard` 可视且正确

→ 可以转 L1 prediction (预估播放区间) 或其他下一段方向

---

## 自审记录 (writing-plans 步骤 self-review)

**Spec 覆盖**: 7 节全覆盖
- §1.2 8 项必须达成 → Task 1 (calibration) + Task 2 (aggregate) + Task 3 (API) + Tasks 4-7 (widgets) + Task 8 (page assembly)
- §2 架构 → Task 2 (5 并发查询) + Task 3 (单一 API)
- §3 数据模型 (DashboardSummary 类型) → Task 1 types.ts
- §3.3 insight 启发式 → Task 1 generateInsight
- §4 关键流程 → Task 8 page assembly + 4 档稀疏分支
- §5.1 错误矩阵 → Task 3 API error handling + Task 8 error banner + Task 9 错误注入验证
- §5.4 验收 → Task 9 全套

**Placeholder scan**: 无 TBD/TODO/"add appropriate". 完整。

**Type 一致性**: `DashboardSummary` / `AccuracyDistribution` / `CalibrationData` / `TrendPoint` / `NicheRow` / `TopPerformer` / `BiggestMiss` 在 types.ts 定义后, aggregate.ts、API、widgets、page 一致使用。 命名贯穿,无冲突。
