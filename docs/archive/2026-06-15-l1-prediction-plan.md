# L1 Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每条上传视频做完 4-dim 诊断后, 在报告页顶部出 "预估 1.2k - 4.8k 播放" 数字区间, 闭环 Phase 3 calibration 信号 + 账号 baseline。

**Architecture:** 纯 JS 公式 + 1 行 Prisma migration + worker pipeline 加 1 步 `runPredict` 把 `predictedPlaysRange` 写进 `report` JSONB + RSC fetch User.baselinePlays 传给 upload form + 报告页顶 PredictionCard。 无 LLM, 无新表。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + vitest

**Spec:** `docs/superpowers/specs/2026-06-15-l1-prediction-design.md`

**Scope** (不在本计划):
- `/settings/baseline` 修改基线的设置页 (v2)
- LLM 调用 (确定性公式)
- Dashboard 加预测 widget (placement 锁定单视频报告页)
- PredictionHistory 表 (v2 追溯精度演化)
- 与 niche 相关的多 score 曲线 (v3)

---

## File Structure

```
新建:
src/lib/prediction/types.ts                             # PredictedPlaysRange + ResolvedBaseline 类型
src/lib/prediction/formula.ts                           # scoreMultiplier / calibrationFactor / computePrediction / formatPlays (纯函数)
src/lib/prediction/baseline.ts                          # resolveBaseline(userId) — DB 层, 优先 retro median, 否则 User.baselinePlays
src/components/content/prediction-card.tsx              # 双状态 UI 卡 (有数据 / fallback CTA)
tests/lib/prediction/formula.test.ts                    # 纯函数 TDD
tests/lib/prediction/baseline.test.ts                   # mock-prisma TDD

修改:
prisma/schema.prisma                                    # +baselinePlays BigInt? 在 User
prisma/migrations/<timestamp>_add_user_baseline_plays/  # 自动生成
src/jobs/workers/content-analyze-worker.ts              # runPredict 调用 + 注入 report.predictedPlaysRange
src/app/api/v1/content/analyses/route.ts                # POST 解析 baselinePlays form 字段写 User
src/app/content/preflight/new/page.tsx                  # RSC 读 User.baselinePlays, 传 prop 给 UploadForm
src/components/content/upload-form.tsx                  # 接 initialBaselinePlays prop, 渲染 conditional input
src/app/content/preflight/[id]/page.tsx                 # 引入 PredictionCard, 放在 ProgressStages 下、ReportView 之上
```

---

## Test Strategy

- **纯函数** (`formula.ts`) 100% vitest 覆盖 (锚点表 + 边界 + overflow)
- **`baseline.ts`** mock prisma, 覆盖 5 个分支 (无 baseline / onboarding / <3 retro / =3 retro / 自动写回失败)
- **Worker `runPredict`** 不写单测 (沿 phase 1 风格, 走手动 E2E)
- **POST route + Upload form** 不写单测 (走手动 E2E)
- **UI `PredictionCard`** 不写单测

测试框架: vitest

---

## Git

每个 task 末尾 `git commit`。 commit 前缀: `feat(l1-prediction): ...` / `fix(l1-prediction): ...` / `chore(l1-prediction): ...`。

---

## Task 1: types.ts + formula.ts (TDD 纯函数)

**Files:**
- Create: `src/lib/prediction/types.ts`
- Create: `src/lib/prediction/formula.ts`
- Create: `tests/lib/prediction/formula.test.ts`

- [ ] **Step 1.1: types.ts**

`src/lib/prediction/types.ts`:

```typescript
export type PredictionConfidence = 'low' | 'medium' | 'high';
export type PredictionBasisSource = 'onboarding' | 'retro-median';

export interface PredictedPlaysRange {
  predicted: number;
  lower: number;
  upper: number;
  confidence: PredictionConfidence;
  basisSource: PredictionBasisSource;
  basisValue: number;
}

export interface ResolvedBaseline {
  value: number;
  source: PredictionBasisSource;
  retroSampleCount: number;
}
```

- [ ] **Step 1.2: 写失败测试**

`tests/lib/prediction/formula.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  scoreMultiplier,
  calibrationFactor,
  computePrediction,
  formatPlays,
} from '@/lib/prediction/formula';
import type { CalibrationData } from '@/lib/dashboard/types';

describe('scoreMultiplier', () => {
  it('锚点表: score 50 → 1.0×', () => {
    expect(scoreMultiplier(50)).toBeCloseTo(1.0, 2);
  });
  it('锚点表: score 80 → ~2.7×', () => {
    expect(scoreMultiplier(80)).toBeCloseTo(2.72, 1);
  });
  it('锚点表: score 100 → ~5.3×', () => {
    expect(scoreMultiplier(100)).toBeCloseTo(5.29, 1);
  });
  it('锚点表: score 30 → ~0.51×', () => {
    expect(scoreMultiplier(30)).toBeCloseTo(0.51, 1);
  });
  it('锚点表: score 0 → ~0.19×', () => {
    expect(scoreMultiplier(0)).toBeCloseTo(0.19, 1);
  });
});

describe('calibrationFactor', () => {
  const mkDist = (over: number, under: number, on: number, unk: number) => ({
    onTarget: on,
    overEstimated: over,
    underEstimated: under,
    unknown: unk,
    total: over + under + on + unk,
    worstBucket: null as null,
  });
  const mkCal = (over: number, under: number, on: number): CalibrationData => ({
    sampleCount: over + under + on,
    matrix: {
      hookGap: mkDist(over, under, on, 0),
      retentionGap: mkDist(over, under, on, 0),
      titleCaptionGap: mkDist(over, under, on, 0),
      coverGap: mkDist(over, under, on, 0),
    },
    insight: '',
  });

  it('null → 1.0', () => {
    expect(calibrationFactor(null)).toBe(1.0);
  });
  it('整体偏乐观 (over ≥ 40%) → 0.7', () => {
    expect(calibrationFactor(mkCal(3, 1, 1))).toBe(0.7);
  });
  it('整体偏保守 (under ≥ 40%) → 1.3', () => {
    expect(calibrationFactor(mkCal(1, 3, 1))).toBe(1.3);
  });
  it('全 on-target → 1.0', () => {
    expect(calibrationFactor(mkCal(0, 0, 5))).toBe(1.0);
  });
  it('over 与 under 都 ≥ 40%, over 优先', () => {
    expect(calibrationFactor(mkCal(2, 2, 1))).toBe(0.7);
  });
});

describe('computePrediction', () => {
  it('典型 case: baseline=1000, score=75, cal=null, retroCount=0', () => {
    const result = computePrediction({
      overallScore: 75,
      baseline: 1000,
      calibration: null,
      retroSampleCount: 0,
      basisSource: 'onboarding',
    });
    // mult = exp(25/30) ≈ 2.30, predicted = 2300
    expect(result.predicted).toBeGreaterThanOrEqual(2200);
    expect(result.predicted).toBeLessThanOrEqual(2400);
    expect(result.lower).toBe(Math.round(result.predicted * 0.5));
    expect(result.upper).toBe(Math.round(result.predicted * 2));
    expect(result.confidence).toBe('low');
    expect(result.basisSource).toBe('onboarding');
    expect(result.basisValue).toBe(1000);
  });

  it('confidence: 0/3/10 retro → low/medium/high', () => {
    const base = {
      overallScore: 50,
      baseline: 1000,
      calibration: null,
      basisSource: 'onboarding' as const,
    };
    expect(computePrediction({ ...base, retroSampleCount: 0 }).confidence).toBe('low');
    expect(computePrediction({ ...base, retroSampleCount: 2 }).confidence).toBe('low');
    expect(computePrediction({ ...base, retroSampleCount: 3 }).confidence).toBe('medium');
    expect(computePrediction({ ...base, retroSampleCount: 9 }).confidence).toBe('medium');
    expect(computePrediction({ ...base, retroSampleCount: 10 }).confidence).toBe('high');
  });

  it('overflow clamp: baseline=1e9, score=100 → predicted ≤ 1e9', () => {
    const result = computePrediction({
      overallScore: 100,
      baseline: 1e9,
      calibration: null,
      retroSampleCount: 0,
      basisSource: 'onboarding',
    });
    expect(result.predicted).toBeLessThanOrEqual(1e9);
  });

  it('calibration 影响最终值 (偏乐观时下移)', () => {
    const baseInput = {
      overallScore: 80,
      baseline: 1000,
      retroSampleCount: 5,
      basisSource: 'retro-median' as const,
    };
    const without = computePrediction({ ...baseInput, calibration: null });
    const withOver = computePrediction({
      ...baseInput,
      calibration: {
        sampleCount: 5,
        matrix: {
          hookGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          retentionGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          titleCaptionGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
          coverGap: { onTarget: 1, overEstimated: 3, underEstimated: 1, unknown: 0, total: 5, worstBucket: 'over-estimated' as const },
        },
        insight: '',
      },
    });
    expect(withOver.predicted).toBeCloseTo(without.predicted * 0.7, 0);
  });
});

describe('formatPlays', () => {
  it('< 1000 → 原数字符串', () => {
    expect(formatPlays(0)).toBe('0');
    expect(formatPlays(850)).toBe('850');
    expect(formatPlays(999)).toBe('999');
  });
  it('1k-10k → "X.Xk"', () => {
    expect(formatPlays(1000)).toBe('1.0k');
    expect(formatPlays(1234)).toBe('1.2k');
    expect(formatPlays(9999)).toBe('10.0k');
  });
  it('≥ 10k → "X.Xw"', () => {
    expect(formatPlays(10000)).toBe('1.0w');
    expect(formatPlays(15234)).toBe('1.5w');
    expect(formatPlays(123456)).toBe('12.3w');
  });
});
```

- [ ] **Step 1.3: 跑测试验证失败**

```bash
npm test -- prediction/formula
```

Expected: FAIL (module not found).

- [ ] **Step 1.4: 实现 formula.ts**

`src/lib/prediction/formula.ts`:

```typescript
import type { CalibrationData } from '@/lib/dashboard/types';
import type {
  PredictedPlaysRange,
  PredictionBasisSource,
  PredictionConfidence,
} from './types';

const MAX_PREDICTED = 1e9;
const MIN_PREDICTED = 0;

export function scoreMultiplier(overallScore: number): number {
  return Math.exp((overallScore - 50) / 30);
}

export function calibrationFactor(cal: CalibrationData | null): number {
  if (!cal) return 1.0;
  const dims = Object.values(cal.matrix);
  const avgOverPct =
    dims.reduce((s, d) => s + (d.total ? d.overEstimated / d.total : 0), 0) / 4;
  const avgUnderPct =
    dims.reduce((s, d) => s + (d.total ? d.underEstimated / d.total : 0), 0) / 4;
  if (avgOverPct >= 0.4) return 0.7;
  if (avgUnderPct >= 0.4) return 1.3;
  return 1.0;
}

function confidenceFor(retroCount: number): PredictionConfidence {
  if (retroCount >= 10) return 'high';
  if (retroCount >= 3) return 'medium';
  return 'low';
}

function clamp(n: number): number {
  if (!Number.isFinite(n) || n < MIN_PREDICTED) return MIN_PREDICTED;
  if (n > MAX_PREDICTED) return MAX_PREDICTED;
  return n;
}

export function computePrediction(input: {
  overallScore: number;
  baseline: number;
  calibration: CalibrationData | null;
  retroSampleCount: number;
  basisSource: PredictionBasisSource;
}): PredictedPlaysRange {
  const mult = scoreMultiplier(input.overallScore);
  const calFactor = calibrationFactor(input.calibration);
  const rawPredicted = input.baseline * mult * calFactor;
  const predicted = Math.round(clamp(rawPredicted));
  return {
    predicted,
    lower: Math.round(predicted * 0.5),
    upper: Math.round(clamp(predicted * 2)),
    confidence: confidenceFor(input.retroSampleCount),
    basisSource: input.basisSource,
    basisValue: input.baseline,
  };
}

export function formatPlays(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 10000).toFixed(1)}w`;
}
```

- [ ] **Step 1.5: 跑测试验证通过**

```bash
npm test -- prediction/formula
```

Expected: PASS (16+ tests).

- [ ] **Step 1.6: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 1.7: Commit**

```bash
git add src/lib/prediction/types.ts src/lib/prediction/formula.ts tests/lib/prediction/formula.test.ts
git commit -m "feat(l1-prediction): types + formula (scoreMultiplier / calibrationFactor / computePrediction / formatPlays)"
```

---

## Task 2: baseline.ts (mock-prisma TDD)

**Files:**
- Create: `src/lib/prediction/baseline.ts`
- Create: `tests/lib/prediction/baseline.test.ts`

- [ ] **Step 2.1: 写失败测试**

`tests/lib/prediction/baseline.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { resolveBaseline } from '@/lib/prediction/baseline';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', baselinePlays: null });
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
});

describe('resolveBaseline', () => {
  it('无 baseline 且无 retro → null', async () => {
    expect(await resolveBaseline('u1')).toBeNull();
  });

  it('User.baselinePlays=500n, 0 retro → onboarding 分支', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 500n });
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 500, source: 'onboarding', retroSampleCount: 0 });
  });

  it('2 条 retro (<3) → 走 onboarding 值, 不动 User.baselinePlays', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 800n });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([{ plays: 600n }, { plays: 700n }]);
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 800, source: 'onboarding', retroSampleCount: 2 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('3 条 retro plays=[100,500,1000] → median=500, source=retro-median, 写回 User', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 999n });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 500n },
      { plays: 1000n },
    ]);
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 500, source: 'retro-median', retroSampleCount: 3 });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { baselinePlays: 500n },
    });
  });

  it('4 条 retro plays=[100,200,800,1000] → median=(200+800)/2=500', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: null });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 200n },
      { plays: 800n },
      { plays: 1000n },
    ]);
    const result = await resolveBaseline('u1');
    expect(result?.value).toBe(500);
    expect(result?.source).toBe('retro-median');
  });

  it('写回失败不抛, 仍返回 retro-median 结果', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: null });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 500n },
      { plays: 1000n },
    ]);
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));
    const result = await resolveBaseline('u1');
    expect(result?.value).toBe(500);
    expect(result?.source).toBe('retro-median');
  });

  it('User.baselinePlays=0n → 视为 null (无 retro)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 0n });
    expect(await resolveBaseline('u1')).toBeNull();
  });
});
```

- [ ] **Step 2.2: 跑测试验证失败**

```bash
npm test -- prediction/baseline
```

Expected: FAIL.

- [ ] **Step 2.3: 实现 baseline.ts**

`src/lib/prediction/baseline.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import type { ResolvedBaseline } from './types';

const MIN_RETROS_FOR_MEDIAN = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export async function resolveBaseline(userId: string): Promise<ResolvedBaseline | null> {
  const [user, metrics] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { baselinePlays: true } }),
    prisma.actualMetric.findMany({
      where: { analysis: { userId } },
      select: { plays: true },
    }),
  ]);

  const retroSampleCount = metrics.length;

  if (retroSampleCount >= MIN_RETROS_FOR_MEDIAN) {
    const playsAsNumbers = metrics.map((m) => Number(m.plays));
    const m = Math.round(median(playsAsNumbers));
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { baselinePlays: BigInt(m) },
      });
    } catch (err) {
      console.error('[prediction/baseline] writeback failed', err);
    }
    return { value: m, source: 'retro-median', retroSampleCount };
  }

  const onboardingValue = user?.baselinePlays;
  if (!onboardingValue || onboardingValue <= 0n) return null;
  return {
    value: Number(onboardingValue),
    source: 'onboarding',
    retroSampleCount,
  };
}
```

- [ ] **Step 2.4: 跑测试验证通过**

```bash
npm test -- prediction/baseline
```

Expected: PASS (7 tests).

- [ ] **Step 2.5: typecheck**

```bash
npm run typecheck
```

Expected: typecheck will FAIL since `User.baselinePlays` doesn't exist yet. We add it in Task 3. Acceptable here — continue.

- [ ] **Step 2.6: Commit**

```bash
git add src/lib/prediction/baseline.ts tests/lib/prediction/baseline.test.ts
git commit -m "feat(l1-prediction): baseline resolver — retro median (≥3) or onboarding value"
```

---

## Task 3: Prisma migration — `User.baselinePlays`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<auto-timestamp>_add_user_baseline_plays/migration.sql`

- [ ] **Step 3.1: 修改 schema**

打开 `prisma/schema.prisma`, 找到 `model User { ... }`, 在其字段块内追加一行 (放在所有 scalar 字段最末, relations 之前):

```prisma
  baselinePlays  BigInt?
```

- [ ] **Step 3.2: 生成 migration**

```bash
npx prisma migrate dev --name add_user_baseline_plays
```

Expected: 生成新 migration 文件夹 `prisma/migrations/<timestamp>_add_user_baseline_plays/` 含 `migration.sql`, 内容应该是:

```sql
ALTER TABLE "User" ADD COLUMN "baselinePlays" BIGINT;
```

prisma 会自动重启 prisma client 生成。

- [ ] **Step 3.3: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors (User.baselinePlays 类型现在有了, baseline.ts 也通过)。

- [ ] **Step 3.4: 跑全测试**

```bash
npm test -- prediction
```

Expected: 16+ formula tests + 7 baseline tests 全过。

- [ ] **Step 3.5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "chore(l1-prediction): prisma migration — add User.baselinePlays BigInt?"
```

---

## Task 4: Worker `runPredict` hook

**Files:**
- Modify: `src/jobs/workers/content-analyze-worker.ts:386-415` (insert prediction step between runAIAnalysis 完成 + DB 写入)

- [ ] **Step 4.1: 修改 worker**

打开 `src/jobs/workers/content-analyze-worker.ts`。

**4.1a:** 文件顶部 imports 加 2 行 (与现有 prediction 区相邻, 与其它 import 风格保持一致):

```typescript
import { computePrediction } from '@/lib/prediction/formula';
import { resolveBaseline } from '@/lib/prediction/baseline';
```

也需要 `aggregateDashboard` 暴露 calibration ? 不必 — 直接调小一点的辅助函数即可。 沿用同一公式: 在 worker 内 inline 算 calibration matrix。 用 `computeCalibration` 已有 (Phase 3 已经写好)。

```typescript
import { computeCalibration } from '@/lib/dashboard/calibration';
import type { RetroReportLike } from '@/lib/dashboard/types';
```

**4.1b:** 在 `handleAnalyze` 函数内, 找到这段 (大约 line 387, 紧跟 `setProgress(analysisId, 'analyze.synthesize', 90, ...)` 之后, Whisper cost injection 之前):

```typescript
  await setProgress(analysisId, 'analyze.synthesize', 90, '综合评分');

  // Fix 1: inject Whisper cost into llmUsage ...
```

在 `setProgress` 后, Whisper cost 之前插入 prediction 步骤:

```typescript
  await setProgress(analysisId, 'analyze.synthesize', 90, '综合评分');

  // L1 prediction — 确定性公式, fail-soft
  try {
    if (typeof ai.report.overallScore === 'number') {
      const baseline = await resolveBaseline(analysis.userId);
      if (baseline) {
        const retroReports = await prisma.contentAnalysis.findMany({
          where: { userId: analysis.userId, retroStatus: 'COMPLETED' },
          select: { retroReport: true },
        });
        const calibration = computeCalibration(
          retroReports
            .map((r) => r.retroReport as RetroReportLike | null)
            .filter((r): r is RetroReportLike => r !== null)
        );
        ai.report.predictedPlaysRange = computePrediction({
          overallScore: ai.report.overallScore,
          baseline: baseline.value,
          calibration,
          retroSampleCount: baseline.retroSampleCount,
          basisSource: baseline.source,
        });
      }
    }
  } catch (err) {
    console.error('[content-analyze-worker] runPredict failed:', err);
  }

  // Fix 1: inject Whisper cost into llmUsage ...
```

- [ ] **Step 4.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4.3: 跑测试**

```bash
npm test
```

Expected: 全部既有测试仍通过 (worker 没单测, 不会引入新失败)。

- [ ] **Step 4.4: Commit**

```bash
git add src/jobs/workers/content-analyze-worker.ts
git commit -m "feat(l1-prediction): worker runPredict — inject predictedPlaysRange into report"
```

---

## Task 5: POST `/api/v1/content/analyses` — 解析 baselinePlays

**Files:**
- Modify: `src/app/api/v1/content/analyses/route.ts:42` (在 `getOrCreateDefaultUser()` 后, 文件写入前插入)

- [ ] **Step 5.1: 修改 POST**

打开 `src/app/api/v1/content/analyses/route.ts`。

找到这一行 (约 line 42):

```typescript
  const user = await getOrCreateDefaultUser();
```

在它**下方**立刻插入:

```typescript
  // baselinePlays onboarding — 仅当 form 传了非空数字时写, 失败静默 (不阻断 analysis 创建)
  const baselineRaw = form.get('baselinePlays');
  if (typeof baselineRaw === 'string' && baselineRaw.trim() !== '') {
    const parsed = Number(baselineRaw);
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1e8) {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { baselinePlays: BigInt(Math.round(parsed)) },
        });
      } catch (err) {
        console.error('[POST analyses] baselinePlays write failed', err);
      }
    }
  }
```

- [ ] **Step 5.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5.3: 跑测试**

```bash
npm test
```

Expected: 141+ tests 全过 (POST 没单测, 不会引入新失败)。

- [ ] **Step 5.4: Commit**

```bash
git add src/app/api/v1/content/analyses/route.ts
git commit -m "feat(l1-prediction): POST analyses parses baselinePlays form field"
```

---

## Task 6: `/content/preflight/new/page.tsx` — RSC 读 User.baselinePlays

**Files:**
- Modify: `src/app/content/preflight/new/page.tsx`

- [ ] **Step 6.1: 修改 page**

打开 `src/app/content/preflight/new/page.tsx`, 完整替换为:

```typescript
import { UploadForm } from '@/components/content/upload-form';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export default async function NewAnalysisPage() {
  const user = await getOrCreateDefaultUser();
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { baselinePlays: true },
  });
  const hasBaseline = fresh?.baselinePlays != null && fresh.baselinePlays > 0n;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">新分析</h1>
      <UploadForm needsBaselineOnboarding={!hasBaseline} />
    </div>
  );
}
```

- [ ] **Step 6.2: typecheck**

会报错: `UploadForm` 不接受 `needsBaselineOnboarding` prop。 下一个 task 修。 先跳过 typecheck, 直接进 Task 7。

- [ ] **Step 6.3: Commit**

```bash
git add src/app/content/preflight/new/page.tsx
git commit -m "feat(l1-prediction): RSC fetch User.baselinePlays, pass to UploadForm"
```

---

## Task 7: `UploadForm` 加 conditional onboarding 字段

**Files:**
- Modify: `src/components/content/upload-form.tsx`

- [ ] **Step 7.1: 修改 UploadForm**

打开 `src/components/content/upload-form.tsx`。

**7.1a:** 修改组件签名, 接收 prop:

把:
```typescript
export function UploadForm() {
```

改为:
```typescript
export function UploadForm({ needsBaselineOnboarding = false }: { needsBaselineOnboarding?: boolean }) {
```

**7.1b:** 在已有 useState 列表底下加一个 baseline state (大约 line 19, 在 `const [error, setError] = useState<string | null>(null);` 之后):

```typescript
  const [baselinePlays, setBaselinePlays] = useState<string>('');
```

**7.1c:** 在 `handleSubmit` 里, FormData append 区域 (大约 line 42, 在 `if (effectiveNiche) fd.append('niche', effectiveNiche);` 之后) 加:

```typescript
      const baselineTrimmed = baselinePlays.trim();
      if (baselineTrimmed && Number(baselineTrimmed) > 0) {
        fd.append('baselinePlays', baselineTrimmed);
      }
```

**7.1d:** 在 JSX 内, 找到第二个 `<Card><CardContent>` 块 (含 niche 选择的那个, 大约 line 89), 在结束 `</CardContent></Card>` **之后**, `{error && ...}` **之前** 插入 conditional onboarding card:

```typescript
      {needsBaselineOnboarding && (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="rounded-md border-2 border-dashed border-amber-300 bg-amber-50 p-3">
              <Label htmlFor="baselinePlays" className="text-sm font-medium">
                🎯 一次性设置: 你最近 10 条视频平均多少播放?
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                用于校准 L1 预测。 不填的话短期内不出预测, 等 3 条复盘后会从实测数据自动算出。
              </p>
              <Input
                id="baselinePlays"
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="例如: 800"
                value={baselinePlays}
                onChange={(e) => setBaselinePlays(e.target.value)}
                className="mt-2"
              />
            </div>
          </CardContent>
        </Card>
      )}
```

- [ ] **Step 7.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7.3: 跑测试**

```bash
npm test
```

Expected: 全过。

- [ ] **Step 7.4: Commit**

```bash
git add src/components/content/upload-form.tsx
git commit -m "feat(l1-prediction): UploadForm conditional baseline onboarding field"
```

---

## Task 8: `PredictionCard` 组件

**Files:**
- Create: `src/components/content/prediction-card.tsx`

- [ ] **Step 8.1: 实现 PredictionCard**

`src/components/content/prediction-card.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatPlays } from '@/lib/prediction/formula';
import type { PredictedPlaysRange } from '@/lib/prediction/types';

const CONFIDENCE_BADGE: Record<PredictedPlaysRange['confidence'], { label: string; cls: string; hint: string }> = {
  low: {
    label: '置信度: 低',
    cls: 'bg-muted text-muted-foreground',
    hint: '复盘 3+ 解锁中等',
  },
  medium: {
    label: '置信度: 中',
    cls: 'bg-blue-100 text-blue-900',
    hint: '复盘 10+ 解锁高',
  },
  high: {
    label: '置信度: 高',
    cls: 'bg-green-100 text-green-900',
    hint: '',
  },
};

const SOURCE_LABEL: Record<PredictedPlaysRange['basisSource'], string> = {
  onboarding: '你 onboarding 填的',
  'retro-median': '你最近复盘中位数',
};

export function PredictionCard({ data }: { data: PredictedPlaysRange | null | undefined }) {
  if (!data) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">💡 L1 播放预测暂未生成</h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>• 设了账号基线 → 上传时立即出预测</li>
            <li>• 没设的话, 等 3 条复盘后会自动从实测数据反算出基线</li>
          </ul>
        </CardContent>
      </Card>
    );
  }

  const badge = CONFIDENCE_BADGE[data.confidence];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <h3 className="font-semibold">📈 预估播放</h3>
        <div className="flex items-baseline justify-center gap-3">
          <span className="text-3xl font-bold tabular-nums">{formatPlays(data.lower)}</span>
          <span className="text-muted-foreground">—</span>
          <span className="text-3xl font-bold tabular-nums">{formatPlays(data.upper)}</span>
        </div>
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-muted-foreground">中心估算 {formatPlays(data.predicted)}</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn('rounded px-2 py-0.5 text-xs font-semibold', badge.cls)}>
            {badge.label}
          </span>
          {badge.hint && <span className="text-xs text-muted-foreground">({badge.hint})</span>}
        </div>
        <div className="text-center text-xs text-muted-foreground">
          基线 {formatPlays(data.basisValue)} ({SOURCE_LABEL[data.basisSource]})
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 8.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/components/content/prediction-card.tsx
git commit -m "feat(l1-prediction): PredictionCard widget (dual-state: range or fallback CTA)"
```

---

## Task 9: 报告页插入 PredictionCard

**Files:**
- Modify: `src/app/content/preflight/[id]/page.tsx`

- [ ] **Step 9.1: 插入 PredictionCard**

打开 `src/app/content/preflight/[id]/page.tsx`。

**9.1a:** 文件顶部 imports 区加一行 (与现有 component imports 相邻):

```typescript
import { PredictionCard } from '@/components/content/prediction-card';
```

**9.1b:** 在 JSX 内, 找到 `<ProgressStages ... />` 调用。 在其**之后**, 在 `{data.status === 'COMPLETED' && data.report && (` 块**之前**, 加一个 conditional:

```typescript
      <ProgressStages status={data.status} progress={data.progress} errorMessage={data.errorMessage} />

      {data.status === 'COMPLETED' && data.report && (
        <PredictionCard data={data.report.predictedPlaysRange} />
      )}

      {data.status === 'COMPLETED' && data.report && (
        // ...existing block continues...
```

注意: PredictionCard 接受 `null|undefined`, 老 analysis 没有 predictedPlaysRange 时显示 fallback CTA, 与设计一致。

- [ ] **Step 9.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/app/content/preflight/[id]/page.tsx
git commit -m "feat(l1-prediction): show PredictionCard on top of report page"
```

---

## Task 10: 手动 E2E 验收

**No code changes** — 验证 spec §7.3 的 5 个场景。

- [ ] **Step 10.1: 清空 baseline (回到冷启动)**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
UPDATE \"User\" SET \"baselinePlays\" = NULL WHERE id = 'default-user';
SELECT id, \"baselinePlays\" FROM \"User\";
"
```

Expected: `baselinePlays | NULL`.

- [ ] **Step 10.2: 冷启动 happy path**

1. 打开 `http://localhost:3000/content/preflight/new`
2. 应该看到 "🎯 一次性设置" 黄底虚线框
3. 上传一个真实视频 (复用旧测试视频, 或现有的 1 条都行)
4. baseline 字段填 `800`
5. 提交, 等 analysis 完成 (60-120s)
6. 跳到报告页, 顶部应该看到 PredictionCard
7. 区间数字格式合理 (例如 score=45 时, predicted ≈ 800 × 0.85 ≈ 680, range 340-1360)
8. confidence badge 显示 "置信度: 低 (复盘 3+ 解锁中等)"
9. 底部小字: "基线 800 (你 onboarding 填的)"

- [ ] **Step 10.3: 第二次上传不再问 baseline**

1. 不重置 baseline, 再上传一条视频
2. upload form 顶部**不应**再出现 "🎯 一次性设置" 框 (因为 User.baselinePlays 已经设了 = 800)
3. 提交后报告页同样出 PredictionCard

- [ ] **Step 10.4: 用户跳过 onboarding (fallback CTA)**

1. 重置 baseline:
   ```bash
   docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
   UPDATE \"User\" SET \"baselinePlays\" = NULL WHERE id = 'default-user';
   "
   ```
2. 上传新视频, **不填** baseline 输入框 (留空)
3. 等 analysis 完成
4. 报告页 PredictionCard 应该显示 fallback 态: "💡 L1 播放预测暂未生成" + 两条 bullet

- [ ] **Step 10.5: Calibration 反馈影响预测 (mock 3 条偏乐观 retro)**

注入和 Phase 3 §9.2 一样的 mock SQL (3 条 retro 都 overEstimated):

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
UPDATE \"User\" SET \"baselinePlays\" = 1000 WHERE id = 'default-user';
INSERT INTO \"ContentAnalysis\" (
  id, \"userId\", \"videoPath\", \"videoFilename\", \"videoSizeBytes\", \"videoDurationSec\", \"videoMimeType\",
  niche, status, \"retryCount\", report, \"llmUsage\",
  \"douyinUrl\", \"douyinAwemeId\", \"publishedAt\", \"retroStatus\", \"retroReport\",
  \"createdAt\", \"updatedAt\", \"completedAt\", \"retroCompletedAt\"
) VALUES
  ('cal-1', 'default-user', '/x', 'mock-cal-1.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 80}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '5 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"over-estimated\"}, \"retentionGap\": {\"accuracy\": \"over-estimated\"}, \"titleCaptionGap\": {\"accuracy\": \"over-estimated\"}, \"coverGap\": {\"accuracy\": \"over-estimated\"}}'::jsonb,
   NOW() - INTERVAL '5 days', NOW(), NOW() - INTERVAL '5 days', NOW() - INTERVAL '2 days'),
  ('cal-2', 'default-user', '/x', 'mock-cal-2.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 75}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '4 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"over-estimated\"}, \"retentionGap\": {\"accuracy\": \"over-estimated\"}, \"titleCaptionGap\": {\"accuracy\": \"on-target\"}, \"coverGap\": {\"accuracy\": \"over-estimated\"}}'::jsonb,
   NOW() - INTERVAL '4 days', NOW(), NOW() - INTERVAL '4 days', NOW() - INTERVAL '1 day'),
  ('cal-3', 'default-user', '/x', 'mock-cal-3.mp4', 1, 30, 'video/mp4', 'ai-knowledge', 'COMPLETED', 0,
   '{\"overallScore\": 70}'::jsonb, '{\"total\": {\"estCostUSD\": 0}}'::jsonb,
   null, null, NOW() - INTERVAL '3 days', 'COMPLETED',
   '{\"hookGap\": {\"accuracy\": \"over-estimated\"}, \"retentionGap\": {\"accuracy\": \"over-estimated\"}, \"titleCaptionGap\": {\"accuracy\": \"over-estimated\"}, \"coverGap\": {\"accuracy\": \"on-target\"}}'::jsonb,
   NOW() - INTERVAL '3 days', NOW(), NOW() - INTERVAL '3 days', NOW());

-- 同时插入对应 ActualMetric (供 baseline retro median 触发)
INSERT INTO \"ActualMetric\" (id, \"analysisId\", \"daysAfterPublish\", source, plays, likes, comments, shares, collects)
VALUES
  ('cal-m-1', 'cal-1', 3.0, 'douyin-creator-center', 800, 20, 5, 2, 8),
  ('cal-m-2', 'cal-2', 3.0, 'douyin-creator-center', 1000, 25, 6, 2, 10),
  ('cal-m-3', 'cal-3', 3.0, 'douyin-creator-center', 1200, 30, 7, 3, 12);
"
```

再上传一条新视频:
- runPredict 时 calibration matrix 触发 "整体偏乐观" → calFactor = 0.7
- baseline 也从 retro-median 来 (median(800,1000,1200) = 1000)
- 报告页 PredictionCard 的 basisSource 显示 "你最近复盘中位数"
- confidence='medium' (3 条 retro)

- [ ] **Step 10.6: 清理 mock**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
DELETE FROM \"ActualMetric\" WHERE id LIKE 'cal-m-%';
DELETE FROM \"ContentAnalysis\" WHERE id LIKE 'cal-%';
-- baseline 留着, 是真实的 onboarding 数据
"
```

- [ ] **Step 10.7: 跑全测试 + typecheck**

```bash
npm run typecheck && npm test
```

Expected: 0 typecheck errors, 全部 tests pass (141 + 16 formula + 7 baseline ≈ 164 总数)。

- [ ] **Step 10.8: Commit (如果需要清理)**

```bash
git status
# 如果有 untracked / changes
git add -A && git commit -m "chore(l1-prediction): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1–9 commit 全部完成
- ✅ Task 10 E2E 5 个场景通过
- ✅ `npm run typecheck` 0 错
- ✅ `npm test` 全绿
- ✅ 浏览器 `/content/preflight/[id]` 报告页顶部 PredictionCard 正确渲染 3 种状态 (数据 / fallback CTA / calibration 影响后下移)

→ 可以进入 v2 (settings/baseline 页 + PredictionHistory 表) 或下一个方向

---

## 自审记录 (writing-plans self-review)

**Spec 覆盖**:
- §1 goal/scope → Task 1-9 全覆盖
- §2 architecture → Task 1 (formula+types), Task 2 (baseline), Task 4 (worker), Task 5 (POST), Task 6 (RSC), Task 7 (form), Task 8 (PredictionCard), Task 9 (report page)
- §3.1 prisma migration → Task 3
- §3.2 report JSONB extension → Task 4 (worker 写入)
- §3.3 BigInt 序列化 → Task 2 (resolveBaseline 转 number) + Task 5 (写回 BigInt)
- §4 formula 公式 → Task 1
- §5.1 onboarding form 字段 → Task 7
- §5.2 auto-recompute → Task 2 (resolveBaseline)
- §5.3 cold start fallback → Task 4 (跳过) + Task 8 (fallback UI)
- §5.4 安全边界 → Task 5 (POST 校验) + Task 1 (clamp)
- §6 UI 布局 → Task 8
- §7 testing → Task 1, 2 (单测), Task 10 (E2E)

**Placeholder scan**: 无 TBD/TODO/"add appropriate"。 所有 step 都有完整代码或具体命令。

**Type consistency**:
- `PredictedPlaysRange`, `ResolvedBaseline`, `PredictionConfidence`, `PredictionBasisSource` 在 Task 1 types.ts 定义, Task 1-9 一致使用。
- `computePrediction` 签名 `{ overallScore, baseline, calibration, retroSampleCount, basisSource }` — Task 4 worker 调用方使用同一签名。
- `resolveBaseline(userId): Promise<ResolvedBaseline | null>` — Task 4 worker 使用一致。
- `formatPlays(n: number): string` — Task 1 定义, Task 8 PredictionCard 使用一致。
- `User.baselinePlays` 类型 `BigInt?` — Task 3 prisma + Task 2 baseline + Task 5 POST + Task 6 RSC 都按 BigInt 处理。

**Fix one inconsistency caught during self-review:** Task 4 originally fetched calibration via aggregate; rewrote to call `computeCalibration` directly with raw retroReports — avoids depending on the larger aggregate function and matches what calibration matrix widget consumes.
