# 发布前流量预测实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稿子 / 口播 → 5 项打分 → 按账号基线换算出分项预测与播放区间；定稿与录制后锁定；复盘时对账；连续同向偏差时回测并提议调整公式，用户采纳才生效。

**Architecture:** `src/lib/predict/` 分五块：`formula.ts`（纯换算）、`score.ts`（模型打分）、`run.ts`（取数 → 打分 → 换算 → 存；后台任务）、`calibrate.ts`（对账、偏差检测、提议、回测、采纳）、`lag.ts`（落后提醒）。复盘生成后调用对账；定稿与转写成功后启动锁定预测任务；界面、命令行、编导工具都调同一个 `runPrediction`。

**Tech Stack:** Next.js 14、Prisma 5、zod、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-09-30-view-prediction-design.md`

## Global Constraints

- 公式第 1 版参数（spec §4）：`k 0.15`；`metricOffset` 全 0；`weights { hook 0.3, topic 0.2, pace 0.2, ending 0.15, interaction 0.15 }`；`viewBase 2`；`viewOffset 0`；`benchmarkBonus 0.3`（对标 `ratio ≥ 3` 时）。
- 基线与判定与复盘完全一致：`computeBaseline`（最近 10 条公开作品中位数，至少 3 条），判定阈值 20%，跳出率越低越好。
- 四档边界（相对基线播放）：`[0, 0.5)`、`[0.5, 2)`、`[2, 5)`、`[5, ∞)`；σ：已对账 < 5 → `ln 3`，5–14 → `ln 2`，≥ 15 → `ln 1.6`；四档概率为整数百分比，和为 100。
- 盲打：打分输入只有稿子 / 转写、定位、对标拆解；项目已关联发布作品后拒绝任何新预测，文案 `已经有数据了，这时再预测不算数`。
- 锁定预测（final / recorded）没有更新、删除接口；草稿每项目只留最近 5 条。
- 校准：最近 3 条有效样本同向且每条偏差 > 20% 才触发；单次调整幅度 ≤ 30%；回测新参数更准才提议；同时最多一条 `proposed`；用户采纳才生效，已有预测不重算。
- 落后提醒：发布满 1 天不满 2 天播放 < 中枢 30%，满 2 天不满 3 天 < 50%；每个项目每天最多一条。
- 定稿、转写、复盘的主流程不因预测失败而失败。
- `mp predict run` 为 `hermes: false`。

## Review Focus

1. **模型两次都没按格式打分**：任务失败并写明"模型没按格式打分"，不存半截预测。→ Task 3 测试 `fails without saving when scoring fails twice`。
2. **公开作品少于 3 条 / 某项指标历史为空**：不给数字、不报错；对账跳过无基线指标。→ Task 1 测试 `gives no numbers without a view baseline`、Task 4 测试 `skips metrics without a prediction`。
3. **同一项目连点两次「预测」或按钮与编导工具同时触发**：不并发跑两份。→ Task 3 测试 `runs predictions for one project one at a time`。
4. **偏差只是 3 条里 2 条同向、或有一条偏差小于 20%**：不提议。→ Task 4 测试 `needs three same-direction misses beyond 20%`。
5. **新作品发布后的当天晚上（不满 1 天）**：不算落后。→ Task 5 测试 `does not flag the publish day`。

---

## 文件结构

```
src/lib/predict/formula.ts     维度与指标映射、参数、换算、四档概率、置信度
src/lib/predict/score.ts       打分 schema、提示词、消息拼装
src/lib/predict/store.ts       当前公式(没有就写入第 1 版)、已对账样本数(不依赖复盘模块, 避免循环引用)
src/lib/predict/run.ts         取数、盲打守卫、打分重试、保存、草稿裁剪、摘要、后台任务
src/lib/predict/calibrate.ts   对账、偏差检测、调参、回测、提议、采纳
src/lib/predict/lag.ts         落后判定与提醒
src/lib/predict/view.ts        PredictionView、格式化文字(命令行/工具/通知共用)
src/lib/retro/diagnose.ts      导出 metricValues / verdictOf / MetricKey
src/lib/retro/generate.ts      导出 toMetricSet; 复盘后对账
src/lib/jobs/registry.ts       predict_draft / predict_final / predict_recorded; 转写后锁定
src/lib/script/finalize.ts     定稿后锁定
src/lib/tools/predict.ts       编导 predict_views
src/lib/cli/commands/predict.ts mp predict run/show/list
src/app/api/projects/[id]/predictions/route.ts
src/app/api/predict/formulas/route.ts、[version]/route.ts
src/components/project/prediction-panel.tsx、prediction-summary.tsx
src/components/retro/formula-card.tsx
```

---

### Task 1: 换算公式

**Files:**
- Create: `src/lib/predict/formula.ts`
- Modify: `src/lib/retro/diagnose.ts`（导出 `metricValues`、`verdictOf`、`type MetricKey`；原私有函数改名导出，内部调用同步改名）
- Test: `tests/lib/predict/formula.test.ts`

**Interfaces:**
- Produces:
  - `DIMS = ['hook', 'pace', 'ending', 'interaction', 'topic'] as const`；`type Dim`；`DIM_LABEL: Record<Dim, string>`（开头钩子 / 节奏与信息密度 / 结尾收束 / 互动引子 / 选题与受众）
  - `METRIC_KEYS: MetricKey[]`（`hook2s, hook5s, middle, ending, like, favorite, share, subscribe`）；`METRIC_DIM: Record<MetricKey, Dim>`
  - `interface FormulaParams { k: number; metricOffset: Record<MetricKey, number>; weights: Record<Dim, number>; viewBase: number; viewOffset: number; benchmarkBonus: number }`；`DEFAULT_PARAMS`
  - `interface MetricPrediction { key: MetricKey; baseline: number | null; predicted: number | null; verdict: Verdict }`
  - `interface Bucket { label: string; lo: number; hi: number | null; prob: number }`
  - `type Confidence = 'low' | 'mid' | 'high'`
  - `interface PredictionResult { metrics: MetricPrediction[]; composite: number; benchmarkBonus: number; baselineViews: number | null; center: number | null; buckets: Bucket[]; confidence: Confidence; calibratedCount: number }`
  - `predictMetric(key, score, baseline, p): number | null`
  - `compositeOf(scores: Record<Dim, number>, p, benchmarkHit: boolean): { composite: number; bonus: number }`
  - `centerOf(baselineViews: number, composite: number, p): number`
  - `confidenceOf(n: number): Confidence`；`sigmaOf(c: Confidence): number`
  - `bucketsFor(baselineViews: number, center: number, sigma: number): Bucket[]`
  - `bucketIndex(buckets: Bucket[], views: number): number`
  - `fmtViews(n: number): string`
  - `computePrediction(i: { scores: Record<Dim, number>; baselines: Partial<Record<MetricKey, number>>; baselineViews: number | null; benchmarkHit: boolean; calibratedCount: number; params: FormulaParams }): PredictionResult`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { bucketIndex, bucketsFor, centerOf, compositeOf, computePrediction, confidenceOf, DEFAULT_PARAMS, fmtViews, predictMetric, sigmaOf } from '@/lib/predict/formula';

const three = { hook: 3, pace: 3, ending: 3, interaction: 3, topic: 3 };

describe('predict formula', () => {
  it('moves a metric 15% per point, inverted for the 2s bounce rate', () => {
    expect(predictMetric('hook5s', 5, 0.5, DEFAULT_PARAMS)).toBeCloseTo(0.65);
    expect(predictMetric('hook2s', 5, 0.4, DEFAULT_PARAMS)).toBeCloseTo(0.28);
    expect(predictMetric('middle', 2, 20, DEFAULT_PARAMS)).toBeCloseTo(17);
    expect(predictMetric('like', 3, null, DEFAULT_PARAMS)).toBeNull();
    expect(predictMetric('like', 3, 0.02, { ...DEFAULT_PARAMS, metricOffset: { ...DEFAULT_PARAMS.metricOffset, like: -0.5 } })).toBeCloseTo(0.01);
  });
  it('weights the composite and adds the benchmark bonus', () => {
    expect(compositeOf(three, DEFAULT_PARAMS, false)).toEqual({ composite: 3, bonus: 0 });
    expect(compositeOf({ ...three, hook: 5 }, DEFAULT_PARAMS, true).composite).toBeCloseTo(3 + 0.6 + 0.3);
  });
  it('doubles the center per composite point', () => {
    expect(centerOf(2900, 3, DEFAULT_PARAMS)).toBe(2900);
    expect(centerOf(2900, 4, DEFAULT_PARAMS)).toBe(5800);
    expect(centerOf(2900, 3, { ...DEFAULT_PARAMS, viewOffset: -1 })).toBe(1450);
  });
  it('makes four buckets that add up to 100 and are flatter with fewer samples', () => {
    const low = bucketsFor(2900, 2900, sigmaOf('low'));
    expect(low.map((b) => b.label)).toEqual(['<1,450', '1,450–5,800', '5,800–1.5万', '≥1.5万']);
    expect(low.reduce((s, b) => s + b.prob, 0)).toBe(100);
    const high = bucketsFor(2900, 2900, sigmaOf('high'));
    expect(high[1].prob).toBeGreaterThan(low[1].prob);
    expect(bucketIndex(low, 6000)).toBe(2);
    expect(bucketIndex(low, 100000)).toBe(3);
  });
  it('grades confidence by calibrated samples', () => {
    expect([confidenceOf(0), confidenceOf(4), confidenceOf(5), confidenceOf(14), confidenceOf(15)]).toEqual(['low', 'low', 'mid', 'mid', 'high']);
  });
  it('formats views', () => {
    expect([fmtViews(1450), fmtViews(14500), fmtViews(125000)]).toEqual(['1,450', '1.5万', '12.5万']);
  });
  it('computes metrics with verdicts like the retro', () => {
    const r = computePrediction({ scores: { ...three, hook: 5, ending: 1 }, baselines: { hook2s: 0.4, hook5s: 0.5, ending: 0.1 }, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
    const m = Object.fromEntries(r.metrics.map((x) => [x.key, x]));
    expect(m.hook2s.verdict).toBe('good');
    expect(m.ending.verdict).toBe('bad');
    expect(m.like).toMatchObject({ baseline: null, predicted: null, verdict: 'na' });
    expect(r.center).toBeGreaterThan(2900);
    expect(r.confidence).toBe('low');
  });
  it('gives no numbers without a view baseline', () => {
    const r = computePrediction({ scores: three, baselines: {}, baselineViews: null, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
    expect(r).toMatchObject({ baselineViews: null, center: null, buckets: [] });
    expect(r.metrics.every((x) => x.predicted === null)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/predict/formula.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 导出复盘里的判定工具**

`src/lib/retro/diagnose.ts`：
- `type Key = …` 改为 `export type MetricKey = …`，文件内 `Key` 全部改成 `MetricKey`；
- `function values(` 改为 `export function metricValues(`，文件内调用 `values(` 改为 `metricValues(`；
- `function verdictOf(` 改为 `export function verdictOf(`。

- [ ] **Step 4: 实现 `src/lib/predict/formula.ts`**

```ts
import { verdictOf, type MetricKey, type Verdict } from '@/lib/retro/diagnose';

export const DIMS = ['hook', 'pace', 'ending', 'interaction', 'topic'] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_LABEL: Record<Dim, string> = { hook: '开头钩子', pace: '节奏与信息密度', ending: '结尾收束', interaction: '互动引子', topic: '选题与受众' };

export const METRIC_KEYS: MetricKey[] = ['hook2s', 'hook5s', 'middle', 'ending', 'like', 'favorite', 'share', 'subscribe'];
export const METRIC_DIM: Record<MetricKey, Dim> = { hook2s: 'hook', hook5s: 'hook', middle: 'pace', ending: 'ending', like: 'interaction', favorite: 'interaction', share: 'interaction', subscribe: 'interaction' };

export interface FormulaParams {
  k: number;
  metricOffset: Record<MetricKey, number>;
  weights: Record<Dim, number>;
  viewBase: number;
  viewOffset: number;
  benchmarkBonus: number;
}

export const DEFAULT_PARAMS: FormulaParams = {
  k: 0.15,
  metricOffset: { hook2s: 0, hook5s: 0, middle: 0, ending: 0, like: 0, favorite: 0, share: 0, subscribe: 0 },
  weights: { hook: 0.3, topic: 0.2, pace: 0.2, ending: 0.15, interaction: 0.15 },
  viewBase: 2,
  viewOffset: 0,
  benchmarkBonus: 0.3,
};

export interface MetricPrediction {
  key: MetricKey;
  baseline: number | null;
  predicted: number | null;
  verdict: Verdict;
}
export interface Bucket {
  label: string;
  lo: number;
  hi: number | null;
  prob: number;
}
export type Confidence = 'low' | 'mid' | 'high';
export interface PredictionResult {
  metrics: MetricPrediction[];
  composite: number;
  benchmarkBonus: number;
  baselineViews: number | null;
  center: number | null;
  buckets: Bucket[];
  confidence: Confidence;
  calibratedCount: number;
}

export function predictMetric(key: MetricKey, score: number, baseline: number | null, p: FormulaParams): number | null {
  if (baseline === null) return null;
  const dir = key === 'hook2s' ? -1 : 1; // 跳出率越低越好
  return baseline * (1 + dir * p.k * (score - 3)) * (1 + p.metricOffset[key]);
}

export function compositeOf(scores: Record<Dim, number>, p: FormulaParams, benchmarkHit: boolean) {
  const base = DIMS.reduce((s, d) => s + p.weights[d] * scores[d], 0);
  const bonus = benchmarkHit ? p.benchmarkBonus : 0;
  return { composite: Math.round((base + bonus) * 1000) / 1000, bonus };
}

export const centerOf = (baselineViews: number, composite: number, p: FormulaParams) => Math.round(baselineViews * p.viewBase ** (composite - 3 + p.viewOffset));

export const confidenceOf = (n: number): Confidence => (n < 5 ? 'low' : n < 15 ? 'mid' : 'high');
export const sigmaOf = (c: Confidence) => Math.log(c === 'low' ? 3 : c === 'mid' ? 2 : 1.6);

export function fmtViews(n: number): string {
  if (n < 10000) return Math.round(n).toLocaleString('en-US');
  return `${(Math.round(n / 1000) / 10).toString()}万`;
}

// Abramowitz–Stegun 7.1.26
function erf(x: number) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const phi = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

const EDGES = [0, 0.5, 2, 5];

export function bucketsFor(baselineViews: number, center: number, sigma: number): Bucket[] {
  const cdf = (v: number | null) => (v === null ? 1 : v <= 0 ? 0 : phi((Math.log(v) - Math.log(center)) / sigma));
  const raw = EDGES.map((e, i) => {
    const lo = e * baselineViews;
    const hi = i + 1 < EDGES.length ? EDGES[i + 1] * baselineViews : null;
    return { lo, hi, p: cdf(hi) - cdf(lo) };
  });
  const probs = raw.map((r) => Math.round(r.p * 100));
  const fix = 100 - probs.reduce((s, x) => s + x, 0);
  probs[probs.indexOf(Math.max(...probs))] += fix;
  return raw.map((r, i) => ({
    label: r.lo === 0 ? `<${fmtViews(r.hi!)}` : r.hi === null ? `≥${fmtViews(r.lo)}` : `${fmtViews(r.lo)}–${fmtViews(r.hi)}`,
    lo: Math.round(r.lo),
    hi: r.hi === null ? null : Math.round(r.hi),
    prob: probs[i],
  }));
}

export const bucketIndex = (buckets: Bucket[], views: number) => buckets.findIndex((b) => views >= b.lo && (b.hi === null || views < b.hi));

export function computePrediction(i: {
  scores: Record<Dim, number>;
  baselines: Partial<Record<MetricKey, number>>;
  baselineViews: number | null;
  benchmarkHit: boolean;
  calibratedCount: number;
  params: FormulaParams;
}): PredictionResult {
  const { composite, bonus } = compositeOf(i.scores, i.params, i.benchmarkHit);
  const confidence = confidenceOf(i.calibratedCount);
  const noViews = i.baselineViews === null;
  const metrics = METRIC_KEYS.map((key): MetricPrediction => {
    const baseline = noViews ? null : i.baselines[key] ?? null;
    const predicted = predictMetric(key, i.scores[METRIC_DIM[key]], baseline, i.params);
    return { key, baseline, predicted, verdict: verdictOf(key, predicted, baseline) };
  });
  const center = noViews ? null : centerOf(i.baselineViews!, composite, i.params);
  return {
    metrics,
    composite,
    benchmarkBonus: bonus,
    baselineViews: i.baselineViews,
    center,
    buckets: center === null ? [] : bucketsFor(i.baselineViews!, center, sigmaOf(confidence)),
    confidence,
    calibratedCount: i.calibratedCount,
  };
}
```

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（复盘原有测试不变）。

```bash
git add src/lib/predict src/lib/retro/diagnose.ts tests/lib/predict
git commit -m "feat(predict): 换算公式(分项预测/综合分/播放中枢/四档概率/置信度), 复用复盘判定

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 模型打分

**Files:**
- Create: `src/lib/predict/score.ts`
- Test: `tests/lib/predict/score.test.ts`

**Interfaces:**
- Consumes：`DIMS`、`Dim`（Task 1）、`StructuredLLM`（`src/lib/script/write.ts`）
- Produces：
  - `ScoreSchema`（zod）；`interface DimScore { dim: Dim; score: number; reason: string; quote: string; segmentId: string | null; fix: string }`
  - `interface ScoreInput { segments: { id: string; label: string; text: string; estSec: number }[] | null; transcript: string[] | null; persona: string; benchmark: string }`
  - `SCORE_SYSTEM: string`
  - `buildScoreMessage(i: ScoreInput): string`
  - `scoreScript(llm: StructuredLLM, i: ScoreInput): Promise<DimScore[]>`（单次调用，schema 由 `callStructured` 校验）
  - `scoreMap(scores: DimScore[]): Record<Dim, number>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';
import { buildScoreMessage, scoreMap, scoreScript, ScoreSchema, SCORE_SYSTEM } from '@/lib/predict/score';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim, i) => ({ dim, score: i + 1, reason: 'r', quote: '', segmentId: null, fix: '' }));

describe('predict scoring', () => {
  it('accepts exactly five distinct dimensions', () => {
    expect(ScoreSchema.safeParse({ scores: five }).success).toBe(true);
    expect(ScoreSchema.safeParse({ scores: five.slice(0, 4) }).success).toBe(false);
    expect(ScoreSchema.safeParse({ scores: [...five.slice(0, 4), { ...five[0] }] }).success).toBe(false);
    expect(ScoreSchema.safeParse({ scores: five.map((s) => ({ ...s, score: 6 })) }).success).toBe(false);
  });
  it('builds a blind message from the script only', () => {
    const m = buildScoreMessage({ segments: [{ id: 's1', label: '开场钩子', text: '一个 U 盘能卖到第一？', estSec: 6 }], transcript: null, persona: '定位：真实', benchmark: '选题：小品类' });
    expect(m).toContain('[s1] 开场钩子（约 6 秒）\n一个 U 盘能卖到第一？');
    expect(m).toContain('【账号定位】\n定位：真实');
    expect(m).toContain('【对标拆解】\n选题：小品类');
    expect(m).not.toMatch(/播放|点赞数|完播率 \d/);
  });
  it('uses the transcript when given', () => {
    expect(buildScoreMessage({ segments: null, transcript: ['第一句', '第二句'], persona: '', benchmark: '' })).toContain('【实际口播（逐句）】\n第一句\n第二句');
  });
  it('explains the scale and the Douyin signals in the system prompt', () => {
    expect(SCORE_SYSTEM).toContain('2 秒');
    expect(SCORE_SYSTEM).toContain('只输出 JSON');
  });
  it('calls the model once and maps scores', async () => {
    const llm = { callStructured: vi.fn(async () => ({ result: { scores: five }, usage: {} })) };
    const s = await scoreScript(llm as never, { segments: null, transcript: ['x'], persona: '', benchmark: '' });
    expect(llm.callStructured).toHaveBeenCalledTimes(1);
    expect(scoreMap(s)).toEqual({ hook: 1, pace: 2, ending: 3, interaction: 4, topic: 5 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/predict/score.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/predict/score.ts`**

```ts
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { DIMS, type Dim } from './formula';

export const ScoreSchema = z.object({
  scores: z
    .array(
      z.object({
        dim: z.enum(DIMS),
        score: z.number().int().min(1).max(5),
        reason: z.string().min(1),
        quote: z.string(),
        segmentId: z.string().nullable(),
        fix: z.string(),
      }),
    )
    .length(5)
    .refine((xs) => new Set(xs.map((x) => x.dim)).size === 5, '5 个维度各打一次'),
});
export type DimScore = z.infer<typeof ScoreSchema>['scores'][number];

export interface ScoreInput {
  segments: { id: string; label: string; text: string; estSec: number }[] | null;
  transcript: string[] | null;
  persona: string;
  benchmark: string;
}

export const SCORE_SYSTEM = `你是抖音口播的流量评审，只根据稿子本身打分，不猜播放量。
抖音按观众行为推荐：前 2 秒有没有划走、前 5 秒有没有留下、平均看了多久、有没有看完、有没有点赞 / 收藏 / 评论 / 分享 / 关注。
按下面 5 个维度各打 1–5 的整数分（3 = 这个账号的平常水平）：
- hook 开头钩子：前 2 秒能否让人停下，前 5 秒是否给出看下去的理由。1 = 寒暄或铺垫开场；3 = 有具体承诺或反常识断言；5 = 具体生动、让人没法不看下去。
- pace 节奏与信息密度：有无注水段，信息点间隔，中段有无新钩子。1 = 大段重复或空话；3 = 平稳推进；5 = 每 5–8 秒都有新信息或新悬念。
- ending 结尾收束：结尾是否干脆，有无让人看完的回收。1 = 拖沓或草草结束；3 = 正常总结；5 = 回收开头悬念或有让人想看完的反转。
- interaction 互动引子：有无让人点赞、收藏、评论、分享、关注的理由。1 = 没有；3 = 一句泛泛的"点个赞"；5 = 有值得收藏的干货、能引发讨论的观点或明确的关注理由。
- topic 选题与受众：选题大众度、与账号定位的契合、对标背书。1 = 小众且偏离定位；3 = 定位内常规选题；5 = 定位内、受众广、有对标爆款验证。
每个维度给：score、reason（一句理由）、quote（作为依据的原句，没有就空串）、segmentId（原句所在段落 id，按口播打分时为 null）、fix（3 分以下必须写一句怎么改，3 分及以上可以空串）。
只输出 JSON：{"scores": [{"dim": "hook", "score": 3, "reason": "…", "quote": "…", "segmentId": "s1", "fix": "…"}, …共 5 项]}。`;

export function buildScoreMessage(i: ScoreInput): string {
  const body = i.segments
    ? `【稿子】\n${i.segments.map((s) => `[${s.id}] ${s.label}（约 ${s.estSec} 秒）\n${s.text}`).join('\n\n')}`
    : `【实际口播（逐句）】\n${(i.transcript ?? []).join('\n')}`;
  return [i.persona ? `【账号定位】\n${i.persona}` : '', i.benchmark ? `【对标拆解】\n${i.benchmark}` : '', body].filter(Boolean).join('\n\n');
}

export async function scoreScript(llm: StructuredLLM, i: ScoreInput): Promise<DimScore[]> {
  const { result } = await llm.callStructured({ systemPrompt: SCORE_SYSTEM, userMessage: [{ type: 'text', text: buildScoreMessage(i) }], responseSchema: ScoreSchema });
  return result.scores;
}

export const scoreMap = (scores: DimScore[]) => Object.fromEntries(scores.map((s) => [s.dim, s.score])) as Record<Dim, number>;
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/predict tests/lib/predict
git commit -m "feat(predict): 5 项打分(抖音推荐信号 + 锚点)与盲打消息拼装

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 数据表、运行预测与后台任务

**Files:**
- Modify: `prisma/schema.prisma`（spec §5 三张表；`Project` 加 `predictions Prediction[]`）
- Create: `src/lib/predict/store.ts`、`src/lib/predict/run.ts`、`src/lib/predict/view.ts`
- Modify: `src/lib/retro/generate.ts`（导出 `toMetricSet`）、`src/lib/jobs/registry.ts`、`src/lib/script/finalize.ts`
- Test: `tests/lib/predict/run.test.ts`、`tests/lib/predict/view.test.ts`、`tests/lib/script/finalize.test.ts`（追加）

**Interfaces:**
- Consumes：Task 1、Task 2 全部导出；`computeBaseline`、`toMetricSet`；`withProjectLock`、`JobError`、`JobRun`
- Produces（run.ts）：
  - `type PredictKind = 'draft' | 'final' | 'recorded'`
  - `class PredictRefused extends Error`
  - `PUBLISHED_REFUSAL = '已经有数据了，这时再预测不算数'`
  - `interface PredictInput { published: boolean; segments: ScoreInput['segments']; transcript: string[] | null; persona: string; benchmark: string; benchmarkHit: boolean; baselines: Partial<Record<MetricKey, number>>; baselineViews: number | null; calibratedCount: number; formula: { version: number; params: FormulaParams } }`
  - `interface PredictDeps { load(projectId: string, kind: PredictKind): Promise<PredictInput>; llm: StructuredLLM | null; modelLabel: string; save(row: { projectId: string; kind: PredictKind; formulaVersion: number; inputHash: string; scores: DimScore[]; result: PredictionResult }): Promise<{ id: string }>; trimDrafts(projectId: string): Promise<void> }`
  - `runPrediction(deps: PredictDeps, projectId: string, kind: PredictKind): Promise<{ id: string; summary: string; scores: DimScore[]; result: PredictionResult; formulaVersion: number }>`（同一项目串行）
  - store.ts：`ensureActiveFormula(db): Promise<{ version: number; params: FormulaParams }>`、`calibratedCount(db): Promise<number>`（run.ts 与 calibrate.ts 都从 store 引用；store 不引用复盘模块，避免 generate → calibrate → run → generate 的循环）
  - `createPredictDeps(db: PrismaClient, llm?: StructuredLLM | null, label?: string): Promise<PredictDeps>`
  - `predictJob(kind: PredictKind): JobRun`
- Produces（view.ts）：
  - `interface PredictionView { id: string; kind: PredictKind; createdAt: string; formulaVersion: number; scores: DimScore[]; result: PredictionResult; check: CheckView | null }`，`interface CheckView { dayN: number; ratios: Partial<Record<MetricKey, number>>; viewRatio: number | null; bucketHit: boolean | null; verdicts: Partial<Record<MetricKey, 'hit' | 'optimistic' | 'pessimistic'>> }`
  - `toPredictionView(row): PredictionView`
  - `KIND_LABEL: Record<PredictKind, string>`（草稿预测 / 定稿预测 / 录制后预测）
  - `summarize(kind: PredictKind, scores: DimScore[], r: PredictionResult): string`
  - `formatPrediction(p: PredictionView): string`（多行，命令行 / 工具 detail 用）
  - `dragItems(scores: DimScore[]): DimScore[]`（分数 ≤ 3 中最低的至多 2 项）
- Registry：`JOB_KINDS.predict_draft / predict_final / predict_recorded`；转写任务成功后启动 `predict_recorded`
- finalize：`finalizeScript(db, projectId, propose?, predict?)`，`predict` 默认启动 `predict_final`

- [ ] **Step 1: schema**

按 spec §5 追加 `Prediction`、`PredictionCheck`、`PredictionFormula`，`model Project` 关系里加 `predictions    Prediction[]`。

Run: `npx prisma db push && npm run typecheck`
Expected: in sync；0 错误。

- [ ] **Step 2: 写失败测试**

`tests/lib/predict/run.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runPrediction, PredictRefused, type PredictDeps, type PredictInput } from '@/lib/predict/run';
import { DEFAULT_PARAMS } from '@/lib/predict/formula';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim) => ({ dim, score: 3, reason: 'r', quote: '', segmentId: null, fix: '' }));
const input = (over: Partial<PredictInput> = {}): PredictInput => ({
  published: false,
  segments: [{ id: 's1', label: '开场钩子', text: 't', estSec: 5 }],
  transcript: null,
  persona: '',
  benchmark: '',
  benchmarkHit: false,
  baselines: { hook2s: 0.4 },
  baselineViews: 2900,
  calibratedCount: 0,
  formula: { version: 1, params: DEFAULT_PARAMS },
  ...over,
});

function deps(over: Partial<PredictDeps> = {}, callStructured = vi.fn(async () => ({ result: { scores: five }, usage: {} }))) {
  const saved: unknown[] = [];
  const trimmed: string[] = [];
  const d: PredictDeps = {
    load: async () => input(),
    llm: { callStructured } as never,
    modelLabel: 'DeepSeek',
    save: async (row) => (saved.push(row), { id: `pr${saved.length}` }),
    trimDrafts: async (p) => void trimmed.push(p),
    ...over,
  };
  return { d, saved, trimmed, callStructured };
}

describe('runPrediction', () => {
  it('scores, computes and saves a locked prediction', async () => {
    const { d, saved, trimmed } = deps();
    const r = await runPrediction(d, 'p1', 'final');
    expect(r.id).toBe('pr1');
    expect(saved[0]).toMatchObject({ projectId: 'p1', kind: 'final', formulaVersion: 1 });
    expect((saved[0] as { inputHash: string }).inputHash).toMatch(/^[0-9a-f]{12}$/);
    expect(r.summary).toContain('定稿预测：中枢约 2,900');
    expect(trimmed).toEqual([]);
  });
  it('trims drafts after a draft prediction', async () => {
    const { d, trimmed } = deps();
    await runPrediction(d, 'p1', 'draft');
    expect(trimmed).toEqual(['p1']);
  });
  it('refuses once the work is published, without calling the model', async () => {
    const { d, callStructured } = deps({ load: async () => input({ published: true }) });
    await expect(runPrediction(d, 'p1', 'draft')).rejects.toThrow('已经有数据了，这时再预测不算数');
    expect(callStructured).not.toHaveBeenCalled();
  });
  it('refuses without a script or a transcript', async () => {
    await expect(runPrediction(deps({ load: async () => input({ segments: null }) }).d, 'p1', 'final')).rejects.toThrow('还没有稿子，不能预测');
    await expect(runPrediction(deps({ load: async () => input({ segments: null }) }).d, 'p1', 'recorded')).rejects.toThrow('还没有转写，不能按口播预测');
    await expect(runPrediction(deps({ llm: null }).d, 'p1', 'draft')).rejects.toThrow(PredictRefused);
  });
  it('retries the model once', async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error('bad json')).mockResolvedValueOnce({ result: { scores: five }, usage: {} });
    const { d, saved } = deps({}, call);
    await runPrediction(d, 'p1', 'draft');
    expect(call).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1);
  });
  it('fails without saving when scoring fails twice', async () => {
    const call = vi.fn(async () => { throw new Error('schema mismatch'); });
    const { d, saved } = deps({}, call);
    await expect(runPrediction(d, 'p1', 'draft')).rejects.toThrow('模型没按格式打分');
    expect(saved).toEqual([]);
  });
  it('explains model connection errors instead', async () => {
    const call = vi.fn(async () => { throw Object.assign(new Error('401 Unauthorized'), { status: 401 }); });
    await expect(runPrediction(deps({}, call).d, 'p1', 'draft')).rejects.toThrow('DeepSeek拒绝了请求');
  });
  it('runs predictions for one project one at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const call = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { result: { scores: five }, usage: {} };
    });
    const { d } = deps({}, call);
    await Promise.all([runPrediction(d, 'p1', 'draft'), runPrediction(d, 'p1', 'draft')]);
    expect(maxActive).toBe(1);
  });
  it('says numbers need more works when there is no view baseline', async () => {
    const { d } = deps({ load: async () => input({ baselineViews: null }) });
    expect((await runPrediction(d, 'p1', 'draft')).summary).toContain('公开作品少于 3 条，暂不预测数字');
  });
});
```

`tests/lib/predict/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dragItems, formatPrediction, summarize } from '@/lib/predict/view';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

const s = (dim: string, score: number, fix = '') => ({ dim, score, reason: `${dim} 理由`, quote: '', segmentId: null, fix }) as never;
const scores = [s('hook', 2, '开头直接说结果'), s('pace', 3), s('ending', 1, '结尾回收开头的问题'), s('interaction', 4), s('topic', 3)];
const result = computePrediction({ scores: { hook: 2, pace: 3, ending: 1, interaction: 4, topic: 3 }, baselines: {}, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });

describe('prediction view', () => {
  it('picks at most two lowest scores at or below 3', () => {
    expect(dragItems(scores).map((x) => x.dim)).toEqual(['ending', 'hook']);
  });
  it('summarizes the center and the most likely bucket', () => {
    const t = summarize('final', scores, result);
    expect(t).toMatch(/^定稿预测：中枢约 [\d,]+，最可能 .+（\d+%）/);
    expect(t).toContain('拖后腿：结尾收束、开头钩子');
  });
  it('formats a multi-line view', () => {
    const t = formatPrediction({ id: 'x', kind: 'draft', createdAt: '2026-09-30T00:00:00.000Z', formulaVersion: 1, scores, result, check: null });
    expect(t).toContain('草稿预测');
    expect(t).toContain('开头钩子 2 分：hook 理由');
    expect(t).toContain('置信度低');
  });
});
```

`tests/lib/script/finalize.test.ts` 追加：

```ts
  it('starts a locked prediction after finalizing, and a failure does not undo it', async () => {
    const predict = vi.fn(async () => { throw new Error('no model'); });
    const { db, project } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1', async () => {}, predict);
    expect(predict).toHaveBeenCalledWith('p1');
    expect(project.stage).toBe('scripted');
  });
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/predict tests/lib/script/finalize.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现 `src/lib/predict/view.ts`**

```ts
import type { MetricKey } from '@/lib/retro/diagnose';
import { DIM_LABEL, type PredictionResult } from './formula';
import type { DimScore } from './score';

export type PredictKind = 'draft' | 'final' | 'recorded';
export const KIND_LABEL: Record<PredictKind, string> = { draft: '草稿预测', final: '定稿预测', recorded: '录制后预测' };

export interface CheckView {
  dayN: number;
  ratios: Partial<Record<MetricKey, number>>;
  viewRatio: number | null;
  bucketHit: boolean | null;
  verdicts: Partial<Record<MetricKey, 'hit' | 'optimistic' | 'pessimistic'>>;
}
export interface PredictionView {
  id: string;
  kind: PredictKind;
  createdAt: string;
  formulaVersion: number;
  scores: DimScore[];
  result: PredictionResult;
  check: CheckView | null;
}

export function toPredictionView(r: { id: string; kind: string; createdAt: Date; formulaVersion: number; scores: unknown; result: unknown; check?: { dayN: number; ratios: unknown; viewRatio: number | null; bucketHit: boolean | null; verdicts: unknown } | null }): PredictionView {
  return {
    id: r.id,
    kind: r.kind as PredictKind,
    createdAt: r.createdAt.toISOString(),
    formulaVersion: r.formulaVersion,
    scores: r.scores as DimScore[],
    result: r.result as PredictionResult,
    check: r.check ? { dayN: r.check.dayN, ratios: r.check.ratios as CheckView['ratios'], viewRatio: r.check.viewRatio, bucketHit: r.check.bucketHit, verdicts: r.check.verdicts as CheckView['verdicts'] } : null,
  };
}

export const dragItems = (scores: DimScore[]) => [...scores].filter((s) => s.score <= 3).sort((a, b) => a.score - b.score).slice(0, 2);

const CONF: Record<string, string> = { low: '置信度低', mid: '置信度中', high: '置信度较高' };
const RANGE: Record<string, string> = { low: '实际可能是预测的 1/3 到 3 倍', mid: '实际可能是预测的 1/2 到 2 倍', high: '实际大概在预测的 0.6 到 1.6 倍之间' };
export const confidenceText = (r: PredictionResult) => `${CONF[r.confidence]}：已对过 ${r.calibratedCount} 次账，${RANGE[r.confidence]}`;

const top = (r: PredictionResult) => r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a), r.buckets[0]);

export function summarize(kind: PredictKind, scores: DimScore[], r: PredictionResult): string {
  const drag = dragItems(scores);
  const dragText = drag.length ? `；拖后腿：${drag.map((d) => DIM_LABEL[d.dim]).join('、')}` : '';
  if (r.center === null) return `${KIND_LABEL[kind]}：${scores.map((s) => `${DIM_LABEL[s.dim]} ${s.score} 分`).join('，')}（公开作品少于 3 条，暂不预测数字）${dragText}`;
  const t = top(r);
  return `${KIND_LABEL[kind]}：中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${t.label}（${t.prob}%）${dragText}`;
}

export function formatPrediction(p: PredictionView): string {
  const r = p.result;
  return [
    `${KIND_LABEL[p.kind]}（${new Date(p.createdAt).toLocaleString('zh-CN')}，公式 v${p.formulaVersion}）`,
    ...p.scores.map((s) => `${DIM_LABEL[s.dim]} ${s.score} 分：${s.reason}${s.fix ? `（建议：${s.fix}）` : ''}`),
    r.center === null ? '公开作品少于 3 条，暂不预测数字。' : `播放中枢约 ${r.center.toLocaleString('en-US')}；${r.buckets.map((b) => `${b.label} ${b.prob}%`).join(' / ')}`,
    confidenceText(r),
  ].join('\n');
}
```

- [ ] **Step 5: 实现 `src/lib/predict/store.ts` 与 `src/lib/predict/run.ts`**

`src/lib/predict/store.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { DEFAULT_PARAMS, type FormulaParams } from './formula';

export async function ensureActiveFormula(db: PrismaClient): Promise<{ version: number; params: FormulaParams }> {
  const active = await db.predictionFormula.findFirst({ where: { status: 'active' }, orderBy: { version: 'desc' } });
  if (active) return { version: active.version, params: active.params as unknown as FormulaParams };
  const created = await db.predictionFormula.upsert({ where: { version: 1 }, update: {}, create: { version: 1, params: DEFAULT_PARAMS as unknown as Prisma.InputJsonValue, status: 'active' } });
  return { version: created.version, params: created.params as unknown as FormulaParams };
}

/** 有效样本数 = 已对账的项目数(每个项目一条) */
export async function calibratedCount(db: PrismaClient): Promise<number> {
  const rows = await db.predictionCheck.findMany({ select: { prediction: { select: { projectId: true } } } });
  return new Set(rows.map((r) => r.prediction.projectId)).size;
}
```

`src/lib/predict/run.ts`:

```ts
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { computeBaseline, type MetricKey } from '@/lib/retro/diagnose';
import { toMetricSet } from '@/lib/retro/generate';
import { median } from '@/lib/benchmark/rules';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { explainModelError } from '@/lib/llm/errors';
import { JobError, withProjectLock, type JobRun } from '@/lib/jobs/runner';
import { computePrediction, type FormulaParams, type PredictionResult } from './formula';
import { calibratedCount, ensureActiveFormula } from './store';
import { scoreMap, scoreScript, type DimScore, type ScoreInput } from './score';
import { summarize, type PredictKind } from './view';

export type { PredictKind } from './view';
export class PredictRefused extends Error {}
export const PUBLISHED_REFUSAL = '已经有数据了，这时再预测不算数';
const MAX_DRAFTS = 5;

export interface PredictInput {
  published: boolean;
  segments: ScoreInput['segments'];
  transcript: string[] | null;
  persona: string;
  benchmark: string;
  benchmarkHit: boolean;
  baselines: Partial<Record<MetricKey, number>>;
  baselineViews: number | null;
  calibratedCount: number;
  formula: { version: number; params: FormulaParams };
}

export interface PredictDeps {
  load(projectId: string, kind: PredictKind): Promise<PredictInput>;
  llm: StructuredLLM | null;
  modelLabel: string;
  save(row: { projectId: string; kind: PredictKind; formulaVersion: number; inputHash: string; scores: DimScore[]; result: PredictionResult }): Promise<{ id: string }>;
  trimDrafts(projectId: string): Promise<void>;
}

async function scoreWithRetry(deps: PredictDeps, input: ScoreInput): Promise<DimScore[]> {
  let last: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return await scoreScript(deps.llm!, input);
    } catch (e) {
      last = e;
    }
  }
  const explained = explainModelError(last, deps.modelLabel);
  // 连不上 / key 错等给出模型原因; 其余(格式不对)统一说没按格式打分
  throw new PredictRefused(/出错了：/.test(explained) || last instanceof z.ZodError ? '模型没按格式打分，再点一次试试' : explained);
}

export async function runPrediction(deps: PredictDeps, projectId: string, kind: PredictKind) {
  return withProjectLock(`predict:${projectId}`, async () => {
    const input = await deps.load(projectId, kind);
    if (input.published) throw new PredictRefused(PUBLISHED_REFUSAL);
    const useTranscript = kind === 'recorded';
    if (useTranscript ? !input.transcript?.length : !input.segments?.length) throw new PredictRefused(useTranscript ? '还没有转写，不能按口播预测' : '还没有稿子，不能预测');
    if (!deps.llm) throw new PredictRefused(NO_MODEL_MESSAGE);
    const scoreInput: ScoreInput = { segments: useTranscript ? null : input.segments, transcript: useTranscript ? input.transcript : null, persona: input.persona, benchmark: input.benchmark };
    const scores = await scoreWithRetry(deps, scoreInput);
    const result = computePrediction({ scores: scoreMap(scores), baselines: input.baselines, baselineViews: input.baselineViews, benchmarkHit: input.benchmarkHit, calibratedCount: input.calibratedCount, params: input.formula.params });
    const inputHash = createHash('sha256').update(JSON.stringify(useTranscript ? input.transcript : input.segments)).digest('hex').slice(0, 12);
    const { id } = await deps.save({ projectId, kind, formulaVersion: input.formula.version, inputHash, scores, result });
    if (kind === 'draft') await deps.trimDrafts(projectId);
    return { id, summary: summarize(kind, scores, result), scores, result, formulaVersion: input.formula.version };
  });
}

export async function createPredictDeps(db: PrismaClient, llm?: StructuredLLM | null, label?: string): Promise<PredictDeps> {
  const active = llm === undefined ? await getActiveModel(db) : null;
  return {
    llm: llm === undefined ? active?.llm ?? null : llm,
    modelLabel: label ?? active?.label ?? '模型',
    async load(projectId) {
      const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: true } });
      const published = (await db.publishedWork.count({ where: { projectId } })) > 0;
      const script = ScriptSchema.safeParse(p.script);
      const report = script.success ? checkDuration(script.data, p.targetSec) : null;
      const t = await loadCurrentTranscript(db, projectId);
      const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
      const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
      const history = await db.publishedWork.findMany({ where: { isPrivate: false, viewCount: { gt: 0 } }, orderBy: { publishedAt: 'desc' }, take: 10 });
      const views = history.map((w) => w.viewCount).filter((v): v is number => v !== null && v > 0);
      return {
        published,
        segments: script.success ? script.data.segments.map((s, i) => ({ id: s.id, label: ROLE_LABEL[s.role], text: s.text, estSec: report!.segments[i].estSec })) : null,
        transcript: t ? t.data.lines.map((l) => l.text) : null,
        persona: formatPersona(persona as PersonaLike | null),
        benchmark: a?.success ? `选题：${a.data.topic}；钩子（${a.data.hook.type}）：${a.data.hook.quote}；标题写法：${a.data.titlePattern}` : '',
        benchmarkHit: (p.benchmarkVideo?.ratio ?? 0) >= 3,
        baselines: computeBaseline(history.map(toMetricSet)).medians,
        baselineViews: views.length >= 3 ? Math.round(median(views)) : null,
        calibratedCount: await calibratedCount(db),
        formula: await ensureActiveFormula(db),
      };
    },
    async save(row) {
      const r = await db.prediction.create({ data: { ...row, scores: row.scores as unknown as Prisma.InputJsonValue, result: row.result as unknown as Prisma.InputJsonValue } });
      return { id: r.id };
    },
    async trimDrafts(projectId) {
      const old = await db.prediction.findMany({ where: { projectId, kind: 'draft' }, orderBy: { createdAt: 'desc' }, skip: MAX_DRAFTS, select: { id: true } });
      if (old.length) await db.prediction.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    },
  };
}

export function predictJob(kind: PredictKind): JobRun {
  return async (ctx) => {
    try {
      const r = await runPrediction(await createPredictDeps(ctx.db), ctx.projectId, kind);
      return { notice: r.summary };
    } catch (e) {
      throw new JobError(e instanceof PredictRefused ? `预测没完成：${e.message}` : '预测没完成：出了意外错误，再点一次试试。', e);
    }
  };
}
```

`src/lib/retro/generate.ts`：`const toMetricSet = (` 改为 `export const toMetricSet = (`。

- [ ] **Step 6: 后台任务与触发**

`src/lib/jobs/registry.ts`：

```ts
import type { PrismaClient } from '@prisma/client';
import { startExclusiveJob, type JobRun } from './runner';
import { runTranscribe } from '@/lib/recording/transcribe';
import { createTranscribeDeps } from '@/lib/recording/deps';
import { predictJob } from '@/lib/predict/run';

/** 所有后台任务种类。上传、重试、agent 工具都从这里启动, 保证同一种任务只有一种跑法。 */
export const JOB_KINDS = {
  transcribe: {
    label: '转写',
    run: (async (ctx) => {
      const out = await runTranscribe(ctx, createTranscribeDeps());
      // 转写成功后按实际口播锁定一版预测; 失败不影响转写
      await launchJob(ctx.db, ctx.projectId, 'predict_recorded').catch(() => null);
      return out;
    }) as JobRun,
  },
  predict_draft: { label: '预测', run: predictJob('draft') },
  predict_final: { label: '定稿预测', run: predictJob('final') },
  predict_recorded: { label: '录制后预测', run: predictJob('recorded') },
} as const;
```

（其余导出不变。）

`src/lib/script/finalize.ts`：签名加第 4 个参数，定稿成功后调用：

```ts
import { launchJob } from '@/lib/jobs/registry';
…
export async function finalizeScript(
  db: PrismaClient,
  projectId: string,
  propose: (projectId: string) => Promise<void> = (id) => proposeSafely(db, id, 'finalize'),
  predict: (projectId: string) => Promise<unknown> = (id) => launchJob(db, id, 'predict_final'),
) {
  …
  await propose(projectId).catch(() => {});
  // 定稿后锁定一版预测; 失败不影响定稿
  await predict(projectId).catch(() => {});
  return updated;
}
```

- [ ] **Step 7: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（`launchJob` 在 fake db 上失败被吞掉；原 finalize / transcribe 测试不变）。

```bash
git add prisma/schema.prisma src/lib/predict src/lib/retro/generate.ts src/lib/jobs/registry.ts src/lib/script/finalize.ts tests/lib
git commit -m "feat(predict): 预测数据表 + 运行预测(盲打守卫/重试/串行/草稿裁剪) + 定稿与转写后自动锁定

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 对账与校准

**Files:**
- Create: `src/lib/predict/calibrate.ts`
- Modify: `src/lib/retro/generate.ts`（`RetroDeps.checkPredictions?`，保存后调用；`createRetroDeps` 接上）
- Test: `tests/lib/predict/calibrate.test.ts`、`tests/lib/retro/generate.test.ts`（追加）

**Interfaces:**
- Consumes：Task 1 的 `predictMetric`、`compositeOf`、`centerOf`、`bucketIndex`、`METRIC_DIM`、`METRIC_KEYS`；Task 3 的 `CheckView`、`ensureActiveFormula`；`Diagnosis`
- Produces：
  - `buildCheck(result: PredictionResult, actual: { values: Partial<Record<MetricKey, number | null>>; verdicts: Partial<Record<MetricKey, Verdict>>; views: number | null }): Omit<CheckView, 'dayN'>`
  - `type Target = MetricKey | 'views'`
  - `interface Sample { scores: Record<Dim, number>; result: PredictionResult; check: Omit<CheckView, 'dayN'> }`
  - `detectBias(recent: Sample[], target: Target): 'optimistic' | 'pessimistic' | null`（`recent` 旧→新，取最后 3 条）
  - `proposeParams(p: FormulaParams, target: Target, recent: Sample[]): FormulaParams`
  - `backtestError(p: FormulaParams, samples: Sample[], target: Target): number | null`
  - `recordChecks(db, projectId, dayN, diagnosis, views): Promise<void>`
  - `maybeProposeFormula(db): Promise<number | null>`（返回新提议的版本号）
  - `decideFormula(db, version: number, action: 'accept' | 'reject'): Promise<void>`（非 proposed 抛 `Error('这个建议已经处理过了')`）
  - `TARGET_LABEL: Record<Target, string>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { backtestError, buildCheck, detectBias, proposeParams, type Sample } from '@/lib/predict/calibrate';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

const scores = { hook: 3, pace: 3, ending: 3, interaction: 3, topic: 3 };
const result = computePrediction({ scores, baselines: { hook5s: 0.5, hook2s: 0.4 }, baselineViews: 2000, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
const sample = (hook5s: number, views: number): Sample => ({ scores, result, check: buildCheck(result, { values: { hook5s, hook2s: 0.4 }, verdicts: { hook5s: hook5s > 0.6 ? 'good' : hook5s < 0.4 ? 'bad' : 'even', hook2s: 'even' }, views }) });

describe('prediction checks', () => {
  it('computes ratios, verdict hits and the bucket hit', () => {
    const c = buildCheck(result, { values: { hook5s: 0.3, hook2s: 0.4 }, verdicts: { hook5s: 'bad', hook2s: 'even' }, views: 1500 });
    expect(c.ratios.hook5s).toBeCloseTo(0.6);
    expect(c.verdicts).toEqual({ hook5s: 'optimistic', hook2s: 'hit' });
    expect(c.viewRatio).toBeCloseTo(0.75);
    expect(c.bucketHit).toBe(true);
  });
  it('skips metrics without a prediction', () => {
    const c = buildCheck(result, { values: { like: 0.05 }, verdicts: { like: 'good' }, views: null });
    expect(c.ratios.like).toBeUndefined();
    expect(c.verdicts.like).toBeUndefined();
    expect(c.viewRatio).toBeNull();
    expect(c.bucketHit).toBeNull();
  });
});

describe('calibration', () => {
  it('needs three same-direction misses beyond 20%', () => {
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.3, 2000)], 'hook5s')).toBe('optimistic');
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.7, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000), sample(0.45, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.3, 2000), sample(0.3, 2000)], 'hook5s')).toBeNull();
    expect(detectBias([sample(0.5, 500), sample(0.5, 600), sample(0.5, 700)], 'views')).toBe('optimistic');
  });
  it('treats a higher actual bounce rate as optimistic', () => {
    const s = (b: number): Sample => ({ scores, result, check: buildCheck(result, { values: { hook2s: b }, verdicts: {}, views: null }) });
    expect(detectBias([s(0.6), s(0.6), s(0.6)], 'hook2s')).toBe('optimistic');
  });
  it('caps a single adjustment at 30%', () => {
    const p = proposeParams(DEFAULT_PARAMS, 'hook5s', [sample(0.1, 2000), sample(0.1, 2000), sample(0.1, 2000)]);
    expect(p.metricOffset.hook5s).toBeCloseTo(-0.3);
    const v = proposeParams(DEFAULT_PARAMS, 'views', [sample(0.5, 100), sample(0.5, 100), sample(0.5, 100)]);
    expect(v.viewOffset).toBeCloseTo(-Math.log2(1.3));
  });
  it('backtests with locked scores and baselines', () => {
    const samples = [sample(0.3, 2000), sample(0.3, 2000), sample(0.3, 2000)];
    const better = proposeParams(DEFAULT_PARAMS, 'hook5s', samples);
    expect(backtestError(better, samples, 'hook5s')!).toBeLessThan(backtestError(DEFAULT_PARAMS, samples, 'hook5s')!);
    expect(backtestError(DEFAULT_PARAMS, samples, 'like')).toBeNull();
  });
});
```

`tests/lib/retro/generate.test.ts` 追加：

```ts
  it('checks predictions after saving, and a failure does not fail the retro', async () => {
    const checkPredictions = vi.fn(async () => { throw new Error('db'); });
    const { d } = deps({ checkPredictions });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: true });
    const call = checkPredictions.mock.calls[0] as unknown[];
    expect(call[0]).toBe('p1');
    expect(typeof call[1]).toBe('number');
    expect(call[2]).toHaveProperty('stages');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/predict/calibrate.test.ts tests/lib/retro/generate.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/predict/calibrate.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Diagnosis, MetricKey, Verdict } from '@/lib/retro/diagnose';
import { bucketIndex, centerOf, compositeOf, METRIC_DIM, METRIC_KEYS, predictMetric, type Dim, type FormulaParams, type PredictionResult } from './formula';
import { ensureActiveFormula } from './store';
import type { CheckView } from './view';
import type { DimScore } from './score';

export type Target = MetricKey | 'views';
const LABELS: Record<MetricKey, string> = { hook2s: '开头 2 秒跳出率', hook5s: '前 5 秒完播率', middle: '平均观看', ending: '完播率', like: '点赞率', favorite: '收藏率', share: '分享率', subscribe: '吸粉率' };
export const TARGET_LABEL: Record<Target, string> = { ...LABELS, views: '播放量' };
const RANK: Record<string, number> = { bad: 0, even: 1, good: 2 };
const MISS = 1.2;
const CAP = 0.3;

export function buildCheck(
  result: PredictionResult,
  actual: { values: Partial<Record<MetricKey, number | null>>; verdicts: Partial<Record<MetricKey, Verdict>>; views: number | null },
): Omit<CheckView, 'dayN'> {
  const ratios: CheckView['ratios'] = {};
  const verdicts: CheckView['verdicts'] = {};
  for (const m of result.metrics) {
    const a = actual.values[m.key];
    if (m.predicted === null || a === null || a === undefined) continue;
    if (m.predicted > 0) ratios[m.key] = a / m.predicted;
    const av = actual.verdicts[m.key];
    if (m.verdict === 'na' || !av || av === 'na') continue;
    verdicts[m.key] = m.verdict === av ? 'hit' : RANK[m.verdict] > RANK[av] ? 'optimistic' : 'pessimistic';
  }
  const hasViews = result.center !== null && actual.views !== null;
  const top = result.buckets.reduce((best, b, i) => (b.prob > result.buckets[best].prob ? i : best), 0);
  return {
    ratios,
    viewRatio: hasViews ? actual.views! / result.center! : null,
    bucketHit: hasViews && result.buckets.length ? bucketIndex(result.buckets, actual.views!) === top : null,
    verdicts,
  };
}

export interface Sample {
  scores: Record<Dim, number>;
  result: PredictionResult;
  check: Omit<CheckView, 'dayN'>;
}

const ratioOf = (s: Sample, t: Target) => (t === 'views' ? s.check.viewRatio : s.check.ratios[t] ?? null);

export function detectBias(recent: Sample[], target: Target): 'optimistic' | 'pessimistic' | null {
  const last = recent.slice(-3).map((s) => ratioOf(s, target));
  if (last.length < 3 || last.some((r) => r === null)) return null;
  // 跳出率: 实际比预测高 = 预测偏乐观; 其余: 实际比预测低 = 偏乐观
  const inverted = target === 'hook2s';
  const optimistic = last.every((r) => (inverted ? r! > MISS : r! < 1 / MISS));
  const pessimistic = last.every((r) => (inverted ? r! < 1 / MISS : r! > MISS));
  return optimistic ? 'optimistic' : pessimistic ? 'pessimistic' : null;
}

const geomean = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function proposeParams(p: FormulaParams, target: Target, recent: Sample[]): FormulaParams {
  const rs = recent.slice(-3).map((s) => ratioOf(s, target)!).filter((r) => r > 0);
  const g = geomean(rs);
  if (target === 'views') {
    const d = clamp(Math.log2(g), -Math.log2(1 + CAP), Math.log2(1 + CAP));
    return { ...p, viewOffset: p.viewOffset + d };
  }
  const old = p.metricOffset[target];
  const next = clamp((1 + old) * g - 1, old - CAP, old + CAP);
  return { ...p, metricOffset: { ...p.metricOffset, [target]: next } };
}

export function backtestError(p: FormulaParams, samples: Sample[], target: Target): number | null {
  const errs: number[] = [];
  for (const s of samples) {
    const r = ratioOf(s, target);
    if (r === null) continue;
    if (target === 'views') {
      const b = s.result.baselineViews;
      if (b === null || s.result.center === null) continue;
      const actual = r * s.result.center;
      const { composite } = compositeOf(s.scores, p, s.result.benchmarkBonus > 0);
      errs.push(Math.abs(Math.log(actual / centerOf(b, composite, p))));
    } else {
      const m = s.result.metrics.find((x) => x.key === target);
      if (!m || m.predicted === null || m.baseline === null) continue;
      const actual = r * m.predicted;
      const pred = predictMetric(target, s.scores[METRIC_DIM[target]], m.baseline, p)!;
      if (actual > 0 && pred > 0) errs.push(Math.abs(Math.log(actual / pred)));
    }
  }
  return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
}

const toMap = (scores: unknown) => Object.fromEntries((scores as DimScore[]).map((s) => [s.dim, s.score])) as Record<Dim, number>;

export async function recordChecks(db: PrismaClient, projectId: string, dayN: number, diagnosis: Diagnosis, views: number | null): Promise<void> {
  const values = Object.fromEntries(diagnosis.stages.map((s) => [s.key, s.value]));
  const verdicts = Object.fromEntries(diagnosis.stages.map((s) => [s.key, s.verdict]));
  for (const kind of ['final', 'recorded']) {
    const p = await db.prediction.findFirst({ where: { projectId, kind }, orderBy: { createdAt: 'desc' } });
    if (!p) continue;
    const c = buildCheck(p.result as unknown as PredictionResult, { values, verdicts, views });
    const data = { dayN, ratios: c.ratios as Prisma.InputJsonValue, viewRatio: c.viewRatio, bucketHit: c.bucketHit, verdicts: c.verdicts as Prisma.InputJsonValue };
    await db.predictionCheck.upsert({ where: { predictionId: p.id }, update: data, create: { predictionId: p.id, ...data } });
  }
  await maybeProposeFormula(db);
}

/** 每个已对账项目一条: 有录制后版用录制后版, 否则定稿版; 按发布时间旧→新 */
async function loadSamples(db: PrismaClient): Promise<Sample[]> {
  const rows = await db.prediction.findMany({ where: { kind: { in: ['final', 'recorded'] }, check: { isNot: null } }, include: { check: true, project: { include: { publishedWorks: { orderBy: { publishedAt: 'asc' }, take: 1 } } } } });
  const byProject = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const cur = byProject.get(r.projectId);
    if (!cur || (cur.kind === 'final' && r.kind === 'recorded') || (cur.kind === r.kind && r.createdAt > cur.createdAt)) byProject.set(r.projectId, r);
  }
  return [...byProject.values()]
    .sort((a, b) => (a.project.publishedWorks[0]?.publishedAt.getTime() ?? 0) - (b.project.publishedWorks[0]?.publishedAt.getTime() ?? 0))
    .map((r) => ({ scores: toMap(r.scores), result: r.result as unknown as PredictionResult, check: { ratios: r.check!.ratios as CheckView['ratios'], viewRatio: r.check!.viewRatio, bucketHit: r.check!.bucketHit, verdicts: r.check!.verdicts as CheckView['verdicts'] } }));
}

export async function maybeProposeFormula(db: PrismaClient): Promise<number | null> {
  if (await db.predictionFormula.findFirst({ where: { status: 'proposed' } })) return null;
  const active = await ensureActiveFormula(db);
  const samples = await loadSamples(db);
  for (const target of [...METRIC_KEYS, 'views'] as Target[]) {
    const direction = detectBias(samples, target);
    if (!direction) continue;
    const next = proposeParams(active.params, target, samples);
    const oldError = backtestError(active.params, samples, target);
    const newError = backtestError(next, samples, target);
    if (oldError === null || newError === null || newError >= oldError) continue;
    const max = await db.predictionFormula.findFirst({ orderBy: { version: 'desc' } });
    const version = (max?.version ?? 0) + 1;
    await db.predictionFormula.create({
      data: { version, params: next as unknown as Prisma.InputJsonValue, status: 'proposed', reason: { target, label: TARGET_LABEL[target], direction, samples: samples.length, oldError, newError } },
    });
    return version;
  }
  return null;
}

export async function decideFormula(db: PrismaClient, version: number, action: 'accept' | 'reject'): Promise<void> {
  const f = await db.predictionFormula.findUnique({ where: { version } });
  if (!f || f.status !== 'proposed') throw new Error('这个建议已经处理过了');
  if (action === 'reject') {
    await db.predictionFormula.update({ where: { version }, data: { status: 'rejected', decidedAt: new Date() } });
    return;
  }
  await db.$transaction([
    db.predictionFormula.updateMany({ where: { status: 'active' }, data: { status: 'retired' } }),
    db.predictionFormula.update({ where: { version }, data: { status: 'active', decidedAt: new Date() } }),
  ]);
}
```

- [ ] **Step 4: 接入复盘**

`src/lib/retro/generate.ts`：
- `RetroDeps` 加 `checkPredictions?(projectId: string, dayN: number, diagnosis: Diagnosis, views: number | null): Promise<void>;`
- `generateRetro` 里提议笔记那行之后加：

```ts
  // 复盘后给锁定的预测对账(并检查要不要提议调公式); 失败不影响复盘
  await deps.checkPredictions?.(projectId, dayN, diagnosis, input.work.viewCount).catch(() => {});
```

- `createRetroDeps` 返回对象加 `checkPredictions: (id, dayN, d, views) => recordChecks(db, id, dayN, d, views),`（import `recordChecks`）。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/predict src/lib/retro/generate.ts tests/lib
git commit -m "feat(predict): 复盘后对账 + 连续同向偏差检测 + 限幅调参 + 回测更准才提议 + 采纳/不要

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 落后提醒

**Files:**
- Create: `src/lib/predict/lag.ts`
- Modify: `scripts/collect-douyin.ts`、`src/lib/cli/commands/read.ts`（status）、`src/lib/cli/brief.ts`
- Test: `tests/lib/predict/lag.test.ts`、`tests/lib/cli/brief.test.ts`（追加）

**Interfaces:**
- Produces：
  - `isBehind(days: number, views: number, center: number): boolean`
  - `findLagging(db, now: Date): Promise<{ projectId: string; title: string; days: number; views: number; center: number }[]>`
  - `postLagAlerts(db, now: Date): Promise<number>`
  - `LAG_TOOL = 'predict:lag'`
- `StatusData.behind?: number`；`BriefInput.behind?: number`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { isBehind } from '@/lib/predict/lag';

describe('lag', () => {
  it('flags day 1 below 30% and day 2 below 50% of the center', () => {
    expect(isBehind(1.2, 800, 3000)).toBe(true);
    expect(isBehind(1.2, 1000, 3000)).toBe(false);
    expect(isBehind(2.5, 1400, 3000)).toBe(true);
    expect(isBehind(2.5, 1600, 3000)).toBe(false);
  });
  it('does not flag the publish day', () => {
    expect(isBehind(0.5, 10, 3000)).toBe(false);
  });
  it('stops after day 3', () => {
    expect(isBehind(3.1, 10, 3000)).toBe(false);
  });
});
```

`tests/lib/cli/brief.test.ts` 在 `describe('buildBrief'` 里追加：

```ts
  it('mentions predictions that are behind', () => {
    expect(buildBrief({ ...base, behind: 2 })).toBe(['MediaPilot 早报', '比预期落后：2 条（回电脑看项目）', '粉丝 408（+3）'].join('\n'));
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/predict/lag.test.ts tests/lib/cli/brief.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/predict/lag.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { PredictionResult } from './formula';

export const LAG_TOOL = 'predict:lag';

/** 发布满 1 天不满 2 天: < 中枢 30%; 满 2 天不满 3 天: < 50% */
export function isBehind(days: number, views: number, center: number): boolean {
  if (days >= 1 && days < 2) return views < center * 0.3;
  if (days >= 2 && days < 3) return views < center * 0.5;
  return false;
}

export async function findLagging(db: PrismaClient, now: Date) {
  const since = new Date(now.getTime() - 3 * 86400_000);
  const works = await db.publishedWork.findMany({ where: { projectId: { not: null }, isPrivate: false, publishedAt: { gte: since } }, include: { project: true } });
  const out: { projectId: string; title: string; days: number; views: number; center: number }[] = [];
  for (const w of works) {
    const p = (await db.prediction.findFirst({ where: { projectId: w.projectId!, kind: 'recorded' }, orderBy: { createdAt: 'desc' } })) ?? (await db.prediction.findFirst({ where: { projectId: w.projectId!, kind: 'final' }, orderBy: { createdAt: 'desc' } }));
    const center = (p?.result as unknown as PredictionResult | undefined)?.center ?? null;
    const days = (now.getTime() - w.publishedAt.getTime()) / 86400_000;
    if (center !== null && w.viewCount !== null && isBehind(days, w.viewCount, center)) out.push({ projectId: w.projectId!, title: w.project!.title, days, views: w.viewCount, center });
  }
  return out;
}

export async function postLagAlerts(db: PrismaClient, now: Date): Promise<number> {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  let n = 0;
  for (const l of await findLagging(db, now)) {
    if (await db.chatMessage.findFirst({ where: { projectId: l.projectId, toolName: LAG_TOOL, createdAt: { gte: today } } })) continue;
    await db.chatMessage.create({
      data: { projectId: l.projectId, role: 'system', toolName: LAG_TOOL, toolResult: { ok: false }, content: `比预期落后：发布第 ${Math.floor(l.days)} 天播放 ${l.views.toLocaleString('en-US')}，预测中枢约 ${l.center.toLocaleString('en-US')}。` },
    });
    n++;
  }
  return n;
}
```

- [ ] **Step 4: 接入回采、状态、简报**

- `scripts/collect-douyin.ts`：`log(await runDueRetros(prisma));` 之后加 `log(\`预测落后提醒: \${await postLagAlerts(prisma, new Date())} 条\`);`（import `postLagAlerts`）。
- `src/lib/cli/commands/read.ts`：`StatusData` 加 `behind?: number`；`status.run` 返回前 `const behind = (await findLagging(ctx.db, ctx.now).catch(() => [])).length;`，返回对象加 `...(behind ? { behind } : {})`；`formatStatus` 在"待确认"行前加 `d.behind ? \`比预期落后：\${d.behind} 条\` : ''` 并在 `join` 前 `filter(Boolean)`。
- `src/lib/cli/brief.ts`：`BriefInput` 加 `behind?: number`；`buildBrief` 的"什么都没有"判断加上 `!i.behind`；列表里在"待你确认"前加 `...(i.behind ? [\`比预期落后：\${i.behind} 条（回电脑看项目）\`] : [])`；`loadBriefInput` 返回加 `behind: (await findLagging(db, now).catch(() => [])).length`（现有测试的假库没有 `publishedWork`，读不到按 0）。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/predict scripts/collect-douyin.ts src/lib/cli tests/lib
git commit -m "feat(predict): 发布后前两天落后于预测时提醒(项目对话/mp status/每日简报)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 编导工具、命令行与接口

**Files:**
- Create: `src/lib/tools/predict.ts`、`src/lib/cli/commands/predict.ts`、`src/app/api/projects/[id]/predictions/route.ts`、`src/app/api/predict/formulas/route.ts`、`src/app/api/predict/formulas/[version]/route.ts`
- Modify: `src/lib/tools/index.ts`、`src/lib/cli/index.ts`、`src/lib/agent/context.ts`、`assistant/skills/daily-kickoff/SKILL.md`
- Test: `tests/lib/tools/predict.test.ts`、`tests/lib/cli/predict.test.ts`、`tests/lib/agent/context.test.ts`（追加）

**Interfaces:**
- Consumes：`runPrediction`、`createPredictDeps`、`PredictRefused`、`toPredictionView`、`formatPrediction`、`summarize`、`decideFormula`、`launchJob`
- Produces：
  - `makePredictTool(makeDeps: (ctx: ToolContext) => Promise<PredictDeps>): Tool<Record<string, never>>`；`predictTool`（name `predict_views`）
  - `PREDICT_COMMANDS`：`predict run`（write，hermes false）、`predict show`（read，hermes true）、`predict list`（read，hermes true）
  - `formatPredictList(rows: { id: string; title: string; kind: string; center: number | null; top: string | null }[]): string`
  - HTTP：
    - `GET /api/projects/[id]/predictions` → `PredictionsData = { latest: PredictionView | null; final: PredictionView | null; recorded: PredictionView | null; running: boolean; published: boolean; canLockFinal: boolean; canLockRecorded: boolean }`
    - `POST /api/projects/[id]/predictions` body `{ kind: 'draft' | 'final' | 'recorded' }` → `{ jobId }`；已发布 400 `已经有数据了，这时再预测不算数`；正在跑 409 `正在预测`
    - `GET /api/predict/formulas` → `{ active: { version, params }, proposed: { version, params, reason } | null }`
    - `POST /api/predict/formulas/[version]` body `{ action: 'accept' | 'reject' }`；已处理 409

- [ ] **Step 1: 写失败测试**

`tests/lib/tools/predict.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makePredictTool } from '@/lib/tools/predict';
import { DEFAULT_PARAMS } from '@/lib/predict/formula';

const five = ['hook', 'pace', 'ending', 'interaction', 'topic'].map((dim) => ({ dim, score: 3, reason: 'r', quote: '', segmentId: null, fix: '' }));
const ctx = { projectId: 'p1', db: {} as never, llm: {} as never };
const deps = (published = false) => async () => ({
  load: async () => ({ published, segments: [{ id: 's1', label: '开场钩子', text: 't', estSec: 5 }], transcript: null, persona: '', benchmark: '', benchmarkHit: false, baselines: {}, baselineViews: 2900, calibratedCount: 0, formula: { version: 1, params: DEFAULT_PARAMS } }),
  llm: { callStructured: async () => ({ result: { scores: five }, usage: {} }) } as never,
  modelLabel: 'M',
  save: async () => ({ id: 'pr1' }),
  trimDrafts: async () => {},
});

describe('predict_views tool', () => {
  it('runs a draft prediction and returns the detail text', async () => {
    const r = await makePredictTool(deps()).execute(ctx, {});
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/^草稿预测：中枢约 2,900/);
    expect((r.data as { text: string }).text).toContain('开头钩子 3 分');
  });
  it('fails readably once published', async () => {
    expect(await makePredictTool(deps(true)).execute(ctx, {})).toMatchObject({ ok: false, summary: '预测失败：已经有数据了，这时再预测不算数' });
  });
});
```

`tests/lib/cli/predict.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PREDICT_COMMANDS, formatPredictList } from '@/lib/cli/commands/predict';

describe('mp predict', () => {
  it('registers run/show/list with the right tiers', () => {
    expect(PREDICT_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([
      ['predict run', 'write', false],
      ['predict show', 'read', true],
      ['predict list', 'read', true],
    ]);
  });
  it('lists by center, unknowns last', () => {
    expect(formatPredictList([
      { id: 'a', title: 'A', kind: 'final', center: 1000, top: '<1,450 60%' },
      { id: 'b', title: 'B', kind: 'recorded', center: 5000, top: '2,900–1.5万 50%' },
      { id: 'c', title: 'C', kind: 'draft', center: null, top: null },
    ])).toBe(['[b] B · 录制后预测 · 中枢约 5,000 · 最可能 2,900–1.5万 50%', '[a] A · 定稿预测 · 中枢约 1,000 · 最可能 <1,450 60%', '[c] C · 草稿预测 · 暂不预测数字'].join('\n'));
    expect(formatPredictList([])).toBe('没有待发布的项目。');
  });
});
```

`tests/lib/agent/context.test.ts` 追加：

```ts
describe('editor rules for predictions', () => {
  it('tells the editor when to call predict_views', () => {
    expect(formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null })).toContain('predict_views');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/tools/predict.test.ts tests/lib/cli/predict.test.ts tests/lib/agent/context.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现工具 `src/lib/tools/predict.ts`**

```ts
import { z } from 'zod';
import type { Tool, ToolContext } from './types';
import { createPredictDeps, PredictRefused, runPrediction, type PredictDeps } from '@/lib/predict/run';
import { formatPrediction } from '@/lib/predict/view';

const Input = z.object({});

export function makePredictTool(makeDeps: (ctx: ToolContext) => Promise<PredictDeps> = (ctx) => createPredictDeps(ctx.db, ctx.llm)): Tool<z.infer<typeof Input>> {
  return {
    name: 'predict_views',
    label: '预测流量',
    description: '按当前稿子做一次草稿预测：5 项打分、分项预测、播放区间和拖后腿的地方。用户问能不能火 / 测一下时调用；按建议改完可以再测。',
    input: Input,
    async execute(ctx) {
      try {
        const r = await runPrediction(await makeDeps(ctx), ctx.projectId, 'draft');
        return { ok: true, summary: r.summary, data: { text: formatPrediction({ id: r.id, kind: 'draft', createdAt: new Date().toISOString(), formulaVersion: r.formulaVersion, scores: r.scores, result: r.result, check: null }) } };
      } catch (e) {
        const msg = e instanceof PredictRefused ? e.message : e instanceof Error ? e.message : String(e);
        return { ok: false, summary: `预测失败：${msg}`, data: { error: msg } };
      }
    },
  };
}

export const predictTool = makePredictTool();
```


`src/lib/tools/index.ts`：`SCRIPT_TOOLS` 追加 `predictTool`。

`src/lib/agent/context.ts` `RULES` 在 Obsidian 两行之后加：

```
- 用户问这条能不能火、让你测一下时：调用 predict_views，把中枢、最可能的区间和拖后腿的项简短告诉用户；按拖后腿的建议改完可以再测一次。
```

- [ ] **Step 4: 实现命令 `src/lib/cli/commands/predict.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { createPredictDeps, PredictRefused, runPrediction } from '@/lib/predict/run';
import { formatPrediction, KIND_LABEL, toPredictionView, type PredictKind } from '@/lib/predict/view';
import type { PredictionResult } from '@/lib/predict/formula';
import { CliError, needArg, type Command } from '../registry';

export function formatPredictList(rows: { id: string; title: string; kind: string; center: number | null; top: string | null }[]): string {
  if (!rows.length) return '没有待发布的项目。';
  return [...rows]
    .sort((a, b) => (b.center ?? -1) - (a.center ?? -1))
    .map((r) => `[${r.id}] ${r.title} · ${KIND_LABEL[r.kind as PredictKind]} · ${r.center === null ? '暂不预测数字' : `中枢约 ${r.center.toLocaleString('en-US')} · 最可能 ${r.top}`}`)
    .join('\n');
}

/** 展示用: 锁定的优先(录制后 > 定稿), 否则最新草稿 */
export async function latestForDisplay(db: PrismaClient, projectId: string) {
  for (const kind of ['recorded', 'final', 'draft']) {
    const p = await db.prediction.findFirst({ where: { projectId, kind }, orderBy: { createdAt: 'desc' }, include: { check: true } });
    if (p) return toPredictionView(p);
  }
  return null;
}

export const PREDICT_COMMANDS: Command[] = [
  {
    path: ['predict', 'run'],
    tier: 'write',
    hermes: false,
    usage: 'mp predict run <项目>',
    summary: '按当前稿子做一次草稿预测',
    async run(ctx, p) {
      try {
        const r = await runPrediction(await createPredictDeps(ctx.db), needArg(p, 0, '项目'), 'draft');
        return { text: formatPrediction({ id: r.id, kind: 'draft', createdAt: new Date().toISOString(), formulaVersion: r.formulaVersion, scores: r.scores, result: r.result, check: null }) };
      } catch (e) {
        if (e instanceof PredictRefused) throw new CliError('bad_args', e.message);
        throw e;
      }
    },
    format: (d) => (d as { text: string }).text,
  },
  {
    path: ['predict', 'show'],
    tier: 'read',
    hermes: true,
    usage: 'mp predict show <项目>',
    summary: '看项目的流量预测',
    async run(ctx, p) {
      const v = await latestForDisplay(ctx.db, needArg(p, 0, '项目'));
      if (!v) throw new CliError('not_found', '这个项目还没有预测：在项目页点「预测」或 mp predict run');
      return v;
    },
    format: (d) => formatPrediction(d as ReturnType<typeof toPredictionView>),
  },
  {
    path: ['predict', 'list'],
    tier: 'read',
    hermes: true,
    usage: 'mp predict list',
    summary: '待发布项目按预测排序',
    async run(ctx) {
      const projects = await ctx.db.project.findMany({ where: { publishedWorks: { none: {} }, stage: { not: 'draft' } }, select: { id: true, title: true } });
      const rows = [];
      for (const pr of projects) {
        const v = await latestForDisplay(ctx.db, pr.id);
        if (!v) continue;
        const r: PredictionResult = v.result;
        const t = r.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
        rows.push({ id: pr.id, title: pr.title, kind: v.kind, center: r.center, top: t ? `${t.label} ${t.prob}%` : null });
      }
      return rows;
    },
    format: (d) => formatPredictList(d as Parameters<typeof formatPredictList>[0]),
  },
];
```

`src/lib/cli/index.ts`：import 并把 `...PREDICT_COMMANDS` 放在 `...NOTES_COMMANDS` 之后。

`assistant/skills/daily-kickoff/SKILL.md` 第 3 步后加一步：`4. 调 \`predict_list\`；有已定稿未发布的稿子时，建议先发中枢最高的那条（说明是预测、置信度多少）。`，原第 4、5 步顺延为 5、6；`工具预算：5` 改为 `工具预算：6`。

- [ ] **Step 5: 接口**

`src/app/api/projects/[id]/predictions/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { launchJob } from '@/lib/jobs/registry';
import { PUBLISHED_REFUSAL } from '@/lib/predict/run';
import { toPredictionView, type PredictionView } from '@/lib/predict/view';

export const dynamic = 'force-dynamic';

export interface PredictionsData {
  latest: PredictionView | null;
  final: PredictionView | null;
  recorded: PredictionView | null;
  running: boolean;
  published: boolean;
  canLockFinal: boolean;
  canLockRecorded: boolean;
}

const KINDS = ['draft', 'final', 'recorded'] as const;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, stage: true } });
  if (!p) return fail('项目不存在或已删除', 404);
  const latestOf = async (kind?: string) => {
    const r = await prisma.prediction.findFirst({ where: { projectId: p.id, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, include: { check: true } });
    return r ? toPredictionView(r) : null;
  };
  const [latest, final, recorded] = await Promise.all([latestOf(), latestOf('final'), latestOf('recorded')]);
  const running = !!(await prisma.job.findFirst({ where: { projectId: p.id, kind: { startsWith: 'predict_' }, status: { in: ['queued', 'running'] } } }));
  const published = (await prisma.publishedWork.count({ where: { projectId: p.id } })) > 0;
  const hasTranscript = !!(await prisma.projectFile.findFirst({ where: { projectId: p.id, kind: 'transcript' } }));
  const data: PredictionsData = {
    latest,
    final,
    recorded,
    running,
    published,
    canLockFinal: !published && p.stage !== 'draft' && !final,
    canLockRecorded: !published && hasTranscript && !recorded,
  };
  return ok(data);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { kind?: string };
  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) return fail('kind 只能是 draft / final / recorded', 400);
  if ((await prisma.publishedWork.count({ where: { projectId: params.id } })) > 0) return fail(PUBLISHED_REFUSAL, 400);
  const started = await launchJob(prisma, params.id, `predict_${kind}`);
  if (!started) return fail('正在预测', 409);
  return ok({ jobId: started.jobId });
}
```

`src/app/api/predict/formulas/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { ensureActiveFormula } from '@/lib/predict/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const active = await ensureActiveFormula(prisma);
  const p = await prisma.predictionFormula.findFirst({ where: { status: 'proposed' } });
  return ok({ active, proposed: p ? { version: p.version, params: p.params, reason: p.reason } : null });
}
```

`src/app/api/predict/formulas/[version]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { decideFormula } from '@/lib/predict/calibrate';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { version: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'accept' && body.action !== 'reject') return fail('action 只能是 accept 或 reject', 400);
  try {
    await decideFormula(prisma, Number(params.version), body.action);
    return ok({ version: Number(params.version) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}
```

（`launchJob` 的 kind 参数类型是 `JobKind`：`\`predict_${kind}\`` 需要 `as JobKind`，从 `@/lib/jobs/registry` import 类型。）

- [ ] **Step 6: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（总助手工具清单自动含 `predict_run / predict_show / predict_list`）。

真机（改了 schema、加了 API 目录 → 重启 dev）：`npm run -s mp -- predict run cmujxgbz6000eg417ngfzoolz` 输出 5 项打分与区间；`curl localhost:3000/api/projects/cmujxgbz6000eg417ngfzoolz/predictions` 有 `latest`；`MP_AGENT=hermes npm run -s mp -- predict run …` 被拒。

```bash
git add src/lib/tools src/lib/cli src/lib/agent/context.ts assistant/skills src/app/api/projects src/app/api/predict tests/lib
git commit -m "feat(predict): 编导 predict_views + mp predict run/show/list + 预测与公式接口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 页面

**Files:**
- Create: `src/components/project/prediction-panel.tsx`、`src/components/project/prediction-summary.tsx`、`src/components/retro/formula-card.tsx`
- Modify: `src/components/project/script-pane.tsx`、`src/components/project/project-workspace.tsx`、`src/components/project/chat-panel.tsx`（`pendingSend`）、`src/components/project/publish-pane.tsx`、`src/components/retro/retro-view.tsx`、`src/app/page.tsx`
- Test: `tests/components/prediction-panel.test.tsx`、`tests/components/retro/formula-card.test.tsx`、`tests/components/chat-panel.test.tsx`（追加）

**Interfaces:**
- Consumes：`PredictionsData`、`PredictionView`、`DIM_LABEL`、`dragItems`、`confidenceText`、`fmtViews`
- Produces：
  - `PredictionPanel({ projectId, onHighlight, onAskEditor, onChanged }: { projectId: string; onHighlight: (segmentId: string) => void; onAskEditor: (text: string) => void; onChanged: () => void })`
  - `PredictionSummary({ projectId, views }: { projectId: string; views: number | null })`（发布与复盘页：两版锁定预测 + 对账）
  - `FormulaCard({ onChanged }: { onChanged: () => void })`
  - `ChatPanel` 新 prop `pendingSend?: { id: string; text: string } | null`（id 变化时把 text 当用户消息发出）

- [ ] **Step 1: 写失败测试**

`tests/components/prediction-panel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PredictionPanel } from '@/components/project/prediction-panel';
import { computePrediction, DEFAULT_PARAMS } from '@/lib/predict/formula';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const scores = [
  { dim: 'hook', score: 2, reason: '开头在铺垫', quote: '大家好', segmentId: 's1', fix: '第一句直接说结果' },
  { dim: 'pace', score: 3, reason: '平稳', quote: '', segmentId: null, fix: '' },
  { dim: 'ending', score: 4, reason: '有回收', quote: '', segmentId: null, fix: '' },
  { dim: 'interaction', score: 3, reason: '一般', quote: '', segmentId: null, fix: '' },
  { dim: 'topic', score: 3, reason: '常规', quote: '', segmentId: null, fix: '' },
];
const result = computePrediction({ scores: { hook: 2, pace: 3, ending: 4, interaction: 3, topic: 3 }, baselines: { hook2s: 0.4 }, baselineViews: 2900, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS });
const view = { id: 'pr1', kind: 'draft', createdAt: '2026-09-30T00:00:00.000Z', formulaVersion: 1, scores, result, check: null };
const data = (over = {}) => ({ latest: view, final: null, recorded: null, running: false, published: false, canLockFinal: false, canLockRecorded: false, ...over });

describe('PredictionPanel', () => {
  it('shows scores, buckets, confidence and drag items, and hands fixes to the editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data() }) })));
    const onHighlight = vi.fn();
    const onAskEditor = vi.fn();
    render(<PredictionPanel projectId="p1" onHighlight={onHighlight} onAskEditor={onAskEditor} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/开头钩子 2 分/)).toBeTruthy());
    expect(screen.getByText(/中枢约/)).toBeTruthy();
    expect(screen.getByText(/置信度低/)).toBeTruthy();
    fireEvent.click(screen.getByText('「大家好」'));
    expect(onHighlight).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getAllByText('让编导按这个改')[0]);
    expect(onAskEditor).toHaveBeenCalledWith('按预测的建议改「开头钩子」：第一句直接说结果');
  });
  it('starts a draft prediction and disables the button while running', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'POST' ? { jobId: 'j1' } : data({ latest: null }) }) }));
    vi.stubGlobal('fetch', f);
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('预测')).toBeTruthy());
    fireEvent.click(screen.getByText('预测'));
    await waitFor(() => expect(f.mock.calls.some((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(String((f.mock.calls.find((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST') as unknown as [string, RequestInit])[1].body))).toEqual({ kind: 'draft' });
  });
  it('explains why there are no numbers and offers to lock missing predictions', async () => {
    const none = { ...view, result: computePrediction({ scores: { hook: 2, pace: 3, ending: 4, interaction: 3, topic: 3 }, baselines: {}, baselineViews: null, benchmarkHit: false, calibratedCount: 0, params: DEFAULT_PARAMS }) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data({ latest: none, canLockFinal: true }) }) })));
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/公开作品少于 3 条/)).toBeTruthy());
    expect(screen.getByText('补做定稿预测')).toBeTruthy();
  });
  it('hides the button once published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: data({ published: true }) }) })));
    render(<PredictionPanel projectId="p1" onHighlight={() => {}} onAskEditor={() => {}} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/已发布，不再预测/)).toBeTruthy());
    expect(screen.queryByText('预测')).toBeNull();
  });
});
```

`tests/components/retro/formula-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FormulaCard } from '@/components/retro/formula-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FormulaCard', () => {
  it('shows a proposal with its backtest and adopts it', async () => {
    const f = vi.fn(async (url: string) => ({
      json: async () => ({ success: true, data: url === '/api/predict/formulas' ? { active: { version: 1 }, proposed: { version: 2, reason: { label: '播放量', direction: 'optimistic', samples: 3, oldError: Math.log(2.1), newError: Math.log(1.6) } } } : { version: 2 } }),
    }));
    vi.stubGlobal('fetch', f);
    const onChanged = vi.fn();
    render(<FormulaCard onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByText(/播放量连续偏乐观/)).toBeTruthy());
    expect(screen.getByText(/平均误差 2.1 倍 → 1.6 倍/)).toBeTruthy();
    fireEvent.click(screen.getByText('采纳'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((f.mock.calls.at(-1) as unknown as [string])[0]).toBe('/api/predict/formulas/2');
  });
  it('renders nothing without a proposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { active: { version: 1 }, proposed: null } }) })));
    const { container } = render(<FormulaCard onChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
```

`tests/components/chat-panel.test.tsx` 追加：

```tsx
describe('ChatPanel pendingSend', () => {
  it('sends a message handed in from outside', async () => {
    const f = vi.fn(async () => ({ ok: false, body: null, status: 500, json: async () => ({ message: 'x' }) }));
    vi.stubGlobal('fetch', f);
    render(<ChatPanel projectId="p1" initialMessages={[]} pendingSend={{ id: 'a1', text: '按预测的建议改' }} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ text: '按预测的建议改' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components`
Expected: FAIL。

- [ ] **Step 3: `PredictionPanel`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PredictionsData } from '@/app/api/projects/[id]/predictions/route';
import { DIM_LABEL, type Dim } from '@/lib/predict/formula';
import { confidenceText, dragItems, KIND_LABEL } from '@/lib/predict/view';
import { cn } from '@/lib/utils';

const V: Record<string, string> = { good: '好', even: '平', bad: '差', na: '—' };
const M: Record<string, string> = { hook2s: '开头 2 秒跳出', hook5s: '前 5 秒完播', middle: '平均观看', ending: '完播率', like: '点赞率', favorite: '收藏率', share: '分享率', subscribe: '吸粉率' };

export function PredictionPanel({ projectId, onHighlight, onAskEditor, onChanged }: { projectId: string; onHighlight: (segmentId: string) => void; onAskEditor: (text: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<PredictionsData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/projects/${projectId}/predictions`;
  const load = useCallback(async () => {
    const j = await fetch(base).then((r) => r.json()).catch(() => ({ success: false, message: '读取预测失败' }));
    if (j.success) setD(j.data);
    else setErr(j.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);
  // 预测在后台跑: 每 3 秒看一次, 跑完通知工作区刷新(拿到对话里的通知)
  useEffect(() => {
    if (!d?.running) return;
    const t = setTimeout(async () => {
      await load();
      onChanged();
    }, 3000);
    return () => clearTimeout(t);
  }, [d, load, onChanged]);

  const start = async (kind: 'draft' | 'final' | 'recorded') => {
    setErr(null);
    const j = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    if (!j.success) setErr(j.message);
    await load();
  };

  if (!d) return <div className="text-xs text-[var(--text-tertiary)]">{err ?? '读取预测…'}</div>;
  const p = d.latest;
  const r = p?.result;
  const top = r?.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-medium">流量预测</h3>
        {p && <span className="text-xs text-[var(--text-tertiary)]">{`${KIND_LABEL[p.kind]}${p.kind === 'draft' ? '' : ' · 已锁定'} · ${new Date(p.createdAt).toLocaleString('zh-CN')}`}</span>}
        <div className="flex-1" />
        {d.published ? (
          <span className="text-xs text-[var(--text-tertiary)]">已发布，不再预测（看「④ 发布与复盘」里的对账）</span>
        ) : (
          <>
            {d.canLockFinal && (
              <button className="text-xs text-[var(--accent)]" disabled={d.running} onClick={() => void start('final')}>补做定稿预测</button>
            )}
            {d.canLockRecorded && (
              <button className="text-xs text-[var(--accent)]" disabled={d.running} onClick={() => void start('recorded')}>补做录制后预测</button>
            )}
            <button className="rounded-md border border-[var(--border-strong)] px-3 py-1 text-xs disabled:opacity-50" disabled={d.running} onClick={() => void start('draft')}>
              {d.running ? '预测中…' : '预测'}
            </button>
          </>
        )}
      </div>
      {err && <p className="mb-2 text-xs text-[var(--danger)]">{err}</p>}
      {!p || !r ? (
        <p className="text-xs text-[var(--text-tertiary)]">还没有预测。点「预测」按当前稿子打分，定稿和录完口播后会自动各锁定一版。</p>
      ) : (
        <div className="space-y-3">
          {r.center === null ? (
            <p className="text-xs text-[var(--text-secondary)]">公开作品少于 3 条，暂不预测数字，先看打分和拖后腿的地方。</p>
          ) : (
            <div>
              <div>{`中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${top!.label}（${top!.prob}%）`}</div>
              <div className="mt-2 space-y-1">
                {r.buckets.map((b) => (
                  <div key={b.label} className="flex items-center gap-2 text-xs">
                    <span className="w-28 shrink-0 font-mono text-[var(--text-secondary)]">{b.label}</span>
                    <div className="h-2 flex-1 rounded bg-[var(--bg-inset)]">
                      <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${b.prob}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono">{b.prob}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">{confidenceText(r)}</p>
            </div>
          )}
          <ul className="space-y-1 text-xs">
            {p.scores.map((s) => (
              <li key={s.dim}>
                <span className={cn('font-medium', s.score <= 2 && 'text-[var(--danger)]')}>{`${DIM_LABEL[s.dim as Dim]} ${s.score} 分`}</span>
                {`：${s.reason}`}
                {s.quote && (
                  <button className="ml-1 text-[var(--accent)] underline" onClick={() => s.segmentId && onHighlight(s.segmentId)}>
                    {`「${s.quote}」`}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {r.center !== null && (
            <p className="text-xs text-[var(--text-secondary)]">
              {r.metrics.filter((m) => m.verdict !== 'na').map((m) => `${M[m.key]} ${V[m.verdict]}`).join(' · ') || '各项指标还没有基线'}
            </p>
          )}
          {dragItems(p.scores).length > 0 && (
            <div className="space-y-1 rounded-md bg-[var(--bg-inset)] p-2 text-xs">
              <div className="text-[var(--text-tertiary)]">拖后腿</div>
              {dragItems(p.scores).map((s) => (
                <div key={s.dim} className="flex flex-wrap items-center gap-2">
                  <span>{`${DIM_LABEL[s.dim as Dim]}：${s.fix || s.reason}`}</span>
                  <button className="text-[var(--accent)]" onClick={() => onAskEditor(`按预测的建议改「${DIM_LABEL[s.dim as Dim]}」：${s.fix || s.reason}`)}>
                    让编导按这个改
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 接进脚本页与对话**

- `ScriptPane` 加 props `onHighlight: (segmentId: string) => void; onAskEditor: (text: string) => void; onPredictionChanged: () => void;`，在段落列表 `<div className="flex-1 space-y-3 overflow-y-auto p-6">` 的第一个子元素位置渲染 `<PredictionPanel projectId={project.id} onHighlight={onHighlight} onAskEditor={onAskEditor} onChanged={onPredictionChanged} />`。
- `ProjectWorkspace`：`const [pendingSend, setPendingSend] = useState<{ id: string; text: string } | null>(null);`；`ScriptPane` 传 `onHighlight={(id) => setHighlighted(new Set([id]))}`、`onAskEditor={(text) => setPendingSend({ id: String(Date.now()), text })}`、`onPredictionChanged={() => void refresh()}`；`ChatPanel` 传 `pendingSend={pendingSend}`。
- `ChatPanel`：props 加 `pendingSend?: { id: string; text: string } | null`；加

```tsx
  const sentIds = useRef(new Set<string>());
  useEffect(() => {
    if (!pendingSend || sentIds.current.has(pendingSend.id)) return;
    sentIds.current.add(pendingSend.id);
    void send(pendingSend.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSend?.id]);
```

- [ ] **Step 5: 发布与复盘页、复盘页、首页**

`src/components/project/prediction-summary.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { PredictionsData } from '@/app/api/projects/[id]/predictions/route';
import type { PredictionView } from '@/lib/predict/view';

const VERDICT: Record<string, string> = { hit: '命中', optimistic: '偏乐观', pessimistic: '偏悲观' };
const M: Record<string, string> = { hook2s: '开头 2 秒', hook5s: '前 5 秒', middle: '平均观看', ending: '完播', like: '点赞', favorite: '收藏', share: '分享', subscribe: '吸粉' };

function Line({ title, p, views }: { title: string; p: PredictionView; views: number | null }) {
  const r = p.result;
  const top = r.buckets.length ? r.buckets.reduce((a, b) => (b.prob > a.prob ? b : a)) : null;
  return (
    <div className="space-y-1">
      <div>{`${title}：${r.center === null ? '暂不预测数字' : `中枢约 ${r.center.toLocaleString('en-US')}，最可能 ${top!.label}（${top!.prob}%）`}`}{views !== null && r.center !== null ? ` · 现在 ${views.toLocaleString('en-US')}` : ''}</div>
      {p.check && (
        <div className="text-xs text-[var(--text-secondary)]">
          {`第 ${p.check.dayN} 天对账：${p.check.viewRatio === null ? '' : `实际是预测的 ${p.check.viewRatio.toFixed(1)} 倍${p.check.bucketHit ? '（落在最可能那档）' : ''}；`}`}
          {Object.entries(p.check.verdicts).map(([k, v]) => `${M[k]} ${VERDICT[v!]}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

export function PredictionSummary({ projectId, views }: { projectId: string; views: number | null }) {
  const [d, setD] = useState<PredictionsData | null>(null);
  useEffect(() => {
    void fetch(`/api/projects/${projectId}/predictions`).then((r) => r.json()).then((j) => j.success && setD(j.data)).catch(() => {});
  }, [projectId]);
  if (!d || (!d.final && !d.recorded)) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-medium">流量预测</h3>
      {d.final && <Line title="定稿预测" p={d.final} views={views} />}
      {d.recorded && <Line title="录制后预测" p={d.recorded} views={views} />}
    </section>
  );
}
```

`publish-pane.tsx`：在"发布的作品"那个 `section` 之后插入 `<PredictionSummary projectId={projectId} views={s.work?.viewCount ?? null} />`。

`src/components/retro/formula-card.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

type Proposed = { version: number; reason: { label: string; direction: string; samples: number; oldError: number; newError: number } };

export function FormulaCard({ onChanged }: { onChanged: () => void }) {
  const [p, setP] = useState<Proposed | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/predict/formulas').then((r) => r.json()).catch(() => ({ success: false }));
    setP(j.success ? j.data.proposed : null);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!p) return null;
  const decide = async (action: 'accept' | 'reject') => {
    const j = await fetch(`/api/predict/formulas/${p.version}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    if (!j.success) setMsg(j.message);
    await load();
    onChanged();
  };
  const x = (e: number) => Math.exp(e).toFixed(1);
  return (
    <div className="rounded-md border border-[var(--accent)] p-3 text-sm">
      <div className="font-medium">预测公式建议</div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {`${p.reason.label}连续${p.reason.direction === 'optimistic' ? '偏乐观' : '偏悲观'}（最近 3 条都偏 20% 以上）。按 ${p.reason.samples} 条已对账的作品回测：平均误差 ${x(p.reason.oldError)} 倍 → ${x(p.reason.newError)} 倍。采纳后以后的预测用新公式，已有预测不变。`}
      </p>
      <div className="mt-2 flex gap-3 text-xs">
        <button className="text-[var(--accent)]" onClick={() => void decide('accept')}>采纳</button>
        <button className="text-[var(--text-tertiary)]" onClick={() => void decide('reject')}>不要</button>
      </div>
      {msg && <p className="mt-1 text-xs text-[var(--danger)]">{msg}</p>}
    </div>
  );
}
```

`retro-view.tsx`：右栏 `写法库` 标题之前渲染 `<FormulaCard onChanged={() => void load()} />`。

`src/app/page.tsx`：
- 读取 `searchParams: { sort?: string }`；
- 查出每个项目用于展示的预测（`latestForDisplay`，只对 `stage !== 'draft'` 且未关联发布作品的项目）；
- 行内在时长列前加 `<span className="font-mono text-[var(--text-tertiary)]">{pred ? (pred.result.center === null ? '预测：待数据' : \`预测 ~\${fmtViews(pred.result.center)}\`) : ''}</span>`；
- 「项目」标题旁加 `<Link href={sort === 'predict' ? '/' : '/?sort=predict'} className="ml-3 text-xs text-[var(--accent)]">{sort === 'predict' ? '按更新时间' : '按预测排序'}</Link>`；`sort=predict` 时有中枢的项目按中枢降序排在前面，其余按原顺序。

- [ ] **Step 6: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：打开「U盘干到品类第一（验收）」脚本页 → 面板显示 → 点「预测」→ 预测中… → 出结果；点原句高亮段落；点「让编导按这个改」→ 编导对话收到消息；首页出现"预测 ~…"并能按预测排序；窄屏不溢出。

```bash
git add src/components src/app/page.tsx tests/components
git commit -m "feat(predict): 脚本页预测面板(原句高亮/拖后腿交给编导) + 发布页预测与对账 + 复盘页公式建议 + 首页按预测排序

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-30-view-prediction-design.md`（追加实测）、`.claude/skills/mediapilot/SKILL.md`

- [ ] **Step 1: README**

「现在能做什么」在「Obsidian 记忆」之后加：

```markdown
- **流量预测**：脚本页「流量预测」按 5 项（开头钩子 / 节奏 / 结尾 / 互动 / 选题）给稿子打分，按你自己作品的平时水平换算出分项预测（2 秒跳出、5 秒完播、平均观看、完播、互动）和播放区间四档概率，并指出拖后腿的段落，可一键让编导按建议改。定稿和录完口播后各自动锁定一版，第 3 / 7 天复盘时逐项对账；同一项连续 3 次同向偏差时，回测更准才在「复盘」页提议调公式，你采纳才生效。发布后前两天明显落后于预测会提醒。首页可按预测排序；`mp predict run/show/list`。样本少时置信度低，会直接写明误差范围。
```

目录一节加 `src/lib/predict/  流量预测：换算公式、打分、运行、对账与校准、落后提醒`。

`.claude/skills/mediapilot/SKILL.md` 流程第 4 步"磨稿"加一行：`- 想知道能跑多少: \`mp predict run <项目>\`(按拖后腿的建议再磨); 手上几条稿子时 \`mp predict list\` 看先发哪条。`

- [ ] **Step 2: 真机验收**

1. `U盘干到品类第一（验收）` 脚本页做一次草稿预测：5 项打分都引用了稿子原句；点原句高亮；拖后腿与「让编导按这个改」可用；公开作品 5 条 → 有中枢与四档，置信度低。
2. `mp predict list`、`mp predict show <项目>`；`MP_AGENT=hermes npm run -s mp -- predict run <项目>` 被拒。
3. 编导对话说"测一下这条能不能火" → 调用 `predict_views`。
4. 首页"按预测排序"。
5. 若验收中新建测试项目（为验证定稿自动锁定），用完问用户是否删除。

实测写入 spec 末尾。

- [ ] **Step 3: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-09-30-view-prediction-design.md .claude/skills/mediapilot/SKILL.md
git commit -m "docs: README 补流量预测, spec 记录真机实测, mediapilot skill 补 mp predict

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
