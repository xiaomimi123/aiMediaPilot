# MediaPilot

AI 知识类抖音口播的个人工作台：一条内容 = 一个项目，在项目里和编导 agent 对话把稿子磨好，再录口播、配特效、出成片。

> 2026-09-27 起整体重构（设计见 `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`）。重构前的全部代码在 git tag `v1-final`，旧文档在 `docs/archive/`，旧数据库 `mediapilot` 原样保留。

## 现在能做什么

- **每日选题**：每晚 23:00 从对标爆款 / 自己作品的续集（片尾留了「下期再讲」之类钩子、或播放明显高于平时的）/ 点子池各挑一个，凑满 3 个选题，每个出 3–5 个要问你的问题（能讲成故事的真事：多少个、哪一次、当时什么感受；实测类的实测项也在里面）、写一篇 75 秒参考稿并预测播放；在选题卡上用自己的话答几题，点「按我的话写」，编导按你的回答和说话方式重写并重新预测（没答的地方留【待补】），卡片标签从「参考稿」变成「按你的话写的」；总览「今天」与「选题」页顶部可看，展开看初稿，「就做这个」才建成作品（初稿即脚本、预测带过去，答过和没答的问题带进编导对话），「不要」就收起，3 天没处理自动收起。点子池在「选题」页，随手写一句回车保存。在「设置 · 每晚任务」开关定时或立即运行（`npm run topics:daily`）。
- **界面**：暖白卡片风，5 个入口——总览（今天要处理的事、在做的作品与先发哪条、今日对标；粉丝 / 获赞 / 播放与预测准度；账号走势（每晚记一条快照，满 7 天出曲线）；作品表现对比）、作品（卡片网格，按阶段筛选、按预测排序）、选题、助手、设置（账号定位、说话样本、模型、Obsidian、每晚任务、写法库、预测公式、体检）。作品工作区顶部是六步步骤条（选题 → 脚本 → 口播 → 成片 → 发布 → 复盘），编导对话收在右下角，有新通知时自动展开。手机上是底部标签栏，编导对话从底部滑出。
- **作品**：「作品」页新建项目、按阶段筛选；每张卡显示走到六步里的哪一步、预测或实际播放。
- **编导对话**：项目页右侧和编导 agent 聊，它会写整稿（`write_script`）或只改某一段（`patch_script`）；工具改过的段落会高亮，直到你发下一条消息。
- **讲故事的 6 段**：钩子 / 我是谁·当时 / 遇到什么 / 怎么做的 / 结果 / 经验或悬念，按 5 字/秒估算；新作品默认 75 秒。每段字数只作参考（偏长会标出），全片超出目标 10% 才算超标，超标时 agent 自己修（写稿最多自修 2 轮），修不好会如实告诉你差多少秒。编导写稿要求像你本人在说话：先交代我是谁、当时在干嘛，用具体的东西，不写文章腔；第一人称经历和数字只能来自你给的材料或回答，没有就写【待补】。
- **说话样本**：「设置 · 说话样本」贴你自己写的口播或录好的转写（作品「口播」一步有转写时也能点「加为说话样本」），编导写稿时参考最近 3 篇（每篇前 800 字）的说话方式，不抄句子。
- **润色**：「选题」页「我自己写了一篇」贴上自己写的稿子点「润色」，或在作品「脚本」一步（定稿前）点「润色」：只用原文内容，删重复和啰嗦、调顺序、断句、改错字，压到目标时长（还超就让模型挑次要的整句删），改动逐条列出，意思不清的地方列出来让你确认，原文里没有的新句子会标黄。可以「用润色版」或「用原文」建作品 / 保留原稿；「我自己写了一篇」的原文会自动存为说话样本。
- **手改与定稿**：点任意一段直接改，时长即时重算；满意后「定稿」。
- **② 口播**：全屏提词器照稿录制；把录好的视频拖进来，后台自动转写（本地 faster-whisper），再按原稿只修识别错字；逐句显示并标出「临场加的」和「没讲到」的段落。转写完成后编导对话里会收到通知，编导也能看到转写内容。任务失败或被重启打断时点「重试」，不会自动重跑。
- **③ 成片**：上传录屏、视频、截图、图片作素材（可写一句说明）。在「成片」一步的出片助手里点「出一版」（或选一个版本「改这一版」并写修改意见），后台用本机 Claude Code 按 `.claude/skills/produce-film` 流程用 Remotion 出一条 1080×1920 竖屏成片（人物小窗右上角、内容区动效卡片与素材、底部字幕，风格「极客手账」）：进度和关键帧截图实时显示，镜头表排好、成片渲染好时各停一次等你确认，确认后登记为新版本，可播放、下载、查看素材使用表；途中可停止、接着做、放弃。「登记为新版本」由网页直接登记（不再开一轮 Claude，几秒完成）；复查关键帧时只重出改过的镜头（`mp film render <片子目录> --stills --shots 镜头id,…`）。成片列表里每个版本可以删除（视频和片子目录一起删，版本号不重复使用）。也可以继续在 Claude Code 里说「给这个项目出片」。出片助手里可选竖版 / 横版（横版 1920×1080，内容区 1360×765 适合放录屏与操作演示；改片沿用原版本的版式）；命令行 `mp film new <项目> --landscape`。出片模型在设置页「模型」里选（默认 Opus），需要本机装好并登录 Claude Code（体检里有这一项），且网页服务要在普通终端里启动（在 Claude Code 会话里启动的服务会把宿主的代理变量带给子进程，claude 会报 401）；画面已避开抖音的顶部频道栏、右侧点赞列和底部作者文案（`remotion/kit/tokens.ts` 的 `ZONE` / `DOUYIN_OVERLAYS`）；白名单可用 `npx tsx scripts/film-perms-check.ts` 真机验证。
- **账号数据**：「总览」显示粉丝、获赞（与抖音主页一致）、公开作品数与播放合计、账号走势（来自每晚回采；仅自己可见的作品不计）；回采失败或超过 36 小时没成功时直接提示原因和补救方法。
- **账号定位**：「设置 · 账号定位」编辑人设档案（受众、差异化角度、忌讳、内容支柱、痛点、产品、定位摘要），编导写稿时读取；只影响之后新建的项目。
- **设置**：「模型」：添加任意模型（OpenAI 兼容：DeepSeek / 通义千问 / Kimi / 智谱 GLM / 豆包 / OpenRouter / Ollama / 中转站；Claude 原生），「测试」判断能不能当编导（连通 / 工具调用 / 结构化输出），全局选一个当前使用；依赖体检逐项检查数据库、当前模型、ffmpeg、本地转写、出片子工程、回采，缺什么给出补救命令（含对标巡检）。「每晚任务」卡片可随时「立即运行」作品数据回采 / 对标巡检（各每天最多手动 3 次，保护账号），也能开关每晚定时并改时间（装/卸 macOS launchd 定时任务；用设置页开启才带失败补跑，`scripts/install-*-cron.sh` 只装设定时间那一次）。
- **选题**：关注对标博主（粘主页链接，或按关键词搜），每晚 20:30 用 ego lite 里登录的账号只读巡检，按「点赞是他平时的 3 倍以上」挑出爆款并自动拆解（逐字稿 + 选题 / 开头钩子 / 标题写法 / 与你定位的契合度）；一键建项目，编导写稿时借选题、钩子写法、标题思路，不照抄原句（与对标逐字稿连续 12 字相同会标出所在段落让编导改掉）。「让编导挑 3 个」从近 14 天的对标爆款里按你的定位出选题；在空项目里对编导说「帮我找个选题」也行。也可以直接粘贴抖音分享链接拆解单条视频。

- **发布与复盘**：作品工作区「发布」一步生成候选标题 / 话题标签 / 封面字（你自己在抖音发）；发布后第二天回采自动提示"这条是你发的吗"，确认即关联（也可贴链接）。发布第 3 天自动复盘、第 7 天更新：按开头 2 秒 / 前 5 秒 / 中段（平均观看秒数对到逐句转写）/ 收尾 / 互动逐段和你平时比，从对标建的项目还会比点赞倍数；编导解读并提出写法经验，你采纳后编导以后写稿都会遵守。「作品 · 已发布」看全部已发布作品，「设置 · 写法库」管理写法经验。每晚回采另存每条作品的完播/跳出/平均观看等指标，发布 30 天内每天一份快照。

- **外部 agent**：`mp` 命令行覆盖全部功能（中文输出，加 `--json` 给程序读）；Claude Code 用项目内 skill `mediapilot` 一句话跑选题→建项目→磨稿→定稿→出片→发布→复盘；本机 Hermes 装上后可在微信里查爆款、复盘、任务状态，每天早上收到简报。
- **助手**：「助手」是跨项目的总助手（用设置页的当前模型）：问状态和数据、一句话开工（对标爆款 → 建项目 → 编导写首版）、讨论怎么调整。它能用 `mp` 命令行的全部能力（出片与安装 Hermes 除外），做事不先问你（每日额度、只读抖音等护栏照旧）；每次调用工具显示一行，点开看原始输出，回复里的项目可点。内置 3 个 skill：每日开工、从对标到首版稿、数据诊断（`assistant/skills/`）。当前模型不支持工具调用时只能聊天，会提示换模型。
- **Obsidian 记忆**：设置页「Obsidian」选编导能读的文件夹（默认 5-灵感 / 3-资源 / 1-项目，库路径自动识别，未勾选的文件夹一律不读）。编导写稿前会搜你的笔记、优先用你自己的观点和经历，并在回复里注明借用了哪篇（`[[笔记名]]`）；助手也能用 `mp notes search/show` 查（Hermes 不能）。定稿、复盘后或你让编导"存进笔记"时，对话里出现「存进 Obsidian」卡片，点确认才把项目笔记（选题 / 对标 / 定稿 / 复盘 / 写法经验 / 编导小结）写进库里的 `MediaPilot/项目/`；你在标记区块外写的内容不会被覆盖，同名的自建笔记不会被动。
- **流量预测**：脚本页「流量预测」按 5 项（开头钩子 / 节奏 / 结尾 / 互动 / 选题）给稿子打分，按你自己作品的平时水平换算出分项预测（2 秒跳出、5 秒完播、平均观看、完播、互动）和播放区间四档概率，并指出拖后腿的段落，可一键让编导按建议改。定稿和录完口播后各自动锁定一版，第 3 / 7 天复盘时逐项对账；同一项连续 3 次同向偏差时，回测更准才在「复盘」页提议调公式，你采纳才生效。发布后前两天明显落后于预测会提醒。首页可按预测排序；`mp predict run/show/list`。样本少时置信度低，会直接写明误差范围。

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

**开机自动启动**（推荐）：`sh scripts/install-dev-autostart.sh` 装好后，登录电脑就自动启动网页服务（固定 3000 端口，日志 `logs/dev.log`），不用再手动 `npm run dev`；卸载用 `sh scripts/install-dev-autostart.sh uninstall`。数据库容器随 Docker 自动起来，在 Docker Desktop 的 Settings → General 里勾选「Start Docker Desktop when you sign in」即可。重启网页服务：`launchctl kickstart -k gui/$(id -u)/com.mediapilot.dev`。

改了 `prisma/schema.prisma` 之后必须 `npx prisma generate` 并重启 `npm run dev`。不要在 dev 运行时跑 `npm run build`。

## 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | `postgresql://mediapilot:<密码>@localhost:5432/mediapilot_v2` |
| `DEEPSEEK_API_KEY` | 只在首次启动时迁移成设置页「模型」里的 DeepSeek（设为当前）；之后在设置页管理模型与 key |
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

在设置页「每晚任务」开启定时时（回采与对标巡检都一样），会排三个时间：设定时间、1 小时后、2 小时后；定时触发带 `--scheduled`，6 小时内成功过就跳过（不访问抖音），所以只有失败时才会补跑，一晚最多 3 次。手动运行不受影响。定时没开时，总览「今天」会直接提示去设置页打开。

依赖 ego lite（共享已登录的浏览器状态），全程只读。日志在 `logs/collect-douyin.log`；抓到 0 条会判定为异常并拒绝写库。写入 `PublishedWork`、`DouyinOverviewSnapshot`、`DouyinMetricSummary` 三张表。

旧库导出的人设与回采数据可用 `npm run import:legacy` 导入（读 `data/legacy-export.json`，幂等，不回退已回采的新数据）。

## 每晚对标巡检

- 安装：`sh scripts/install-scan-cron.sh`（每晚 20:30，排在回采之后；卸载加 `uninstall`）
- 手动跑一次：`npm run scan:benchmarks`
- 日志：`logs/scan-benchmarks.log`（总览与设置页读它判断巡检是否正常）
- 风控护栏（写死在代码里）：只读，不点赞/关注/评论；每晚最多 15 个账号、每个只读第一页、账号间隔 5～10 秒；连续 3 个账号被拒当晚即停；按关键词搜博主每天最多 10 次。
- 播放量拿不到（他人作品接口恒为 0），爆款只按点赞判断。

## 命令行与外部 agent

- 看全部命令：`npm run -s mp -- help`；任何命令加 `--json` 输出一行 JSON（`{ok,data}` / `{ok:false,error:{code,message}}`），退出码 0 成功 / 1 失败 / 2 权限不允许。
- 身份：`MP_AGENT=hermes` 时只能用只读命令与少数安全写（建项目、采纳/不要经验、忽略作品、确认作品关联）；写稿、出片、访问抖音的命令只给 Claude Code。这只防误操作，不是安全隔离。
- Claude Code：项目内 skill `.claude/skills/mediapilot`（全流程与停点）。
- Hermes：`npm run -s mp -- agents install-hermes [--time 08:30] [--deliver all]` 把 `agents/hermes/mediapilot` 复制到 `~/.hermes/skills/`，写 `~/.hermes/scripts/mediapilot-brief.sh`，建定时任务「MediaPilot 每日简报」。简报不经过大模型、原样投递；已有同名 skill / 任务会先备份 / 替换。

## 目录

```
src/app/                 页面与 API（/、/projects/[id]、/persona、/settings、/api/...）
src/components/project/  项目页组件（稿子栏、对话栏）
src/lib/script/          稿子模型、时长估算、写稿与自修
src/lib/tools/           agent 工具（与界面无关，将来可套 CLI 给外部 agent）
src/lib/agent/           对话循环、上下文、DeepSeek 流式模型
src/lib/film/            出片：资料包、片子骨架、检查规则、素材、登记
src/lib/film-session/    网页出片：启动参数与白名单、日志解析、状态判断、会话运行
src/lib/llm/             模型层：配置与迁移、OpenAI 兼容 / Claude 适配、能力测试、报错翻译
src/lib/assistant/       总助手：命令→工具、skill 读取、系统提示、对话范围
src/lib/notes/           Obsidian：库配置、路径安全检索、笔记拼装与写入、存进提议
src/lib/predict/         流量预测：换算公式、打分、运行、对账与校准、落后提醒
src/lib/overview/        总览与作品页：六步判定、「今天」待办、仪表盘取数
assistant/skills/        总助手内置 skill（SKILL.md）
src/lib/retro/           发布与复盘：作品指标/快照、作品-项目匹配、分段诊断、复盘生成、写法经验
src/lib/benchmark/       选题：抖音只读访问、巡检、爆款规则、拆解、找选题、照抄检查
src/lib/douyin/ account/  回采日志解析、总览账号数据、账号每日快照
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
