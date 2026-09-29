# 发布与复盘模块设计

- 日期：2026-09-29
- 状态：待用户审阅
- 路线图位置：`2026-09-28-film-production-design.md` §10 第 4 项
- 前置：阶段 0～5、选题模块、设置页每晚任务已完成

## 1. 为什么做、做成什么样

用户（AI 知识类抖音博主）要的复盘同时有四个目的：知道一条**为什么火/不火**；让**编导下次写得更好**；**追踪数据曲线**（发布后几天的走势）；**和对标比**。发布由用户自己在抖音发，工具负责准备发布文案。

成功标准：发完一条，第 3 天打开项目就能看到一份分段诊断——哪一段掉人、掉在哪句话、比平时好还是差；编导据此提出写法经验，用户采纳后，下一条稿子编导会照着写。

现状缺口：
- 作品表只存最新值，没有发布后的变化过程；
- `PublishedWork.projectId` 字段已在，但没有登记入口，一条都没关联；
- 用户最近一条公开作品是 2026-05-08，需要发新视频后才有真实数据验证。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 方案 | A：自动快照 + 分段诊断 + 写法经验经用户确认后回流编导 |
| 发布 | 用户自己发；工具生成候选标题 / 话题标签 / 封面文字 |
| 作品对项目 | 自动匹配给出候选，用户点确认才关联；也可贴分享链接手动关联；绝不自动关联 |
| 复盘时机 | 发布后第 3 天自动生成、第 7 天自动更新（每晚回采后）；项目页可手动「现在复盘」 |
| 分段诊断 | 固定规则计算，不交给模型；模型只做解读，只能引用诊断里的数 |
| 写法经验 | 用户「采纳 / 改后采纳 / 不要」；生效的最多 10 条进编导；可停用 |
| 数据范围 | 公开作品；发布 30 天内每日快照，之后只保留最新值 |

## 3. 数据来源（2026-09-29 只读探查）

创作者中心「作品管理」页用的接口：

`GET https://creator.douyin.com/janus/douyin/creator/pc/work_list?status=0&count=12&max_cursor=0&scene=star_atlas&device_platform=android&aid=1128`

- 在已登录的 creator.douyin.com 页面里 `page.fetch` 即可，**不需要签名参数**。
- 返回 `aweme_list`（与既有作品列表同形）、`items`（带指标）、`has_more`、`max_cursor`、`total`。
- `items[i].metrics`（字符串数值）：`view_count`、`like_count`、`comment_count`、`share_count`、`favorite_count`、`subscribe_count`、`homepage_visit_count`、`completion_rate`、`completion_rate_5s`、`bounce_rate_2s`、`avg_view_second`、`avg_view_proportion`、`fan_view_proportion`、`like_rate`、`comment_rate`、`share_rate`、`favorite_rate`、`subscribe_rate`、`dislike_rate` 等；另有 `metrics_offline_update_time`（指标更新时间，Unix 秒）。
- 老作品（2025-08）也有完整指标，覆盖范围比「近 90 天投稿分析」大。
- **坑**：`items[i].id` 是数字，超出 JS 精度会被改写（实测 `7537605160290684000`）。必须按下标与同页 `aweme_list[i]` 配对取 `aweme_id`，并用 `create_time` 核对；不一致的跳过并记日志。
- 没找到流量来源、逐秒留存曲线的接口，本期不做。

示例（2025-08-12 那条，43 秒）：2 秒跳出 26.6%，5 秒完播 50.2%，平均观看 10.4 秒（24%），完播 9.4%。

## 4. 数据模型

`PublishedWork` 增加最新指标字段（均可空，旧数据为空）：`viewCount`、`likeCount`、`commentCount`、`shareCount`、`favoriteCount`、`subscribeCount`、`homepageVisitCount`、`completionRate`、`completionRate5s`、`bounceRate2s`、`avgViewSec`、`avgViewProportion`、`fanViewProportion`、`metricsUpdatedAt`。

新增：

```prisma
/// 作品每日指标快照(发布 30 天内的公开作品, 每晚一份)
model WorkMetricSnapshot {
  id                String   @id @default(cuid())
  workId            String
  work              PublishedWork @relation(fields: [workId], references: [id], onDelete: Cascade)
  /// 本地日期 YYYY-MM-DD(Asia/Shanghai)
  day               String
  viewCount         Int
  likeCount         Int
  commentCount      Int
  shareCount        Int
  favoriteCount     Int
  subscribeCount    Int
  completionRate    Float?
  completionRate5s  Float?
  bounceRate2s      Float?
  avgViewSec        Float?
  avgViewProportion Float?
  metricsUpdatedAt  DateTime?
  takenAt           DateTime @default(now())
  @@unique([workId, day])
}

/// 复盘报告(一个项目一份, 第 3 天生成、第 7 天更新)
model Retro {
  id          String   @id @default(cuid())
  projectId   String   @unique
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  workId      String
  /// 发布后第几天生成的(3 / 7 / 手动时为实际天数)
  dayN        Int
  /// Diagnosis(见 §6.2), 规则算出
  diagnosis   Json
  /// 编导解读; 生成失败为 null
  narrative   String?  @db.Text
  narrativeError String?
  dataAsOf    DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

/// 写法经验(编导的经验本)
model WritingLesson {
  id         String   @id @default(cuid())
  text       String
  /// topic | hook | opening | middle | ending | interaction | title
  stage      String
  /// [{ projectId, workId, metric, value, baseline }]
  evidence   Json     @default("[]")
  /// candidate | active | retired | rejected
  status     String   @default("candidate")
  /// 这条经验来自哪次复盘
  retroId    String?
  createdAt  DateTime @default(now())
  confirmedAt DateTime?
}
```

`Project` 增加：`publishKit Json?`（生成的发布文案）；作品与项目的关联沿用已有的 `PublishedWork.projectId`（不给 Project 加列）；`stage` 增加 `published`（在 `final` 之后，只前进）。
`PublishedWork` 增加 `matchDismissed Boolean @default(false)`（用户点过"不是"的候选不再提示）。

## 5. 回采与关联

### 5.1 每晚回采（`scripts/collect-douyin.ts` 增加一步，独立失败）

1. 在 creator.douyin.com 页面里翻 `work_list`（每页 12 条，页间 1 秒，直到 `has_more` 为假或翻满 15 页），配对 id，得到每条作品的指标。
2. 按 `aweme_id` 更新 `PublishedWork` 的最新指标字段。
3. 对"公开且发布 ≤ 30 天"的作品写当天快照（同一天重复跑覆盖）。
4. 日志：`作品指标: N 条(快照 M 条, 跳过 K 条)`。失败只记日志，不影响前面的回采。

### 5.2 作品对项目

- 自动候选：回采后，对每个 `stage = final` 且未关联作品的项目，在"成片登记之后发布、公开、未关联、未被驳回"的作品里打分：发布时间越接近成片登记越高；作品文案与 `publishKit` 标题/话题的字重合度越高越高。得分过线的第一名作为候选。
- 项目页顶部显示候选：「这条是你发的吗？」+ 作品文案/发布时间 +「确认」「不是」。确认 → 写 `PublishedWork.projectId`、项目阶段 → `published`、对话里写 `job:publish` 系统通知。「不是」→ `matchDismissed = true`。
- 手动：项目页贴分享链接（复用 `resolveLink`），库里有这条作品就直接关联；没有则提示"等今晚回采后再关联"。

### 5.3 发布准备

「④ 发布与复盘」标签里「生成发布文案」：DeepSeek 读定稿、人设、参考对标的标题写法（有则），输出 `{ titles: string[3], hashtags: string[], coverText: string[1..2] }`，存 `Project.publishKit`，每项带复制按钮；可重新生成。

## 6. 复盘

### 6.1 触发

- 每晚回采后：已关联作品且发布满 3 天、还没有复盘的 → 生成；满 7 天且复盘是第 3 天版的 → 更新。
- 手动「现在复盘」：随时生成/覆盖。
- 指标更新时间早于发布时间（还没出数）→ 不生成，界面显示"数据还没出来"，下一晚再试。

### 6.2 分段诊断（纯函数 `diagnose`）

平时基准 = 用户最近 10 条公开作品（不含本条、有指标的）各指标中位数；不足 3 条 → 不比较，只列数值并说明"历史作品太少"。

| 阶段 | 指标 | 说明 |
|---|---|---|
| 开头 2 秒 | `bounceRate2s`（越低越好） | 封面和第一句 |
| 前 5 秒 | `completionRate5s` | 开头钩子 |
| 中段 | `avgViewSec` 对到当前转写 | "平均在第 X 秒离开，这时在讲「段名」：『句子』"；无转写时只给秒数 |
| 收尾 | `completionRate` | 看完的比例 |
| 互动 | `likeRate`、`favoriteRate`、`shareRate`、`subscribeRate` | 由计数 / 播放算 |

每项与基准比：好 20% 以上为「好」，差 20% 以上为「差」，其余「持平」（跳出率方向相反）。

对标对比（项目有 `benchmarkVideoId` 时）：对标点赞 ÷ 对标平时水平 vs 本条点赞 ÷ 用户平时点赞中位数，只比倍数。

数据曲线：该作品的每日快照（播放、点赞），第 1～7 天。

### 6.3 编导解读（DeepSeek，可失败）

输入：诊断结果、定稿、转写、对标拆解（有则）、生效的写法经验。输出 `{ summary: string, lessons: [{ text, stage, evidenceMetric }] (0..3) }`。
规矩：只引用诊断里的数；不编原因（没把握写"数据看不出原因"）；经验必须是能直接照做的一句话；已有生效经验被本次数据否定时，在 summary 里点名。
失败 → 诊断照常显示，解读区显示"没写出来，点重试"。

### 6.4 写法经验

- 复盘里的候选 → 用户「采纳」「改后采纳」「不要」。采纳时 evidence 记下本次作品、指标、数值、基准。
- 生效经验进编导：`formatSystemPrompt` 与 `writeScript` 首条消息增加「【写法经验】（来自你自己的复盘）」，最多取最近确认的 10 条，每条附"证据：N 条作品"；只有 1 条证据的标"证据少"。
- 复盘解读点名否定某条经验时，经验卡上显示"最近一次复盘没应验，要不要停用？"，停不停由用户决定。

## 7. 界面

- **项目页「④ 发布与复盘」标签**：发布文案（生成/复制）→ 关联作品（候选确认 / 贴链接）→ 复盘报告（数据卡 + 曲线 + 分段诊断 + 对标对比 + 编导解读 + 经验候选）。
- **侧栏「复盘」（`/retro`）**：已发布作品列表（复盘状态、关键指标 vs 平时）；写法库（全部经验，可编辑、停用、看证据）。
- **首页**：有待确认的作品关联或新复盘时一行提示。

## 8. 出错处理

| 场景 | 行为 |
|---|---|
| `work_list` 读取失败 | 日志记录，原回采照常完成 |
| id 配对失败 | 跳过该条并记日志，不拿错的数凑 |
| 指标还没出来 | 复盘推迟到下一晚，界面说明 |
| DeepSeek 失败（发布文案 / 解读） | 给原因 + 重试；诊断不受影响 |
| 贴的链接库里没有 | "等今晚回采后再关联" |

## 9. 测试与验收

- 纯函数（真实返回裁剪的夹具）：`work_list` 解析与 id 配对、快照保留规则、平时基准、分段诊断（含平均观看秒数对到转写句）、作品-项目匹配打分。
- 流程：复盘生成与第 7 天更新、经验采纳后编导上下文含该条、DeepSeek 失败时诊断照常。
- 真机验收：回采写入指标与快照；用老作品"当我把龙虾装到u盘"手动关联 U 盘验收项目做一次复盘（成片不是当时发的版本，只验证流程）；发新视频后做一次真实复盘。

## 10. 不做

流量来源；逐秒留存曲线；自动发布；评论区分析；多平台；经验自动生效。

## 11. 真机实测（2026-09-29，实施后）

- 回采新步骤：101 条作品指标全部写入，跳过 0 条（id 配对 + create_time 核对无误）；2025-08-12 那条完播 9.37%、5 秒完播 50.2%、平均观看 10.4 秒，与作品管理页一致。30 天内无公开作品，快照 0 条。
- 发布文案：DeepSeek 约 20 秒给出 3 标题 / 6 标签 / 2 行封面字。
- 流程验收：把 3 月老作品"当我把龙虾装到u盘"关联到 U 盘验收项目并复盘（成片与转写不是当时发的版本，只验证流程）：8 项分段诊断与平时比、中段对到「概念A」具体句；编导解读只引用诊断数字，收藏率偏低写"数据看不出原因"；给出 3 条经验候选（均标"证据少"）。采纳 1 条后，另一个项目的编导系统提示里出现【写法经验】。
- 真实复盘待用户发布新视频后验证。

