# Prediction Accuracy Dashboard Widget Design Spec

**Status:** Draft 2026-06-15
**Owner:** MediaPilot (solo dev)
**Phase:** L1 Prediction v2 — Sub-project B

## 1. Goal & Scope

Dashboard 增加 "L1 预测精度" widget — 3-stat 概要 (准 / 偏高 / 偏低) + 最近 5 条明细表, 让用户量化感受 AI 预测随时间是否变准。 **零 schema 变更**, 复用现有数据。

**In scope:**

- 改 `src/lib/dashboard/aggregate.ts` — JOIN ContentAnalysis × ActualMetric, JS 端算 verdict
- 改 `src/lib/dashboard/types.ts` — 加 `PredictionAccuracyEntry` + 嵌入 `DashboardSummary`
- 新 `src/components/dashboard/prediction-accuracy.tsx` — 主 widget (3-stat + 表)
- 新 `src/components/dashboard/prediction-accuracy-locked.tsx` — < 1 条有预测的复盘时 locked
- 改 `src/app/dashboard/page.tsx` — 插入新组件在 CalibrationMatrix 下、3-col grid 上
- 加 verdictOf 纯函数 + 单测 (3 分支)
- 改 aggregate 单测 — 验证 prediction accuracy 数据 shape

**Out of scope (留 v3):**

- Scatter plot (predicted vs actual)
- 钻入单条预测的历史详情页
- 自动学习率: 用 accuracy 反推 score multiplier 调参

## 2. Architecture

```
[ ContentAnalysis ]  (where report.predictedPlaysRange exists)
       │  analysisId
       ▼
[ ActualMetric ]   (1-1 if retro completed)
       │
       ▼
[ aggregate.ts ]
   - 拉 analysis (报告含 predictedPlaysRange) JOIN actualMetric
   - 每行算 verdict + ratio
   - 全集做 stat counts
   - 最近 5 条取明细 (orderBy completedAt desc)
       ▼
[ DashboardSummary.predictionAccuracy ]
       ▼
[ /dashboard/page.tsx ]
   - 有数据 → <PredictionAccuracy />
   - 0 条 → <PredictionAccuracyLocked />
```

## 3. Data Model

### 3.1 Schema 变更

**无。** 完全复用:
- `ContentAnalysis.report.predictedPlaysRange` (L1 phase 已写入)
- `ActualMetric.plays` (retro phase 写入)
- `ContentAnalysis.completedAt` (= 预测时间戳)

### 3.2 新 TypeScript 类型 (in `src/lib/dashboard/types.ts`)

```typescript
export type PredictionVerdict = 'in-range' | 'over' | 'under';

export interface PredictionAccuracyEntry {
  id: string;                 // ContentAnalysis.id
  videoFilename: string;
  completedAt: string;        // ISO
  predicted: number;
  lower: number;
  upper: number;
  actual: number;             // ActualMetric.plays serialized BigInt → number
  verdict: PredictionVerdict;
  deltaPct: number;           // round(|actual - predicted| / predicted * 100)
}

export interface PredictionAccuracySummary {
  totalSamples: number;
  inRangeCount: number;
  overCount: number;
  underCount: number;
  recent: PredictionAccuracyEntry[];  // top 5 by completedAt desc
}

// 加到 DashboardSummary:
export interface DashboardSummary {
  // ...existing fields...
  predictionAccuracy: PredictionAccuracySummary | null;  // null = 0 条有预测的复盘
}
```

## 4. Verdict 定义 (纯函数)

```typescript
// src/lib/dashboard/prediction-accuracy.ts (新文件)
import type { PredictionVerdict } from './types';

export function verdictOf(
  actual: number,
  range: { predicted: number; lower: number; upper: number }
): PredictionVerdict {
  if (actual < range.lower) return 'over';   // 预测偏高 (actual < lower → AI 偏乐观)
  if (actual > range.upper) return 'under';  // 预测偏低 (actual > upper → AI 偏保守)
  return 'in-range';                          // [lower, upper] 之内 = 准
}

export function deltaPct(actual: number, predicted: number): number {
  if (predicted <= 0) return 0;
  return Math.round((Math.abs(actual - predicted) / predicted) * 100);
}
```

**单测覆盖** (`tests/lib/dashboard/prediction-accuracy.test.ts`):

- actual=2000, range={p:2000, l:1000, u:4000} → in-range, deltaPct=0
- actual=500, range={p:2000, l:1000, u:4000} → over, deltaPct=75
- actual=8000, range={p:2000, l:1000, u:4000} → under, deltaPct=300
- actual=1000, range={p:2000, l:1000, u:4000} → in-range (边界)
- actual=999, range={p:2000, l:1000, u:4000} → over (边界 -1)
- predicted=0 → deltaPct=0 (避免除零)

## 5. UI 布局

### 5.1 数据存在态 (`<PredictionAccuracy />`)

```
┌──────────────────────────────────────────────────────────────┐
│  🎯 L1 预测精度                          基于 8 条复盘          │
│                                                              │
│  ┌────────┐  ┌────────┐  ┌────────┐                          │
│  │ ✓ 5 准 │  │⚠ 2 偏高│  │⚠ 1 偏低│                          │
│  └────────┘  └────────┘  └────────┘                          │
│                                                              │
│  视频              预测            实际       落差            │
│  ──────────────────────────────────────────                 │
│  mock-3.mp4       1.2k-4.8k       8.0k       [偏低 +66%]   │
│  mock-2.mp4       800-3.2k        1.5k       [准]          │
│  ...                                                        │
└──────────────────────────────────────────────────────────────┘
```

**Verdict badge 颜色:**
- in-range: `bg-green-100 text-green-900` "准"
- over: `bg-red-100 text-red-900` "偏高 -X%" (实际比预测低 → 负号符号意)
- under: `bg-blue-100 text-blue-900` "偏低 +X%" (实际比预测高 → 正号)

注意符号: `over` = AI 偏乐观, 实际 < predicted → 负偏差; `under` = AI 偏保守, 实际 > predicted → 正偏差。 UI 文案符合直觉。

### 5.2 Locked 态 (`<PredictionAccuracyLocked />`)

```
┌──────────────────────────────────────────────────────────────┐
│  🎯 L1 预测精度 (锁定中)                                       │
│                                                              │
│  需要 ≥ 1 条 "有预测 的 复盘" 才能解锁。 你当前: 0 条。        │
│                                                              │
│  💡 预测 = 上传时 L1 算出的播放区间                            │
│      复盘 = 视频发布后, 你粘抖音 URL 拉真实数据                 │
└──────────────────────────────────────────────────────────────┘
```

### 5.3 Dashboard 整体放置顺序

```
StatsBar
OverallScoreTrend
CalibrationMatrix / CalibrationLocked
PredictionAccuracy / PredictionAccuracyLocked   ← 新增此处
3-col grid: NicheDistribution | TopPerformers | BiggestMisses
```

## 6. Aggregate 实现

`src/lib/dashboard/aggregate.ts` 新增并发查询 + JS 处理:

```typescript
// 在现有 Promise.all 数组里加一项:
prisma.contentAnalysis.findMany({
  where: { userId, status: 'COMPLETED' },
  select: {
    id: true,
    videoFilename: true,
    completedAt: true,
    report: true,
    actualMetrics: { select: { plays: true }, orderBy: { snapshotAt: 'desc' }, take: 1 },
  },
}),
```

(为字段名加 `predictionAccuracyRows`。 实际 query 一次拉 analysis + 最近一次 ActualMetric。)

JS 端处理:
```typescript
const predictionAccuracyEntries: PredictionAccuracyEntry[] = predictionAccuracyRows
  .map((r) => {
    const range = (r.report as any)?.predictedPlaysRange;
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

return {
  // ...existing fields...
  predictionAccuracy,
};
```

## 7. Testing

### 7.1 单测

**`tests/lib/dashboard/prediction-accuracy.test.ts` (新)** — verdictOf + deltaPct 6 个 case (见 §4)。

**`tests/lib/dashboard/aggregate.test.ts` (改)** — 新增 2 个 it():
- `aggregateDashboard 计算 predictionAccuracy: 1 in-range + 1 over` (mock 2 条 analysis with retroReport + actualMetrics)
- `aggregateDashboard predictionAccuracy=null 当没有 prediction-retro 配对`

### 7.2 不写单测
- UI components (走手动 E2E)

### 7.3 手动 E2E

1. **Locked state:**
   - 清掉所有 mock 数据, 打开 /dashboard
   - PredictionAccuracy 显示 locked, "你当前: 0 条"

2. **有数据 state (注入 3 条):**
   - mock 3 条 ContentAnalysis + ActualMetric (verdict 各异), 注入 predictedPlaysRange 到 report
   - 刷新 /dashboard
   - 3 stat 显示 1/1/1, 表显示 3 条
   - 颜色 badge 正确 (绿/红/蓝)

3. **deltaPct 计算正确:**
   - 注入 actual=8000, predicted=2000 → 表显示 "[偏低 +300%]"

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| ContentAnalysis 没有 `predictedPlaysRange` 字段 (老 analysis) | aggregate 过滤掉, 不计入 |
| 关联 ActualMetric 没有 (未复盘) | 同上, 过滤掉 |
| `actualMetrics[0]` 是 undefined (race condition) | 同上, 过滤掉 |
| `predicted <= 0` (极端) | deltaPct=0, verdict 仍按 lower/upper 算 |
| `totalSamples === 0` | aggregate 返回 null, UI 显示 Locked |

## 9. 完成标志

- ✅ verdictOf + deltaPct 6 测全过
- ✅ aggregate 新增 2 测全过
- ✅ Dashboard /dashboard 渲染 4 档稀疏状态 (0 / 1 / 3+ / 10+)
- ✅ Verdict badge 颜色 + 文案符号正确 (over=负偏差, under=正偏差)
- ✅ typecheck 0 错, npm test 全绿
