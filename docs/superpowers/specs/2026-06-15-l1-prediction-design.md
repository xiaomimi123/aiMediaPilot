# L1 Prediction (预估抖音播放区间) Design Spec

**Status:** Draft 2026-06-15
**Owner:** MediaPilot (solo dev)
**Phase:** Phase 3 follow-up (after Dashboard)

## 1. Goal & Scope

让用户在每条上传视频做完 4-dim 诊断之后, 在报告页顶部立即看到一个数字播放量区间预估 (例如 "预估 1.2k - 4.8k 播放"), 用于支持 "这条视频值不值得发" 的判断。

**In scope:**

- 新模块 `src/lib/prediction/` — 纯 JS 公式 (TDD 覆盖)
- `User.baselinePlays` 列 + upload form 内一次性 onboarding 字段
- worker pipeline 在 synthesize 之后追加 `runPredict` 步, 把 `predictedPlaysRange` 写进 `report` JSONB
- 报告页顶部新增 `<PredictionCard>` 组件 (含 fallback 引导态)
- ≥ 3 条 retro 后自动用 retro median 替换 `User.baselinePlays`, basisSource 标记切换

**Out of scope (v1):**

- Dashboard 加任何 prediction widget (placement 锁定到单视频报告页)
- LLM 估算预测 (确定性公式)
- 用户后期修改 baseline 的 UI (走 DB 直改或 auto-recompute, settings 页留 v2)
- 与 retro 的 actual-vs-predicted 对比可视化 (retro 自身已有 落差分析)

## 2. Architecture / Data Flow

```
[ Upload Form ]
   │ niche + (首次额外: baselinePlays 数字输入框, 仅当 User.baselinePlays === null)
   ▼
[ POST /api/v1/content/analyses ]
   │ 创建 ContentAnalysis;
   │ 若 form 携带 baselinePlays → 写入 User.baselinePlays
   ▼
[ BullMQ content-analyze worker ]
   │ runPreprocess → runAIAnalysis → synthesize
   │ → runPredict  ◄─── 新加这一步 (纯 JS)
   │       │ resolveBaseline(userId)  — 读 retro median (≥3) 或 User.baselinePlays
   │       │ getCalibration(userId)   — 复用 Phase 3 aggregate.ts 的 calibration matrix
   │       │ computePrediction({overallScore, baseline, calibration, retroSampleCount})
   │       │ → 写入 ContentAnalysis.report.predictedPlaysRange
   ▼
[ ContentAnalysis.report ]
   {
     overallScore, topActionItems,         ← 原有
     predictedPlaysRange?: { … }           ← 新增, optional
   }
   ▼
[ GET /api/v1/content/analyses/[id] ]
   │ 返回完整 report (无加工)
   ▼
[ /content/preflight/[id] page ]
   │ <PredictionCard data={report.predictedPlaysRange} />
   │   显示在 overallScore 卡之上
```

**Key boundaries:**

| File | Responsibility |
|---|---|
| `src/lib/prediction/formula.ts` | 纯函数: `scoreMultiplier`, `calibrationFactor`, `computePrediction`, format helpers |
| `src/lib/prediction/baseline.ts` | `resolveBaseline(userId)` — DB 访问层, 决定用 retro median 还是 User.baselinePlays |
| `src/lib/prediction/types.ts` | `PredictedPlaysRange`, `ResolvedBaseline` 类型 |
| `src/jobs/workers/content-analyze-worker.ts` | 新增 `runPredict` 函数 (~15 行), 在 synthesize 后调用, fail-soft |
| `src/components/content/prediction-card.tsx` | UI 组件, 双状态 (有数据 / fallback "设置基线") |
| `src/components/content/upload-form.tsx` | 加 conditional baselinePlays 输入 |
| `src/app/api/v1/content/analyses/route.ts` | POST 解析 baselinePlays form 字段, 写 User |

## 3. Data Model

### 3.1 Prisma schema 变更

```prisma
model User {
  // ...existing fields...
  baselinePlays  BigInt?   // 用户 onboarding 时填的 "通常多少播放";
                            // ≥3 条 retro 后会被 retro median 自动覆盖。
}
```

**Migration:** `npx prisma migrate dev --name add_user_baseline_plays`

生成 SQL 等价于:
```sql
ALTER TABLE "User" ADD COLUMN "baselinePlays" BIGINT;
```

### 3.2 `ContentAnalysis.report` JSONB 扩展 (无 schema 变更)

```typescript
{
  overallScore: number,                  // 原有
  topActionItems: string[],              // 原有
  predictedPlaysRange?: {                // 新增, optional
    predicted: number,                   // 中心估算 (整数)
    lower: number,                       // predicted × 0.5
    upper: number,                       // predicted × 2
    confidence: 'low' | 'medium' | 'high',
    basisSource: 'onboarding' | 'retro-median',
    basisValue: number                   // 实际 baseline 数字 (展示用)
  }
}
```

### 3.3 BigInt 序列化

- `User.baselinePlays` 在 worker 内部读出后立即 `.toString()` → number (反正 baseline 不会超过 JS safe int 2^53)。
- 计算全程用 `number` (公式涉及小数, 不能用 BigInt 直算)。
- 写回 User.baselinePlays 用 `BigInt(Math.round(value))`。

## 4. Formula

### 4.1 核心函数签名

```typescript
function computePrediction(input: {
  overallScore: number;        // 0..100
  baseline: number;             // user baseline (number, post-BigInt-decode)
  calibration: CalibrationData | null;
  retroSampleCount: number;
}): PredictedPlaysRange
```

### 4.2 Score multiplier (指数曲线)

```typescript
function scoreMultiplier(overallScore: number): number {
  return Math.exp((overallScore - 50) / 30);
}
```

锚点验证表:

| overallScore | multiplier |
|---|---|
| 100 | 5.29× |
| 80  | 2.72× |
| 50  | 1.00× |
| 30  | 0.51× |
| 0   | 0.19× |

**选 div=30 的理由:** div=20 太陡 (score 100 → 13× 虚假乐观), div=40 太平 (score 100 → 3.5× 奖励不足)。 30 让 "比平均好" 显著奖励但避免单一爆款幻觉。

### 4.3 Calibration factor (与 Phase 3 闭环)

```typescript
function calibrationFactor(cal: CalibrationData | null): number {
  if (!cal) return 1.0;
  const dims = Object.values(cal.matrix);
  const avgOverPct =
    dims.reduce((s, d) => s + (d.total ? d.overEstimated / d.total : 0), 0) / 4;
  const avgUnderPct =
    dims.reduce((s, d) => s + (d.total ? d.underEstimated / d.total : 0), 0) / 4;
  if (avgOverPct >= 0.4) return 0.7;   // 整体偏乐观: 压缩 30%
  if (avgUnderPct >= 0.4) return 1.3;  // 整体偏保守: 拔高 30%
  return 1.0;
}
```

### 4.4 最终算式

```
predicted = round(baseline × scoreMultiplier(overallScore) × calibrationFactor(matrix))
lower     = round(predicted × 0.5)
upper     = round(predicted × 2)
```

**Overflow clamp:** 若 `predicted > 1e9`, clamp 到 `1e9` (避免显示荒谬数字、避免 BigInt 写回失败)。

### 4.5 Confidence

| retroSampleCount | confidence | 文案 |
|---|---|---|
| 0..2  | low    | 置信度低 (复盘 3+ 解锁中等) |
| 3..9  | medium | 置信度中 (复盘 10+ 解锁高) |
| 10+   | high   | 置信度高 |

### 4.6 Worked example (当前真实数据)

User 假设 onboarding 填了 baseline=800, 上传视频得 overallScore=45, calibration=null (0 retro):

- `mult = exp((45-50)/30) = exp(-0.167) ≈ 0.846`
- `calFactor = 1.0`
- `predicted = round(800 × 0.846 × 1.0) = 677`
- `lower = round(677 × 0.5) = 339`
- `upper = round(677 × 2) = 1354`
- `confidence = 'low'`
- `basisSource = 'onboarding'`, `basisValue = 800`

UI 渲染: "📈 预估 339 - 1.4k 播放 · 中心估算 677 · 置信度: 低"

## 5. Onboarding Flow

### 5.1 首次问答 — 在 upload form

`src/components/content/upload-form.tsx` 加一个 conditional 字段, 仅当 `user.baselinePlays === null` 时显示:

```tsx
{user.baselinePlays === null && (
  <div className="rounded-md border-2 border-dashed border-amber-300 bg-amber-50 p-3">
    <label className="text-sm font-medium">
      🎯 一次性设置: 你最近 10 条视频平均多少播放?
      <p className="text-xs text-muted-foreground">
        用于校准 L1 预测。 不填的话短期内不出预测, 等 3 条复盘后会从实测数据自动算出。
      </p>
    </label>
    <input
      type="number"
      min={0}
      placeholder="例如: 800"
      name="baselinePlays"
      className="mt-2 input-class"
    />
  </div>
)}
```

POST `/api/v1/content/analyses` 解析 multipart form 时, 若 `baselinePlays` 字段存在且 > 0 → 写 `User.baselinePlays`。

### 5.2 Auto-recompute from retros

`src/lib/prediction/baseline.ts` 内 `resolveBaseline(userId)`:

1. 查 User 的全部 `ActualMetric.plays` (跨多个 ContentAnalysis 的 retro)
2. 如果 `count >= 3` → 取 median(plays) 作为 baseline, basisSource='retro-median'
3. 如果 `count < 3` → 用 `User.baselinePlays`, basisSource='onboarding'
4. 如果两者都没有 → 返回 null (worker 跳过 runPredict)

**Side effect:** 步骤 2 触发时, 顺手把 median 写回 `User.baselinePlays` (覆盖 onboarding 值, 让下次更快读)。 用 `prisma.user.update`, 失败不抛, 主流程不阻断。

### 5.3 Cold start fallback (用户跳过 onboarding)

`User.baselinePlays === null && retroCount === 0`:

- worker `runPredict` 检测到 baseline 为 null → 跳过, 不写 `predictedPlaysRange`
- 报告页 PredictionCard 看到 `report.predictedPlaysRange === undefined` → 渲染 fallback CTA:

```
💡 设置账号基线后, L1 播放预测会出现在这里
[设置基线 →]   (链接到 /settings/baseline mini 页, 一个 input + 保存)
```

v1 不写 `/settings/baseline` 页。 fallback 文案纯文字提示 (无按钮、无跳转)。 用户若想拿到预测有两条路: (a) 重新上传时把 onboarding 填上; (b) 攒够 3 条 retro 后自动覆盖。

### 5.4 安全边界

- baselinePlays ≤ 0 或 NaN → 视为 null
- baselinePlays > 1e8 → 截断到 1e8 (防 BigInt overflow)
- form 解析失败 → 静默忽略 (不阻断 analysis 创建)

## 6. UI — PredictionCard

`src/components/content/prediction-card.tsx`:

### 6.1 数据存在态

```
┌─────────────────────────────────────────────────────────┐
│  📈 预估播放                                              │
│                                                          │
│      1.2k  ─────  4.8k                                  │
│                                                          │
│  中心估算 2.4k · [置信度: 低 badge] (复盘 3+ 解锁中等)    │
│                                                          │
│  基线 800 (你 onboarding 填的) · score 75 × 1.5×        │
└─────────────────────────────────────────────────────────┘
```

**数字格式化函数** `formatPlays(n: number): string`:
- `< 1000` → `n.toString()` (例: `850`)
- `1000 ~ 9999` → `(n/1000).toFixed(1) + 'k'` (例: `1.2k`)
- `>= 10000` → `(n/10000).toFixed(1) + 'w'` (例: `1.2w`, 与 Phase 3 top-performers 一致)

**Confidence badge:**
- low: 灰色 `bg-muted text-muted-foreground`, 文案 "置信度: 低"
- medium: 蓝色 `bg-blue-100 text-blue-900`
- high: 绿色 `bg-green-100 text-green-900`

### 6.2 Fallback 态 (predictedPlaysRange undefined)

```
┌─────────────────────────────────────────────────────────┐
│  💡 L1 播放预测暂未生成                                   │
│                                                          │
│  • 设了账号基线 → 上传时立即出预测                         │
│  • 没设的话, 等 3 条复盘后会自动从实测数据反算出基线         │
└─────────────────────────────────────────────────────────┘
```

v1 不渲染 "设置基线 →" 按钮 (settings 页留 v2)。 纯文字提示用户两条解锁路径。

### 6.3 放置

`/content/preflight/[id]` page, PredictionCard 放在 overallScore 卡片之上 (用户最先看到, 决策驱动)。

### 6.4 交互

无。 纯展示, 不可点击, 不可隐藏。

## 7. Testing & Error Handling

### 7.1 单测覆盖

**`tests/lib/prediction/formula.test.ts`:**

- `scoreMultiplier` 锚点表 — score=0/30/50/80/100, 容差 ±0.02
- `calibrationFactor`:
  - null → 1.0
  - 任一 dim overEstimated 占比 ≥ 0.4 平均 → 0.7
  - 任一 dim underEstimated 占比 ≥ 0.4 平均 → 1.3
  - 同时触发 → over 优先 (与 Phase 3 insight 一致)
  - 全 on-target → 1.0
- `computePrediction` 集成:
  - 典型 case (baseline=1000, score=75, cal=null) → 检查 predicted/lower/upper/confidence
  - Overflow case (baseline=1e9, score=100) → clamp 到 1e9
  - 边界 (score=0, score=100)
- `formatPlays`:
  - 850 → "850"
  - 1234 → "1.2k"
  - 15234 → "1.5w"
  - 0 → "0"

**`tests/lib/prediction/baseline.test.ts`** (mock prisma):

- 0 retro + User.baselinePlays=null → 返回 null
- 0 retro + User.baselinePlays=500n → 返回 {value: 500, source: 'onboarding'}
- 2 retro (< 3) → 走 onboarding 分支
- 3 retro plays=[100, 500, 1000] → median=500, source='retro-median', 写回 User.baselinePlays=500n
- 4 retro plays=[100, 200, 800, 1000] → median=(200+800)/2=500
- BigInt 大数: plays=[1n, 2n, 3n] (median 2)

**不写单测:**
- worker `runPredict` 集成 (与 phase 1 worker 风格一致)
- UI `PredictionCard` (UI 一律手动 E2E)
- POST 路由解析 baselinePlays form (走真实 form 提交 E2E 覆盖)

### 7.2 错误处理矩阵

| 情况 | 行为 |
|---|---|
| `baselineRequest === null` (无 onboarding, 无 retro) | worker 跳过 runPredict, report.predictedPlaysRange 留 undefined, UI 渲染 fallback CTA |
| `predicted > 1e9` | clamp 到 1e9 |
| `overallScore` 缺失 (理论不可能, 防御) | runPredict 抛 → catch, 不写, console.error |
| Prisma 写 `User.baselinePlays` 覆盖失败 | catch 后不阻断, prediction 仍写入 report (只是下次重算) |
| 老 analysis 没 `predictedPlaysRange` 字段 | UI 用 optional chaining, 渲染 fallback CTA (与冷启动同) |
| `baselinePlays` form 字段非数字 / 负数 / NaN | 静默忽略, 不阻断 analysis 创建 |

### 7.3 手动 E2E 验收清单

1. **冷启动 happy path:**
   - 清空 User.baselinePlays
   - 打开 /content/preflight/new → 看到 "🎯 一次性设置" 提示
   - 填 baseline=800 → 提交 → 等 analysis 完成
   - 报告页顶部出现 PredictionCard, 显示具体区间, confidence='low'
2. **二次上传:**
   - 不再看到 baseline 提示 (User.baselinePlays 已设)
   - 报告页继续出 PredictionCard
3. **Skip onboarding:**
   - 清空 baseline 后, 不填 baseline 字段直接提交
   - 报告页显示 fallback CTA "设置账号基线后..."
4. **Calibration 影响:**
   - 用 Phase 3 mock SQL 注入 3 条偏乐观 retro
   - 重跑一条 analysis → predict 时 calFactor=0.7, 区间下移
5. **Auto-recompute:**
   - 3 条 retro 实际数据完成后, User.baselinePlays 被自动覆盖为 median
   - 下次预测 basisSource='retro-median'

## 8. Open Questions / Future Iterations

- **v2: settings/baseline 页面.** 当前 fallback CTA 不能点。 v2 添加 mini 设置页 (一行 input + 保存按钮), 让冷启动绕过 + 后期手动调整。
- **v2: prediction history.** 把 prediction 写到独立 PredictionHistory 表, 方便看 "你过去 5 次上传预测了 X, 实际是 Y" 的精度演化。 v1 直接靠 retro 已有数据可手算。
- **v2: 多形式 confidence 信号.** 现在只用 retroCount, 未来可加 baseline std-dev → 高方差账号自动调宽区间。
- **v3: 与 niche 相关的 score curve.** 现在所有 niche 共享 div=30 曲线。 不同垂类爆款分布不同 (娱乐右尾更厚), v3 可针对 niche 微调。
- **冒烟数据问题:** 当前用户只有 1 条真实 video + 0 retro。 v1 上线后, 真实验证需要等用户产生 ≥ 3 条 retro, 才能触发 calibration 闭环路径。 这是工程时间能解决的问题, 设计本身 OK。
