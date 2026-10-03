# 系统内出片设计（网页里调用本机 Claude Code，边做边问）

- 日期：2026-10-03
- 状态：待用户审阅
- 前置：produce-film skill（`.claude/skills/produce-film/SKILL.md`）、`mp film new/check/render/register`、作品工作区「成片」一步
- 取代：成片页"去 Claude Code 里说「给这个项目出片」"的提示

## 1. 目标

在作品工作区「成片」一步直接出片、改片，不用切到 Claude Code；过程可见，关键处停下来等你确认，质量与在 Claude Code 里出片一致。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 方式 | A：后台启动本机 `claude` 无界面模式（用已登录的订阅额度），按 produce-film 流程走；每轮结束即停顿，你回复后续上同一会话 |
| 互动 | 边做边问 |
| 必停的确认点 | ① 镜头表排好后；② 渲染完、登记前。它拿不准时也会停下来问 |
| 关键帧截图 | 它自己检查，不停；截图在进度里展示 |
| 并发 | 全系统同一时间只跑一个出片 |
| 模型 | 默认 Opus，设置页可改 |

## 3. 页面与流程

### 3.1 出片助手卡片（「成片」一步顶部）

- 空闲：
  - 没有成片：「出一版」+ 可选要求输入框。
  - 已有成片：另有「改这一版」（选择基于哪个版本，默认最新）+ 修改意见输入框。
  - 另一个项目正在出片：按钮不可点，显示"「<项目名>」正在出片"。
  - 本机没有可用的 Claude Code：按钮不可点，显示补救方法（§6）。
- 进行中 / 等待中：按时间顺序显示这次出片过程——
  - 进度行（每个工具调用一行，中文描述，见 §4.5）；看过的关键帧截图以缩略图显示，点开放大；
  - 它说的话（每轮结尾的文字）以对话气泡显示；
  - 「停止」按钮（进行中时）。
- 等你确认（状态 `waiting`）：
  - 确认点 = 镜头表：表格列出 `shots.json` 每个镜头（时间、intent、素材 id 与片段），加它的说明；「可以，继续」+ 输入框。
  - 确认点 = 成片：嵌入刚渲染的成片（片子目录 `out/` 里最新的 mp4）可播放，加它的说明；「登记为新版本」+ 输入框。
  - 确认点 = 提问：显示它的问题；输入框。
  - 「可以，继续」「登记为新版本」= 以固定文字回复（"可以，继续" / "可以，登记"）续上会话；输入框 = 以你写的文字续上会话。
- 结束（完成 / 失败 / 已停止）：
  - 完成：新版本出现在下方成片列表；卡片回到空闲，这次过程收成一行历史（"v3 · 10 月 3 日 · <登记时的 summary>"），点开回看。
  - 失败 / 已停止：显示原因 + 「接着做」（续上同一会话，发"接着做"）+ 「放弃」（结束这次，片子目录保留但不登记）。

### 3.2 编导对话通知

写入项目对话的 `job:film` 系统消息（工作区按现有规则自动展开抽屉一次）：
- "镜头表排好了，等你确认（在「成片」里看）"
- "成片渲染好了，等你确认"
- "已登记 v<N>：<summary>"
- 失败 / 停止时："出片停了：<原因>"

## 4. 后台执行

### 4.1 启动

每一轮启动一个子进程：

```
claude -p <本轮消息>
  (第一轮) --session-id <uuid>  (之后) --resume <uuid>
  --output-format stream-json --verbose
  --model <出片模型>
  --allowedTools <§4.3 白名单>
  --append-system-prompt <§4.2 规则>
```

- 工作目录：仓库根目录（produce-film skill 与 `mp` 命令在此可用）。
- 进程脱离网页服务独立运行（detached、单独进程组）；stdout 逐行追加到 `logs/film-sessions/<FilmSession.id>.jsonl`，stderr 追加到同名 `.err`。
- 第一轮消息：新出 = "给项目 <id>（<标题>）出一版成片。<你的要求>"；改片 = "改项目 <id> 的成片：基于 v<N>（<片子目录>）出新的一版。修改意见：<你的意见>"。
- 之后每轮消息 = 你的回复原文。

### 4.2 追加规则（`--append-system-prompt`）

```
你在 MediaPilot 网页里被调用，用户在网页上看你的进度、在停顿时回复你。
- 按 produce-film skill 的流程出片，只做出片相关的事。
- 镜头表 shots.json 写好后停下：用一段话说明切了几镜、怎么用素材，然后问"镜头表可以吗？可以就回复继续"。本轮到此结束。
- 渲染成片（film render，不带 --stills）完成后，不要运行 film register：说明这一版做了什么、用了哪些素材、做了哪些取舍，问"要登记为新版本吗？"。本轮到此结束。
- 用户回复"可以，登记"后再运行 film register（--summary 写这一版做了什么）。
- 拿不准的事（素材丢了、不确定放哪里、要求矛盾）停下来问，不要猜。
- film check 或渲染同一个错误连续 3 次没修好，停下来把报错和你的判断告诉用户。
- 不改 remotion/kit、不删除文件、不碰片子目录以外的文件。
```

### 4.3 权限白名单（`--allowedTools`）

- 读：`Read`、`Glob`、`Grep`（项目内）
- 写：`Write(remotion/films/**)`、`Edit(remotion/films/**)`
- 命令：
  - `Bash(npm run -s mp -- project list)`、`Bash(npm run -s mp -- project export:*)`
  - `Bash(npm run -s mp -- film new:*)`、`Bash(npm run -s mp -- film check:*)`、`Bash(npm run -s mp -- film render:*)`、`Bash(npm run -s mp -- film register:*)`
  - `Bash(ffmpeg:*)`、`Bash(ffprobe:*)`、`Bash(mkdir -p /tmp/mp-film:*)`、`Bash(ls:*)`
- 白名单外的工具在无界面模式下直接被拒（不等人确认）。实施第一步用真实 `claude` 验证规则写法：写 `src/` 被拒、写片子目录被允许、`git status` 被拒；验证不过不往下做。produce-film 里的抽帧路径改为 `/tmp/mp-film/`。

### 4.4 状态判断（每轮进程结束时）

| 依据（本轮日志） | 状态 / 确认点 |
|---|---|
| `film register` 成功 | `done`，记下版本号 |
| 写了 `shots.json`，没有 `film render`（不带 --stills）成功 | `waiting` / `shots` |
| `film render`（不带 --stills）成功，没有 register | `waiting` / `render` |
| 其他正常结束（有 result 事件且非错误） | `waiting` / `question` |
| result 事件为错误（额度、限流、模型错误） | `failed`，原因 = 错误原文 |
| 用户点停止 | `stopped` |
| 进程不在、日志无 result 事件 | `failed`，"出片进程意外退出" |
| 单轮超过 30 分钟 | 终止进程组，`failed`，"超时" |

进行中时状态为 `running`。读取状态时若 `running` 而进程已不在，按上表重判。

### 4.5 进度行（解析 stream-json）

| 事件 | 显示 |
|---|---|
| `mp project export` | 读稿子和素材 |
| `ffmpeg`（抽帧） | 抽帧看素材 |
| `mp film new` | 建片子目录 v<N> |
| 写 `shots.json` | 排镜头表 |
| 写 `Film.tsx` / `copy.ts` | 写画面 |
| `mp film check` | 检查：通过 / 有 N 处问题 |
| `mp film render --stills` | 渲染关键帧 |
| `Read` 一张 png | 看关键帧（附缩略图） |
| `mp film render` | 渲染成片（约 2 分钟） |
| `mp film register` | 登记 v<N> |
| 工具被拒 | ⛔ 被拒绝：<工具与参数> |
| 其它工具 | 工具名 + 简短参数 |

助手文字块显示为气泡。缩略图与成片预览通过新接口按会话读取片子目录里的文件（只允许该会话的片子目录内的 png / mp4）。

### 4.6 数据

```prisma
/// 一次出片过程(新出或改片), 可多轮
model FilmSession {
  id              String    @id @default(cuid())
  projectId       String
  project         Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  /// new | revise
  kind            String
  /// 改片时基于的片子目录
  baseFilmDir     String?
  /// Claude 会话 id(--session-id / --resume)
  claudeSessionId String
  /// running | waiting | done | failed | stopped
  status          String    @default("running")
  /// shots | render | question(status=waiting 时)
  checkpoint      String?
  /// 失败原因或它最后的提问
  message         String?   @db.Text
  /// 本次产出的片子目录(film new 之后)
  filmDir         String?
  /// 登记后的版本号
  version         Int?
  summary         String?
  pid             Int?
  turnStartedAt   DateTime?
  logPath         String
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([projectId, createdAt])
  @@index([status])
}
```

- 同一时间全系统最多一条 `running`；一个项目最多一条未结束（running / waiting / failed 可接着做）的会话。
- 日志文件是过程的原始记录，不逐条入库。

### 4.7 设置与体检

- 设置页「模型」卡片下加"出片模型"：Opus（默认）/ Sonnet（`AppSetting` `film.model`）。
- 依赖体检加一项 "Claude Code"：`claude --version` 能运行且已登录（`claude -p "ok" --max-turns 1` 不在体检里跑——太慢；只检查命令存在，登录问题在第一次出片时报出）。

## 5. 接口

- `GET /api/projects/[id]/film-session`：当前会话（若有）+ 解析好的进度 + 历史会话列表 + 全局是否有别的项目在出片 + Claude Code 是否可用。
- `POST /api/projects/[id]/film-session`：`{ action: 'start', kind: 'new' | 'revise', baseFilmDir?, note? }` / `{ action: 'reply', text }` / `{ action: 'stop' }` / `{ action: 'abandon' }`。
- `GET /api/film-sessions/[id]/file?path=<片子目录内相对路径>`：只返回该会话片子目录下的 png / mp4。

## 6. 出错处理

| 场景 | 行为 |
|---|---|
| 没装 Claude Code / 命令不可用 | 按钮不可点："本机没有可用的 Claude Code：安装后在终端运行 `claude` 登录" |
| 没登录 / 额度用完 / 限流 | 本轮 `failed`，原因用它的原话；「接着做」续上会话 |
| 白名单外操作 | 进度行"⛔ 被拒绝"，它自行换办法或停下来问 |
| 同一错误反复 | 规则要求连续 3 次后停下来问 |
| 素材丢了 | 按 skill 停下来问 |
| 超时（单轮 30 分钟） | 终止进程组，`failed`"超时"，可「接着做」 |
| 网页服务重启 / 刷新 | 不影响；进度从日志恢复 |
| 进程意外消失 | `failed`"出片进程意外退出"，可「接着做」 |
| 另一个出片在跑 | 不可开始，提示是哪个项目 |
| 已登记版本 | 不覆盖，改片总是新版本 |

## 7. 测试与验收

- 单元：启动参数拼装（首轮 / 续轮、白名单、模型）；日志解析为进度行（含缩略图、被拒）；状态判断（§4.4 每一行）；并发限制；超时；停止；文件接口只放行会话片子目录内的 png / mp4；体检项。
- 集成：用假的 `claude` 脚本按行输出 stream-json 事件，覆盖：停在镜头表 → 回复 → 停在成片 → 登记；中途 result 错误；进程消失。不调用真的 Claude。
- 页面：出片助手卡片各状态（空闲 / 进行中 / 等镜头表 / 等成片 / 完成 / 失败）与按钮。
- 真机（会用订阅额度，约一次完整改片）：①白名单验证（写 `src/` 被拒、写片子目录允许、`git status` 被拒）；②「U盘干到品类第一」基于 v2 改片：进度与缩略图 → 停在镜头表 →「可以，继续」→ 停在成片可播放 →「登记为新版本」→ 出现 v3；③中途刷新页面进度不丢；④试一次「停止」；⑤验收后问用户 v3 是否保留。

## 8. 不做

同时出多条；手机端出片（可看进度、可回复，但需电脑开着）；自动发布；编导对话 / 助手直接触发出片。
