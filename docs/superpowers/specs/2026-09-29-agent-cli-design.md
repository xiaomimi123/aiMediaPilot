# 外部 agent 接入设计：统一 `mp` 命令行 + Claude Code / Hermes skill + 每日简报

- 日期：2026-09-29
- 状态：待用户审阅
- 路线图位置：`2026-09-28-film-production-design.md` §10 第 5 项
- 前置：阶段 0～5、选题、每晚任务、发布与复盘已完成

## 1. 为什么做、做成什么样

用户要外部 agent 做四件事：**在手机微信里指挥**（经本机 Hermes）、**Claude Code 一句话跑全流程**、**定时主动推送**、**让别的 agent 读数据做分析**。

现状：
- `scripts/mp.ts` 只服务出片（`project list/export`、`film new/check/render/register`），是一串 if，输出有纯文本也有 JSON；
- `src/lib/tools`（写稿 / 改稿 / 转写 / 找选题）当初就预留给外部 agent，但只有网页编导在调；
- 本机 Hermes 已接 3 个微信账号，能跑带 skill 与工作目录的定时任务并投递到微信（曾遇微信发送频率限制）。

成功标准：
- 在 Claude Code 里说"找个选题做一条"，它按 skill 用 `mp` 把选题 → 建项目 → 磨稿 → 定稿串起来，录口播时停下交给用户；
- 每天早上微信收到一条简报；在微信里问"今天有什么爆款""这条复盘怎么样"能得到简短准确的回答；
- 其他 agent 用 `mp … --json` 拿到结构稳定的数据。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 方案 | A：统一 `mp` 命令行 + 两份 skill + 每日简报（不做本地 HTTP API、不做 MCP） |
| 权限 | 按调用者区分：Claude Code 全部；Hermes 只读 + 少数安全写 |
| 微信写稿 | 不允许：`mp chat` 只给 Claude Code |
| 简报 | `mp brief`；Hermes 每天 8:30 跑并推送微信（时间可选），合并成一条消息 |
| 安装到 Hermes | `mp agents install-hermes`，改的是用户的 Hermes 目录与定时任务，执行前先问用户 |
| 权限的性质 | 防误操作，不是安全隔离（Hermes 本身能执行任意命令）；真正底线仍是每日限额、只读访问抖音、经验需用户确认 |

## 3. 命令清单

等级：**读**（只读）/ **写**（改本地数据）/ **抖**（用大号访问抖音，受每日额度）/ **重**（出片等长任务）。

| 命令 | 作用 | 等级 | Hermes |
|---|---|---|---|
| `mp help` | 列出当前身份可用的命令 | 读 | ✓ |
| `mp status` | 粉丝/获赞、今日爆款数、每晚任务状态、待确认事项 | 读 | ✓ |
| `mp brief` | 每日简报文本 | 读 | ✓ |
| `mp topics hits [--days N]` | 近期对标爆款（默认 14 天） | 读 | ✓ |
| `mp topics show <作品>` | 拆解与逐字稿 | 读 | ✓ |
| `mp topics accounts` | 对标账号 | 读 | ✓ |
| `mp topics suggest` | 编导挑 3 个选题（调 DeepSeek，不写库） | 读 | ✓ |
| `mp topics ignore <作品>` | 忽略作品 | 写 | ✓ |
| `mp topics follow / unfollow <账号>` | 关注 / 取消关注对标 | 写 | ✗ |
| `mp topics paste <链接>` / `analyze <作品>` / `search <词>` | 粘链接 / 拆解 / 搜博主 | 抖 | ✗ |
| `mp project list` / `show <项目>` | 项目列表 / 稿子、时长、阶段、转写摘要 | 读 | ✓ |
| `mp project new [--title T] [--from-video V]` | 建项目（可从对标作品建） | 写 | ✓ |
| `mp project export <项目>` | 出片资料包（现有） | 读 | ✗（出片专用） |
| `mp chat <项目> "<消息>"` | 与编导对话（写稿 / 改稿），记录与网页同一份 | 写 | ✗ |
| `mp script finalize <项目>` | 定稿 | 写 | ✗ |
| `mp film new / check / render / register …` | 出片（现有） | 重 | ✗ |
| `mp publish kit <项目>` | 生成发布文案 | 写 | ✗ |
| `mp publish candidates` | 等确认的作品关联 | 读 | ✓ |
| `mp publish link <项目> <作品id或链接>` | 关联作品 | 写 | ✓ |
| `mp retro show <项目>` | 复盘（诊断 + 解读 + 经验候选） | 读 | ✓ |
| `mp retro run <项目>` | 生成复盘 | 写 | ✗ |
| `mp lessons list` | 写法经验 | 读 | ✓ |
| `mp lessons adopt / reject <经验>` | 采纳 / 不要 | 写 | ✓ |
| `mp lessons retire <经验>` | 停用 | 写 | ✗ |
| `mp tasks status` | 每晚任务状态 | 读 | ✓ |
| `mp tasks run collect / scan` | 立即运行（占手动额度，立即返回"已开始"） | 抖 | ✗ |
| `mp agents install-hermes [--time HH:MM]` | 安装 Hermes skill 与简报定时任务 | 写 | ✗ |

身份：环境变量 `MP_AGENT`（`hermes` / `claude-code`，未设视为 `claude-code`）。

参数中的"作品 / 项目 / 经验 / 账号"均为库内 id；`topics hits`、`project list`、`lessons list` 等列表输出里给出 id，供后续命令引用。

## 4. 输出与退出码

- 默认：中文，给人看。
- `--json`：只输出一行 JSON：成功 `{ "ok": true, "data": … }`；失败 `{ "ok": false, "error": { "code": "…", "message": "…" } }`。不夹杂其他输出（进度信息走 stderr）。
- 退出码：`0` 成功；`1` 失败；`2` 当前身份不允许。
- 错误码：`not_found`、`bad_args`、`forbidden`、`db_down`（补救：打开 Docker Desktop，运行 `docker compose up -d`）、`no_deepseek_key`（去设置页填入）、`ego_unavailable`（打开 ego lite 重新登录）、`douyin_rejected`、`quota`、`running`、`failed`。
- `mp chat`：边生成边把编导回复写到 stdout（`--json` 时进度写 stderr，最后输出结果 `{ reply, tools: [{ name, ok, summary }] }`）；出错写进对话记录并返回失败，与网页一致。

## 5. 代码结构

```
scripts/mp.ts                        入口: 解析参数 → 找命令 → 权限检查 → 执行 → 按 --json 输出
src/lib/cli/registry.ts              命令定义类型、注册表、权限规则、参数解析、错误映射
src/lib/cli/commands/*.ts            每组命令一个文件: status / brief / topics / project / chat / script / film / publish / retro / lessons / tasks / agents
src/lib/cli/brief.ts                 简报组装(纯函数)
agents/hermes/mediapilot/SKILL.md    Hermes 用的说明(安装时复制)
.claude/skills/mediapilot/SKILL.md   Claude Code 全流程说明
```

命令定义：`{ name: string[]; tier: 'read' | 'write' | 'douyin' | 'heavy'; hermes: boolean; usage: string; args: zod; run(ctx, args) → data; format(data) → string }`。命令只调现有 `src/lib` 函数，不复制业务逻辑；出片四条沿用现有实现搬进注册表。

## 6. 两份 skill

**Claude Code（`.claude/skills/mediapilot/SKILL.md`，入库）**：全流程与停点——
1. `mp topics suggest` / `mp topics hits` 找选题 → 与用户确认选哪个；
2. `mp project new --from-video …`；
3. `mp chat` 磨稿（遵守编导规则与写法经验；照抄检查报出时改掉）→ `mp project show` 给用户看 → **用户确认后** `mp script finalize`；
4. **停**：提示用户录口播并在项目页上传；转写完成后继续；
5. 出片交给 `produce-film` skill（出片前与用户确认）；
6. `mp publish kit` → 用户自己发 → `mp publish candidates` / `link`；
7. 第 3 天后 `mp retro show`；经验候选**由用户决定**是否 `mp lessons adopt`。

**Hermes（`agents/hermes/mediapilot/SKILL.md`，由 `mp agents install-hermes` 复制到 `~/.hermes/skills/mediapilot/`）**：
- 所有命令以 `MP_AGENT=hermes npm run -s mp -- … --json` 调用，工作目录为项目根目录；
- 回复适合手机：短句、不用表格、最多 5 条；只转述命令输出，不编数据；
- 命令返回 `forbidden` 时回复"这个要回电脑上做"；
- 微信消息合并发送，避免频率限制。

## 7. 每日简报

`mp brief` 组装（纯函数 `buildBrief`）：
1. 昨晚回采、巡检是否成功（失败写原因与补救）；
2. 近 24 小时新判定的对标爆款，最多 3 条，每条"博主 · 平时的 N 倍 · 一句选题"；
3. 近 24 小时新出 / 更新的复盘，每条一句结论（诊断里"差"的阶段或编导解读首句）；
4. 待确认：作品关联候选数、写法经验候选数；
5. 粉丝变化（较上次回采）。

全部为空且任务都成功 → 只输出"昨晚一切正常，没有新爆款。粉丝 N（±M）"。

定时：`mp agents install-hermes` 在 `~/.hermes/scripts/` 写一个脚本 `mediapilot-brief.sh`（进入项目目录执行 `MP_AGENT=hermes npm run -s mp -- brief`），再调 `hermes cron create "30 8 * * *" --name "MediaPilot 每日简报" --script mediapilot-brief.sh --no-agent --deliver <目标>`：**不经过大模型，脚本输出原样投递**（不花模型费用，也不可能编造）。投递目标默认 `all`（与用户现有定时任务一致），可用 `--deliver` 指定。同名任务已存在则先删后建。

## 8. 出错处理

| 场景 | 行为 |
|---|---|
| 未知命令 / 参数错 | `bad_args` + 用法 |
| Hermes 调不允许的命令 | 退出码 2，`forbidden`："Hermes 不能做 X，回电脑上做" |
| 数据库没启动 | `db_down` + 补救命令 |
| 没有 DeepSeek key | `no_deepseek_key` |
| ego lite 不可用 / 抖音拒绝 | `ego_unavailable` / `douyin_rejected` |
| 手动额度用完 / 任务正在跑 | `quota` / `running` |
| 安装 Hermes：skill 目录已存在 | 备份为 `mediapilot.bak-<时间>` 后覆盖 |
| 安装 Hermes：同名定时任务已存在 | 更新，不重复创建 |

## 9. 测试与验收

- 单元：参数解析与权限（Hermes 调 抖 / 重 / chat / retire → 退出码 2）；`--json` 形状稳定；`mp help` 按身份列命令；`status` / `brief` / `topics hits` / `retro show` 的输出；简报精简版；`install-hermes` 的备份与"已存在则更新"（命令执行可注入）。
- 真机：
  1. Claude Code 按 skill 跑前半程：选题 → 建项目 → `mp chat` 写稿 → `mp project show` → 定稿，到"录口播"停；
  2. `MP_AGENT=hermes` 跑读命令与被禁命令；
  3. 经用户同意安装 Hermes skill 与定时任务，手动触发一次，确认微信收到简报。

## 10. 不做

MCP 服务；真正的安全隔离；微信写稿 / 出片；Hermes 触发访问抖音的操作；多用户。
