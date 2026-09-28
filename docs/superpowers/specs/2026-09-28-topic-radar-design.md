# 选题模块设计：对标雷达 + 编导「找选题」

- 日期：2026-09-28
- 状态：待用户审阅
- 路线图位置：`2026-09-28-film-production-design.md` §10 第 3 项
- 前置：阶段 0～5 已完成（项目 + 编导、口播转写、Remotion 出片、首页/定位/设置）

## 1. 为什么做、做成什么样

用户（AI 知识类抖音博主）的好选题**主要来自对标博主的爆款**，但目前**没有固定看对标的习惯**；有几个对标账号，希望工具帮忙发现更多。看中一条爆款后想借的是：**选题本身、开头钩子、标题文案**（不借整体结构）。

旧版（v1-final）做过"关键词全网搜新闻 → AI 打热度分"的雷达：272 条只采纳 5 条，609 个 AI 候选词无人审批；灵感视频库 0 条。**本设计不沿用那条路**。

成功标准：每天打开首页就能看到"对标里跑出来的爆款"，点一下就有逐字稿与拆解，再点一下就进项目让编导按用户的角度重写。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 方案 | A：定时巡检对标账号 + 爆款自动拆解 + 一键建项目；粘链接作为兜底入口 |
| 抓取身份 | ego lite 默认配置「少年哥」里的**大号**，**只读低频**（用户 2026-09-28 明确授权） |
| 爆款判定 | 点赞 ≥ 该账号"平时水平"× 3，且 ≥ 1000，且发布 ≤ 30 天 |
| 平时水平 | 该账号近 90 天作品点赞中位数（播放量拿不到，见 §3） |
| 自动拆解 | 巡检当晚对爆款自动拆解，每晚 ≤ 5 条；其余作品手动点「拆解」 |
| 借什么 | 选题、开头钩子、标题/文案写法；不借整体结构 |
| 编导找选题 | 选题页按钮 + 空项目对话里触发；只基于已有对标数据、定位、自己的作品数据 |

## 3. 可行性验证（2026-09-28，用大号只读，共访问 4 个页面）

| 项 | 结果 |
|---|---|
| 搜博主 | `douyin.com/search/<词>?type=user` 页面可读出名字、抖音号、获赞、粉丝、简介、主页链接；页面文字粘连（"…10537**07.8万获赞**"），实现时改读搜索接口的 JSON |
| 作品列表 | 在博主主页内 `page.fetch('/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=…&max_cursor=0&count=18')`，**不需要签名**，返回 `aweme_list`（18 条）、`has_more`、`max_cursor` |
| 每条数据 | `aweme_id`、`create_time`、`desc`、`duration`(ms)、`statistics.{digg,comment,collect,share}_count`；`play_count` 对他人作品**恒为 0** |
| 视频下载 | `video.play_addr.url_list[0]`（douyinvod.com）用 `page.fetch(url, { saveAs })` 下载成功，73 秒 1080p 约 12MB |
| 转写 | 本机 faster-whisper small，73 秒视频 20 秒转完；人名有同音错字（余秀华→于秀华），用视频文案校对 |

实现前仍需验证（计划第一个任务）：分享短链 `v.douyin.com/xxx` → `aweme_id` 的解析；单条作品详情接口 `/aweme/v1/web/aweme/detail/?aweme_id=`（粘链接入口用）；用户搜索接口的 JSON 形状。

## 4. 数据（新增 2 张表 + Project 1 个字段）

```prisma
/// 对标账号
model BenchmarkAccount {
  id           String    @id @default(cuid())
  secUid       String    @unique
  nickname     String
  douyinId     String    @default("")
  avatarUrl    String    @default("")
  bio          String    @default("") @db.Text
  followers    Int       @default(0)
  totalLikes   Int       @default(0)
  /// following | candidate | ignored
  status       String    @default("candidate")
  /// manual(粘主页链接) | search(关键词搜到) | link(粘作品链接时顺带)
  source       String    @default("manual")
  searchKeyword String?
  /// 近 90 天作品点赞中位数; 作品不足 3 条时为 null(不判爆款)
  baselineDigg Int?
  lastCheckedAt DateTime?
  createdAt    DateTime  @default(now())
  videos       BenchmarkVideo[]
}

/// 对标作品
model BenchmarkVideo {
  id            String    @id @default(cuid())
  awemeId       String    @unique
  accountId     String
  account       BenchmarkAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  desc          String    @db.Text
  url           String
  publishedAt   DateTime
  durationSec   Int
  digg          Int
  comment       Int
  collect       Int
  share         Int
  /// digg / baselineDigg, 保留一位小数; 无基线时 null
  ratio         Float?
  isHit         Boolean   @default(false)
  /// 首次被判为爆款的时间(首页"今天 N 条爆款"用); 之后跌出爆款也不清空
  hitAt         DateTime?
  /// new | seen | ignored | adopted
  status        String    @default("new")
  /// none | running | done | failed
  analysisStatus String   @default("none")
  analysisError String?
  transcript    String?   @db.Text
  /// Analysis(见 §6.2)
  analysis      Json?
  analyzedAt    DateTime?
  fetchedAt     DateTime  @default(now())
  projects      Project[]
  @@index([isHit, publishedAt])
}
```

`Project` 增加 `benchmarkVideoId String?`（关联参考的对标作品，`onDelete: SetNull`）。

拆解不进 `Job` 表（`Job.projectId` 必填，拆解发生在建项目之前）；进度与失败原因直接记在 `BenchmarkVideo.analysisStatus/analysisError`。

## 5. 抓取层（`src/lib/benchmark/douyin.ts`）

所有抖音访问集中在一个模块，通过 `ego-browser nodejs` 在任务空间「对标雷达」中执行，**只含读取调用**：

| 函数 | 做什么 |
|---|---|
| `fetchAccountWorks(secUid)` | 打开主页，`page.fetch` 作品列表第一页，返回账号资料 + 作品 |
| `fetchVideoDetail(awemeId)` | 单条作品详情（粘链接用） |
| `downloadVideo(awemeId, destPath)` | 取 `play_addr` 逐个地址尝试下载 |
| `searchUsers(keyword)` | 搜博主，返回候选列表 |
| `resolveShareLink(text)` | 从分享文本/短链解析 `aweme_id` 或 `sec_uid`（不需要浏览器，HTTP 跟随跳转） |

解析接口 JSON 的函数是纯函数（`parseWorks`、`parseUserSearch`），用验证时保存的真实返回裁剪成测试夹具。

**风控护栏（写死）：**
- 模块内没有任何写操作（点赞、关注、评论、私信）。
- 巡检每晚 ≤ 15 个账号，每账号只读第一页，账号间随机间隔 5～10 秒。
- 搜博主每天 ≤ 10 次，单次一个词。
- 连续 3 个账号请求被拒（非 200、`status_code ≠ 0`、或返回空列表且 `has_more` 异常）→ 当晚立即停止并在日志写明"疑似触发风控，已停止"。

## 6. 巡检与拆解

### 6.1 每晚巡检（`scripts/scan-benchmarks.ts` + launchd 20:30）

沿用 `collect-douyin` 的模式（独立脚本直接写库，不依赖 web 进程；日志 `logs/scan-benchmarks.log`，格式 `[ISO] 消息`，以「开始巡检」「巡检完成」为运行边界）：

1. 取 `status = following` 的账号（按 `lastCheckedAt` 升序，最多 15 个）。
2. 逐个 `fetchAccountWorks`，upsert 账号资料与作品（数据以最新为准）。
3. 重算 `baselineDigg`（该账号库内近 90 天作品点赞中位数，≥ 3 条才算），更新每条作品的 `ratio` 与 `isHit`。
4. 对当晚新判定为爆款、且 `analysisStatus = none` 的作品，按 ratio 降序取前 5 条自动拆解。
5. 写「巡检完成: 账号 N 个 / 新作品 M 条 / 爆款 K 条 / 拆解 J 条」。

首页与设置页体检复用阶段 5 的日志解析（`parseCollectLog` 泛化为按起止标记解析）。

### 6.2 拆解（`src/lib/benchmark/analyze.ts`）

一条作品的拆解：下载视频 → 本地转写（复用 `src/lib/llm/local_whisper.py`）→ **删除视频文件**（成功失败都删）→ DeepSeek 以作品文案校对转写错字 → DeepSeek 结构化拆解（zod 校验，失败自修一次）：

```ts
type Analysis = {
  topic: string;          // 一句话选题
  hook: { quote: string; type: string };   // 前 3 秒原话 + 写法类型(反常识/提问/数字/冲突/…)
  titlePattern: string;   // 标题/文案写法
  fit: 'high' | 'mid' | 'low';
  fitReason: string;      // 对上了定位里哪个支柱/痛点, 或为什么不合适
  myAngle: string;        // 用户可以怎么讲(不得编造用户经历)
};
```

触发方式：巡检自动（§6.1）、选题页「拆解」按钮、粘链接。web 进程内单并发队列（一次一条，后续排队）；失败写 `analysisError`（原因 + 怎么办），界面给「重试」，不自动重试。

## 7. 界面

### 7.1 侧栏「选题」（`/topics`，在「项目」下）

- **顶部**：「让编导挑 3 个」按钮；粘链接输入框。
- **对标爆款列表**（默认"只看爆款"，可切"全部新作品"）：卡片 = 博主名 · 发布日期 · 点赞与"平时的 N 倍" · 文案 · 拆解出的选题/钩子原话/契合度。操作：看拆解（展开逐字稿与完整拆解）、建项目、忽略、原视频；未拆解的显示「拆解」，拆解中显示进度，失败显示原因与「重试」。打开卡片即标记为已看。
- **对标账号**（可折叠）：关注中账号（头像、名字、粉丝、平时水平、最近爆款、上次巡检）+ 取消关注；添加：粘主页链接，或按关键词搜 → 候选列表（粉丝、总获赞、简介；不逐个再请求近期作品，保护账号）→「关注」。

### 7.2 首页

账号数据卡下一行："今天对标里有 N 条爆款 →"（`hitAt` 在近 24 小时内的爆款数；0 条时显示"今天对标没有新爆款"）。巡检失败/过期时与回采同样告警。

### 7.3 建项目

从对标作品建项目：标题 = 拆解的 `topic`（未拆解则用文案前 30 字），`benchmarkVideoId` 关联，作品状态改为 `adopted`，跳到项目页。编导上下文新增「【参考的对标作品】」块：博主、点赞倍数、逐字稿、拆解；并加硬规则：

> 参考对标只借三样：选题、开头钩子的写法、标题思路。不得照抄原句（连续 12 字以上与原稿相同视为照抄）；用用户的角度讲；不得替用户编造经历，需要经历处用「【待补：你的真实经历】」占位。

## 8. 编导「找选题」（`src/lib/benchmark/suggest.ts` + 工具 `suggest_topics`）

- 入口：选题页「让编导挑 3 个」；项目处于 `draft` 且没有稿子时，用户在对话里要选题，编导调用工具 `suggest_topics`。
- 输入：近 14 天未忽略的爆款（含拆解）、人设档案（受众/支柱/痛点/忌讳）、用户自己点赞最高的 5 条公开作品标题。
- 输出 3 个：`{ topic, why, sourceVideoIds: string[], hook }`，`sourceVideoIds` 必须来自输入（程序校验，不在输入里的整条丢弃）。每个选题可「建项目」（关联第一条来源作品）。
- 数据不足（近 14 天爆款 < 2 条）时不调用模型，直接说明"对标数据太少，建议先多关注几个账号"。
- 不编造"最近很火的 XX"这类没有来源的热点。

## 9. 出错处理

| 场景 | 行为 |
|---|---|
| ego lite 没运行 / 登录过期 | 巡检记失败原因；首页告警，补救：打开 ego lite 重新登录 |
| 单个账号失败 | 记日志，继续下一个 |
| 连续 3 个账号被拒 | 当晚停止，日志与告警写明"疑似触发风控" |
| 下载/转写/DeepSeek 失败 | 该作品 `analysisStatus = failed` + 原因，给「重试」 |
| 链接解析失败 | "这不是抖音视频/主页链接" 或 "视频已删除或不可见" |
| 视频文件 | 拆解结束（成功或失败）立即删除，只留文字 |

## 10. 测试与验收

- 单元测试（纯函数 + 假数据）：作品列表/搜索 JSON 解析、平时水平与爆款判定、分享链接解析、巡检日志解析、拆解结果 schema、`suggest_topics` 来源校验、限流计数。
- 流程测试（ego、whisper、DeepSeek 可注入替身）：巡检单账号失败继续、连续被拒停止、拆解失败可重试且视频文件被删、建项目后编导上下文含参考块。
- 真机验收：关注 3 个真实对标跑一次巡检；手动拆一条；建项目并确认编导上下文；「让编导挑 3 个」；粘一条分享链接走完整流程。

## 11. 不做

小红书/B 站等其他平台；评论区分析；对标账号趋势图；定时自动发现新对标（只在手动搜索时发现）；借整体结构；封面图分析；播放量（拿不到）。
