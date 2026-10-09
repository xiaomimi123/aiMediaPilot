# 每日选题与初稿设计（每晚自动出 3 个选题，各配一篇口播初稿）

- 日期：2026-10-09
- 状态：待用户审阅
- 前置：对标巡检（每晚 20:30，带补跑）、编导写稿（`src/lib/script/write.ts`）、照抄检查（`src/lib/benchmark/copy-check.ts`）、流量预测（`src/lib/predict/*`）、写法经验（`src/lib/retro/lessons.ts`）

## 1. 目标

每天早上打开系统，「今天」里已经有 3 个选题，每个配好一篇能直接磨的口播初稿和预测播放。挑一个点「就做这个」就变成作品接着磨稿、去录；没挑的不进作品列表，3 天后自动收起。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 每天产出 | 3 个选题，每个一篇整稿初稿 + 预测播放区间 |
| 选题来源 | 对标爆款、自己作品的续集、点子池（用户随手丢的点子）；不用 Obsidian |
| 方案 | A：每晚生成「今日选题」，挑中了才建成作品；不直接建作品、不在打开时现场生成 |
| 写稿 | 现有编导写稿（当前模型、账号定位、已采纳的写法经验），目标时长 60 秒 |
| 时间 | 每晚 23:00（在回采 20:00–22:00、巡检 20:30–22:30 之后），失败 0:00、1:00 补跑 |

## 3. 每晚生成

### 3.1 挑候选（每个来源最多出 1 个，凑满 3 个）

| 来源 | 候选 | 排序 |
|---|---|---|
| 对标 `benchmark` | 近 14 天的对标爆款（`isHit`、未忽略），且没被用过（没出过选题、没被建成作品） | 倍数（`ratio`）从高到低 |
| 续集 `sequel` | 已关联发布作品的项目：片尾一段（定稿或转写的最后一段）含「下期 / 下一期 / 单独讲 / 下次 / 后面再说 / 留着」等钩子词的；或播放 ≥ 近 10 条公开作品播放中位数 2 倍的。没出过续集选题的 | 有钩子的优先，其次按播放 |
| 点子 `idea` | 点子池里状态为「没用过」的 | 先写的先用 |

- 先每个来源各取 1 个；某个来源没料，从其余来源顺位补（同一来源可以出第 2、第 3 个），总数最多 3。
- 三个来源都没料：当晚不生成，记录原因「加几个对标账号，或在点子池里写几句」。
- 不重复：出过的候选（任何状态）不再进候选；用户点过「不要」的同样不再出。

### 3.2 定选题 + 写稿 + 预测（每个候选依次做，一个失败不影响其他）

1. **定选题**：调当前模型，按候选（对标的拆解/文案、续集的原稿与片尾钩子、点子原话）+ 账号定位，产出 `title`（选题标题）、`why`（为什么值得做，一句）、`hook`（开头钩子，一句）、`direction`（给写稿的方向说明：讲什么、什么角度、用什么例子）。只基于输入，不编热点、不编数字。
2. **写稿**：`writeScript({ direction, targetSec: 60, personaText, lessons, reference })`。对标来源传对标作品作 `reference`，写完跑 `findCopiedInScript`，有照抄片段时记在选题上（展示时提醒）。
3. **预测**：对这篇稿子打分（复用现有打分：3 次取中位数）并算出预测（复用 `computePrediction`）；记下 `scores`、`inputHash`、预测中枢与区间。预测失败只把预测记为空，选题照出。

### 3.3 当晚记录

每晚一条「生成记录」：生成了几个、跳过了几个和原因（模型不可用、某篇写稿失败、来源没料）。同一天已有成功记录（生成数 ≥ 1）时，补跑直接跳过。

## 4. 页面

### 4.1 总览「今天」

- 新增「今日选题」一块：最多 3 张小卡，每张：标题、来源标签（对标 / 续集 / 点子）、`why`、预测播放（如「预测 ~4,500」，没算出来写「预测没算出来」）。按预测中枢从高到低。点卡片去「选题」页对应位置。
- 当晚没生成：显示原因一句话（来自生成记录）。

### 4.2 「选题」页顶部

- 「今日选题」：同样的卡片，展开看整篇初稿（6 段）、开头钩子、来源（对标作品 / 续集原作品 / 点子原话）、照抄提醒（如有）。
- 每张两个按钮：
  - 「就做这个」：建成作品（标题、脚本 = 初稿、目标 60 秒；对标来源带上 `benchmarkVideoId`），把这次的打分存成该作品的一次「稿子预测」（同一 `inputHash`，不再花钱重打），跳到作品工作区的「脚本」一步。选题标为「已采用」。
  - 「不要」：标为「不要」，收起。
- 「点子池」：一个输入框（回车保存），下面列出点子与状态（没用过 / 已出选题 / 已删）。点子可以删除（软删除，标为已删）。
- 3 天前生成、还没处理的选题自动收起（标为「过期」），不再显示。

## 5. 数据

```prisma
/// 点子池: 用户随手写的选题点子
model TopicIdea {
  id        String   @id @default(cuid())
  text      String   @db.Text
  /// fresh(没用过) | used(已出选题) | deleted
  status    String   @default("fresh")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

/// 每晚生成的选题(带初稿与预测)
model DailyTopic {
  id          String   @id @default(cuid())
  /// 生成那天(本机时区 YYYY-MM-DD)
  day         String
  /// benchmark | sequel | idea
  source      String
  /// 来源的 id: BenchmarkVideo.id / Project.id / TopicIdea.id
  sourceId    String
  title       String
  why         String   @db.Text
  hook        String   @db.Text
  direction   String   @db.Text
  /// Script(6 段), 形状见 src/lib/script/model.ts
  script      Json
  /// 照抄片段(对标来源), 没有为 []
  copied      Json     @default("[]")
  /// 预测: { scores, inputHash, formulaVersion, result } | null
  prediction  Json?
  /// new | adopted | dismissed | expired
  status      String   @default("new")
  projectId   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([day])
  @@index([status])
  @@unique([source, sourceId])
}

/// 每晚生成记录(给「今天」显示原因、给补跑判断是否已生成)
model DailyTopicRun {
  id        String   @id @default(cuid())
  day       String
  created   Int
  /// [{ source?, reason }]
  skipped   Json     @default("[]")
  createdAt DateTime @default(now())

  @@index([day])
}
```

- `@@unique([source, sourceId])` 保证同一候选永不重复出。
- 「就做这个」写入的稿子预测：用现有 `Prediction` 表，`kind = 'draft'`，`inputHash`、`scores`、`formulaVersion`、`result` 取自 `DailyTopic.prediction`。

## 6. 定时任务

- 新脚本 `scripts/daily-topics.ts`（`npm run topics:daily`）：带 `--scheduled` 时先看今天是否已有成功的生成记录，有就跳过。
- 每晚任务卡片新增「每日选题」：开关定时、改时间、「立即运行」（每天手动最多 3 次）、失败补跑（+1、+2 小时），沿用 `NIGHTLY_TASKS` 的做法；默认 23:00。
- 日志 `logs/daily-topics.log`，格式沿用每晚任务（「开始生成」/「生成完成」），失败时「今天」与体检照常提示。

## 7. 出错处理

| 情况 | 处理 |
|---|---|
| 没有可用模型 / 额度用完 / 连不上 | 当晚不生成，记录原因；补跑时间再试；「今天」显示原因 |
| 某篇定选题或写稿失败 | 跳过这一个候选（不标为已用，下次还能出），记原因；其他照出 |
| 预测失败 | 选题照出，`prediction = null`，页面写「预测没算出来」 |
| 三个来源都没料 | 不生成，记原因「加几个对标账号，或在点子池里写几句」 |
| 「就做这个」时选题已采用/已收起 | 不重复建作品，提示已处理 |
| 数据库没开 | 脚本失败退出、写日志，按每晚任务的规则提示 |

## 8. 测试与验收

- 单元：挑候选（各来源排序、某来源没料时补位、都没料、已用/不要的不再出、续集钩子词判断与播放倍数判断）；定选题与写稿的编排（某篇失败不影响其他、预测失败照出）；同一天已成功则补跑跳过；「就做这个」建作品并写入稿子预测（不重打）、重复点击不重复建；「不要」；3 天过期；点子池增删与状态；「今天」与「选题」页的卡片、排序、空状态与原因显示；每晚任务卡片多出「每日选题」。
- 真机（会用模型额度，一晚的量）：手动「立即运行」一次，看到 3 个选题与初稿、预测；点子池写一句后再跑一次（换天或清当天记录）能出点子来源；「就做这个」后作品脚本即初稿、预测已在；「不要」后不再出现。

## 9. 不做

微信推送（Hermes 未开通）；Obsidian 灵感笔记作来源；评论内容分析（只有评论数，没有评论文本）；联网热点；一天生成超过 3 个；自动出片。
