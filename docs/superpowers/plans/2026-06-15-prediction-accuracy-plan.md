# Prediction Accuracy Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard 加 "L1 预测精度" widget (3-stat 概要 + 最近 5 条明细表), 复用现有 `report.predictedPlaysRange` × `ActualMetric.plays`, 零 schema 变更。

**Architecture:** 1 个纯函数文件 (verdictOf + deltaPct, TDD) + aggregate.ts 加并发查询并算 verdict + 2 个 UI 组件 (主 + locked) + dashboard 页插入。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + vitest

**Spec:** `docs/superpowers/specs/2026-06-15-prediction-accuracy-design.md`

**Scope** (不在本计划):
- Scatter plot 视图 (v3)
- 钻入单条预测详情页 (v3)
- 用 accuracy 反推 score multiplier 调参 (v3)

---

## File Structure

```
新建:
src/lib/dashboard/prediction-accuracy.ts                  # verdictOf + deltaPct 纯函数
src/components/dashboard/prediction-accuracy.tsx          # 主 widget (3-stat + 表)
src/components/dashboard/prediction-accuracy-locked.tsx   # Locked 态
tests/lib/dashboard/prediction-accuracy.test.ts          # verdictOf + deltaPct TDD

修改:
src/lib/dashboard/types.ts                                # 加 PredictionVerdict, PredictionAccuracyEntry, PredictionAccuracySummary
src/lib/dashboard/aggregate.ts                            # JOIN query + JS verdict + 填 predictionAccuracy
tests/lib/dashboard/aggregate.test.ts                     # 加 2 个 it 验证 predictionAccuracy 形状
src/app/dashboard/page.tsx                                # 插入 widget 在 CalibrationMatrix 后, 3-col grid 前
```

---

## Test Strategy

- **纯函数** (verdictOf / deltaPct) 100% vitest 覆盖, 6 个 case (3 主分支 + 2 边界 + 除零)
- **`aggregate.ts`** mock prisma, 加 2 个 it() 验证 predictionAccuracy (有数据 / 全无)
- **UI 组件** 不写单测, 走手动 E2E

测试框架: vitest

---

## Git

每 task 末尾 commit。 前缀: `feat(prediction-accuracy): ...` / `fix(prediction-accuracy): ...`。

---

## Task 1: types + prediction-accuracy.ts (TDD 纯函数)

**Files:**
- Modify: `src/lib/dashboard/types.ts` (加 3 个类型)
- Create: `src/lib/dashboard/prediction-accuracy.ts`
- Create: `tests/lib/dashboard/prediction-accuracy.test.ts`

### Step 1.1 — Extend types.ts

打开 `src/lib/dashboard/types.ts`, 在文件末尾追加:

```typescript
export type PredictionVerdict = 'in-range' | 'over' | 'under';

export interface PredictionAccuracyEntry {
  id: string;
  videoFilename: string;
  completedAt: string;
  predicted: number;
  lower: number;
  upper: number;
  actual: number;
  verdict: PredictionVerdict;
  deltaPct: number;
}

export interface PredictionAccuracySummary {
  totalSamples: number;
  inRangeCount: number;
  overCount: number;
  underCount: number;
  recent: PredictionAccuracyEntry[];
}
```

然后, 找到 `DashboardSummary` interface, 在末尾(`biggestMisses` 之后)加一行:

```typescript
  predictionAccuracy: PredictionAccuracySummary | null;
```

完整 DashboardSummary 应该长这样 (供对照):

```typescript
export interface DashboardSummary {
  stats: { ... };
  trend: TrendPoint[];
  calibration: CalibrationData | null;
  nicheDistribution: NicheRow[];
  topPerformers: TopPerformer[];
  biggestMisses: BiggestMiss[];
  predictionAccuracy: PredictionAccuracySummary | null;  // 新增
}
```

### Step 1.2 — Failing tests

Write `tests/lib/dashboard/prediction-accuracy.test.ts` with EXACTLY:

```typescript
import { describe, expect, it } from 'vitest';
import { verdictOf, deltaPct } from '@/lib/dashboard/prediction-accuracy';

describe('verdictOf', () => {
  const range = { predicted: 2000, lower: 1000, upper: 4000 };

  it('actual 在中心 → in-range', () => {
    expect(verdictOf(2000, range)).toBe('in-range');
  });
  it('actual < lower → over (AI 偏乐观)', () => {
    expect(verdictOf(500, range)).toBe('over');
  });
  it('actual > upper → under (AI 偏保守)', () => {
    expect(verdictOf(8000, range)).toBe('under');
  });
  it('actual == lower → in-range (包含下界)', () => {
    expect(verdictOf(1000, range)).toBe('in-range');
  });
  it('actual == upper → in-range (包含上界)', () => {
    expect(verdictOf(4000, range)).toBe('in-range');
  });
  it('actual = lower - 1 → over', () => {
    expect(verdictOf(999, range)).toBe('over');
  });
  it('actual = upper + 1 → under', () => {
    expect(verdictOf(4001, range)).toBe('under');
  });
});

describe('deltaPct', () => {
  it('actual=2000, predicted=2000 → 0', () => {
    expect(deltaPct(2000, 2000)).toBe(0);
  });
  it('actual=500, predicted=2000 → 75 (|500-2000|/2000)', () => {
    expect(deltaPct(500, 2000)).toBe(75);
  });
  it('actual=8000, predicted=2000 → 300', () => {
    expect(deltaPct(8000, 2000)).toBe(300);
  });
  it('predicted=0 → 0 (除零保护)', () => {
    expect(deltaPct(500, 0)).toBe(0);
  });
  it('predicted<0 (极端) → 0', () => {
    expect(deltaPct(500, -1)).toBe(0);
  });
});
```

### Step 1.3 — Run test (expect FAIL)

```bash
npm test -- prediction-accuracy
```

Expected: FAIL (module not found).

### Step 1.4 — Implement prediction-accuracy.ts

Write `src/lib/dashboard/prediction-accuracy.ts` with EXACTLY:

```typescript
import type { PredictionVerdict } from './types';

export function verdictOf(
  actual: number,
  range: { predicted: number; lower: number; upper: number }
): PredictionVerdict {
  if (actual < range.lower) return 'over';
  if (actual > range.upper) return 'under';
  return 'in-range';
}

export function deltaPct(actual: number, predicted: number): number {
  if (predicted <= 0) return 0;
  return Math.round((Math.abs(actual - predicted) / predicted) * 100);
}
```

### Step 1.5 — Run test (expect PASS)

```bash
npm test -- prediction-accuracy
```

Expected: PASS (12 tests).

### Step 1.6 — Typecheck

**Note:** typecheck will report `DashboardSummary.predictionAccuracy` not provided by `aggregate.ts` consumers. The aggregate change is in Task 2; this is expected.

```bash
npm run typecheck
```

Expected: errors only related to `aggregate.ts` (or its tests) about the new field. Report exact error to confirm; do not try to fix in this task.

### Step 1.7 — Commit

```bash
git add src/lib/dashboard/types.ts src/lib/dashboard/prediction-accuracy.ts tests/lib/dashboard/prediction-accuracy.test.ts
git commit -m "feat(prediction-accuracy): types + verdictOf / deltaPct pure functions"
```

---

## Task 2: aggregate.ts 集成 + 测试

**Files:**
- Modify: `src/lib/dashboard/aggregate.ts`
- Modify: `tests/lib/dashboard/aggregate.test.ts`

### Step 2.1 — Modify aggregate.ts

打开 `src/lib/dashboard/aggregate.ts`。

**2.1a — Add imports** (在文件顶部 imports 区, 与现有 dashboard imports 紧邻):

```typescript
import { verdictOf, deltaPct } from './prediction-accuracy';
import type { PredictionAccuracyEntry, PredictionAccuracySummary } from './types';
```

**2.1b — Add 1 query to Promise.all**

在现有 8-item Promise.all 内, 在 missCandidateRows 之后追加一项:

```typescript
    prisma.contentAnalysis.findMany({
      where: { userId, status: 'COMPLETED' },
      select: {
        id: true,
        videoFilename: true,
        completedAt: true,
        report: true,
        actualMetrics: {
          select: { plays: true },
          orderBy: { snapshotAt: 'desc' },
          take: 1,
        },
      },
    }),
```

更新 destructuring (加 `predictionAccuracyRows`):

```typescript
const [
  totalAnalyses,
  last7dCount,
  retroedCount,
  trendRows,
  retroSourceRows,
  nicheRows,
  topPerformerRows,
  missCandidateRows,
  predictionAccuracyRows,
] = await Promise.all([
```

**2.1c — Compute predictionAccuracy after the Promise.all (before return)**

在 return statement 之前加这段:

```typescript
  // ---- predictionAccuracy: JOIN report.predictedPlaysRange × ActualMetric.plays ----
  const predictionAccuracyEntries: PredictionAccuracyEntry[] = predictionAccuracyRows
    .map((r) => {
      const range = (r.report as any)?.predictedPlaysRange as
        | { predicted: number; lower: number; upper: number }
        | undefined;
      const metric = r.actualMetrics[0];
      if (!range || !metric) return null;
      const actual = Number(metric.plays);
      return {
        id: r.id,
        videoFilename: r.videoFilename,
        completedAt: r.completedAt!.toISOString(),
        predicted: range.predicted,
        lower: range.lower,
        upper: range.upper,
        actual,
        verdict: verdictOf(actual, range),
        deltaPct: deltaPct(actual, range.predicted),
      };
    })
    .filter((e): e is PredictionAccuracyEntry => e !== null);

  const predictionAccuracy: PredictionAccuracySummary | null =
    predictionAccuracyEntries.length === 0
      ? null
      : {
          totalSamples: predictionAccuracyEntries.length,
          inRangeCount: predictionAccuracyEntries.filter((e) => e.verdict === 'in-range').length,
          overCount: predictionAccuracyEntries.filter((e) => e.verdict === 'over').length,
          underCount: predictionAccuracyEntries.filter((e) => e.verdict === 'under').length,
          recent: [...predictionAccuracyEntries]
            .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
            .slice(0, 5),
        };
```

**2.1d — 加到 return**

在现有 `return { ... }` 对象末尾加一行:

```typescript
    predictionAccuracy,
```

完整 return 应当包含:

```typescript
  return {
    stats: { totalAnalyses, totalSpendUSD, last7dCount, retroedCount },
    trend,
    calibration,
    nicheDistribution,
    topPerformers,
    biggestMisses: missesAll,
    predictionAccuracy,
  };
```

### Step 2.2 — Modify aggregate.test.ts

打开 `tests/lib/dashboard/aggregate.test.ts`。

**2.2a — Update prismaMock setup** (顶部 `vi.hoisted` 块) — `actualMetric` 已存在, 不动。 现有的 `findMany` mock list 不需要扩展, 但每个 it 会用第 4 个 `prisma.contentAnalysis.findMany` mock (predictionAccuracyRows)。 用 mockResolvedValueOnce 序列方式注入。

**2.2b — 加 2 个新 it()** in `describe('aggregateDashboard', ...)`:

```typescript
  it('predictionAccuracy: 1 in-range + 1 over 时正确 (有 prediction 和 retro)', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])  // trendRows
      .mockResolvedValueOnce([])  // retroSourceRows
      .mockResolvedValueOnce([])  // missCandidateRows
      .mockResolvedValueOnce([    // predictionAccuracyRows
        {
          id: 'a-in',
          videoFilename: 'in.mp4',
          completedAt: new Date('2026-06-10T00:00:00Z'),
          report: { predictedPlaysRange: { predicted: 1000, lower: 500, upper: 2000 } },
          actualMetrics: [{ plays: 1200n }],
        },
        {
          id: 'a-over',
          videoFilename: 'over.mp4',
          completedAt: new Date('2026-06-09T00:00:00Z'),
          report: { predictedPlaysRange: { predicted: 2000, lower: 1000, upper: 4000 } },
          actualMetrics: [{ plays: 500n }],
        },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.predictionAccuracy).not.toBeNull();
    expect(result.predictionAccuracy!.totalSamples).toBe(2);
    expect(result.predictionAccuracy!.inRangeCount).toBe(1);
    expect(result.predictionAccuracy!.overCount).toBe(1);
    expect(result.predictionAccuracy!.underCount).toBe(0);
    expect(result.predictionAccuracy!.recent).toHaveLength(2);
    expect(result.predictionAccuracy!.recent[0].id).toBe('a-in');  // newer first
  });

  it('predictionAccuracy=null 当无 prediction-retro 配对', async () => {
    prismaMock.contentAnalysis.findMany
      .mockResolvedValueOnce([])  // trendRows
      .mockResolvedValueOnce([])  // retroSourceRows
      .mockResolvedValueOnce([])  // missCandidateRows
      .mockResolvedValueOnce([    // predictionAccuracyRows: 有 report 但没 actualMetrics
        {
          id: 'a-no-retro',
          videoFilename: 'x.mp4',
          completedAt: new Date(),
          report: { predictedPlaysRange: { predicted: 1000, lower: 500, upper: 2000 } },
          actualMetrics: [],
        },
      ]);
    const result = await aggregateDashboard('user1');
    expect(result.predictionAccuracy).toBeNull();
  });
```

### Step 2.3 — Run tests

```bash
npm test -- dashboard/aggregate
```

Expected: 6 + 2 = 8 tests PASS。 还有 `prediction-accuracy` 12 tests 也应 pass。

### Step 2.4 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors。

### Step 2.5 — Commit

```bash
git add src/lib/dashboard/aggregate.ts tests/lib/dashboard/aggregate.test.ts
git commit -m "feat(prediction-accuracy): aggregate — JOIN-based prediction × actual computation"
```

---

## Task 3: PredictionAccuracy + Locked 组件

**Files:**
- Create: `src/components/dashboard/prediction-accuracy.tsx`
- Create: `src/components/dashboard/prediction-accuracy-locked.tsx`

### Step 3.1 — prediction-accuracy-locked.tsx

Write `src/components/dashboard/prediction-accuracy-locked.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';

export function PredictionAccuracyLocked() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        <h3 className="font-semibold">🎯 L1 预测精度 (锁定中)</h3>
        <p className="text-sm text-muted-foreground">
          需要 ≥ 1 条 &ldquo;有预测的复盘&rdquo; 才能解锁。 你当前: 0 条。
        </p>
        <p className="text-xs text-muted-foreground">
          预测 = 上传时 L1 算出的播放区间。 复盘 = 视频发布后, 粘抖音 URL 拉真实数据。
        </p>
      </CardContent>
    </Card>
  );
}
```

### Step 3.2 — prediction-accuracy.tsx

Write `src/components/dashboard/prediction-accuracy.tsx`:

```typescript
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPlays } from '@/lib/prediction/formula';
import type { PredictionAccuracySummary, PredictionAccuracyEntry } from '@/lib/dashboard/types';

const VERDICT_BADGE: Record<
  PredictionAccuracyEntry['verdict'],
  { label: (delta: number) => string; cls: string }
> = {
  'in-range': {
    label: () => '准',
    cls: 'bg-green-100 text-green-900',
  },
  over: {
    label: (delta) => `偏高 -${delta}%`,
    cls: 'bg-red-100 text-red-900',
  },
  under: {
    label: (delta) => `偏低 +${delta}%`,
    cls: 'bg-blue-100 text-blue-900',
  },
};

export function PredictionAccuracy({ data }: { data: PredictionAccuracySummary }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">🎯 L1 预测精度</h3>
          <div className="text-xs text-muted-foreground">基于 {data.totalSamples} 条复盘</div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat emoji="✓" label="准" count={data.inRangeCount} cls="bg-green-100 text-green-900" />
          <Stat emoji="⚠" label="偏高" count={data.overCount} cls="bg-red-100 text-red-900" />
          <Stat emoji="⚠" label="偏低" count={data.underCount} cls="bg-blue-100 text-blue-900" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-2 text-left">视频</th>
                <th className="py-2 text-right">预测</th>
                <th className="py-2 text-right">实际</th>
                <th className="py-2 text-right">落差</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((row) => {
                const badge = VERDICT_BADGE[row.verdict];
                return (
                  <tr key={row.id} className="border-b">
                    <td className="py-2">
                      <Link href={`/content/preflight/${row.id}`} className="truncate hover:text-primary">
                        {row.videoFilename}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatPlays(row.lower)} - {formatPlays(row.upper)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatPlays(row.actual)}</td>
                    <td className="py-2 text-right">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', badge.cls)}>
                        {badge.label(row.deltaPct)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ emoji, label, count, cls }: { emoji: string; label: string; count: number; cls: string }) {
  return (
    <div className={cn('rounded-md px-3 py-2 text-center', cls)}>
      <div className="text-xs">{emoji} {label}</div>
      <div className="text-2xl font-bold tabular-nums">{count}</div>
    </div>
  );
}
```

### Step 3.3 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 3.4 — Commit

```bash
git add src/components/dashboard/prediction-accuracy.tsx src/components/dashboard/prediction-accuracy-locked.tsx
git commit -m "feat(prediction-accuracy): PredictionAccuracy + Locked components"
```

---

## Task 4: dashboard page 插入

**Files:**
- Modify: `src/app/dashboard/page.tsx`

### Step 4.1 — 加 imports

打开 `src/app/dashboard/page.tsx`, 在现有 dashboard component imports 区(与 CalibrationMatrix 邻近)加 2 行:

```typescript
import { PredictionAccuracy } from '@/components/dashboard/prediction-accuracy';
import { PredictionAccuracyLocked } from '@/components/dashboard/prediction-accuracy-locked';
```

### Step 4.2 — 插入组件

找到这段(CalibrationMatrix / Locked 三元的下方, 3-col grid 之前):

```typescript
      {data.calibration
        ? <CalibrationMatrix data={data.calibration} />
        : <CalibrationLocked sampleCount={data.stats.retroedCount} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
```

在两者中间插入新 widget:

```typescript
      {data.calibration
        ? <CalibrationMatrix data={data.calibration} />
        : <CalibrationLocked sampleCount={data.stats.retroedCount} />}

      {data.predictionAccuracy
        ? <PredictionAccuracy data={data.predictionAccuracy} />
        : <PredictionAccuracyLocked />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
```

### Step 4.3 — Typecheck + tests

```bash
npm run typecheck && npm test
```

Expected: 0 typecheck errors, 全部 tests pass (172 + 12 prediction-accuracy + 2 aggregate ≈ 186 总数).

### Step 4.4 — Commit

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(prediction-accuracy): /dashboard insert PredictionAccuracy widget"
```

---

## Task 5: 手动 E2E 验收

**No code changes.**

### Step 5.1 — Locked state

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
-- 确保没有 predictedPlaysRange-actualMetric 配对
DELETE FROM \"ActualMetric\" WHERE id LIKE 'pa-%';
DELETE FROM \"ContentAnalysis\" WHERE id LIKE 'pa-%';
SELECT (SELECT COUNT(*) FROM \"ContentAnalysis\") AS analyses,
       (SELECT COUNT(*) FROM \"ActualMetric\") AS metrics;"
```

1. 刷新 `http://localhost:3000/dashboard`
2. 应该看到 "🎯 L1 预测精度 (锁定中)" + 提示 "需要 ≥ 1 条" + "你当前: 0 条"

### Step 5.2 — 数据存在 state (注入 3 条)

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
INSERT INTO \"ContentAnalysis\" (
  id, \"userId\", \"videoPath\", \"videoFilename\", \"videoSizeBytes\", \"videoDurationSec\", \"videoMimeType\",
  niche, status, \"retryCount\", report, \"llmUsage\",
  \"douyinUrl\", \"douyinAwemeId\", \"publishedAt\", \"retroStatus\",
  \"createdAt\", \"updatedAt\", \"completedAt\", \"retroCompletedAt\"
) VALUES
  ('pa-in', 'default-user', '/x', 'in-range.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70, \"predictedPlaysRange\": {\"predicted\": 1000, \"lower\": 500, \"upper\": 2000, \"confidence\": \"low\", \"basisSource\": \"onboarding\", \"basisValue\": 1000}}'::jsonb,
   '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '5 days', 'COMPLETED', NOW(), NOW(), NOW() - INTERVAL '5 days', NOW() - INTERVAL '2 days'),
  ('pa-over', 'default-user', '/x', 'over-est.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 80, \"predictedPlaysRange\": {\"predicted\": 3000, \"lower\": 1500, \"upper\": 6000, \"confidence\": \"low\", \"basisSource\": \"onboarding\", \"basisValue\": 1000}}'::jsonb,
   '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '4 days', 'COMPLETED', NOW(), NOW(), NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
  ('pa-under', 'default-user', '/x', 'under-est.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 60, \"predictedPlaysRange\": {\"predicted\": 1000, \"lower\": 500, \"upper\": 2000, \"confidence\": \"low\", \"basisSource\": \"onboarding\", \"basisValue\": 1000}}'::jsonb,
   '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '3 days', 'COMPLETED', NOW(), NOW(), NOW() - INTERVAL '3 days', NOW());

INSERT INTO \"ActualMetric\" (id, \"analysisId\", \"daysAfterPublish\", source, plays, likes, comments, shares, collects)
VALUES
  ('pa-m-in', 'pa-in', 3.0, 'douyin-creator-center', 1200, 30, 6, 3, 15),
  ('pa-m-over', 'pa-over', 3.0, 'douyin-creator-center', 800, 15, 3, 2, 8),
  ('pa-m-under', 'pa-under', 3.0, 'douyin-creator-center', 8000, 200, 30, 10, 50);"
```

刷新 `/dashboard`,期望:

- ✓ 3-stat: ✓ 准 1 / ⚠ 偏高 1 / ⚠ 偏低 1
- ✓ 表 3 行 (按 completedAt desc):
  - under-est.mp4 | 500 - 2.0k | 8.0k | [偏低 +700%] (8000 vs predicted 1000)
  - over-est.mp4 | 1.5k - 6.0k | 800 | [偏高 -73%] (800 vs predicted 3000)
  - in-range.mp4 | 500 - 2.0k | 1.2k | [准]
- 颜色: 绿 / 红 / 蓝 三个 badge

### Step 5.3 — 清理 mocks

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
DELETE FROM \"ActualMetric\" WHERE id LIKE 'pa-m-%';
DELETE FROM \"ContentAnalysis\" WHERE id LIKE 'pa-%';"
```

### Step 5.4 — 全测试

```bash
npm run typecheck && npm test
```

Expected: 0 typecheck errors, 全部 tests pass (≈ 186 总数)。

---

## 完成标志

- ✅ Task 1-4 commit 完整
- ✅ Task 5 E2E (locked + 3-verdict + 颜色 + 落差%) 全过
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿 (含 12 prediction-accuracy + 2 aggregate 新增)

→ Sub-project B 完成。 进入 Sub-project C (cheat-on-content 自动拉复盘)。

---

## 自审记录 (writing-plans self-review)

**Spec 覆盖**:
- §1 goal/scope → Task 1-5 全覆盖
- §2 architecture → Task 1 (types + verdict 函数), Task 2 (aggregate JOIN), Task 3 (widgets), Task 4 (page 集成)
- §3 data model (无 schema 变更) → 仅类型 add (Task 1)
- §4 verdict 定义 → Task 1 实现 + 单测
- §5 UI 布局 → Task 3 主组件 + Locked
- §6 aggregate 实现 → Task 2
- §7 testing → Task 1 (12 测) + Task 2 (2 测) + Task 5 (E2E)
- §8 错误处理 → Task 2 (过滤 null) + Task 1 (除零 guard)

**Placeholder scan**: 无 TBD/TODO。 完整代码 + 命令。

**Type consistency**:
- `PredictionVerdict` / `PredictionAccuracyEntry` / `PredictionAccuracySummary` Task 1 定义, Task 2 (aggregate) + Task 3 (UI) 一致使用。
- `verdictOf({actual}, range)` 签名 Task 1 定义, Task 2 调用方式 `verdictOf(actual, range)` 一致。
- `data.predictionAccuracy: PredictionAccuracySummary | null` Task 1 add 到 DashboardSummary, Task 4 page 用 `data.predictionAccuracy ? ...` 一致。
