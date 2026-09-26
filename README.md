# MediaPilot

AI 知识类抖音口播的个人工作台：一条内容 = 一个项目，在项目里和编导 agent 对话把稿子磨好，再录口播、配特效、出成片。

> 2026-09-27 起整体重构（设计见 `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`）。重构前的全部代码在 git tag `v1-final`，旧文档在 `docs/archive/`，旧数据库 `mediapilot` 原样保留。

## 现在能做什么

- **项目**：首页新建项目，列表看每条的阶段与时长。
- **编导对话**：项目页右侧和编导 agent 聊，它会写整稿（`write_script`）或只改某一段（`patch_script`）；工具改过的段落会高亮，直到你发下一条消息。
- **时长硬约束**：稿子固定 6 段（开场钩子 / 概念A / 概念B / 冷知识 / 知识串联 / 金句收尾），按 5 字/秒估算；超标时 agent 自己修（写稿最多自修 2 轮），修不好会如实告诉你差多少秒。
- **手改与定稿**：点任意一段直接改，时长即时重算；满意后「定稿」。

录口播上传、特效编排、合成成片、首页账号数据、定位页、设置页在后续阶段加入。

## 快速开始

需要：Node 20+、Docker Desktop（建议设为开机自启，数据库容器会跟着自动起来）。

```bash
docker compose up -d        # 只有一个 Postgres
npm install
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
| `PYTHON_BIN` | 本地 Whisper 用的 Python（阶段 3 起用） |

## 每晚回采抖音数据

```bash
sh scripts/install-collect-cron.sh            # 装定时任务(每晚 20:00)
sh scripts/install-collect-cron.sh uninstall  # 卸载
npm run collect:douyin                        # 手动跑一次
```

依赖 ego lite（共享已登录的浏览器状态），全程只读。日志在 `logs/collect-douyin.log`；抓到 0 条会判定为异常并拒绝写库。写入 `PublishedWork`、`DouyinOverviewSnapshot`、`DouyinMetricSummary` 三张表。

旧库导出的人设与回采数据可用 `npm run import:legacy` 导入（读 `data/legacy-export.json`，幂等，不回退已回采的新数据）。

## 目录

```
src/app/                 页面与 API（/、/projects/[id]、/api/projects/...）
src/components/project/  项目页组件（稿子栏、对话栏）
src/lib/script/          稿子模型、时长估算、写稿与自修
src/lib/tools/           agent 工具（与界面无关，将来可套 CLI 给外部 agent）
src/lib/agent/           对话循环、上下文、DeepSeek 流式模型
src/lib/overlay-studio/  Overlay Studio 集成层（阶段 4 接入）
scripts/                 回采、旧数据导入、字级对齐
tools/overlay-studio/    外部工具，gitignore，不入库
```

## 测试

```bash
npm test          # vitest
npm run typecheck
```
