# MediaPilot

AI 知识类抖音口播的个人工作台：一条内容 = 一个项目，在项目里和编导 agent 对话把稿子磨好，再录口播、配特效、出成片。

> 2026-09-27 起整体重构（设计见 `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`）。重构前的全部代码在 git tag `v1-final`，旧文档在 `docs/archive/`，旧数据库 `mediapilot` 原样保留。

## 现在能做什么

- **项目**：首页新建项目，列表看每条的阶段与时长。
- **编导对话**：项目页右侧和编导 agent 聊，它会写整稿（`write_script`）或只改某一段（`patch_script`）；工具改过的段落会高亮，直到你发下一条消息。
- **时长硬约束**：稿子固定 6 段（开场钩子 / 概念A / 概念B / 冷知识 / 知识串联 / 金句收尾），按 5 字/秒估算；超标时 agent 自己修（写稿最多自修 2 轮），修不好会如实告诉你差多少秒。
- **手改与定稿**：点任意一段直接改，时长即时重算；满意后「定稿」。
- **② 口播**：全屏提词器照稿录制；把录好的视频拖进来，后台自动转写（本地 faster-whisper），再按原稿只修识别错字；逐句显示并标出「临场加的」和「没讲到」的段落。转写完成后编导对话里会收到通知，编导也能看到转写内容。任务失败或被重启打断时点「重试」，不会自动重跑。
- **③ 成片**：上传录屏、视频、截图、图片作素材（可写一句说明）；在 Claude Code 里说「给这个项目出片」，按 `.claude/skills/produce-film` 流程用 Remotion 出一条 1080×1920 竖屏成片（人物小窗右上角、内容区动效卡片与素材、底部字幕，风格「极客手账」），登记回项目后可播放、下载、查看素材使用表。
- **首页账号数据**：顶部显示粉丝、获赞（与抖音主页一致）、公开作品数与播放合计、最近公开发布（来自每晚回采；仅自己可见的作品不计）；回采失败或超过 36 小时没成功时直接提示原因和补救方法。
- **定位**：编辑人设档案（受众、差异化角度、忌讳、内容支柱、痛点、产品、定位摘要），编导写稿时读取；只影响之后新建的项目。
- **设置**：更换 DeepSeek key（写入 `.env`，立即生效）并测试连接；依赖体检逐项检查数据库、DeepSeek key、ffmpeg、本地转写、出片子工程、回采，缺什么给出补救命令（含对标巡检）。
- **选题**：关注对标博主（粘主页链接，或按关键词搜），每晚 20:30 用 ego lite 里登录的账号只读巡检，按「点赞是他平时的 3 倍以上」挑出爆款并自动拆解（逐字稿 + 选题 / 开头钩子 / 标题写法 / 与你定位的契合度）；一键建项目，编导写稿时借选题、钩子写法、标题思路，不照抄原句（与对标逐字稿连续 12 字相同会标出所在段落让编导改掉）。「让编导挑 3 个」从近 14 天的对标爆款里按你的定位出选题；在空项目里对编导说「帮我找个选题」也行。也可以直接粘贴抖音分享链接拆解单条视频。

出片目前在 Claude Code 里完成，网页一键出片（接 Claude API）排在后续路线图里。

## 快速开始

需要：Node 20+、Docker Desktop（建议设为开机自启，数据库容器会跟着自动起来）。

```bash
docker compose up -d        # 只有一个 Postgres
npm install
cd remotion && npm install && cd ..   # 出片用的 Remotion 子工程(独立依赖)
npx prisma db push          # 首次或改了 schema 后
npm run dev                 # http://localhost:3000
```

改了 `prisma/schema.prisma` 之后必须 `npx prisma generate` 并重启 `npm run dev`。不要在 dev 运行时跑 `npm run build`。

## 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | `postgresql://mediapilot:<密码>@localhost:5432/mediapilot_v2` |
| `DEEPSEEK_API_KEY` | 编导 agent 与写稿用（目前只从这里读） |
| `DB_PASSWORD` | docker-compose 的数据库密码 |
| `PYTHON_BIN` | 本地转写用的 Python（需装 faster-whisper） |
| `PROJECT_FILES_ROOT` | 项目文件（口播原片、转写）存放目录，默认仓库下 `projects/`（已 gitignore） |
| `WHISPER_MODEL` | 本地转写模型，默认 `small`；要更准可设 `medium`（更慢） |

## 出片命令行（给 Claude Code 用）

```bash
npm run -s mp -- project list
npm run -s mp -- project export <项目id>
npm run -s mp -- film new <项目id>                 # 建片子骨架 remotion/films/<id>-v<N>/
npm run -s mp -- film check <片子目录>              # 镜头覆盖 / 素材截取 / 画面数字有出处
npm run -s mp -- film render <片子目录> [--stills]  # 关键帧或整片(79 秒约 2 分钟)
npm run -s mp -- film register <片子目录> --summary <这一版改了什么>
```

组件库在 `remotion/kit/`，每条片子的源码在 `remotion/films/`（不入库）。

## 常见问题

- **dev 运行中新增了 API 路由目录后，别的接口也返回 Next 的 404 页**：重启 `npm run dev`（开发服务器路由表没刷新）。

## 每晚回采抖音数据

```bash
sh scripts/install-collect-cron.sh            # 装定时任务(每晚 20:00)
sh scripts/install-collect-cron.sh uninstall  # 卸载
npm run collect:douyin                        # 手动跑一次
```

依赖 ego lite（共享已登录的浏览器状态），全程只读。日志在 `logs/collect-douyin.log`；抓到 0 条会判定为异常并拒绝写库。写入 `PublishedWork`、`DouyinOverviewSnapshot`、`DouyinMetricSummary` 三张表。

旧库导出的人设与回采数据可用 `npm run import:legacy` 导入（读 `data/legacy-export.json`，幂等，不回退已回采的新数据）。

## 每晚对标巡检

- 安装：`sh scripts/install-scan-cron.sh`（每晚 20:30，排在回采之后；卸载加 `uninstall`）
- 手动跑一次：`npm run scan:benchmarks`
- 日志：`logs/scan-benchmarks.log`（首页与设置页读它判断巡检是否正常）
- 风控护栏（写死在代码里）：只读，不点赞/关注/评论；每晚最多 15 个账号、每个只读第一页、账号间隔 5～10 秒；连续 3 个账号被拒当晚即停；按关键词搜博主每天最多 10 次。
- 播放量拿不到（他人作品接口恒为 0），爆款只按点赞判断。

## 目录

```
src/app/                 页面与 API（/、/projects/[id]、/persona、/settings、/api/...）
src/components/project/  项目页组件（稿子栏、对话栏）
src/lib/script/          稿子模型、时长估算、写稿与自修
src/lib/tools/           agent 工具（与界面无关，将来可套 CLI 给外部 agent）
src/lib/agent/           对话循环、上下文、DeepSeek 流式模型
src/lib/film/            出片：资料包、片子骨架、检查规则、素材、登记
src/lib/benchmark/       选题：抖音只读访问、巡检、爆款规则、拆解、找选题、照抄检查
src/lib/douyin/ account/  回采日志解析、首页账号概览
src/lib/persona/          人设档案 schema
src/lib/settings/ health/ .env 写入、DeepSeek key 测试、依赖体检
remotion/                出片用的 Remotion 子工程（kit 组件库 + 渲染脚本）
scripts/                 回采、旧数据导入、字级对齐
```

## 测试

```bash
npm test          # vitest
npm run typecheck
```
