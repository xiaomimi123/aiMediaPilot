# MediaPilot

> AI 自媒体工作台 — 自用创作闭环: 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据复盘。 主阵地抖音, 其他平台 (B站/YouTube/推特/小红书/公众号/快手/微博) 走分发登记。 设计预留 SaaS 扩展空间 (`userId` 隔离已在 schema, 未接 auth/计费)。

**当前状态:** 单用户 MVP。 经历三次定位调整: "个人视频分析工具" → "小白向导式智能体" → "自用自媒体工作台" → **"Creator Cockpit 整体移植"** (2026-08-04, 详见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`)。 首页 `/` 与全站外壳已换成移植自开源项目 [creator-cockpit](https://github.com/AverrryHu/creator-cockpit) 的纸质编辑部风格操作台; 紧接着完成**二期「平台页面融入驾驶舱」** (2026-08-05, 详见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`)——把一期挂壳的创作/数据/设置页面功能长进驾驶舱视图, 侧栏「平台」组解散; 再完成**三期「产出优先信息架构重组」** (2026-08-06, 详见 `docs/superpowers/specs/2026-08-06-platform-first-ia-design.md`)——侧栏从「流程优先」六视图重排为「产出优先」按平台组织; 又完成**四期「AI 深度采集 · 热点雷达」** (2026-08-13, 详见 `docs/superpowers/specs/2026-08-13-radar-deep-collection-design.md`)——新增服务端热点雷达管线 (关键词 → Tavily 搜索 → AI 逐篇阅读评分 → 热度排行), 独立「热点雷达」侧栏视图 + 设置「雷达配置」卡, 零 Claude 额度消耗 (阅读评分走用户自己的 AI provider); 又完成**五期「创作质量深化」** (2026-08-13, 详见 `docs/superpowers/specs/2026-08-13-script-quality-design.md`)——抖音脚本生成从单次大 prompt 升级为「研究→写作」两阶段管线, 产出可直接口播的完整逐字稿 (`script.sections[]`), 叠加 Tavily 联网研究打底 + 抽屉素材框, 定稿自动沉淀为风格样本供后续生成 few-shot 参照, 新增分块/整稿两级改稿。 本文档 §3 为当前实际 IA。

---

## 1. Product Vision (当前: 工作台定位)

### 当前定位

**用户:** 自己 (AI 知识类抖音博主), 保留未来扩展给其他博主的可能 (`userId` 隔离已在 schema 里, 未来接 SaaS 需要另加 auth/计费中间件)
**覆盖环节:** 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据/复盘, 完整创作闭环 (见 §3 `/` 工作台首页)
**平台策略:** 主阵地 + 分发登记。 抖音是主阵地 (创作闭环 + L1 预测 + 复盘全在这里); 其他平台只登记"这条内容分发到了哪", 不做独立创作流
**不做:** 一键发布、看板拖拽改状态、SaaS 计费 (本期范围外)

### 历史定位 1: 小白向导式智能体 (第一次 pivot, 已被工作台定位取代)

**用户:** 想做自媒体但不知道怎么开始的小白
**核心交互:** 向导式智能体 — 选平台 → 选垂类 → 输 topic → 出 platform-ready 内容
**平台:** 抖音 / 小红书 / 公众号 (3 平台同时支持,文风差异由 platform-specific prompts 处理)

这一版的产物 (多平台脚本生成、`/agent` 向导页) 被保留并整合进当前工作台, 但面向小白的教学引导 (三步教学卡、"第一次来"新手引导) 已在工作台重定位中压缩/移除 —— 自用工具不需要新手教程。

### 历史定位 0: 个人视频分析工具 (pivot 前) — 保留为深度功能

视频上传 → AI 4 维诊断 → L1 播放量预测 → 发布后 retro 复盘 → calibration 闭环。
这条线 (Phase 1 + L1 + retro) **保留**,是当前工作台看板"已拍待发/已发布/已复盘"三列的数据来源。

---

## 2. 14 Sub-projects 全景

### 仍然核心 (post-pivot)

| ID | 内容 | 状态 |
|---|---|---|
| **E** | Script 生成 (DeepSeek + zod schema) | ✅ 3 平台 (抖音/小红书/公众号) 各自 prompt + schema |
| **F** + **K2** | Script ↔ Analysis 双向链 (URL `?fromScript=` + DB FK) | ✅ |
| **H** + **I** | UI 风格 (Stitch 设计,蓝紫渐变,中文化) | ✅ 已被 Cockpit 纸质编辑部风格取代 —— `.bg-brand-gradient`/`.text-brand-gradient` 二期 (T7) 已全部退役 (`button.tsx` 的 `brand` variant 与其余 6 处字面量用法均改为 cockpit clay 强调色), 全仓库 `grep brand-gradient` 零残留 |
| **G** | Mobile 响应式 (drawer + 卡 stack) | ✅ |
| **M** | finalTitle 实时 AI 反馈 (DeepSeek 评分 + 改进建议) | ✅ `title-feedback` API 已支持 `platform` 参数 |

### 改造能用

| ID | 内容 | 待改 |
|---|---|---|
| **A** | 账号视频通常播放数 (baseline) | 概念偏视频,新场景下需重设计,当前不动; 二期 (T5) 已从 `/settings/baseline` 挪进 cockpit 设置视图「Baseline」卡, 旧路由已删除 (redirect → `/?view=settings`) |
| **J** | 发前 publish checklist (5 项 + isReady) | 仍是视频专属单一 schema,未按平台拆分 (Roadmap Phase D,未做) |

### 老视频管线 — 保留为深度功能

| ID | 内容 |
|---|---|
| **Phase 1** | 视频上传 + ffmpeg 预处理 + 4 维 AI 评估 (hook/retention/title-caption/cover) + Whisper 转录 + synthesize 综合评分 |
| **L1** | 播放区间预测 (baseline × scoreMultiplier × calibrationFactor) |
| **C** | Retro 半自动 (review.py list + 手动 dropdown 匹配) |
| **D** | Auto-sync cron 12h + bigram Dice 0.8 fuzzy match |
| **B** | Phase 3 Dashboard 7 widget (StatsBar / OverallScoreTrend / Calibration / PredictionAccuracy / Niche / Top / Misses) | 二期 (T4/T6) `/dashboard` 页整体退役: Calibration/PredictionAccuracy/Misses → 迁移进复盘实验室「预测与校准」区块; Niche/Top → 迁移进大目标「内容表现」区块; StatsBar/OverallScoreTrend 连同页面自身的 QuickCreate/AccountRecent/EmptyState 一并退役删除 (无迁移, 首屏信息与其他视图重复), 数据源 `GET /api/v1/dashboard/summary` **保留**未退役 (两个新 widget panel 仍靠它取数, 未按 spec 原计划"仅剩 dashboard 用就退役") |
| **L** | NextSteps "下一步" widget (待发 / 待复盘 / 草稿待拍 3 计数) | 二期 (T6) 随 `/dashboard` 一起退役删除, 未迁移 (职责已被「今日推进」视图取代) |

---

## 3. 当前 IA (Creator Cockpit 全面接管 + 二期融合 + 三期产出优先重组)

首页 `/` 与全站外壳已替换为移植自开源项目 [creator-cockpit](https://github.com/AverrryHu/creator-cockpit) 的纸质编辑部风格操作台 (一期, 详见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`)。 旧工作台看板/内容库列表页/旧侧栏已删除。

**二期 (平台页面融入驾驶舱, 详见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`) 已完成**: 侧栏「平台」组 (创作/数据/设置三项外链) **已解散**——AI 写稿、数据看板、AI key/baseline 三块功能已分别**长进**驾驶舱视图内部 (不再是独立挂壳页面); `/agent` `/dashboard` `/settings` 三个旧壳页已删除, 全部 redirect 回 `/` 的对应视图 (见下方 redirect 表)。 `/accounts` 保留为双入口。 二期还把蓝紫渐变 (Stitch 风格残留) 全面退役, 存留的站外页面 (`/accounts`、`/agent/discover`、`/content/*`) 视觉统一为 cockpit 纸质编辑部风格。

**三期 (产出优先信息架构重组, 详见 `docs/superpowers/specs/2026-08-06-platform-first-ia-design.md`) 已完成**: 二期的六视图侧栏是「流程优先」(灵感→推进→档期→总览→目标→复盘), 与"按平台组织产出"的实际心智不符——三期只重排信息架构、不动底层机制 (抽屉/409 防护/AI 生成/爬虫回填等全部保留)。 侧栏「今日推进」与「档期规划」合并为一个视图内的今日/本周/档期三个 tab; 「大目标」与「复盘实验室」合并为「内容数据分析」一个视图内的目标/复盘两个分区; 新增「创作」固定分组, 五个平台 (抖音/小红书/bilibili/X/YouTube) 各自一个流水线页; 侧栏拖拽排序整体移除 (与新的固定分组结构冲突, 按 spec"实施时定"的授权简化)。 本文档 §3 为当前实际 IA。

### Sidebar

侧栏 (`src/components/cockpit/sidebar.tsx`) 现在是三段固定分组, 全站统一, **不支持拖拽排序**:

```
✣ 灵感库选题                    ← 工作台组
◉ 热点雷达                      ← 工作台组 (四期新增, 自取数视图, 见下方「热点雷达」小节)
◫ 今日推进                      ← 工作台组 (页内 tab: 今日 / 本周 / 档期)
─ 创作 ──────────────────────
▸ 抖音 / 小红书 / bilibili / X / YouTube   ← 创作组, 各自独立平台流水线页
──────────────────────────────
▦ 内容总览                      ← 总览组 (全平台看板, 不过滤)
◎ 内容数据分析                  ← 总览组 (页内 tab: 目标 / 复盘)
⚙ 设置                          ← 底部, 不在上述任一分组
```

站外页面挂入壳时同一份侧栏渲染成 `/?view=<id>` 静态链接。 `settings` 是固定分组之外的独立 view state (不在侧栏三段分组渲染逻辑里), 只能通过「设置与备份」按钮或 `/?view=settings` 直达。 `/accounts` 不在侧栏里 (二期解散的「平台」组唯一残留的落地页), 入口见下方双入口说明。

### `/` — Cockpit 驾驶舱 (首页)

`src/app/page.tsx` 只 `dynamic import` 一个客户端组件 `Cockpit.tsx` (`ssr:false`), 内部按 `view` state (`NavView`, 定义于 `src/lib/cockpit/view-routing.ts`) 切换视图: `inspirations` / `radar`(四期新增, 自取数, 不进 `WorkspaceState`) / `momentum`(今日/本周/档期三个 `MomentumPeriod` tab) / 五个 `platform-<平台>` / `pipeline` / `analytics`(目标/复盘两个 `AnalyticsTab` tab) 六类固定视图 + 一个独立的 `settings` 视图, 均是原样移植或参数化复用的 UI + 交互逻辑 (`src/lib/cockpit/{model,workflow,schedule,calculations}.ts` 纯函数零改动移植; `view-routing.ts` 是三期新增的纯逻辑模块, 详见下方兼容映射)。 首次进入 (workspace 为空) 走 onboarding; 支持明暗主题 + 5 套设计风格切换, 侧栏可折叠 (拖拽排序已移除); <820px 时侧栏收起, 换成底部 `.mobile-nav`。

### 平台流水线页 (三期新增)

五个平台 (抖音/小红书/bilibili/X/YouTube) 各有一个 `/?view=platform-<id>` 页面 (`src/components/cockpit/views/platform.tsx`), 每页固定三区:

1. **产出区**: 「+ 新建内容」按钮直接创建内容并预置 `platform` 为当前页所属平台, 打开抽屉；能力分级提示文字——抖音/小红书 (全能力) 支持抽屉内就地 AI 生成, bilibili/X/YouTube (基础能力) 仅手写脚本骨架。
2. **看板区**: 复用 `内容总览` 同一个 `ContentOverviewView` 组件 (`views/pipeline.tsx`), 传入 `platformFilter` 只显示该平台内容 (参数化复用, 非复制)。
3. **分发区**: 读现有 `Distribution` 表, 展示登记到该平台的分发记录 (来源选题标题 + URL + 日期)。

**platform 字段与主平台+分发模型**: 内容在其 `platform` 字段标记的主平台上完整走完创作流水线 (灵感→脚本→拍摄→发布→复盘)；发布到其他平台不重新走流程, 而是在该内容的脚本详情页登记一条 `Distribution` 记录 (平台+URL), 出现在对应平台流水线页的分发区——"一份内容, 一条主线, 多条分发标记"。

### 热点雷达 (四期新增)

一句话: **关键词 → Tavily 搜索 → AI 逐篇阅读评分 → 热度排行 → (人工审批)收入灵感库**——AI 只负责采集与排序, 是否值得做仍由人决定。

服务端 AI 深度采集管线 + 独立视图, 与 cockpit 其余六视图不同——**自取数, 不进 `WorkspaceState`**（学 dashboard summary 先例，见 `src/components/cockpit/views/radar.tsx` 顶部注释）。「零 Claude 额度消耗」是硬约束: AI 阅读评分走用户自己在「AI 服务配置」卡配置的服务商 (现为 DeepSeek); DeepSeek key 解析优先读该卡里的 `AIConfig` 记录, 未配置时回退 `.env` 里的 `DEEPSEEK_API_KEY` (见 `src/lib/llm/resolve-key.ts`), 不占用 Claude 用量。

**管线** (`src/lib/radar/run.ts` 的 `runRadarScan`, `src/jobs/workers/radar-worker.ts` 每日一次仿 auto-sync-worker 注册 + `/api/v1/radar/trigger` 手动触发仿二期 trigger 超时模式):

```
活跃 RadarKeyword → Tavily 搜索 (近期结果, 含正文) → URL+标题指纹双去重
→ AI 逐篇阅读 (zod 结构化: 摘要/角度/相关度/新鲜度/讨论强度/可做性/候选关键词)
→ 相关性闸门 (relevance < 40 丢弃不入库) → 热度合成 (四维加权 + 同话题跨源共现加成)
→ 写 RadarItem + 候选词入 RadarKeyword(candidate) + RadarRun 运行日志
```

每日阅读上限默认 20 篇 (`RadarConfig.dailyLimit`, 可在设置卡改), 是**近 24 小时滚动累计**的额度 (而非"每次点击立即扫描各自的上限")——跑之前先查过去 24h 内该用户所有 RadarRun 的 `read` 总和, 剩余额度 = `dailyLimit - 已耗用`; 剩余为 0 时本轮仍创建 RadarRun 但不进入阅读循环, 记一条 `errors: [{stage:'budget', message:'今日阅读额度已用完'}]` 后立即收尾, 在雷达视图的上轮运行摘要中可见。

**数据模型** (4 张新表, 均 `userId` 隔离, 详见 `prisma/schema.prisma`): `RadarKeyword`(关键词, status: active/candidate/ignored) / `RadarItem`(采集条目, status: new/adopted/ignored) / `RadarRun`(每轮运行日志) / `RadarConfig`(单行, Tavily key 用 `src/lib/crypto.ts` 同款 AES-256-GCM 加密存储, 前端只回 `hasKey` 布尔不回显明文/密文)。

**视图三块** (`/?view=radar`, spec §3): ① 候选关键词审批条 (仅当存在 AI 学到的候选词时显示, 采纳/忽略) ② 热度排行 (卡片: 热度分 + 悬浮展开四维分项与共现加成 / 来源链接 `target=_blank` / AI 摘要与可做角度 / 命中关键词标签 / 「收入灵感库」「忽略」——两个动作都走幂等守卫, 非 `new` 状态的条目一律 409, 防双击产生孤儿数据) ③ 「立即扫描」按钮 + 上轮运行摘要一行 (扫 X 词/读 Y 篇/入库 Z 条/错误 N)。空态分两级: 未配置 Tavily key 或未启用 → 引导文案 + 「去设置」链接; 已配置但暂无条目 → 提示手动扫描或等待每日自动采集。

**「收入灵感库」复用既有事务**: `PATCH /api/v1/radar/items/[id] {action:'adopt'}` 直接调用 `cockpitInspiration.create` + `bumpCockpitRev(tx)` 同一事务 (与 `POST /api/v1/cockpit/inspirations` 同等逻辑), 并在同事务里把该 `RadarItem` 标记 `adopted` + 回写 `inspirationId`——零新增 cockpit 写路径。

**设置「雷达配置」卡** (`src/components/cockpit/settings-cards/radar-config-card.tsx`, 挂在设置视图): Tavily API Key (密码框, 留空 = 不修改, 已配置时显示掩码提示) / 每日阅读上限 / 启用开关 / 关键词管理 (已启用⇄已停用双向切换, 手动新增, 重复关键词 409 提示——AI 候选词的采纳/忽略在雷达视图页顶完成, 不在这张卡)。

**API**: `GET/PUT /api/v1/radar/config`、`GET/POST /api/v1/radar/keywords`、`PATCH /api/v1/radar/keywords/[id]`、`GET /api/v1/radar/items`、`PATCH /api/v1/radar/items/[id]`、`POST /api/v1/radar/trigger` (前置就绪检查: 未启用/无 Tavily key → 400；无可用 DeepSeek key (设置卡 `AIConfig` 与 `.env` 均未配置) → 503)、`GET /api/v1/radar/runs/latest` (雷达视图「上轮运行摘要」的数据源)。

**成本与真实验证**: DeepSeek 每篇几厘, Tavily 免费档每月 1000 次检索通常够用。管线核心 (纯函数热度合成/搜索层/阅读 prompt/API 路由) 全链路可 mock 测试 (见 `tests/lib/radar/` `tests/api/radar/`); worker 的每日 repeat 调度层未直测, 循 auto-sync-worker 先例 (人工验证)。真实跑一轮需用户在设置卡配置真实 Tavily key 后自验 (同 DeepSeek key 先例)。

### 抖音口播逐字稿 · 创作质量深化 (五期新增)

一句话: 抖音脚本生成从「一次性大纲」升级为「研究→写作」两阶段管线——雷达采纳选题摘要 + Tavily 联网搜索 + 抽屉素材框, 提炼成素材简报后再写出可直接对镜头念的完整逐字稿, 支持分块/整稿两级改稿, 定稿自动沉淀风格样本反哺下次生成。**本期仅抖音**(内容抽屉「脚本」tab 生成平台选「抖音」时可见; 其余平台仍是原有单次生成路径未变)。

管线 (`src/lib/script/research.ts` + `src/lib/script/style.ts`, 编排在 `src/app/api/v1/scripts/generate/route.ts` 的 douyin 分支):

```
阶段一 研究 runResearch()
  雷达来源选题(标题匹配已采纳的 RadarItem → aiSummary/aiAngle/url)
  + Tavily 搜索×2(主题原词 + "主题 案例 数据", 近 7 天, 同四期雷达口径)
  + 素材框文本(可选, 用户自己粘的资料)
  → 三路任一失败/未命中都静默跳过, 全空或无 DeepSeek key → 整体降级返回 null
    (前端提示"本篇未联网研究"), 不阻断写稿; 拼接超过 8000 字截断上限时,
    雷达种子与用户素材优先于 Tavily 搜索正文保留 (体积最大的搜索正文最先被截)
  → DeepSeek 提炼 3-6 条「素材简报」{fact, source(URL|"用户素材"), usage},
    存入 ScriptDraft.output.research 供改稿复用(不重新联网)

阶段二 写稿 SCRIPT_WRITE_DOUYIN
  输入 = 专家人设 + 风格上下文 + 素材简报 + 主题 + 时长目标(30/45/60s, 默认 45)
  输出 = script.sections[](role: hook/main/cta, startSec/endSec, 逐字口播 text, 3-6 块)
       + hooks×3 候选 + titles×3 + cover
```

**风格学习** (`getStyleContext`): `StyleSample(platform='douyin')` 样本数 <2 → 用 `StyleProfile.description` 一句话说明兜底; ≥2 → 切换为最近 3 篇样本 few-shot(说明仍附带)。定稿(`PUT /api/v1/scripts/[id]/picked`)成功后自动把该稿 sections 拼接沉淀为一条 `StyleSample`——同一草稿改稿后再次定稿会**覆盖更新**已有样本 content(而非新建或跳过), 保证样本始终是这篇稿子的最新文本, 用户裁决优先。

**两级改稿** (`POST /api/v1/scripts/[id]/refine`): `scope='section'` 只重写 `sectionIdx` 指定的一块, 服务端校验其余块 `text` 逐字未变, 越权改动 → 502 且不写库; `scope='all'` 重写全部 sections(titles/cover 不动)。两者都复用已存的素材简报, 不重新联网搜索。

**抽屉交互** (内容详情抽屉「脚本」tab, `src/components/cockpit/content-drawer.tsx`): 生成前可折叠「素材(可选)」文本域 + 时长下拉(30/45/60s); 生成后素材简报折叠区(要点+来源链接) + 逐字稿分块渲染(块头角色中文标签+秒段, 块内「换一版」+ 一句话指令输入) + 页顶「整体指令」+ hook 块 3 候选切换(沿用既有 picked 机制)。

**设置「风格档案」卡** (`src/components/cockpit/settings-cards/style-profile-card.tsx`): 上半编辑 `StyleProfile.description`(口吻/句式/口头禅/忌讳); 下半只读样本列表(平台 badge + 预览 + 创建时间), 单条可删, 不提供手动新增入口(样本只经由脚本定稿沉淀, 避免两条写入路径)。

**数据模型** (2 张新表, 零迁移): `StyleProfile`(userId 单行) / `StyleSample`(定稿沉淀, `platform` + `content` + `sourceScriptDraftId` 溯源, `@@index([userId, platform, createdAt])`); `ScriptDraft.output` Json 内新增 `research`/`script.sections[]` 两键, 旧稿没有这两键时抽屉按旧结构原样渲染。

**API**: `POST /api/v1/scripts/generate`(douyin 分支两阶段化, 请求体新增 `materials?`/`durationSec?`, 响应新增 `scriptDraftId`/`research`/`researchDegraded`/`sections`; 无 DeepSeek key → 500)、`POST /api/v1/scripts/[id]/refine`(无 DeepSeek key → 503——与 generate 路由同场景的 500 状态码不同, 两条路由各自独立裁决, 未回头统一口径)、`GET/PUT /api/v1/style/profile`、`GET /api/v1/style/samples`、`DELETE /api/v1/style/samples/[id]`。

**配置依赖(不新增配置项, 复用既有两张卡)**: DeepSeek key 走设置「AI 服务配置」卡(同全站其它 LLM 调用点), Tavily key 走设置「雷达配置」卡(同四期热点雷达)——两者任一缺失时研究阶段静默降级(不联网研究, 不影响写稿本身), 只有 DeepSeek key 缺失才会让整个生成/改稿请求失败。

**成本**: 单篇生成 2 次 Tavily 搜索 + 2 次 DeepSeek 调用(研究提炼 + 写稿), 几分钱级; 每次改稿 1 次 DeepSeek 调用。

**真实验证**: 收尾任务用已配置的真实 DeepSeek + Tavily key 跑通全链路(雷达已采纳选题作种子生成一篇、素材框生成一篇、对其做一次分块改稿+一次整稿改稿、定稿沉淀样本后再生成第三篇确认样本数 ≥2 时切换 few-shot), 过程中发现并修复了一处真实 bug(素材过长截断会把用户素材框内容整段丢弃, 见上文「雷达种子与用户素材优先于搜索正文保留」), 详见 `.superpowers/sdd/2026-08-13-script-quality/task-8-report.md`。

### `/accounts` `/agent/discover` `/content/*` — 挂入 Cockpit 外壳

根布局 (`src/components/layout/main-layout.tsx`) 按路径判断: 非 `/` 时用 `ExternalShell` (`src/components/cockpit/external-shell.tsx`) 包一层, 复用同一个 `Sidebar`(`mode="external"`) + `.main-area` 容器 + 移动端 `.mobile-nav`, 主题/风格从 cockpit 写入的 localStorage 同步。 二期起 `ExternalShell` 仅剩 `/accounts`、`/agent/discover`(及其未挂导航的兄弟页 `inspiration`/`patterns`)、`/content/preflight|script|retro-sync` 使用 (`/agent` `/dashboard` `/settings` 三个壳页已删除)。 这些存留页面二期 (T7) 已做纸质风重塑 (样式层改动, 业务逻辑零改动)。

### 新功能位置表 (二期融合 + 三期重组后)

| 功能 | 一期挂壳位置 (已删除) | 当前位置 (三期) |
|---|---|---|
| AI 写稿 | `/agent` 向导页 | 内容抽屉「脚本」tab 就地生成按钮 (三平台下拉选择器 + 生成中态; 标题字段失焦 1.5s 防抖调用 `title-feedback` 展示一行建议); 抖音平台五期升级为两阶段研究+写稿, 见 §3「抖音口播逐字稿」小节 |
| 灵感抓取/热点 | `/agent` 首页推荐行「+ 入选题池」 | `/agent/discover` (保留路由) 每条主题卡「存入灵感池」→ 写 `CockpitInspiration`, 灵感库选题视图右上角「抓灵感 →」跳回该页 |
| 数据看板 (预测准确率/校准/Misses/Niche/Top) | `/dashboard` | 预测准确率·校准矩阵·Misses → 内容数据分析·复盘 tab「预测与校准」区块; Niche·Top → 内容数据分析·目标 tab「内容表现」区块 (二期时这两个 tab 曾是独立的复盘实验室/大目标视图, 三期合并进「内容数据分析」一个视图, 见 §3 Sidebar) |
| AI key 配置 | `/settings` | cockpit 设置视图「AI Provider」卡 |
| 账号基准播放数 (baseline) | `/settings/baseline` | cockpit 设置视图「Baseline」卡 |
| 手动同步 | `/settings` 或账号页内触发 | 内容数据分析·目标 tab「账号粉丝趋势」状态条「立即同步」按钮 (`POST /api/v1/douyin/auto-sync/trigger`) |
| 账号绑定/管理 (深流程) | 侧栏常驻「账号」入口 | **保留** `/accounts` 页面本身, 但侧栏入口移除, 改为双入口: 内容数据分析·目标 tab 状态条「管理账号 →」链接 + 设置视图账号管理卡 + 站外页面 (`/accounts` 等) 移动端底部导航「账号」格 |
| 深度写稿 (完整多区块生成, 非抽屉内快速生成) | `/agent` | `/content/script/new`(保留, `ScriptForm`/`ScriptResult` 组件未删除, 仍支持 `?topic=&ideaId=&platform=&niche=&inspirationId=` 预填) |

### redirect 表 (`next.config.js`)

| 旧 URL | 目的地 | 说明 |
|---|---|---|
| `/agent` | `/?view=pipeline` | 307, 精确匹配, `/agent/discover` 等子路径不受影响 |
| `/dashboard` | `/?view=review` | 307 (目的地查询值经三期兼容映射折叠进 analytics 视图 review tab, 见下方说明) |
| `/settings` | `/?view=settings` | 307 (二期实施中从最初的 `/` 升级为直达 settings 视图, 见 spec 实际实施结论) |
| `/settings/baseline` | `/?view=settings` | 307, 同上 |

保留可直接访问的路由 (不 redirect): `/agent/discover`、`/agent/inspiration`、`/agent/patterns`、`/accounts`、`/content/script`、`/content/script/new`(深度写稿入口)、`/content/script/[id]`、`/content/preflight`、`/content/retro-sync`。

**三期 (产出优先信息架构重组) 起旧 `?view=` 兼容映射**: 二期六视图里的 `schedule`/`goals`/`review` 三个旧 view 值 (redirect 表目的地里仍会出现) 在三期后不再是独立视图, 由 `src/lib/cockpit/view-routing.ts` (`resolveInitialView`/`resolveInitialMomentumTab`/`resolveInitialAnalyticsTab`, 单测 `tests/lib/cockpit/view-routing.test.ts`) 精确折叠到新视图的对应 tab；其余三值原生直达。 六值映射矩阵:

| 旧 `?view=` 值 | 三期落点 |
|---|---|
| `inspirations` | 灵感库选题 (原生直达, 未变) |
| `momentum` | 今日推进 · 今日 tab (原生直达, 默认 tab) |
| `schedule` | 今日推进 · 档期 tab (折叠) |
| `pipeline` | 内容总览 (原生直达, 未变) |
| `goals` | 内容数据分析 · 目标 tab (折叠) |
| `review` | 内容数据分析 · 复盘 tab (折叠) |

`settings` 及五个 `platform-*` 值本就是三期新增/未变的原生视图 id, 同样直达; 其余非法/缺省值一律回退 momentum(今日 tab)。

### `/content` 的变化

- 列表页 (`src/app/content/page.tsx`) 已删除, 由 Cockpit **Pipeline** 视图 (`/?view=pipeline`) 取代。
- 子路由保留: `/content/preflight`(视频分析 Phase 1/L1)、`/content/script`(AI 脚本生成详情页, 含分发登记; `/content/script/new` 为深度写稿入口)、`/content/retro-sync`(半自动复盘) —— 未挂进侧栏导航, 但仍是抽屉/inspiration/patterns 页跳转深度写稿、发布登记、复盘流程内部跳转的落点, 照常可直接访问。

### Cockpit 数据层

- **10 张 Prisma 表**: `CockpitContent` / `CockpitInspiration` / `CockpitStageEvent` / `CockpitReviewDay` / `CockpitLiveSession` / `CockpitScheduleObjectType` / `CockpitScheduleObject` / `CockpitGoalCycle` / `CockpitInsightRule` / `CockpitPrefs`, 字段形状与 vendor `model.ts` 的 TS 类型一一对应, 保证移植过来的纯函数直接可用。 `FollowerSnapshot` **不建表**: `GET /api/v1/cockpit/workspace` 时从既有的 `AccountMetric` (爬虫每日写入) 实时派生, `PUT` 忽略该字段。
- `GET/PUT /api/v1/cockpit/workspace`: GET 组装整个 `WorkspaceState` 返回; PUT 提交整个 `WorkspaceState` + 加载时拿到的 `rev`, 服务端 diff 落库, 若 `rev` 与当前不一致 (双标签页并发保存) 返回 **409**, 前端弹冲突提示, 不做自动合并 (单用户场景接受 last-write-wins + 显式提示, 不做 CRDT 之类的方案)。
- 前端存储适配器 `src/lib/cockpit/storage.ts` (`loadWorkspace`/`saveWorkspace`) 替换掉原版的 IndexedDB 读写, 是移植时唯一改动的一层; `src/lib/cockpit/migrations.ts` 只搬运了 vendor `storage.ts` 里 `migrateWorkspace` 这一个纯函数 (老版本 workspace 字段升级), 其余 IndexedDB 相关代码没有移植。
- 强能力集成点: **AI 写稿** (二期起内容抽屉脚本 tab「用 AI 写脚本」按钮就地调用生成管线并回填, 不再跳转 `/agent`; 保存定稿自动把关联 `CockpitContent` 的 script 阶段推进完成; 三期起生成默认平台跟随内容 `platform` 字段, 而非固定抖音) · **爬虫指标回填** (auto-sync 命中已发视频写入播放/点赞/收藏/评论快照) · **粉丝快照** (`AccountMetric` 派生 `FollowerSnapshot` 喂 `calculateGoalHealth`) · **L1 预测对比** (内容数据分析·复盘 tab 展示预测区间 vs 实际播放, 结论可沉淀为 `InsightRule`)。
- 备份/导入导出 UI 未移植 —— 数据库本身就是持久化底座, 版本记录 (`版本记录` 弹窗) 里仍保留历史版本可查看/导出, 但没有单独的「导入导出 JSON」界面 (原版基于 IndexedDB 需要这个, 我们不需要)。

存量数据一次性迁移到 Cockpit 表见 §6; 老流水线 (`ScriptDraft`/`TopicIdea`/`Distribution`) 的阶段派生规则见 §3.5, 迁移脚本复用同一套判定。

### `vendor/creator-cockpit/`

移植源码的只读参考副本, 固定在 commit `197d49b93ff42d80211c1d832d1f8fa8db7c6660` ([AverrryHu/creator-cockpit](https://github.com/AverrryHu/creator-cockpit), MIT License, Copyright (c) 2026 Avery)。 `tsconfig.json` 显式 `exclude` 了 `vendor`, 不参与构建也不会被任何 `src/` 代码 `import` —— 纯粹留作逐行对照 (排查移植差异、日后想再搬一部分东西时的对照源), 不需要跟随其上游更新。

### 3.5 数据模型: 管线阶段派生 (支撑 `/content` 子路由与迁移脚本)

`ScriptDraft` 是老流水线的基本单元 (曾经是已删除的工作台看板的数据源, 现在是 `/content/script` 详情页和一次性迁移脚本的数据源)。 **阶段不落库, 按现有数据实时派生**, 判定唯一入口是纯函数 `deriveStage` (`src/lib/pipeline/stage.ts`), UI / API / 迁移脚本都调用它, 不内联复制规则, 避免双写不一致:

| 阶段 | 判定规则 |
|---|---|
| 📝 草稿 (`DRAFTING`) | `picked == null` |
| ✅ 定稿待拍 (`READY`) | `picked != null` 且无关联 `analysis` |
| 🎬 已拍待发 (`SHOT`) | 有关联 `analysis`, 且未发布 |
| 🚀 已发布 (`PUBLISHED`) | `analysis.publishedAt != null` **或** 存在任一 `Distribution` 记录 |
| 📊 已复盘 (`RETROED`) | `analysis.retroStatus === 'COMPLETED'` |

缺失数据 (analysis 被删导致悬空) 一律降级到更早阶段, 不抛错。 归档 (`ScriptDraft.archivedAt` 非空) 的卡不进看板。 没链接 `ScriptDraft` 的孤儿 `ContentAnalysis` (老数据, 直接上传视频分析) 也进看板, 从「已拍待发」起算。

新增 Prisma 模型:

- **`TopicIdea`** (选题池): `title` / `note` / `source` (`discover` | `inspiration` | `manual`) / `status` (`POOL` | `ADOPTED` | `DISCARDED`) / `scriptDraftId` (采纳后回链)。
- **`Distribution`** (分发登记): `scriptDraftId` + `platform` (代码注册表 key, 非 DB enum, 见 `src/lib/pipeline/platforms.ts`) + `url` + `publishedAt` + `note`。 抖音主阵地发布仍走 `ContentAnalysis.publishedAt` (喂 L1 预测 / retro 管线); `Distribution` 管其他平台的搬运登记, 未走视频分析直接发布的内容也可用 `platform='douyin'` 的 `Distribution` 兜底登记 (不参与 retro)。
- **`ScriptDraft.archivedAt`** (`DateTime?`): 放弃的内容标记归档, 不删数据。 字段与 `PATCH /api/v1/scripts/[id] { archived }` 路由仍在, 但触发它的「归档」按钮曾挂在已删除的旧工作台看板卡片上 —— 目前没有 UI 入口调用, 相当于遗留能力, 未来若做类似操作可直接复用这条路由。

分发平台注册表 (`src/lib/pipeline/platforms.ts`, 加新平台 = 加一行, 不改 DB schema): 抖音 / B站 / YouTube / X-推特 / 小红书 / 公众号 / 快手 / 微博 (共 8 个)。 与 `src/lib/platform.ts` 的采集端 `Platform` enum、创作端 `ContentPlatform` 是两套独立命名空间 —— 这里管"内容搬运到了哪"。

API: `POST/GET /api/v1/topics`、`PATCH /api/v1/topics/[id]`、`POST/GET /api/v1/scripts/[id]/distributions`、`DELETE /api/v1/distributions/[id]`。 (旧工作台看板专用的 `GET /api/v1/workbench` 聚合接口已随看板一起删除。)

### 关键交互流

1. **灵感抓取**: `/agent/discover` 页每条主题卡「存入灵感池」按钮 (`POST /api/v1/cockpit/inspirations`), 直接写入 Cockpit 灵感墙 (`CockpitInspiration`); Cockpit 灵感库选题视图 (三期改名, 原「灵感池」) 右上角「抓灵感 →」跳回该页。 二期起这是灵感进入系统的唯一活跃路径——`TopicIdea`(选题池) 表与配套的 `PoolButton`/`ideaId` 预填链路是 `/agent` 首页 (已随壳页一起删除) 的产物, 现无任何 UI 入口可达, 属遗留能力 (`PoolButton` 组件、`ScriptForm` 对 `ideaId` query param 的兼容读取、`script-result.tsx` 里 `ideaId` 存在时的 `ADOPTED` 回写均原样保留代码, 只是没有链接会带上 `ideaId` 了); `POST/GET /api/v1/topics` 等 API 仍在但无写入方。
2. **分发登记**: script 详情页 (`/content/script/[id]`) + 分发登记弹窗, 选平台 (注册表 key) + 贴 URL → 写一条 `Distribution` 记录, 显示「已分发 N 平台」徽标。
3. **复盘闭环**: 现有 retro / auto-sync 不动; Cockpit 内容数据分析·复盘 tab (三期起, 原「复盘实验室」独立视图) 承接「待复盘 / 复盘倒计时」的展示职责 (原来在旧看板已发布列)。

---

## 4. Roadmap — 分阶段实施 (Phase A-C 已完成)

不一次性 5 天大重构,分小步走,每步可发布。 **这是第一次 pivot (小白向导) 时定的 roadmap; Phase A-C 已完成, D 未做, E 仍是未来事项。** 工作台重定位 (第二次 pivot) 是独立的后续 spec, 见 `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md`, 其自身的 12 个 Task 均已完成 (数据层 → 工作台首页 → 交互流 → 本文档)。 Creator Cockpit 整体移植 (第三次 pivot, 见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`) 又是独立的后续 spec, 14 个 Task 均已完成 —— 替换了第二次 pivot 引入的工作台首页/看板/侧栏。 **平台页面融入驾驶舱 (二期, 见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`) 8 个 Task 均已完成** —— 把一期挂壳的 `/agent`/`/dashboard`/`/settings` 三页功能长进驾驶舱六视图, 侧栏「平台」组解散 (§3 为当前实际 IA)。 Phase A-C 的产物 (脚本多平台生成、`/content` 子路由) 保留不受影响。

### ✅ **Phase A: Script 多平台化** — 已完成

1. ✅ ScriptDraft 加 `platform` 列 (`'douyin' | 'xiaohongshu' | 'gongzhonghao'`)
2. ✅ 拆分 prompts: `script-generate-douyin.ts` / `script-generate-xiaohongshu.ts` / `script-generate-gongzhonghao.ts`
3. ✅ POST `/api/v1/scripts/generate` 加 `platform` 参数 → 路由到对应 prompt
4. ✅ UI ScriptForm 加 Step 1 platform 选择器
5. ✅ UI ScriptResult 按 platform 渲染不同 schema
6. ✅ 单测覆盖每平台 prompt schema

### ✅ **Phase B: IA 重组** — 已完成 (后续被工作台重定位进一步扩展为 6 项 sidebar, 见 §3)

1. ✅ `/agent` 顶级路由
2. ✅ Sidebar nav 简化
3. ✅ 底部 CTA 改 "+ 新内容" → `/agent`
4. ✅ `/content` 合并 scripts + analyses (统一列表 + 类型 badge)
5. ✅ 老入口仍可访问 (向后兼容)

### ✅ **Phase C: M 多平台化** — 已完成

`POST /api/v1/checklist/title-feedback` 已支持 `platform` 参数, 不同平台走不同"好标题"评价标准。

### ⬜ **Phase D: J 改造为多平台 publish checklist**（可选, 未做）

`src/lib/checklist/types.ts` 目前仍是单一 (视频专属) checklist schema, 未按平台 (抖音/小红书/公众号) 拆分发布前检查项。

### ⬜ **Phase E: SaaS 准备**（未来, 未做）

- NextAuth 登录
- 数据 userId 隔离 (DB schema 已经有 userId, 但中间件需要严格 user scope)
- Stripe 计费
- API quota / rate limit

**这阶段不在当前 sprint 范围。**

---

## 5. 技术债 & Known Issues

### Schema / Data

- `User.baselinePlays` (L1) — 视频专属概念, 新场景下 score multiplier 失去意义。 留着不动。
- `ContentAnalysis.publishChecklist` (J) — 视频专属。
- 新增 `ScriptDraft.platform` 后,现有数据是抖音,需 migration 设默认值。

### Code 重复

- `match-douyin` POST route + `runAutoSync` 中 "写 douyinAwemeId + enqueue retro" 逻辑重复 (~ 25 行)。 抽 helper 留 future。
- 多个 prompt 文件用同一 `getExpertPersona(niche)` + `JSON_STRICTNESS` 头尾, 但每个文件自己拼。 可以抽 `composeSystemPrompt(niche, taskDescription)` helper。

### LLM 配置

- 视频管线 vision LLM 是 Bailian Qwen-VL,文本 LLM 是 DeepSeek。
- DeepSeek key: 优先读设置「AI 服务配置」卡里的 `AIConfig` 记录 (`provider='deepseek'`, AES-256-GCM 加密存储), 查不到或解密失败时回退 `.env` 里的 `DEEPSEEK_API_KEY` (`src/lib/llm/resolve-key.ts` 的 `resolveDeepSeekApiKey`, 所有消费点——脚本生成/选题生成/灵感总结/标题反馈/热点雷达/内容分析复盘——统一走它)。
- vision LLM (OpenAI/Bailian) key 仍只在 `.env` (OPENAI_API_KEY, OPENAI_BASE_URL 等), 未纳入本次桥接范围。

### 测试覆盖

- 877 tests 大多是 API 单测 + 纯函数 + mock prisma (含 Cockpit `model/workflow/schedule/calculations`/迁移映射的原版测试; 四期新增雷达搜索层/热度合成/阅读 prompt/API 路由测试; 五期新增研究层/风格层/两阶段生成/两级改稿/风格档案 API 的 mock 测试)
- UI 一律走手动 E2E (是有意识的取舍); 五期收尾用真实 DeepSeek+Tavily key 额外跑了一轮全链路真实 E2E (非 mock), 见 `.superpowers/sdd/2026-08-13-script-quality/task-8-report.md`
- Worker 集成测试缺 (auto-sync-worker, content-analyze-worker, radar-worker 的每日 repeat 调度层)

---

## 6. 本地开发

### 基础启动

```bash
# 1. 配置 .env (从 .env.example 复制 + 填 DEEPSEEK_API_KEY 等)
cp .env.example .env

# 2. 启 Postgres + Redis
docker compose up -d postgres redis

# 3. 同步 schema (无 migrations, 用 prisma db push)
npx prisma db push

# 4. 安装依赖
npm install

# 5. 跑 dev + worker (各开一个 terminal)
npm run dev          # http://localhost:3000
npm run worker:dev   # BullMQ workers (analyze / retro / auto-sync / radar 四期新增)
```

雷达功能额外需要: Tavily API key (在设置视图「雷达配置」卡里填, 见 §3「热点雷达」小节; 去 [tavily.com](https://tavily.com) 免费注册即得, 免费档每月 1000 次检索通常够用) + 一个可用的 DeepSeek key (阅读评分复用「AI 服务配置」卡——优先读该卡里配置的 key, 未配置时回退 `.env` 里的 `DEEPSEEK_API_KEY`)。 两者任一缺失时「立即扫描」会明确报错 (未配置 Tavily/未启用 → 400；无可用 DeepSeek key → 503), 每日自动扫描会静默跳过该轮 (不报错, 见 `runRadarScan` 注释)。

抖音口播逐字稿 (五期, 见 §3「抖音口播逐字稿」小节) 不新增配置项, 直接复用上面两张卡的 key: 研究阶段的 Tavily 搜索缺 key 时静默降级 (跳过联网研究, 不报错); DeepSeek key 缺失会让生成/改稿请求直接失败 (`/scripts/generate` 500, `/scripts/[id]/refine` 503)。

### 测试

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest, 877 tests across 88 files (含 Cockpit 纯逻辑层原版测试)
npm test -- <filter> # 跑某个 file
```

### Schema 改动

```bash
# 改完 prisma/schema.prisma 后
npx prisma db push   # 同步 + regenerate client
# (项目用 db push 而不是 migrations, dev 简单)
```

### 重启 dev / worker (改 schema 后必须)

dev server 和 worker 都缓存 prisma client。 schema 改后必须重启它们才能用新字段。

### 存量数据迁移到 Cockpit (一次性)

```bash
npx tsx scripts/migrate-cockpit.ts          # dry-run (默认): 只打印映射清单+汇总, 不写库
npx tsx scripts/migrate-cockpit.ts --apply  # 人工确认 dry-run 输出无误后再写库
```

把老表 (`ScriptDraft`/`ContentAnalysis`/`ActualMetric`/`TopicIdea`/`InspirationVideo`) 一次性映射进
`CockpitContent`/`CockpitStageEvent`/`CockpitInspiration`。阶段判定复用 `deriveStage`
(`src/lib/pipeline/stage.ts`)，纯映射函数见 `src/lib/cockpit/migrate-mapping.ts`。`--apply` 会先检查
目标用户名下 `CockpitContent` 是否已有数据，非空直接中止（防重复迁移）；旧表全程只读，不删不改。
`publishedAt`/`metrics.capturedAt` 这两个"日期部分"字段按 `Asia/Shanghai` (UTC+8) 取年月日
(`dateISOInShanghai`)，与运行时写入方约定一致，避免 UTC 午夜前后跑迁移脚本时日期错位一天。
**必须先在 `/` 完成一次 onboarding（`CockpitPrefs.setupComplete=true`）再执行 `--apply`**——迁移脚本
不经过全量保存的 compare-and-set，若 onboarding 未完成就先写库，页面之后触发的第一次自动保存会用
"空白开始"的全量状态把刚迁移进去的数据整个覆盖清空；`--apply` 会检测该顺序并主动中止。

---

## 7. 目录结构 (重要文件)

```
src/
├── app/
│   ├── page.tsx                  # `/` — 只 dynamic import Cockpit.tsx (ssr:false)
│   ├── cockpit.css                # 全站纸质编辑部风格 (主题变量 + 5 套 design style + mobile-nav)
│   ├── layout.tsx                 # 根布局, 套 MainLayout
│   ├── agent/                     # 二期起仅剩 discover/ inspiration/ patterns 三个子页面, 挂 ExternalShell (`/agent` 本体已删, redirect → `/?view=pipeline`)
│   ├── content/
│   │   ├── preflight/             # 视频分析 (Phase 1, L1) — 列表页已删, 子路由保留
│   │   ├── script/                # 脚本生成详情页 (E) + 分发登记, `script/new` 为深度写稿入口
│   │   └── retro-sync/            # 抖音半自动复盘 (C)
│   ├── accounts/                  # 账号绑定, 挂 ExternalShell (双入口之一)
│   └── api/v1/                    # 所有 API routes (含 topics/ distributions/ cockpit/workspace/ cockpit/inspirations/ douyin/auto-sync/trigger/ radar/{items,keywords,config,trigger,runs/latest}/ scripts/generate(五期 douyin 两阶段化)/ scripts/[id]/refine(五期新增)/ style/{profile,samples}(五期新增))
├── components/
│   ├── cockpit/                   # Creator Cockpit 移植主体
│   │   ├── Cockpit.tsx             # 顶层组件: state + view 路由 (`NavView`, 三期起见 `lib/cockpit/view-routing.ts`) + 主题/onboarding (侧栏拖拽排序三期已移除)
│   │   ├── views/                 # inspirations/radar(四期新增, 自取数)/momentum(含 schedule tab)/platform(五平台流水线页共用)/pipeline/analytics(含 goals+review tab) + settings.tsx (独立视图)
│   │   ├── analytics/              # 二期 (T4) 从 components/dashboard/ 迁移重塑: prediction-panel/performance-panel + 7 个搬迁 widget + use-dashboard-summary hook
│   │   ├── settings-cards/         # ai-provider-card, baseline-card (二期 T5) + radar-config-card (四期 T6) + style-profile-card (五期新增)
│   │   ├── sidebar.tsx             # 全站共用侧栏 (cockpit 模式 + external 模式), 二期起「平台」外链组已移除, 四期新增「热点雷达」项
│   │   ├── external-shell.tsx      # 站外页面外壳 (侧栏 + mobile-nav + 主题同步), 仅剩 /accounts /agent/discover /content/* 使用
│   │   ├── content-drawer.tsx      # 内容详情抽屉, 二期 (T2) 脚本 tab 加入就地 AI 生成 + 标题实时建议; 五期新增素材框/时长/简报折叠区/分块渲染/换一版/整体指令
│   │   ├── onboarding.tsx / shared.tsx
│   ├── content/                   # script-form, script-result (深度写稿入口用), publish-checklist, prediction-card, 分发登记弹窗 etc
│   └── layout/                    # main-layout.tsx (按路径决定是否套 ExternalShell)
├── lib/
│   ├── cockpit/                   # model/workflow/schedule/calculations (纯函数, 零改动移植) + storage.ts(API 适配器) + migrations.ts(migrateWorkspace) + migrate-mapping.ts(存量数据映射) + script-mapping.ts(二期 T1: 生成结果→脚本骨架映射纯函数, 五期扩展 sections→body/hook 映射) + extras.ts/extras-types.ts(复盘/大目标额外数据, 含二期新增 account/settings) + view-routing.ts(`NavView` 定义, 四期新增 `radar`)
│   ├── radar/                     # 四期新增: search.ts(SearchProvider 抽象 + Tavily 实现) / config.ts(RadarConfig 读写+加解密) / scoring.ts(titleFingerprint/clusterByTopic/composeHeat/applyTimeDecay 纯函数) / run.ts(runRadarScan 管线主体)
│   ├── script/                    # 五期新增: research.ts(runResearch 两阶段生成的阶段一, 雷达种子+Tavily+素材框合并→DeepSeek 提炼简报) / style.ts(getStyleContext 风格上下文切换 + depositStyleSample 定稿沉淀)
│   ├── llm/                       # DeepSeekTextLLM + OpenAIVisionLLM + prompts/ (四期新增 radar-read.ts; 五期新增 research-brief.ts / script-write-douyin.ts / script-refine.ts)
│   ├── pipeline/                  # deriveStage 纯函数 + platforms.ts 分发平台注册表
│   ├── prediction/                # L1 formula + baseline
│   ├── dashboard/                 # aggregate + calibration + prediction-accuracy (聚合逻辑零改动, 仍是 cockpit/analytics 面板与 `/api/v1/dashboard/summary` 的数据源)
│   ├── settings/                  # 二期 (T5) 新建: baseline-stats.ts (computeRetroStats 纯函数, 从旧 baseline 页抽出)
│   ├── douyin/                    # cheat-on-content adapter + fuzzy + auto-sync
│   ├── checklist/                 # J types + isReady
│   └── prisma.ts
├── jobs/
│   ├── queue.ts                   # 6 BullMQ queues (四期新增 radar)
│   └── workers/                   # 5 workers (bind, analyze, retro, auto-sync, radar 四期新增)
scripts/
└── migrate-cockpit.ts             # 存量数据 → Cockpit 表, dry-run 默认 / --apply 写库
prisma/
└── schema.prisma                  # User / ContentAnalysis / ActualMetric / ScriptDraft / TopicIdea / Distribution / Cockpit* (10 张) / Radar*(4 张, 四期新增) / StyleProfile / StyleSample (五期新增) 等
vendor/
└── creator-cockpit/                # 移植源固定副本 (pinned 197d49b, MIT), tsconfig 排除, 不参与构建, 只读参考
docs/superpowers/
├── specs/                         # 每个 sub-project 的 design spec
└── plans/                         # 每个 sub-project 的 task plan
```

---

## 8. 决策记录 (重要选择)

| 决策 | 理由 |
|---|---|
| Single-user (default-user) | 一开始就要 SaaS 是 over-build; 验证产品后再加 auth |
| Prisma `db push` (无 migrations) | dev 速度优先, 一次性单用户产品, migrations 复杂收益低 |
| BullMQ over Trigger.dev / Inngest | 自管 Redis 单机够用, 无云依赖 |
| LLM: DeepSeek (text) + Qwen-VL (vision) + Whisper (local Python) | 中文友好 + 成本低; 测过 kedaya 代理 503 / OpenAI 直接调 模型不可达后选定 |
| Stateless generate + opt-in save | 避免数据库膨胀;用户决定是否记下 |
| 不做 native auto-publish | 平台 API 限制重 + 法律风险; 改成 copy-paste UX / 分发登记 UX |
| Stitch 风格 (蓝紫渐变) | 用户自己拿 AI 设计稿确认的, 不是我猜 |
| 管线阶段不落库, 按数据派生 (`deriveStage`) | 避免状态与真实数据 (picked/analysis/distribution) 双写不一致 |
| 分发平台用代码注册表非 DB enum | 加平台 = 加一行代码, 不用改 schema / migration |
| 工作台看板不做拖拽 (历史决策, 该看板已被 Cockpit Pipeline 视图取代) | 状态由真实动作驱动 (选版本/传视频/登记链接), 拖拽会制造假状态 |
| Creator Cockpit 整体移植 (UI + 交互逻辑复制) 而非照抄视觉重新实现 | 用户认可其纸质编辑部风格与操作台交互逻辑; 移植省去重新设计+踩坑成本, 用 Prisma 换掉 IndexedDB 接入已有数据库 |
| Cockpit 纯逻辑层零改动复制, 只换存储层 | `model/workflow/schedule/calculations.ts` 是「输入 state → 输出新 state」纯函数, 与存储解耦, 换存储不动逻辑风险最低 |
| FollowerSnapshot 不建表, GET 时从 AccountMetric 派生 | 爬虫已经每日写 AccountMetric, 建独立表是重复数据, 派生更简单且不会不同步 |
| 不搬 IndexedDB 备份/导入导出 UI | 数据库本身就是持久化底座, 这套 UI 是原版应对"无后端"环境的权宜设计, 我们不需要 |
| 二期: 侧栏「平台」组解散, 功能长进驾驶舱视图而非留作独立挂壳页 | 消除双产品观感与页面跳转; `/agent`/`/dashboard`/`/settings` 挂壳页退役, 逻辑/数据源保留 (零后端改动) |
| 二期: 账号入口做双入口 (大目标状态条 + 设置视图 + 移动端导航) 而非单一入口 | 吸取一期教训 (侧栏入口消失曾导致功能不可达), 拆掉常驻侧栏项前必须确保至少两条可达路径 |
| 二期: `/content/script/new` (ScriptForm/ScriptResult) 保留为独立深度写稿入口, 不随 `/agent` 一起退役 | 抽屉内就地生成偏「快速起草」, 深度写稿页仍是唯一支持 `?ideaId=` 遗留链路兼容与完整多区块编辑的入口 |
| 二期: `/api/v1/dashboard/summary` 端点保留未退役 (偏离 spec 原计划) | 迁移进复盘实验室/大目标的 widget 面板仍靠它取数, 实施时判断"仅剩 dashboard 使用则退役"的前提不成立 |

---

## 9. 下一步

Phase A-C、工作台重定位 (Task 1-12)、Creator Cockpit 整体移植 (Task 1-14) 与平台页面融入驾驶舱 (二期, Task 1-8) 均已完成。 尚未做的:

1. **Phase D** — checklist 按平台拆分发布前检查项 (`src/lib/checklist/types.ts` 目前仍单一 schema)
2. **Phase E / SaaS 准备** — NextAuth 登录 + userId 中间件严格 scope + 计费, 本期范围外
3. **本地真用一段时间** — 用 default-user 走完整 Cockpit 闭环 (灵感→转内容→档期拖拽→今日勾选→阶段推进→发布登记→复盘录入), 找实际使用中的痛点
4. **人工走查一期 Task 14 未自动化验证项** — onboarding 冷启动、拖拽排期、双标签页 409 提示、明暗/5 风格切换、375px 移动端视觉 (见 `.superpowers/sdd/2026-08-04-cockpit-adoption/task-14-report.md`)
5. **人工走查二期 Task 8 未自动化验证项** — 抽屉三平台生成回填真机走查、discover 存灵感→灵感池 409 横幅、复盘/大目标新区块数据对照、立即同步真实入队观察、设置卡三项功能等价、明暗模式残留检查 (见 `.superpowers/sdd/2026-08-05-platform-pages-fusion/task-8-report.md` 待人工走查清单)
6. **遗留清理候选** — `PoolButton` 组件与 `TopicIdea`/`ideaId` 选题池链路现无任何 UI 入口 (二期起灵感只走 `CockpitInspiration`), 未来若确认不再需要可整体移除; cockpit 设置视图「账号管理」静态链接卡未单独拆文件 (内联在 `settings.tsx`), 后续扩展时再拆

---

## 附录: Sub-projects 详细 spec / plan 索引

- `docs/superpowers/specs/2026-06-12-content-preflight-design.md` (Phase 1 A v1)
- `docs/superpowers/specs/2026-06-12-content-preflight-v2-design.md` (Phase 1 A v2 retro)
- `docs/superpowers/specs/2026-06-14-dashboard-design.md` (Phase 3 B)
- `docs/superpowers/specs/2026-06-15-l1-prediction-design.md` (L1)
- `docs/superpowers/specs/2026-06-15-baseline-settings-design.md` (A)
- `docs/superpowers/specs/2026-06-15-prediction-accuracy-design.md` (B widget)
- `docs/superpowers/specs/2026-06-16-retro-sync-design.md` (C)
- `docs/superpowers/specs/2026-06-16-auto-sync-design.md` (D)
- `docs/superpowers/specs/2026-06-17-script-generate-design.md` (E)
- `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md` (工作台重定位, 第二次 pivot, Task 1-12)
- `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md` (Creator Cockpit 整体移植, 第三次 pivot, Task 1-14)
- `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md` (平台页面融入驾驶舱, 二期, Task 1-8)
(Plan files in `docs/superpowers/plans/` 对应每个 spec)
