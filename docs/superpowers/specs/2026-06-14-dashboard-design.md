# Phase 3 Dashboard (数据总览) — Design

**Project**: MediaPilot (自媒体智能管理平台)
**Phase**: 3 — Cross-video aggregation dashboard
**Date**: 2026-06-14
**Spec status**: Approved by user, pending implementation plan
**Predecessor**: Direction A v1 + v2 已上线;niche optional 已落地

---

## 0. 背景

Direction A v1 (上传分析) 和 v2 (发后复盘) 让用户每条视频都积累一份"AI 预判 + 实际数据"二元数据。 但当前用户只能逐条点进去看,没有跨视频的聚合视角。 `/dashboard` 路由目前是 Placeholder。

Dashboard 把零散积累变成 **MediaPilot 独有的运营飞轮洞察** — 抖音创作者中心给得了 actuals,但给不了 "AI 预判 vs 实际" 的 calibration 视图。 这是 MediaPilot 区别于一般运营工具的最大差异化。

---

## 1. 目标与范围

### 1.1 用户故事

> 我打开 `/dashboard`,一眼看到我最近 10 条分析的 overallScore 趋势线 + 我的 4 个维度 AI 预判校准矩阵(钩子准 80%、完播过度乐观 40%、等等)+ 我的 Top 3 表现视频 + Top 3 最大失误。 如果我只有 1-2 条,显示已有数据 + 引导"上传更多解锁完整洞察",不留白。

### 1.2 v1 必须达成 (verifiable)

1. `/dashboard` 替换现有 Placeholder,显示真实聚合数据
2. **Top stats bar** 4 个数字:
   - 总分析数 (`COUNT(*)`)
   - 累计 token 花费 USD (`SUM(llmUsage->'total'->>'estCostUSD')`)
   - 最近 7 天上传数
   - 已 v2 复盘数 (`retroStatus = 'COMPLETED'`)
3. **overallScore 趋势图** (Recharts LineChart):
   - 横轴: 最近 10 条 createdAt
   - 纵轴: 0-100
   - 主线: report.overallScore (有数据的)
   - 第二线: retroReport.inferredActualScore (仅复盘过的才画点)
4. **Calibration 矩阵** (MediaPilot 独家洞察):
   - 4 维度 × 4 accuracy enum (on-target / over-estimated / under-estimated / unknown)
   - 每格百分比 + 该格样本数
   - 显示 **解锁门槛: ≥ 3 条 v2 retro'd 分析**,否则显示"复盘 3 条以上视频后解锁"
   - 1 句话洞察自动生成,如"你的'完播'预测系统性偏乐观,可能高估了 完播率" (根据矩阵的最大异常 cell 启发式生成,不调 LLM)
5. **Niche 分布表** 3 列:niche label / count / 平均 overallScore (按 count 倒序)
6. **Top 3 表现** — actualMetric.plays 倒序前 3 (只看 retro'd 的)
7. **Top 3 失误** — `predictedOverallScore - inferredActualScore` 倒序前 3 (过度乐观)
8. 稀疏数据 graceful 4 档:
   - 0 条 → 全空,显示大 CTA "+ 新分析"
   - 1-2 条 → 显示 stats + trend 单点,calibration 锁定提示
   - 3-9 条 → 全部 widget 显示,trend 数据不满 10
   - 10+ 条 → 完整状态

### 1.3 v1 明确不做

- niche / date range 筛选条
- chart 点击 → 钻入到具体分析
- 两条视频并排对比
- 实时刷新 / 轮询 (数据低频变化, 每次访问页面拉一次即可)
- AI 生成周报 / 月报
- 多账号横向对比 (单用户假设)
- 导出 CSV / PDF
- 自定义 widget 顺序 / 隐藏

### 1.4 默认值 (摊在桌面避免歧义)

| 项 | 取值 | 理由 |
|---|---|---|
| 时间范围 | 最近 10 条 (按 createdAt desc) | 趋势可视 + 数据不太多 |
| Calibration 最少样本 | ≥ 3 条 v2 retro'd | 太少没意义, 3 是统计上"勉强能看"的最小门槛 |
| 趋势第二线 | inferredActualScore (有 retro 才画) | calibration 视角的核心 |
| Niche 分布 排序 | count desc | 用户最常做哪类 |
| Top 表现 / 失误 个数 | 各 3 个 | 屏占合理,鼓励上传更多 |
| Calibration insight | 启发式生成(非 LLM) | dashboard 加载零额外成本 |
| 数据刷新策略 | 每次页面加载 1 次, 无轮询 | 单用户低频, 不浪费 |
| Empty state CTA | `/content/preflight/new` | 引导新分析 |

---

## 2. 架构

### 2.1 数据流

```
[浏览器 /dashboard]
   │
   │ Server Component 或 Client Component + useEffect fetch
   ▼
[GET /api/v1/dashboard/summary]
   │
   │ 单一聚合 API,一次性 SQL + Prisma 查询返回所有 widget 数据
   │
   ├─ 5 个 Prisma 查询并发:
   │   1. stats: COUNT + SUM
   │   2. trend: SELECT id, completedAt, report->overallScore, retroReport->inferredActualScore (LIMIT 10)
   │   3. calibration source: SELECT retroReport WHERE retroReport IS NOT NULL → JS 端聚合
   │   4. nicheDistribution: GROUP BY niche
   │   5. topPerformers + biggestMisses: JOIN ActualMetric
   │
   ▼
[Dashboard renders widgets]
   - StatsBar
   - OverallScoreTrendChart (Recharts LineChart)
   - CalibrationMatrix (table)
   - NicheDistribution (table)
   - TopPerformers (cards)
   - BiggestMisses (cards)
```

### 2.2 关键技术决策

| 项 | 选型 | 理由 |
|---|---|---|
| **数据存储** | 复用现有表 (ContentAnalysis + ActualMetric) | 0 新表,0 迁移 |
| **聚合层** | 单个 API endpoint 一次性返 5 块数据 | 避免 N+1 / 前端 reduce 大数组 |
| **查询并发** | `Promise.all` 5 个独立 Prisma 查询 | 单用户场景 < 100ms 总耗时 |
| **Calibration 聚合** | JS 端遍历 retroReport JSONB | retro'd row 通常 < 几十条, JS 聚合更灵活 |
| **趋势图** | Recharts LineChart (Phase 1 已选) | deps 现成, 无需新增 |
| **状态管理** | Client component + 1 次 fetch | 数据低频,无需 zustand / SWR |
| **缓存** | 无 (每次刷新都重算) | 单用户量小, 不值得复杂化 |
| **空状态** | 4 档显式分支 (0 / 1-2 / 3-9 / 10+) | 用户体验关键, 避免难看的"图表里 1 个点" |

### 2.3 新建 / 修改文件清单

**新建**:

```
src/app/api/v1/dashboard/summary/route.ts            # GET 聚合 API
src/lib/dashboard/aggregate.ts                       # 5 个查询 + JS 聚合 (Prisma 调用层)
src/lib/dashboard/calibration.ts                     # 从 retroReport 集合算 4×4 矩阵 + insight
src/lib/dashboard/types.ts                           # DashboardSummary 类型
src/components/dashboard/stats-bar.tsx
src/components/dashboard/overall-score-trend.tsx     # Recharts LineChart wrapper
src/components/dashboard/calibration-matrix.tsx
src/components/dashboard/niche-distribution.tsx
src/components/dashboard/top-performers.tsx
src/components/dashboard/biggest-misses.tsx
src/components/dashboard/empty-state.tsx             # 0 / 1-2 / sparse 4 档复用
tests/lib/dashboard/aggregate.test.ts
tests/lib/dashboard/calibration.test.ts
tests/api/dashboard/summary.test.ts
```

**修改**:

```
src/app/dashboard/page.tsx                           # 替换 Placeholder, 组装 6 widgets
```

---

## 3. 数据模型

**零新表**。 所有数据从现有 `ContentAnalysis` + `ActualMetric` 表读。 关键字段已存在:

- `ContentAnalysis.status` (COMPLETED / FAILED / ...)
- `ContentAnalysis.niche` (string)
- `ContentAnalysis.completedAt`
- `ContentAnalysis.report` (JSONB, 含 `overallScore`)
- `ContentAnalysis.retroReport` (JSONB, 含 `predictedOverallScore` / `inferredActualScore` / `hookGap.accuracy` / `retentionGap.accuracy` / `titleCaptionGap.accuracy` / `coverGap.accuracy`)
- `ContentAnalysis.retroStatus`
- `ContentAnalysis.llmUsage` (JSONB, 含 `total.estCostUSD`)
- `ActualMetric.plays` (BigInt)

### 3.1 DashboardSummary 类型 (API 返回)

```typescript
export interface DashboardSummary {
  stats: {
    totalAnalyses: number;
    totalSpendUSD: number;
    last7dCount: number;
    retroedCount: number;
  };

  trend: Array<{
    id: string;
    videoFilename: string;
    completedAt: string;            // ISO
    overallScore: number | null;
    inferredActualScore: number | null;
  }>;  // 最近 10 条, asc by completedAt

  calibration: {
    sampleCount: number;             // 用于 calibration 的 retro 样本数
    matrix: {
      hookGap: AccuracyDistribution;
      retentionGap: AccuracyDistribution;
      titleCaptionGap: AccuracyDistribution;
      coverGap: AccuracyDistribution;
    };
    insight: string;                 // "你的'完播'预测系统性偏乐观, 可能高估了 完播率"
  } | null;  // sampleCount < 3 → null

  nicheDistribution: Array<{
    niche: string;
    label: string;                   // KNOWN_NICHES 里的 label, 未知 niche → 原字符串
    count: number;
    avgOverallScore: number | null;
  }>;  // 按 count desc

  topPerformers: Array<{
    id: string;
    videoFilename: string;
    plays: number;                   // string serialized BigInt
    overallScore: number | null;
  }>;  // top 3 by plays

  biggestMisses: Array<{
    id: string;
    videoFilename: string;
    predicted: number;
    inferred: number;
    gap: number;                     // predicted - inferred
  }>;  // top 3 by gap (positive = 过度乐观)
}

interface AccuracyDistribution {
  onTarget: number;                  // count
  overEstimated: number;
  underEstimated: number;
  unknown: number;
  total: number;
  /** 高亮异常 cell — 该 dim 最大的非 on-target 占比 (e.g. 'over-estimated') */
  worstBucket: 'on-target' | 'over-estimated' | 'under-estimated' | 'unknown' | null;
}
```

### 3.2 关键设计决策

| 决策 | 说明 |
|---|---|
| `plays` 序列化为 string | BigInt 无法 JSON.stringify; 前端用 `Number(string)` 转 |
| `trend` 按 asc by completedAt | LineChart 横轴从左到右时间顺序 |
| `calibration` 整体 null vs 部分 null | 解锁门槛简化: 全有或全无, 而非 "钩子有 / 完播没" |
| `insight` 服务端启发式生成 | 不调 LLM, dashboard 零额外成本 |
| `worstBucket` 字段 | 便于前端 UI 高亮异常格 (e.g. 红色边框) |

### 3.3 Calibration insight 启发式

```typescript
function generateInsight(matrix: CalibrationMatrix): string {
  // 找出 over-estimated 占比最高的 dim
  const overRanking = Object.entries(matrix)
    .map(([dim, dist]) => ({ dim, pct: dist.overEstimated / dist.total }))
    .sort((a, b) => b.pct - a.pct);
  const worst = overRanking[0];
  if (worst.pct >= 0.4) {
    return `你的"${dimLabel(worst.dim)}"预测系统性偏乐观 (${Math.round(worst.pct*100)}% 实际表现低于预期)。 后续可调低评分基线。`;
  }
  // 找出 under-estimated 占比最高的 dim
  const underRanking = Object.entries(matrix)
    .map(([dim, dist]) => ({ dim, pct: dist.underEstimated / dist.total }))
    .sort((a, b) => b.pct - a.pct);
  const best = underRanking[0];
  if (best.pct >= 0.4) {
    return `你的"${dimLabel(best.dim)}"预测系统性偏保守 (${Math.round(best.pct*100)}% 实际优于预期)。 可放心提升评分自信。`;
  }
  // 都还好
  return '各维度预测整体校准良好, 继续保持。';
}
```

---

## 4. 关键流程

### 4.1 Dashboard 加载

```
浏览器进入 /dashboard
  ▼
client component mount → useEffect → fetch /api/v1/dashboard/summary
  ▼
API server-side:
  - getOrCreateDefaultUser
  - Promise.all 5 个 Prisma 查询
  - JS 端聚合 calibration
  - 生成 insight
  - serialize BigInt → string
  - return DashboardSummary
  ▼
前端拿 data → render 6 widgets
  - 0 条 → <EmptyState> 大 CTA
  - 1-2 条 → 部分 widget + 引导
  - 3+ retro → 完整 calibration 解锁
```

### 4.2 4 档稀疏状态

| 总分析数 | retro 数 | 显示 |
|---|---|---|
| 0 | 0 | 大 CTA "+ 新分析", 简短文案"上传第一个视频试试" |
| 1-2 | 0 | stats bar + trend (单/双点) + niche 表; calibration / top / misses 全锁 |
| 3-9 | < 3 | stats + trend + niche + top performers; calibration 锁定提示 |
| 3+ | ≥ 3 | 完整 dashboard |
| 10+ | 任意 | 趋势满 10 点; 其他不变 |

### 4.3 数据查询细节

```typescript
// src/lib/dashboard/aggregate.ts

export async function aggregateDashboard(userId: string): Promise<DashboardSummary> {
  const [statsRow, trendRows, retroSourceRows, nicheRows, topPerformerRows, missCandidateRows] =
    await Promise.all([
      prisma.contentAnalysis.aggregate({ ... }),  // count + sum cost
      prisma.contentAnalysis.findMany({ where: { userId, status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, take: 10, select: { id, videoFilename, completedAt, report, retroReport } }),
      prisma.contentAnalysis.findMany({ where: { userId, retroReport: { not: null } }, select: { retroReport } }),
      prisma.contentAnalysis.groupBy({ by: ['niche'], where: { userId, status: 'COMPLETED' }, _count: true, _avg: { ... } }),
      prisma.actualMetric.findMany({ where: { analysis: { userId } }, orderBy: { plays: 'desc' }, take: 3, select: { plays, analysis: { select: { id, videoFilename, report } } } }),
      prisma.contentAnalysis.findMany({ where: { userId, retroReport: { not: null } }, select: { id, videoFilename, retroReport } }),
    ]);

  // 计算 calibration (sampleCount < 3 → null)
  // 计算 biggestMisses (sort by predicted - inferred, top 3 with positive gap)
  // 生成 insight
  // serialize BigInt plays → string
  // return DashboardSummary;
}
```

### 4.4 UI 组件树

```
<DashboardPage>
  <StatsBar stats={data.stats} />
  {data.stats.totalAnalyses === 0
    ? <EmptyState />
    : <>
        <OverallScoreTrend trend={data.trend} />
        {data.calibration
          ? <CalibrationMatrix data={data.calibration} />
          : <CalibrationLocked sampleCount={data.stats.retroedCount} />}
        <div className="grid md:grid-cols-3">
          <NicheDistribution rows={data.nicheDistribution} />
          {data.topPerformers.length > 0 && <TopPerformers items={data.topPerformers} />}
          {data.biggestMisses.length > 0 && <BiggestMisses items={data.biggestMisses} />}
        </div>
      </>
  }
</DashboardPage>
```

---

## 5. 错误处理 / 测试 / UI / 验收

### 5.1 错误矩阵

| 阶段 | 失败 | 处理 | 用户可见 |
|---|---|---|---|
| Dashboard 加载 | API 500 / 网络 | client component 捕获 → 显示错误 banner | "数据加载失败,刷新重试" |
| 0 分析 | (非失败,初始状态) | <EmptyState /> + CTA | 大按钮 "+ 新分析" |
| < 3 retro | 锁定 calibration | <CalibrationLocked sampleCount={N}/> | "复盘 ≥ 3 条视频后解锁校准矩阵 (现在 N 条)" |
| 无 ActualMetric (没人 retro 过) | top / misses 不显示 | 自动隐藏对应 widget | 仅趋势 + niche |
| Recharts crash (异常数据) | error boundary 兜住 | trend section 显示 fallback | "图表渲染异常,看下方 niche 表" |
| BigInt serialize 失败 | 不可能 (我们手动 toString) | — | — |

### 5.2 测试策略

| 层 | 覆盖 | 工具 | CI |
|---|---|---|---|
| `lib/dashboard/calibration.ts` | 给一组 retroReport, 算 4×4 矩阵 + worstBucket + insight | vitest 纯函数 | ✓ |
| `lib/dashboard/aggregate.ts` | mock prisma → 验证 5 查询并发 + 聚合正确 | vitest + vi.mock | ✓ |
| API `GET /summary` | 0 / 1 / 3 / 10 条 4 档稀疏状态 | vitest + Request | ✓ |
| UI 组件 | StatsBar / Trend / CalibrationMatrix / 等各档 render | (可选) vitest + RTL | 略 v1 |
| 手动 E2E | 真实分析数据 → 浏览器打开 /dashboard | 手动 | ✗ |

### 5.3 UI 草图

```
┌─ 数据总览 ─────────────────────────────────────────┐
│ 📊 总分析 12   💰 $0.86   📅 7天 3   🔄 已复盘 5  │
└────────────────────────────────────────────────────┘

┌─ 📈 overallScore 趋势 (最近 10) ──────────────────┐
│   100 ┤                                              │
│       │   ●─●                                        │
│    50 ┤  /   \         ○─○ (实测推算)                │
│       │ ●     ●─●─●                                  │
│     0 └─────────────────────────                     │
│      6/01  6/05  6/10  6/14                         │
│  ── 预判 overallScore   ○○ 实测 inferred             │
└──────────────────────────────────────────────────────┘

┌─ 🎯 Calibration (基于 5 条复盘) ──────────────────────┐
│  维度          ✓ on-target  ⚠ over  ⚠ under  ? unknown│
│  钩子           80% (4)     0%      20% (1)   0%      │
│  完播           40% (2)     40%★(2)  0%      20% (1)  │← 高亮
│  标题/文案      60% (3)     20% (1)  20% (1)  0%      │
│  封面           80% (4)     0%      0%       20% (1)  │
│  💡 "完播"预测系统性偏乐观,可能高估了完播率           │
└─────────────────────────────────────────────────────────┘

┌─ 📂 Niche ────┐ ┌─ 🏆 Top 表现 ─────┐ ┌─ 📉 Top 失误 ────┐
│ AI 知识  8 72 │ │ 1. xx.mp4 12.5w   │ │ 1. yy 预 80→实 30│
│ 娱乐     3 55 │ │ 2. ...            │ │ 2. ...           │
│ 美食     1 65 │ │ 3. ...            │ │ 3. ...           │
└───────────────┘ └───────────────────┘ └──────────────────┘
```

### 5.4 v1 验收清单

- [ ] 0 条分析: 进 /dashboard → 大 CTA "+ 新分析"
- [ ] 1 条分析: stats bar + trend 单点 + niche 表 + "上传更多解锁"提示
- [ ] 3 条分析 / 0 复盘: stats + trend + niche; calibration 锁; top / misses 锁
- [ ] 5 条分析 / 3 复盘: 完整 dashboard, calibration 矩阵 + insight + topPerformers + biggestMisses 显示
- [ ] 错误注入 (kill DB): 错误 banner 显示
- [ ] BigInt plays 数字格式化 (12,345 / 1.2w)
- [ ] worstBucket 高亮 (CSS class 区分)
- [ ] DB 查询验证:
  ```sql
  -- aggregate 函数返回的 stats 跟 SQL 直接 COUNT 一致
  SELECT COUNT(*), SUM(("llmUsage"->'total'->>'estCostUSD')::float) FROM "ContentAnalysis";
  ```
- [ ] `npm run typecheck` 0 错 + `npm test` 全绿
- [ ] 总开发 2-3 天

---

## 6. Open Questions / Risks

### 6.1 Calibration insight 准确性

启发式逻辑只看 over/under 占比 ≥ 40%。 边缘情况:
- 5 条样本里 2 over + 2 under + 1 on-target → 都 40% → insight 选哪个? (按代码: over 优先, 先扫 over 再扫 under)
- 4 维度都健康 → 输出"整体校准良好" — 可能让用户觉得 dashboard 没价值, 但实际就是没异常

接受 v1, 真实数据用户反馈后迭代。

### 6.2 BigInt 序列化

`plays` 是 BigInt, 直接 `JSON.stringify` 抛错。 我们手动 toString。 前端用 `Number()` 转换, 但 > 2^53 会丢精度。 抖音播放量 < 10 亿很少, 2^53 ≈ 9000 万亿, 安全。

### 6.3 性能边界

单用户场景下 5 个并发 Prisma 查询 < 100ms。 用户长期累积到 1000+ 分析时, retroReport 全表扫描可能慢。 v2 加 retro report 字段索引 / 物化视图 / Redis 缓存。

### 6.4 Recharts 版本

Phase 1 deps 已含 Recharts。 验证 LineChart + 多线 + 时间轴在当前版本工作。 若需 upgrade, 单独 task。

### 6.5 Empty state CTA 目标路径

CTA "+ 新分析" 指向 `/content/preflight/new`。 不指向 `/dashboard` 是因为这是新用户流程, 不是回流。

### 6.6 多用户假设破坏

`aggregateDashboard(userId)` 接受 userId 参数, 内部 query 都用 userId WHERE filter。 当前 `getOrCreateDefaultUser()` 总返 single user, 但实现已为多用户做好准备。 Phase 6 / SaaS 时无需重构。

---

## 7. 完成定义 (Definition of Done)

本 spec 通过用户 review 后, 直接交给 `writing-plans` skill 产出分 task 的实现计划 (`docs/superpowers/plans/2026-06-14-dashboard-plan.md`)。

实现期间任何 spec 偏离 (新增 widget / 改 API shape / 调整稀疏状态) 须回到本文档更新。

---

**Author**: Claude (Opus 4.7) + 用户 brainstorm 协作完成
**Predecessor specs**: `2026-06-12-content-preflight-design.md` (A v1), `2026-06-12-content-preflight-v2-design.md` (A v2)
**Next**: writing-plans skill → 实现计划
