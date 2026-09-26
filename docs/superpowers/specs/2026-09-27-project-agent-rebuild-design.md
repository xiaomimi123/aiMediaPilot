# 重构设计：以「项目 + 编导 agent」为中心的口播出片工作台

- 日期：2026-09-27
- 状态：待用户审阅
- 对标：CreatorOS（用户提供的演示视频，2026-09-19 录）

## 1. 为什么重构

2026-09-26 的审查与真机走查结论：

- 抖音作品数从 08-28 起一直是 101 条，**一个月零发布**；历史 3 条 master 成片无一发出。
- 同期代码长到 42k 行、45 个数据模型、侧栏 13 项、38 份 spec + 44 份 plan。
- 走查「规划 → 生成今日稿 → 写稿 → 成片」发现：
  - AI 生成的稿子 127.6 秒 / 目标 60 秒，被自家评分判 0/10，再甩 7 条待办给人修；
  - 首页称"发布 0 条"，回采里明明有 101 条作品；同一题目一处"出片失败"一处"已完成"；
  - 内部术语（`ppt-narration`、"死画面 84%"）和 zod 报错原文直接露给用户；
  - master 抽帧是白底 + 蓝条 + 左右越界的字幕，体检却报"画面正常"。
- 启动要 Postgres + Redis + web + worker + ego lite + Studio，任何一个没起来就静默失效（2026-09-25 起库停了两天没人知道）。

用户判断：没用起来是因为"做出来无法很好地使用，前端有很大问题"。走查说明很多前端问题是底层"生成不合格就推给人"和"状态互相矛盾"的表象，只换皮解决不了，因此整体重构。

## 2. 目标与成功标准

**第一个月的成功 =** 每天打开一个项目，和编导 agent 对话把稿子磨好 → 自己录口播 → 在项目里上传 → agent 配特效 → 直接拿到能发的成片。全程不离开这个工具（剪映合成这一步也省掉）。

硬指标：用用户真实录的一条口播，端到端走完并得到可直接发布的 mp4。

**不做（本次范围外）：** 单独的选题模块（题目在项目对话里定）、热点雷达、30 天规划、评分/校准、钩子库、拆解、素材库、小红书/公众号、图文口播全自动链、多用户、外部 agent 的 CLI 外壳（工具层为它预留，但不实现）。

## 3. 已确认的决策

| 问题 | 用户选择 |
|---|---|
| 第一个月要做到什么 | B：项目 + 对话式编导 + 项目内直接出片 |
| 主要出片形式 | 真人口播 + 特效（Overlay Studio 链） |
| agent 由谁驱动 | 内置 agent 调模型 API；工具层按日后可开放给外部 agent 的方式设计 |
| 重构方式 | 原地大清理（按保留清单删除，不开新仓库） |
| 选题 | 不单独做，在项目对话里定 |
| 项目页布局 | 左稿右聊（草图 A） |
| 特效怎么调 | 全自动 + 对话改；Studio 手调作为逃生口 |

## 4. 清理：保留清单

原则：**只列保留项，清单外全部删除**；每删一批跑 `typecheck` + `test`，全绿才删下一批。删除前打 `v1-final` tag，任何代码都可从 git 找回。

保留并接入新链：

| 保留 | 位置 | 新用途 |
|---|---|---|
| DeepSeek 客户端 | `src/lib/llm/deepseek.ts`、`clients.ts`、`resolve-key.ts` | 驱动编导 agent |
| 本地 Whisper 转写 | `src/lib/llm/local-whisper.ts`、`local_whisper.py` | 口播 → 带时间戳文本 |
| 字级对齐 | `scripts/align/` | 转写时间戳精修 |
| Overlay Studio 集成层 | `src/lib/overlay-studio/`、`src/lib/llm/prompts/overlay-arrange.ts` | 特效编排 + 体检 |
| ffmpeg 工具 | `src/lib/video/ffmpeg.ts`（其余按需） | 探测时长、合成 |
| 人设定位 | `PersonaProfile`（字段精简） | agent 常驻上下文 |
| 抖音回采 | `scripts/collect-douyin.ts`、launchd 安装脚本 | 首页真实账号数据 |
| 基础 UI | `src/components/ui/`、深色主题 token | 界面底座 |

删除（摘要）：雷达、规划、灵感、选题、钩子库、拆解、素材库、校准与评分体系、小红书/公众号写稿与配图、旧视频分析/预测/复盘管线、图文口播与插画配音链、模板系统与剪辑台、`remotion/` 整个目录、TTS、`vendor/creator-cockpit`、`src/lib/cockpit`、旧总览页与 13 项侧栏、`src/jobs/`（BullMQ worker）、Redis。

文档：现有 `docs/superpowers/specs|plans` 与根目录开发文档移入 `docs/archive/`；README 从 2097 行重写为一页。

旧数据：新库不迁移。35 份稿子与人设导出为 `data/legacy-export.json`（agent 可读）；人设导入新库。`video-productions/`（4.8G）移出项目到归档目录，删不删由用户决定。

## 5. 架构

### 5.1 进程与依赖

- **单进程**：`npm run dev` 一条命令 + 一个 Postgres。去掉 Redis、BullMQ 和独立 worker。
- 耗时任务在 web 进程内执行，状态落 `Job` 表。服务启动时把残留的 `running` 任务标为 `interrupted`，界面给「重试」，由用户决定是否重跑（热重载打断任务的代价用这条兜住）。
- 外部依赖：Overlay Studio（`tools/overlay-studio`，node ≥ 22.12，导出时需它的 dev server 在 5177）、ffmpeg、本地 Whisper。全部由设置页「依赖体检」逐项检测并给出补救方法。

### 5.2 数据模型（8 张表）

| 表 | 关键字段 |
|---|---|
| `Project` | `title`、`stage`（`draft` → `scripted` → `recorded` → `overlaid` → `final` → `published`）、`script`（JSON：段落数组，每段 `id`/`role`/`text`）、`targetSec`、`personaSnapshot`、时间戳 |
| `ChatMessage` | `projectId`、`role`（user/assistant/tool/system）、`content`、`toolName`、`toolInput`、`toolResult` |
| `ProjectFile` | `projectId`、`kind`（`raw_video`/`transcript`/`overlay_json`/`overlay_mov`/`final_mp4`）、`path`、`meta`、`version` |
| `Job` | `projectId`、`kind`（`transcribe`/`arrange`/`render`）、`status`（`queued`/`running`/`done`/`failed`/`interrupted`）、`progress`、`userMessage`（人话）、`errorDetail`（原文） |
| `PersonaProfile` | 精简后的定位字段 |
| `PublishedWork` | 回采作品；新增可空 `projectId` |
| `DouyinOverviewSnapshot` | 账号级统计（中位播放、完播率等） |
| `DouyinMetricSummary` | 账号级当前值（粉丝数等，`metric` 唯一）。实施时发现粉丝数只在这张表里，`DouyinOverviewSnapshot` 没有 |

单用户：去掉 `User` 表与所有 `userId`。

### 5.3 项目文件落盘

`projects/<projectId>/` 下：`raw.mp4`、`transcript.srt`、`overlay.v<N>.json`、`overlay.v<N>.mov`、`final.v<N>.mp4`。每次重编排/重导出版本号 +1，旧版本保留到项目删除，便于回退。

## 6. 编导 agent

### 6.1 对话循环

- `POST /api/projects/:id/chat`，流式返回（SSE）。
- 调 DeepSeek（OpenAI 兼容的 function calling），每轮用户消息最多 8 次工具调用。
- 工具调用在对话里显示为一条小结果行（如「✓ 改稿：第 4 段 37s → 9s」）。

### 6.2 上下文：每轮从数据库重建

system prompt = 人设定位 + 项目阶段 + 当前稿子（带段落 id 与每段估算时长）+ 转写摘要 + 当前特效编排摘要（卡号/时刻/类型/文字）+ 工具说明；再附最近 20 条对话。**不依赖聊天记录推断当前状态**。

### 6.3 工具（`src/lib/tools/`）

每个工具 = zod 输入 schema + 一句说明 + `execute(ctx, input)`，与界面无关，日后套 CLI 外壳即可给 Claude Code / Hermes 用。

| 工具 | 同步/后台 | 作用 |
|---|---|---|
| `write_script` | 同步 | 按方向写整稿（六段结构，目标时长默认 60s） |
| `patch_script` | 同步 | 只改指定段落 |
| `transcribe` | 后台 | 转写 `raw_video`，完成后与稿子比对，标出临场改口 |
| `arrange_overlays` | 后台 | 编排 → Studio lint → 修复循环（复用 `arrange.ts`） |
| `patch_overlays` | 同步，随后自动触发 `render` | 删卡/换卡/调时刻/改文字，改后跑 lint |
| `render_final` | 后台 | `export-frames.mjs` 无头导出透明 MOV → ffmpeg 叠原片 → `final.mp4` |

后台工具立即返回"已开始 + 预计耗时"；任务结束后往对话插入一条 system 消息，并把中间栏切到对应标签。

### 6.4 两条硬规则

1. **不合格不交付。** `write_script`/`patch_script` 执行后由代码估算时长（按中文字数 × 语速常量，数值在实现时用用户已发作品校准）。超标则把带实际值的报错（"第 4 段 37 秒，上限 10 秒，全片 127 秒/目标 60 秒"）回喂模型自修，最多 2 轮；仍超则在对话里如实说明差多少，稿子标为未达标，不假装完成。特效 lint 的 error 同理。
2. **报错说人话。** 对话与界面只显示 `Job.userMessage`（原因 + 怎么办 + 重试按钮）；原始报错存 `errorDetail`，可展开，不直接铺在页面上。

## 7. 界面

### 7.1 侧栏三项

- **项目（首页）**：顶部账号真实数据（来自 `DouyinOverviewSnapshot` 与 `DouyinMetricSummary`）；项目列表（进行中 / 已完成）；「新建项目」。回采连续失败时顶部直接提示原因。
- **定位**：人设定位档案，可编辑。
- **设置**：DeepSeek key；依赖体检面板（数据库、Whisper、Studio、ffmpeg、node 22 逐项就绪状态与补救命令）。

### 7.2 项目页：左稿右聊

中间栏按阶段分标签，右侧编导对话常驻。

| 标签 | 中间栏内容 | 用户动作 |
|---|---|---|
| ① 脚本 | 分段稿子、每段估算时长、总时长；agent 刚改的句子高亮 | 对话提意见；可直接手改文字；「定稿」 |
| ② 口播 | 提词器（全屏、可调速）；拖拽上传区；转写结果与改口标记 | 录制、上传 |
| ③ 特效 | 合成预览播放器；卡片时间线列表（只读）；「在 Studio 里打开」逃生口 | 对话调整；需要时进 Studio 手调后点「用 Studio 的版本」 |
| ④ 成片 | 播放器、下载、版本切换；发布登记（贴抖音链接） | 下载、发布、贴链接 |

界面上不出现任何内部 id、模板代号或英文状态码。

## 8. 验收与测试

- 单元测试：时长估算、`patch_script`、各工具 schema 校验、以假 LLM 驱动的 agent 循环（含超标自修与放弃路径）、启动时 `interrupted` 标记。
- **每个阶段真机验收才算完成**（浏览器实际操作，不只跑测试）。
- 最终验收：用户真实录制的一条口播，端到端得到可直接发布的 mp4。

## 9. 实施阶段

| 阶段 | 内容 | 完成时用户能看到 |
|---|---|---|
| 0 | 打 `v1-final` tag；旧文档归档；导出旧稿子与人设 | 仓库留档完成 |
| 1 | 按保留清单清理；重建 schema；去掉 Redis/worker；typecheck + test 全绿 | 一条命令起得来的空壳 |
| 2 | 项目页 + 编导对话 + `write_script`/`patch_script` | **能用 agent 磨稿了** |
| 3 | 口播上传 + 提词器 + `transcribe` | 上传即出转写 |
| 4 | `arrange_overlays`/`patch_overlays`/`render_final` + 合成 | 项目内出成片 |
| 5 | 首页、定位页、设置页（依赖体检）；README 重写 | 完整可用 |

## 10. 风险与待实测项

- **后台导出耗时**：逐帧渲染，60 秒片估计数分钟，阶段 4 实测后写回本文档；若过慢，考虑只重导改动卡所在区间（需评估 Studio 是否支持）。
- **画幅**：Studio 导出舞台固定 1920×1080；用户竖屏口播如何对位需在阶段 4 用真实素材验证（09-20 集成时的 U 盘片可作参照）。
- **Studio 授权边界**：沿用现有约束——只拉起其 dev server、调其 CLI（`lint:overlay`、`export-frames.mjs`）、产其格式 JSON，绝不 import 其源码。
- **DeepSeek 工具调用质量**：若多步工具调用不稳，退路是换 Claude API（工具层不变）。
- **原地清理的残留耦合**：靠"按保留清单删除 + 每批 typecheck/test 全绿"控制；阶段 1 结束时全仓 grep 已删模块名应零命中。
