# 发布前流量预测设计

- 日期：2026-09-30
- 状态：待用户审阅
- 参考：[cheat-on-content](https://github.com/XBuilderLAB/cheat-on-content)（MIT）的"打分 → 盲预测 → 复盘对账 → 校准"循环；抖音公开的推荐原理（按"看完 / 点赞 / 评论 / 分享 / 关注"等行为加权）
- 前置：复盘（`src/lib/retro/diagnose.ts` 的平时基线与判定）、每晚回采的分段指标、写法经验的采纳机制

## 1. 目标

发布前预测一条口播大概能跑多少，并指出哪一段拖后腿；发布后对账，公式越用越准。用途：
- 定稿前改稿：看到哪项拖后腿，让编导改完再测；
- 决定先发哪条：已定稿未发布的项目按预测排序；
- 练判断力：锁定的预测第 3 天逐项对账；
- 定期望值：发布后前两天明显落后于预测时提醒。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 方法 | A：大模型分项打分 + 写死的换算公式（以账号自己的基线为准）；不训练统计模型；不让模型直接报播放量 |
| 输出 | 分项预测（与复盘同口径）+ 播放区间四档概率 + 中枢 |
| 时机 | 草稿随时测（不锁定）；定稿自动锁定；转写完成后按实际口播再锁定一版 |
| 用户自己的猜测 | 不做 |
| 校准 | 连续同向偏差 → 回测更准才提议 → 用户在复盘页采纳才生效 |
| 盲打 | 打分只看稿子 / 转写、定位、对标拆解，看不到本条作品任何数据；作品关联发布后不再允许新增锁定预测 |

## 3. 打分

一次模型调用给 5 项打分，每项 1–5 整数：

| 维度 key | 名称 | 看什么 | 对应复盘指标 |
|---|---|---|---|
| `hook` | 开头钩子 | 前 2 秒能否让人停下、前 5 秒是否给出看下去的理由 | `hook2s`（跳出率，越低越好）、`hook5s` |
| `pace` | 节奏与信息密度 | 注水段、信息点间隔、中段有无新钩子 | `middle`（平均观看秒数） |
| `ending` | 结尾收束 | 结尾是否干脆、有无让人看完的回收 | `ending`（完播率） |
| `interaction` | 互动引子 | 有无点赞 / 收藏 / 评论 / 分享 / 关注的理由 | `like`、`favorite`、`share`、`subscribe` |
| `topic` | 选题与受众 | 选题大众度、与定位的契合、对标背书 | 只影响播放量 |

模型输出（zod 校验，格式不对重试一次）：

```ts
{
  scores: {
    dim: 'hook' | 'pace' | 'ending' | 'interaction' | 'topic';
    score: 1 | 2 | 3 | 4 | 5;
    reason: string;        // 一句理由
    quote: string;         // 稿子 / 转写里的原句(依据), 可为空串
    segmentId: string | null; // 原句所在段落 id(转写版为 null)
    fix: string;           // 一句怎么改(3 分及以上可为空串)
  }[]  // 恰好 5 项, 各 dim 一次
}
```

系统提示包含：抖音推荐原理摘要、5 个维度各 1 / 3 / 5 分的锚点描述、用户定位、对标拆解（如有）。用户消息为稿子全文（段落 id + 中文段名 + 估算秒数），录制后版为逐句转写。不包含本项目的任何发布数据。

## 4. 换算公式

参数存在公式表里，带版本号。第 1 版：

```ts
{
  k: 0.15,                       // 每差 1 分, 分项指标变化 15%
  metricOffset: { hook2s: 0, hook5s: 0, middle: 0, ending: 0, like: 0, favorite: 0, share: 0, subscribe: 0 },
  weights: { hook: 0.3, topic: 0.2, pace: 0.2, ending: 0.15, interaction: 0.15 },
  viewBase: 2,                   // 综合分每高 1 分, 播放中枢 × 2
  viewOffset: 0,                 // 播放中枢的整体校准(以 2 为底的对数偏移)
  benchmarkBonus: 0.3,           // 对标爆款(对标是他平时 ≥3 倍)时综合分加成
}
```

- **基线**：与复盘相同——最近 10 条公开作品各指标的中位数（`BASELINE_SIZE`），某指标有效值少于 3 条（`MIN_BASELINE`）时该指标无基线。
- **分项预测值**：`baseline × (1 + k × (s − 3)) × (1 + metricOffset[m])`；跳出率方向相反：`baseline × (1 − k × (s − 3)) × (1 + metricOffset[m])`。`s` 为该指标对应维度的分数。
- **分项判定**：与复盘同一规则（`THRESHOLD = 0.2`）——预测值相对基线好 20% 以上为"好"、差 20% 以上为"差"、否则"平"；无基线为"—"。
- **综合分**：`Σ weights[d] × score[d]`（1–5），对标爆款时 `+ benchmarkBonus`。
- **播放中枢**：`baselineViews × viewBase^(综合分 − 3 + viewOffset)`。
- **四档**（相对基线播放）：`< 0.5×`、`0.5–2×`、`2–5×`、`≥ 5×`；显示时换算成具体数字。
- **各档概率**：以中枢为中心的对数正态分布，`σ` 由置信度决定：已对账 < 5 次 `ln 3`、5–14 次 `ln 2`、≥ 15 次 `ln 1.6`；各档概率 = 该档上下界在分布上的累积概率之差；四档之和为 100%（四舍五入后误差补到最大档）。
- **公开作品少于 3 条**（无播放基线）：只给打分与拖后腿，不给任何数字，并提示"再发 N 条就能预测数字"。

## 5. 数据

```prisma
/// 流量预测(定稿/录制后两种一旦生成不可改不可删)
model Prediction {
  id             String   @id @default(cuid())
  projectId      String
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  /// draft | final | recorded
  kind           String
  formulaVersion Int
  /// 所依据文本的 sha256 前 12 位
  inputHash      String
  /// 模型打分(§3 的 scores)
  scores         Json
  /// 换算结果: { metrics: {key, baseline, predicted, verdict}[], composite, benchmarkBonus, baselineViews, center, buckets: {label, lo, hi, prob}[], confidence, calibratedCount } ; 无播放基线时 baselineViews/center 为 null、buckets 为空
  result         Json
  createdAt      DateTime @default(now())
  check          PredictionCheck?

  @@index([projectId, kind, createdAt])
}

/// 锁定预测与实际的对账(第 3 天生成, 第 7 天更新)
model PredictionCheck {
  id           String     @id @default(cuid())
  predictionId String     @unique
  prediction   Prediction @relation(fields: [predictionId], references: [id], onDelete: Cascade)
  dayN         Int
  /// { [metric]: 实际 / 预测 }
  ratios       Json
  /// 实际播放 / 中枢
  viewRatio    Float?
  /// 实际播放所在档位是否就是预测概率最高的那档
  bucketHit    Boolean?
  /// { [metric]: 'hit' | 'optimistic' | 'pessimistic' }
  verdicts     Json
  updatedAt    DateTime   @updatedAt
}

/// 预测换算公式(版本化)
model PredictionFormula {
  version   Int       @id
  params    Json
  /// active | proposed | rejected | retired
  status    String
  /// 提议原因与回测: { metric, direction, samples, oldError, newError }
  reason    Json?
  createdAt DateTime  @default(now())
  decidedAt DateTime?
}
```

- 首次使用时若没有公式，自动写入 §4 的第 1 版（`active`）。
- 草稿预测每个项目只保留最近 5 条；定稿 / 录制后预测没有更新和删除的接口（项目被删时级联删除）。
- 同一项目同一类锁定预测可以有多条（如补做）；对账和展示取该类最新一条。

## 6. 流程

- **草稿预测**：脚本页「预测」按钮或编导工具 `predict_views`、命令 `mp predict run <项目>`。按钮与命令走后台任务（`Job` 新增 kind `predict_draft`）；编导工具在对话轮次内直接执行。同一项目预测串行（`withProjectLock`）。
- **定稿预测**：`finalizeScript` 从 draft 推进到 scripted 后启动 `predict_final` 任务；失败不影响定稿。
- **录制后预测**：转写任务成功后启动 `predict_recorded` 任务（输入为逐句转写）；失败不影响转写。
- **补做**：脚本页在"已定稿且没有 final 预测"或"已转写且没有 recorded 预测"时显示「补做定稿预测」/「补做录制后预测」。
- **发布后禁止**：项目已关联发布作品时，拒绝新的 final / recorded 预测（草稿预测也拒绝），提示"已经有数据了，这时再预测不算数"。
- **任务通知**：沿用转写的做法，任务结束在项目对话里写 `job:predict_*` 通知（成功：一句摘要，如"定稿预测：中枢约 3,200，最可能 1,450–5,800（55%）"；失败：原因）。

## 7. 界面与命令

- **脚本页预测面板**（最新一条预测，锁定的标"已锁定"）：5 项分数 + 理由 + 原句（点原句高亮对应段落）；分项判定；四档概率条与中枢；置信度（大白话，如"置信度低：才对过 2 次账，实际可能是预测的 1/3 到 3 倍"）；「拖后腿」列出分数最低且 ≤ 3 的至多 2 项及其 `fix`，每项旁「让编导按这个改」（把建议作为用户消息发进编导对话）。
- **首页项目列表**：已定稿未发布的项目卡片显示锁定预测（优先 recorded）的中枢与区间；列表可按预测中枢排序。
- **发布与复盘页**：显示两版锁定预测的区间与中枢、每日实际播放。
- **复盘「预测对账」**：逐项预测判定对实际判定（命中 / 偏乐观 / 偏悲观）；实际播放所在档位、是否等于预测概率最高档、实际 / 中枢；定稿版与录制后版分列。
- **落后提醒**：每晚回采后，对发布第 1 天播放 < 中枢 30%、第 2 天 < 中枢 50% 的作品，在项目对话写一条提醒（每个作品每天最多一次）；`mp status` 与每日简报显示"比预期落后：N 条"。
- **编导**：工具 `predict_views`；规则"用户问能不能火 / 测一下时调用；按拖后腿建议改完可以再测"。
- **命令行**：`mp predict run <项目>`（write，`hermes: false`）、`mp predict show <项目>`（read）、`mp predict list`（read，未发布项目按中枢降序）。总助手自动获得对应工具；`daily-kickoff` skill 加"有已定稿未发布的稿子时，建议先发预测最高的"。

## 8. 校准

- **对账**：`generateRetro` 生成 / 更新复盘时，为该项目最新的 final 与 recorded 预测各写 / 更新一条 `PredictionCheck`：`ratios[m] = 实际 / 预测`（有值才算），`viewRatio = 实际播放 / 中枢`，`verdicts[m]` 比较预测判定与实际判定（相同为 hit；预测更好为 optimistic，预测更差为 pessimistic），`bucketHit`。
- **有效样本**：每个已复盘项目取一条——有 recorded 用 recorded，否则 final。置信度的"已对账次数"即有效样本数。
- **偏差检测**（每次对账后）：对每个指标与播放量，按发布时间取最近 3 条有效样本；3 条都偏向同一方向且每条偏差超过 20%（`ratio > 1.2` 或 `< 1/1.2`；跳出率方向相反）即触发。
- **生成提议**：只调该指标的 `metricOffset`（或播放的 `viewOffset`）：新值使这 3 条的几何平均误差归零，单次变化幅度不超过 30%（offset 变化 ≤ 0.3；viewOffset 变化 ≤ log2(1.3)）。
- **回测**：用全部有效样本锁定时的分数、综合分与当时的基线（`result.metrics[].baseline`、`result.composite`、`result.benchmarkBonus`、`result.baselineViews`），分别按旧参数与新参数重算，比较该指标的平均绝对对数误差；新参数更小才写入 `proposed` 公式，否则不提议。同一时间最多一条 `proposed`；已有时新触发的并入下一次检测。
- **采纳**：复盘页「预测公式建议」卡片显示原因、新旧参数、回测误差（如"平均误差 2.1 倍 → 1.6 倍"）；「采纳」→ 新版本 `active`、旧版本 `retired`；「不要」→ `rejected`。已有预测不重算。

## 9. 出错处理

| 场景 | 行为 |
|---|---|
| 没有模型 / 模型出错 | 任务失败，通知写原因；定稿、转写不受影响；脚本页可补做 |
| 打分格式不对 | 重试一次；仍不对则失败"模型没按格式打分" |
| 公开作品少于 3 条 | 只给打分与拖后腿，不给数字 |
| 某指标无基线 | 该指标判定为"—"，不参与对账 |
| 已关联发布作品 | 拒绝新预测 |
| 同一项目预测正在跑 | 按钮不可点；命令返回"正在预测" |
| 没有稿子 | "还没有稿子，不能预测" |

## 10. 测试与验收

- 单元：分项换算（含跳出率方向）、判定、综合分与对标加成、中枢、四档概率（和为 100%，置信度分档）；无基线降级；打分 schema（恰好 5 项）；锁定预测无更新接口、发布后拒绝；草稿保留 5 条；对账计算（hit / optimistic / pessimistic、bucketHit）；偏差检测（3 条同向且超 20%）；提议幅度上限；回测只在更准时提议；采纳切换版本；落后提醒判定与每日一次；任务通知；定稿 / 转写失败隔离。
- 真机：用"U盘干到品类第一（验收）"做一次草稿预测，看面板、原句高亮、拖后腿与「让编导按这个改」；`mp predict list`；首页卡片。现有 5 条公开作品没有对应稿子，上线时对账样本为 0，预测均为"置信度低"。

## 11. 不做

训练统计模型；预测他人作品；投流建议；自动改稿；用户自己的猜测。

## 12. 真机实测（2026-09-30，实施后，当前模型 DeepSeek）

- 「U盘干到品类第一（验收）」草稿预测：5 项打分都引用了稿子原句，点原句高亮对应段落；公开作品 5 条 → 有中枢与四档，置信度低（0 次对账）。首页显示"预测 ~…"，可按预测排序。
- 脚本页「预测」→ 按钮变"预测中…" → 后台任务完成后面板自动刷新，编导对话收到通知（"草稿预测：中枢约 4,565，最可能 1,455–5,818（43%）；拖后腿：节奏与信息密度、互动引子"）。
- 编导对话"测一下这条能不能火，只测不用改" → 调用 predict_views，只汇报不改稿。
- `mp predict run/list` 正常；`MP_AGENT=hermes` 调用 predict run 被拒。
- 发现：同一稿子三次打分，中枢分别 7,163 / 4,565 / 4,565——模型打分有波动（约 1.6 倍），比置信度低时的 ±3 倍区间小，但会影响"先发哪条"的排序；交给最终审查评估。
- 现有 5 条公开作品没有对应稿子，上线时对账样本为 0；定稿 / 录制后自动锁定需在下一条新项目上验证。
