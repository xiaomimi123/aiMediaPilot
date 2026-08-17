# MediaPilot

> AI 自媒体工作台 — 自用创作闭环: 选题灵感 → 写稿改稿 → 拍摄/发布追踪 → 数据复盘。 主阵地抖音, 其他平台 (B站/YouTube/推特/小红书/公众号/快手/微博) 走分发登记。 设计预留 SaaS 扩展空间 (`userId` 隔离已在 schema, 未接 auth/计费)。

**当前状态:** 单用户 MVP。 经历三次定位调整: "个人视频分析工具" → "小白向导式智能体" → "自用自媒体工作台" → **"Creator Cockpit 整体移植"** (2026-08-04, 详见 `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`)。 首页 `/` 与全站外壳已换成移植自开源项目 [creator-cockpit](https://github.com/AverrryHu/creator-cockpit) 的纸质编辑部风格操作台; 紧接着完成**二期「平台页面融入驾驶舱」** (2026-08-05, 详见 `docs/superpowers/specs/2026-08-05-platform-pages-fusion-design.md`)——把一期挂壳的创作/数据/设置页面功能长进驾驶舱视图, 侧栏「平台」组解散; 再完成**三期「产出优先信息架构重组」** (2026-08-06, 详见 `docs/superpowers/specs/2026-08-06-platform-first-ia-design.md`)——侧栏从「流程优先」六视图重排为「产出优先」按平台组织; 又完成**四期「AI 深度采集 · 热点雷达」** (2026-08-13, 详见 `docs/superpowers/specs/2026-08-13-radar-deep-collection-design.md`)——新增服务端热点雷达管线 (关键词 → Tavily 搜索 → AI 逐篇阅读评分 → 热度排行), 独立「热点雷达」侧栏视图 + 设置「雷达配置」卡, 零 Claude 额度消耗 (阅读评分走用户自己的 AI provider); 又完成**五期「创作质量深化」** (2026-08-13, 详见 `docs/superpowers/specs/2026-08-13-script-quality-design.md`)——抖音脚本生成从单次大 prompt 升级为「研究→写作」两阶段管线, 产出可直接口播的完整逐字稿 (`script.sections[]`), 叠加 Tavily 联网研究打底 + 抽屉素材框, 定稿自动沉淀为风格样本供后续生成 few-shot 参照, 新增分块/整稿两级改稿; 又完成**六期「抽屉改稿闭环 + 小红书两阶段接入」** (2026-08-14, 详见 `docs/superpowers/specs/2026-08-14-drawer-closure-xhs-design.md`)——补齐五期两个已知限制 (抽屉关闭后改稿 UI 不可恢复、定稿自动推进阶段失效), 同时把小红书从旧单阶段生成升级为与抖音同款的「研究→写作」两阶段管线, 抽屉新增小红书素材简报/正文渲染 + 整稿指令框; 又完成**七期「小红书 AI 配图生成」** (2026-08-14, 详见 `docs/superpowers/specs/2026-08-14-xhs-image-generation-design.md`)——把小红书图文笔记里的 `shotIdeas` 配图建议升级为 gpt-image-1 真实生成的图片, 抽屉内一键全生成 (封面+全部配图), 单张失败可单独重试, 完成后打包 zip (png + 发布文案) 一键下载, 实现"定稿即成品"; 又完成**八期「人设定位驱动选题」** (2026-08-14, 详见 `docs/superpowers/specs/2026-08-14-persona-driven-topics-design.md`)——新增 `PersonaProfile` 人设定位档案(受众/想吸引的粉丝/3-5 条内容支柱/差异化角度/忌讳), 设置页「人设定位」卡支持直接编辑与「AI 帮我起草」五问访谈(DeepSeek 综合风格档案+定稿样本+雷达关键词起草, 只回填表单不落库, 保存才写库), 建立后自动注入三处: 热点雷达阅读评分(命中内容支柱 +8 分/未命中 ×0.7 降权 + 雷达页支柱名/"偏离定位"徽标)、选题与灵感生成(倾斜推荐更贴合定位的方向)、抖音与小红书写稿角度(受众画像与差异化角度约束切入点, 公众号与改稿路由不注入); 无档案时以上行为与现状完全一致(零迁移)。 又完成**九期「平台差异化流水线」** (2026-08-15, 详见 `docs/superpowers/specs/2026-08-15-platform-stage-flows-design.md`)——修正"全站统一 8 阶段"与"小红书是纯 AI 图文产线, 录制/剪辑永远空走"的错配: 新增平台阶段流层 (`src/lib/cockpit/platform-stages.ts`), 小红书看板/抽屉/档期/今日推进收窄为灵感→大纲→文案→发布→复盘 5 阶段 (其余平台不变, 仍是 7 阶段全集), 定稿(picked)与阶段完成推进都按平台流走 (小红书完成文案直接进发布, 不再卡进死阶段), 配一次性存量归并脚本; 收尾 E2E 顺带发现并修复一处五期遗留的真实 bug (`/content/script/[id]` 深度脚本页对两阶段生成的抖音稿 `retentionBeats` 字段读取崩溃, 见下文小节)。 又完成**十期「账号定位体系 · 作战室」** (2026-08-15, 详见 `docs/superpowers/specs/2026-08-15-positioning-system-design.md`)——把八期人设定位档案从"受众+支柱+角度+忌讳"一层薄皮扩展成完整作战室: `PersonaProfile` 新增痛点 (`painPoints` 3-6 条) / 商品服务 (`offerings` 1-5 条) / 产品逻辑 (`productLogic`) / 市场前景 (`marketInsight`, AI 自动调研可重跑) / 体系摘要 (`systemSummary`, 一页纸 markdown 可导出) 五个字段, 建档访谈从五问扩到九问 (新增痛点/变现/转化路径/竞争格局四问, 一次起草全部新字段); 内容卡新增 `intent` (引流/建立信任/转化) 字段, 生成时可指定或由 AI 建议回填, 写稿结尾 CTA 按 intent 分岔 (转化意图自然带出 offerings 里的具体产品名); 热点雷达阅读评分新增痛点命中 (`painHit`) 与差异化角度建议 (`angleSuggestion`) 展示, 但**不新增热度调权系数**——痛点只进相关性判断语义, 热度分合成公式 (`composeHeat`/`applyPersonaAdjust`) 零改动 (收尾用真实扫描数据重算验证过, 见下文小节); 内容总览新增内容组合比例条 (引流/信任/转化/未标注占比, 只展示不纠偏); 全档案仍不整体注入 prompt, 改为按用途 (`radar`/`write`/`topic`) 三段导出防止 prompt 暴长稀释指令。 又完成**十一期「账号定位独立视图」** (2026-08-15, 详见 `docs/superpowers/specs/2026-08-15-positioning-view-design.md`)——十期把定位体系(人设定位卡+风格档案卡)做进了「设置」页, 与 AI 服务配置/雷达配置/基线等一次性配置项并列, 用户实际体验后指出语义错位: 定位是反复回看、随经营迭代的**内容战略资产**, 不该埋在"配置一次不动"的设置页里。十一期把两张卡**原样迁移**(零重写, 只换挂载点)到新建的独立「账号定位」视图, 插入侧栏「工作台」组**第一项**(定位是选题/写稿一切动作的前提); 视图顶部新增**体系报告置顶区**(自取数展示 `systemSummary` + 「导出 .md」, 为空时引导访谈调研), 设置页收窄为只剩三张真正的配置卡。 本文档 §3 为当前实际 IA。

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
◌ 账号定位                      ← 工作台组第一项 (十一期新增, 自取数视图, 见下方「账号定位独立视图」小节)
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

`src/app/page.tsx` 只 `dynamic import` 一个客户端组件 `Cockpit.tsx` (`ssr:false`), 内部按 `view` state (`NavView`, 定义于 `src/lib/cockpit/view-routing.ts`) 切换视图: `positioning`(十一期新增, 自取数, 不进 `WorkspaceState`, 侧栏工作台组首项) / `inspirations` / `radar`(四期新增, 自取数, 不进 `WorkspaceState`) / `momentum`(今日/本周/档期三个 `MomentumPeriod` tab) / 五个 `platform-<平台>` / `pipeline` / `analytics`(目标/复盘两个 `AnalyticsTab` tab) 七类固定视图 + 一个独立的 `settings` 视图, 均是原样移植或参数化复用的 UI + 交互逻辑 (`src/lib/cockpit/{model,workflow,schedule,calculations}.ts` 纯函数零改动移植; `view-routing.ts` 是三期新增的纯逻辑模块, 详见下方兼容映射)。 首次进入 (workspace 为空) 走 onboarding; 支持明暗主题 + 5 套设计风格切换, 侧栏可折叠 (拖拽排序已移除); <820px 时侧栏收起, 换成底部 `.mobile-nav`。

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

**抽屉懒加载拉回改稿 UI (六期)**: 五期的分块改稿面板只存在于抽屉自己的前端 state, 重开抽屉(或刷新页面后重开)后消失, 只剩六个文本框(见上文 spec §6(c) 限制)。六期起: 打开抽屉挂载时若本地无生成态且 `item.scriptDraftId`(`CockpitContent` 服务端字段, 由上面 `cockpitContentId` 回写关联, `server-store.ts` 只读下发给前端, `PUT /api/v1/cockpit/workspace` 仍不接收) 非空, 懒加载 `GET /api/v1/scripts/{id}` 拉回 `output`, 用窄化解析纯函数 `parseDraftOutput` (`src/lib/cockpit/draft-restore.ts`) 恢复 sections/research/hooks/时长(douyin)或 intro/body/tags/配图建议(xiaohongshu, 见下方专门段落); 两种形态都解析不出(旧 `retentionBeats` 形态、intro/body 缺一个、请求失败等)一律静默保持现状, 不阻断六个文本框编辑。

**xiaohongshu 分支两阶段化 (六期)**: 上文「本期仅抖音」是五期交付时的范围——六期起 `xiaohongshu` 分支同样走 `runResearch` → `getStyleContext(userId, 'xiaohongshu')` → `SCRIPT_WRITE_XHS`(专家人设+风格上下文+素材简报+主题) 两阶段管线, 落库 `ScriptDraft.output = { research, titles, coverText, intro, body, tags, shotIdeas }`(与五期 douyin 的 `{ research, script.sections[], hooks, titles, cover, durationSec }` 形状并列, 键名不同); `durationSec` 请求参数仍校验但 xhs 分支不消费。`depositStyleSample`(`src/lib/script/style.ts`) 相应按 `draft.platform` 分支取定稿文本源: douyin 沿用 `sections` 拼接, xiaohongshu 取 `intro + '\n' + body`, 其余平台(含 gongzhonghao、未知值)防御性返回 `false` 不写入。`gongzhonghao` 分支未改动, 仍是单次生成、不落库 `ScriptDraft`。

**xiaohongshu 抽屉交互 + 落库去重 (六期)**: 抽屉「脚本」tab 生成平台选小红书时不再是六个空文本框——生成后展示素材简报折叠区(与 douyin 分块面板共用同一个 `ResearchBriefDetails` 子组件)+ 页顶「整稿指令」框(只有 scope:'all', 小红书不支持分块改稿) + intro/正文/标签/配图建议只读渲染; 素材（可选）折叠框对小红书开放(时长下拉仍只有 douyin 有, `durationSec` 后端不消费); 整稿指令成功后本地替换 intro/body, 并按 `mapGeneratedToScript('xiaohongshu', {intro, body})`(即 `mapXiaohongshu`)同款语义回填六字段骨架的 `hook`/`body`(不触碰 `headline`/`conclusion`/`example`/`ending`)。生成/整稿指令/hook 相关动作(douyin 专属)四类互斥、生成中禁用, 沿用五期 T9 的 busy 开关模式。`src/lib/cockpit/generate-flow.ts` 里「生成成功后是否二次 `POST /api/v1/scripts` 保存」的分支条件从只判断 `platform === 'douyin'` 扩到 `douyin || xiaohongshu`——五期收尾曾修过 douyin 的同类孤儿 `ScriptDraft` 问题, T4 把 xhs 的 generate 路由也改成落库后这个坑对 xhs 原样重现(旧代码仍会二次保存产生一条孤儿草稿, 且把 `CockpitContent.scriptDraftId` 覆盖指向孤儿记录), 六期一并修掉, `gongzhonghao` 的生成路由仍不落库、继续走二次保存。`parseDraftOutput`(`src/lib/cockpit/draft-restore.ts`) 相应扩展形状嗅探: 先找 douyin 的 `script.sections`, 找不到再找顶层 `intro`+`body`(双非空字符串) 判定为 xiaohongshu 形态, 两种形态互斥, 判别口径与 refine 路由的 `XhsOutputReadSchema` 一致——抽屉懒加载拉回改稿 UI 因此对两个平台都生效。

**「风格档案」卡** (`src/components/cockpit/settings-cards/style-profile-card.tsx`, 十一期起挂在独立的「账号定位」视图, 见下方「账号定位独立视图」小节, 组件本身零改动): 上半编辑 `StyleProfile.description`(口吻/句式/口头禅/忌讳); 下半只读样本列表(平台 badge + 预览 + 创建时间), 单条可删, 不提供手动新增入口(样本只经由脚本定稿沉淀, 避免两条写入路径)。

**数据模型** (2 张新表, 零迁移): `StyleProfile`(userId 单行) / `StyleSample`(定稿沉淀, `platform` + `content` + `sourceScriptDraftId` 溯源, `@@index([userId, platform, createdAt])`); `ScriptDraft.output` Json 内新增 `research`/`script.sections[]` 两键, 旧稿没有这两键时抽屉按旧结构原样渲染。

**API**: `POST /api/v1/scripts/generate`(douyin/xiaohongshu 分支两阶段化, 请求体新增 `materials?`/`durationSec?`/`cockpitContentId?`, 响应新增 `scriptDraftId`/`research`/`researchDegraded` + 各自的产出字段(douyin: `sections`/`hooks`/`titles`/`cover`; xiaohongshu: `titles`/`coverText`/`intro`/`body`/`tags`/`shotIdeas`); 无 DeepSeek key → 500; `cockpitContentId` 六期新增, douyin/xiaohongshu 分支落库 `ScriptDraft` 后 best-effort 回写 `CockpitContent.scriptDraftId`——归属校验/写入失败仅 `console.warn` 不阻断响应, 供抽屉重开恢复改稿 UI; gongzhonghao 分支目前仍不落库 `ScriptDraft`, 该参数暂不生效, `styleHints`/`inspirationApplied` 仅 gongzhonghao 分支保留)、`POST /api/v1/scripts/[id]/refine`(无 DeepSeek key → 503——与 generate 路由同场景的 500 状态码不同, 两条路由各自独立裁决, 未回头统一口径)、`GET/PUT /api/v1/style/profile`、`GET /api/v1/style/samples`、`DELETE /api/v1/style/samples/[id]`。

**配置依赖(不新增配置项, 复用既有两张卡)**: DeepSeek key 走设置「AI 服务配置」卡(同全站其它 LLM 调用点), Tavily key 走设置「雷达配置」卡(同四期热点雷达)——两者任一缺失时研究阶段静默降级(不联网研究, 不影响写稿本身), 只有 DeepSeek key 缺失才会让整个生成/改稿请求失败。

**成本**: 单篇生成 2 次 Tavily 搜索 + 2 次 DeepSeek 调用(研究提炼 + 写稿), 几分钱级; 每次改稿 1 次 DeepSeek 调用。

**真实验证**: 收尾任务用已配置的真实 DeepSeek + Tavily key 跑通全链路(雷达已采纳选题作种子生成一篇、素材框生成一篇、对其做一次分块改稿+一次整稿改稿、定稿沉淀样本后再生成第三篇确认样本数 ≥2 时切换 few-shot), 过程中发现并修复了一处真实 bug(素材过长截断会把用户素材框内容整段丢弃, 见上文「雷达种子与用户素材优先于搜索正文保留」), 详见 `.superpowers/sdd/2026-08-13-script-quality/task-8-report.md`。

### 小红书 AI 配图生成 (七期新增)

一句话: 小红书图文笔记定稿后, shotIdeas 配图建议从"文字建议"升级成"真图"——两步链路(出图计划 → 逐张生图) + gpt-image-1, 抽屉一键全生成, 完成后打包下载即可直接发布。

**两步链路**(`src/app/api/v1/scripts/[id]/images/{plan,route}.ts`):

```
① POST .../images/plan  (幂等, 已有 imagePlan 直接返回既有计划, 重新规划需 ?force=1)
   输入 = ScriptDraft.output 的 coverText/intro/body/shotIdeas
   DeepSeek 输出 { style: 全篇统一视觉风格描述, images: [{idx, prompt}] }
   idx=0 为封面(prompt 要求把 coverText 原文渲染为海报大字), idx 1..N 对应 shotIdeas
   总数 = 1+shotIdeas 数且 ≤10(成本护栏); 落 output.imagePlan

② POST .../images  body {idx, quality?}  (逐张, 前端并发 2 调用)
   GptImageProvider.generate() → POST api.openai.com/v1/images/generations
   (model gpt-image-1, size 1024x1536 竖版, quality 默认 medium, b64_json)
   写盘 public/generated/<draftId>/<idx>.png, 落 output.images[idx] = {path,prompt,createdAt}
```

抽屉「配图」区块 (`XhsScriptPanel`, `content-drawer.tsx`): 常亮「生成配图」按钮, 无本地 imagePlan 先幂等调 plan, 无 key (503) 时提示引导去设置卡配置; 否则并发 2 逐张调用 images, 生成一张渲染一张(缩略图网格), 单张失败该格显示「重试」; 生成动作并入既有互斥矩阵(生图中不可改稿); 至少 1 张成图后出现「打包下载」链接。关抽屉重开靠 `draft-restore.ts` 的 `imagePlan`/`images` 窄化解析恢复缩略图与下载入口(六期懒加载机制的自然延伸)。

**打包下载**: `GET .../images/archive` 把已生成的 png + `note.txt`(标题+正文+标签, 可直接粘贴发布)打成 zip, 文件名 `<topic>-发布包.zip`; 单张配图文件缺失时跳过(console.warn), 全部缺失才 400。用 `jszip` 打包(见下方决策记录), 二进制 zip 响应不走全站 `ok()` JSON 包裹, 与图片二进制响应路由同一先例。

**key 配置**: 设置 → 「AI 服务配置」卡新增 provider「OpenAI 生图」(`gpt-image`, 模型 `gpt-image-1`), key 保存/AES 加密/掩码全走既有 `AIConfig` 机制; 生图客户端**硬编码**直连 `https://api.openai.com/v1`(不读 `.env` 的 `OPENAI_BASE_URL`, 那个指向百炼视觉模型), 需保证本地网络能直达 OpenAI 官方端点; 连通性测试按钮对该 provider 不支持(同 deepseek 现状, 显示友好提示)。

**成本**: 出图计划 1 次 DeepSeek(几厘) + 每张 gpt-image-1 约 ¥0.1-0.6(按 quality 档), 单篇全生成(封面+数张配图)约 1-3 元。

**真实生图验证(用户裁决, 七期收尾未做)**: 生图需要用户自己的 OpenAI 官方 key(与站内其余 LLM 调用点不同, 这个 key 没有 `.env` 回退), 收尾时用户尚未配置, 按 DeepSeek/Tavily 先例降级——核心链路(plan prompt/schema、逐张生图路由、写盘、archive 打包)全部 mock 测试覆盖, 真实成图/打包留待用户配置 key 后自验, 步骤: ① 设置→AI 服务配置卡保存「OpenAI 生图」key ② 打开一篇小红书稿的抽屉, 点「生成配图」③ 确认封面+配图渲染出来、单张重试可用 ④ 点「打包下载」解压确认 png+note.txt。

### 平台差异化流水线 (九期新增)

一句话: 每个平台的创作流程不一样, 不该共用同一套 8 阶段——小红书七期后是纯 AI 图文产线, 录制/剪辑对它是永远空走的死阶段, 定稿自动推进还会把它卡进去; 九期新增「平台阶段流」视图层, 各平台按自己的实际流程显示与推进, 数据层 8 阶段超集不动。

**平台阶段流** (`src/lib/cockpit/platform-stages.ts`, 唯一事实来源, 纯函数零 IO):

| 平台 | 阶段流 | 说明 |
|---|---|---|
| 小红书 (xiaohongshu) | 灵感→大纲→**文案**→发布→复盘 (5 阶段) | `script` 阶段展示名改「文案」(`stageLabelFor`); 配图并入文案阶段的抽屉, 不新增阶段值 |
| 其余平台 (抖音/bilibili/X/YouTube/公众号) + 未收录平台 | 灵感→大纲→脚本→录制→剪辑→发布→复盘 (7 阶段, `WORK_STAGES`) | 与九期前行为一致 (`DEFAULT_STAGE_FLOW`) |
| 内容总览 (跨平台混合看板) | 上述 7 阶段 + 归档 (8 阶段超集, `CONTENT_STAGES`) | 总览故意保留超集不收窄, 存量脏值卡也能显示 |

`stageFlowFor(platform)` 决定看板列/抽屉 tab/可排期阶段集合; `nextStageFor(platform, stage)` 决定"完成当前阶段"与定稿(picked)时推进到哪一站——流内直接取下一站, 流尾 (`review`) 返回 `null` 不自动归档; 流外脏值 (含改平台后残留的旧阶段) 按 8 阶段超集顺序回落到该平台流内第一个能接住的阶段, 不硬阻断。

**消费点**: 平台流水线页看板列、内容详情抽屉 tab (含「阶段完成状态」进度条与「下一步动作」文案)、档期规划的可拖拽阶段 chip、今日推进的任务生成闸门 (`canScheduleStage`) 五处统一改走流层函数; 内容总览看板与「全局当前阶段」下拉 (数据层手动逃生舱, 用于纠错脏值) 两处刻意保留 8 阶段超集。

**定稿(picked)推进语义**: `PUT /api/v1/scripts/[id]/picked` 与阶段完成按钮 (`setContentStageCompletion`/`toggleStageEvent`) 都从硬编码"推进到 `recording`"改为 `nextStageFor(platform, 'script')`——小红书完成文案直接进「发布」(跳过死阶段), 其余平台仍进「录制」不变。 API 本身不加阶段取值硬校验 (看板过滤已天然限制展示, 硬校验会卡住存量脏值卡)。

**存量归并脚本**: `npm run migrate:xhs-stages`, 用法与语义见 §6「xhs 存量阶段归并 (一次性)」小节, 不重复展开。

**收尾 E2E 顺带修复的真实 bug**: 走查②③(定稿一篇 xhs 稿/一篇抖音稿, 确认落对看板列)时发现 `/content/script/[id]` 深度脚本详情页对两阶段生成 (五期起) 的抖音稿会直接崩溃——`script-result.tsx` 的 `DouyinView` 仍在读旧单阶段 schema 才有的 `retentionBeats[]` 字段, 而两阶段管线的产出形状是 `output.script.sections[]`, 二者字段名不同, `.map` 在 `undefined` 上直接抛错, 五期上线后这个页面对新形状草稿从未被人工走查覆盖过。 修复: `DouyinView` 按 `retentionBeats` 是否存在分岔渲染 (老稿走原表格, 新稿改渲染 `sections` 逐字稿列表), 不改数据形状本身。 与本期平台阶段流特性本身无关, 单独一个 fix commit。

真实验证 (无 mock, 真花 DeepSeek key 额度几分钱): 新建一张小红书测试卡、用 AI 生成一篇两阶段图文稿、在深度脚本页选定标题触发定稿——看板卡片直接落「发布」列 (而不是不存在的「录制」列); 新建一张抖音测试卡同样走一遍确认仍落「录制」列 (回归无误); 过程中修复上述 bug 后原地复现验证通过。 明暗主题下的看板列头 (`kanban-column header h2`) 与设计风格「安静编辑部」的深色模式联动过一遍浅色→深色→浅色, 文字渲染正常。 走查用的测试卡片/草稿/风格样本已全部清理, 数据库恢复原状, 详见 `.superpowers/sdd/2026-08-15-platform-stage-flows/task-5-report.md`。

### 账号定位体系 · 作战室 (十期新增)

一句话: 八期的人设定位档案只回答了"你是谁/想吸引谁/擅长讲什么/差异化角度是什么", 前半段"关键痛点→商品服务→产品逻辑→市场前景→体系总结"全部空缺——平台像一个强生产车间但缺作战室, 能把任何选题做成漂亮成品, 却不知道这条内容为谁的什么痛点服务、最终怎么变现。十期扩展 `PersonaProfile` 补齐这一段, 并让它真正改变选题与生成, 详见 `docs/superpowers/specs/2026-08-15-positioning-system-design.md`。

**档案字段** (`prisma/schema.prisma` `PersonaProfile`, 八期已有 `audience`/`targetFans`/`pillars`/`angle`/`avoid` 五字段原样保留不动):

| 新增字段 | 形状 | 说明 |
|---|---|---|
| `painPoints` | `{pain(≤30字), evidence(≤60字)}[]`, 3-6 条 | 目标人群的关键痛点 + 证据来源 |
| `offerings` | `{name(≤20), type: 'tool'\|'service'\|'course', description(≤80), targetPain(≤30)}[]`, 1-5 条 | 卖什么 (工具/服务/课程) + 对应哪条痛点 |
| `productLogic` | `string`, ≤500 字 | 内容把人从「刷到」带到「付费」的路径自述 |
| `marketInsight` | `{landscape, mainstream, unmet, opportunity, researchedAt}` 或 `null` | AI 自动市场调研结论 (各段 ≤300 字), `null` = 未调研过 |
| `systemSummary` | `string`, ≤2000 字 markdown | 定位体系一页纸报告, 可导出 `.md` |

内容卡新增 `CockpitContent.intent`: `'' | 'reach' | 'trust' | 'convert'` (空 = 未标注), 中文标签「引流 / 建立信任 / 转化」(`INTENT_LABELS`, `src/lib/cockpit/model.ts`)。

**建档三步** (「人设定位」卡, `src/components/cockpit/settings-cards/persona-card.tsx`, 十一期起挂在独立的「账号定位」视图, 见下方「账号定位独立视图」小节, 组件本身零改动):

1. **访谈起草** (从八期 5 问扩到 9 问, 新增④目标人群最头疼什么⑤打算靠什么变现⑧刷到到付费中间经历什么⑨怎么看赛道竞争四问) → `POST /api/v1/persona/draft` (`src/app/api/v1/persona/draft/route.ts`) 一次性起草**全部**字段 (含 painPoints/offerings/productLogic), 说明性字段宽进严出 (校验层放宽接住 AI 超发挥再在 transform 里截断, 防真实 500) → 只回填表单不落库, 用户改后点保存才 `PUT /api/v1/persona/profile` 落库 (八期"起草不落库"语义不变)。
2. **市场调研** (独立按钮, 可重跑) → `POST /api/v1/persona/market-research` (`src/app/api/v1/persona/market-research/route.ts`) → 查询词取「内容支柱名 赛道 现状」+「受众 内容 账号」两条 → 复用四期 Tavily 搜索层 (`getSearchProvider`) → DeepSeek 汇总成 `{landscape, mainstream, unmet, opportunity}` → 服务端只更新 `marketInsight` 一列直写落库 (不经过 PUT 的整表单合并流程), 同时记 `researchedAt`。 无 Tavily key 时 400 引导去雷达配置卡配置, 不阻断其余建档流程。
3. **体系报告** → `POST /api/v1/persona/summary` (`src/app/api/v1/persona/summary/route.ts`) → DeepSeek 综合已建档的全部字段生成一页纸 markdown (定位陈述/人群与痛点/变现路径/内容策略/差异化机会) → 只更新 `systemSummary` 一列直写落库, 可重生成 (覆盖)。 设置卡内展示 + 「导出 .md」按钮 (`downloadMarkdown`, 纯前端 Blob 下载, 不经服务端)。

`PUT /api/v1/persona/profile` 对**新增的 5 个字段**改为合并语义: 请求体显式提供的字段才覆盖, 未提供的 key 从现有行读回原样保留——防止老版本表单 (只发八期 5 字段) 每次保存把 T2/T3 产出的新字段静默清空; 市场调研/体系报告两条路由则各自只更新自己那一列 (更稳的"列式表 spread 保留", 无 PUT 那种"读回合并"的 TOCTOU 窗口)。 八期原始 5 字段仍是 PUT 全量覆盖语义不变。

**三处注入** (`buildPersonaSection(profile, scope, intent?)`, `src/lib/llm/prompts/persona-section.ts`, 唯一事实来源): 全档案任何时候都不整体倒进 prompt, 改按用途分段, 各调用点只拿自己需要的子集——

| scope | 含 | 调用点 (实况 5 处) |
|---|---|---|
| `radar` | 受众 + 内容支柱 + 用户痛点 + 市场机会位 | `src/lib/radar/run.ts` (雷达阅读评分) |
| `write` | 受众 + 用户痛点 + 差异化角度 + 市场机会位 (+ intent 非空时追加 CTA 指引段) | `src/app/api/v1/scripts/generate/route.ts` 抖音/小红书两分支 |
| `topic` | 受众 + 内容支柱 + 用户痛点 | `src/app/api/v1/discover/topics/route.ts`、`src/app/api/v1/inspiration/insights/generate/route.ts` |

未建立档案 (`isProfileEstablished` 判定不变: `audience` 非空 + `pillars≥1`) 时 `loadPersonaProfile` 返回 `null`, `buildPersonaSection` 直接返回空串, 各调用点字符级退回八期/无档案行为。

**痛点识别 (雷达)**: 阅读评分 (`src/lib/llm/prompts/radar-read.ts`) 新增 `painHit`(命中痛点原文, 与档案痛点严格等值校验, 同 `pillarHit` 先例宽进严出) 与 `angleSuggestion`(≤40 字差异化切入建议), 雷达卡片展示「戳中痛点：X」与角度建议 (`src/components/cockpit/views/radar.tsx`)。 **不新增热度调权系数**——`composeHeat`/`applyPersonaAdjust` (`src/lib/radar/scoring.ts`) 全期零改动, 痛点只进 AI 判断 `relevance` 时的语义参考, 不再叠加第三层调权 (八期已有共现加成 + 人设调权两层, 第三层会饱和且不可解释, E2E 实测调权空间已被压到 0)。

**内容意图与 CTA**: 生成请求可带 `intent`; AI 同时会按选题+`productLogic` 建议一个 `suggestedIntent` (严格枚举校验, 非法/无倾向一律 `null`), 未标注的内容卡收到生成响应后自动回填 (`shouldAutoFillIntent`, `src/lib/cockpit/intent-stats.ts`)。 写稿 prompt 结尾段按 intent 分岔: `reach` 给互动钩子引导关注, `trust` 引导收藏+看更多案例, `convert` 场景化自然带出 `offerings` 里的具体产品名 (禁生硬广告话术); intent 为空时沿用现状写法。 内容抽屉「内容意图」下拉可手动改 (`content-drawer.tsx`)。

**内容组合比例**: 内容总览/平台流水线页顶部一行「引流 X% / 信任 Y% / 转化 Z% / 未标注 N 条」+ 一句静态提示「转化内容长期为 0 时, 专业信任无法变现」(`computeIntentMix`, `src/lib/cockpit/intent-stats.ts`), 平台视图按该平台内容统计、总览按全量, 只展示不做自动纠偏。

**成本**: 访谈起草/体系报告各 1 次 DeepSeek 调用 (几分钱); 市场调研 2 条 Tavily 搜索 + 1 次 DeepSeek 汇总 (约几毛/次, 可重跑); 生成侧 intent 注入不额外增加调用次数, 只是同一次写稿 prompt 变长几十到一两百字。

**收尾真实 E2E** (无 mock, 真花 DeepSeek+Tavily key 额度几毛钱, 详见 `.superpowers/sdd/2026-08-15-positioning-system/task-7-report.md`): ①真实 9 问作答起草 (5 条痛点/3 条 offerings/productLogic 均在 spec 上限内) → 保存 → GET 校验一致 ②真实市场调研一轮, `marketInsight` 四段均非空 + `researchedAt` ③真实体系报告生成 (1839 字 markdown) + 导出逻辑代码走读确认 (浏览器扩展当次不可用, 未做真实点击下载走查, 与七期先例同样降级) ④真实雷达扫描产出 5 条新条目, 4 条命中 `painHit`/带 `angleSuggestion`——用 `composeHeat`/`applyPersonaAdjust` 对同一批条目原样重算, 5/5 与库内 `heatScore`/`personaAdjust` 完全一致, 实测验证"痛点识别不影响热度分"⑤真实生成一篇 `intent='convert'` 的抖音稿, CTA 确认指向 `offerings` 里的真实产品名⑥临时清空 `audience`/`pillars` 触发无档案回退, 真实生成/雷达扫描确认不报错且退回默认文案, 随后完整恢复原档案 (三份新旧字段深度比对完全一致, 详见报告)⑦`typecheck`+`test`(1376)+`build` 全绿。 过程中④→⑤走查发现一个真实 bug 并修复: 抖音写稿 prompt (`src/lib/llm/prompts/script-write-douyin.ts`) 里"最后一块必须引导评论/关注/转发"是无条件的写作要求, 会盖过 persona 段按 `intent='convert'` 给出的 CTA 指引 (真实生成验证到 AI 完全没有引用任何 offering), 改为"上文如果给了具体的结尾方向就照着写, 没给的话默认引导评论/关注/转发"后原地复现验证通过, 单独一个 fix commit。 E2E 过程中产生的测试用 `ScriptDraft`(3 条) 已清理; 雷达真实扫描产出的条目属于真实产品输出 (非测试专用数据) 予以保留; 用户真实定位档案原样保留未受影响。

### 抖音逐字稿六幕改造 (十三期新增)

一句话: 抖音口播逐字稿的结构从「hook/main×N/cta」三段式改为固定六幕(向外部工具
`script_spec.md` 的六幕格式对齐), 新增服务端硬检查(lint, 不阻断保存)。详见
`docs/superpowers/specs/2026-08-16-six-act-script-design.md`。

**六幕结构** (`src/lib/script/six-act.ts`, `ACT_KEYS` 固定顺序, 不可乱序/增减):

| 幕 key | 中文标签 | 时长占比 |
|---|---|---|
| `hook` | 开场钩子 | 10% |
| `concept_a` | 概念A | 22.5% |
| `concept_b` | 概念B | 22.5% |
| `trivia` | 冷知识 | 15% |
| `synthesis` | 知识串联 | 22.5% |
| `punchline` | 金句收尾 | 7.5% |

`allocateActSeconds(durationSec)` 按占比四舍五入分配各幕 `targetSec`, 余数补给
`concept_a`, 保证 6 幕之和恰好等于 `durationSec`。每幕除 `narration`(口播台词)外还带
`title`/`visual`(配图建议)/`note`(备注)/`beats`(3-5 个关键词 chip)/`facts`(0-8 条
事实核查, 每条 `claim`+`value`+`source`+`confidence`)。字段宽进严出: LLM 响应先放宽
上限接住超发挥, `ScriptActSchema` 的 `transform` 再截断到展示上限(如 `narration` 最多
1500 字接、截到 800 展示), 而不是直接拒收整份重试。`isSixActScript` 是**唯一的形状判别
入口**——`script-write-douyin.ts`/生成路由/改稿路由/`style.ts`/`script-mapping.ts`/深度页/
抽屉六处消费点都调它分岔, 不各写各的判别逻辑。

**时长建议**: 生成请求 `durationSec` 可选 30/45/60/**90(六幕默认)**——六幕结构是按
~90 秒科普口播设计的(六幕塞进 45 秒每幕仅 4-11 秒, 概念讲不透), 抽屉时长下拉与深度写稿页
都以 90 为默认值, 选中 <60 秒时给出提示「六幕结构在 60 秒以下会很挤，建议 90 秒」。

**lint 硬检查** (`src/lib/script/six-act-lint.ts` 的 `lintSixActScript`, 规则移植自参考实现
`lint.py` 并按当前字段裁剪): 生成后自动跑一遍, 结果落 `output.lintIssues` 并随生成响应
返回, **仅作展示提示, 不阻断保存**(生成/改稿都是 200 直接持久化)。规则表:

| 规则 | 级别 |
|---|---|
| 六幕缺失或顺序错误 | error |
| 四维(`gain`/`surprise`/`clarity`/`appeal`)任一项为空 | error |
| 某幕 `title`/`narration`/`visual` 为空 | error |
| 台词里出现的数字(年份/百分比/倍数/万亿等单位)在该幕 `facts` 里找不到对应条目("不说没把握的数字") | error |
| `facts` 条目缺 `source`(没有标注来源) | error |
| 开场 30 字内出现「大家好/欢迎来到/今天我们来聊聊/我是」等寒暄词 | error |
| 空洞形容词(非常/极其/震撼/颠覆) | warn |
| 单句超过 30 字(念不出来, 建议拆) | warn |
| 句首悬空指代(这个/那个开头) | warn |
| 收尾 (`punchline`) 与开场 (`hook`) 没有 2 字以上共同词(可能没回扣钩子) | warn |

抽屉「脚本」tab 六幕卡片区顶部有一条 lint 结果条, error 红点/warn 黄点分组展示, 点开列出
`act + message`, 明确标注「仅提示, 不影响保存」。

**六处消费点**: ①写稿 prompt(`script-write-douyin.ts`)与生成路由 —— `DouyinFullScriptSchema`
从 `sections` 换成 `acts`+`four_dims`, system prompt 吸收 `script_spec.md` 的六幕职责/占比/
科普严谨性原则, 生成后跑 lint、落库 `output.script.acts`+`output.four_dims`+`output.lintIssues`
②改稿路由新增 `scope:'act'`(单幕改稿, 服务端校验其余五幕 `narration` 逐字不变 + act
key/顺序不被打乱)与六幕版 `scope:'all'`(整稿改稿, 校验幕数固定 6 且顺序正确) ③定稿沉淀
(`style.ts` 的 `depositStyleSample`)六幕稿取 `acts[].narration` 拼接作为样本正文 ④抽屉骨架
回填(`script-mapping.ts` 的 `mapDouyin`)六幕稿取 hook 幕 narration 回填 `draft.hook`、六幕
`[标签] narration` 拼接回填 `draft.body` ⑤深度脚本页(`script-result.tsx` 的 `DouyinView`)
按 `pickDouyinViewMode` 四态判别(`legacy`/`six-act`/`sections`/`empty`)渲染六幕卡片(标题+
建议时长+台词+配图建议+关键词 chips+事实核查表) ⑥抽屉六幕面板(`SixActPanel`, 六张幕卡片 +
每幕「改这一幕」按钮 + 页顶整稿指令 + lint 结果条)。

**旧稿兼容(零迁移)**: 所有消费点按 `output.script` 里是 `sections` 还是 `acts` 分岔, 旧的
三段式抖音稿(`output.script.sections`)完全走原渲染/原改稿路径, 不做存量数据迁移脚本——
`isSixActScript` 对旧稿返回 `false`, 六处消费点各自落回改造前的逻辑, 字符级不变。

**成本**: 一篇 90 秒六幕稿约几分钱 DeepSeek 调用(研究+写稿两阶段管线沿用五期结构未变);
单幕改稿一次调用成本更低(只重写一幕的输出量)。

**收尾真实 E2E** (无 mock, 真花 DeepSeek key 额度几分钱, 详见
`.superpowers/sdd/2026-08-16-six-act-script/task-7-report.md`): ①真实生成一篇 90 秒六幕稿——
六幕齐全且顺序正确(`hook/concept_a/concept_b/trivia/synthesis/punchline`)、`four_dims` 四项
均非空、9 条 `facts` 全部标注 `source`、6 幕 `targetSec`(9/20/20/14/20/7)合计=90 ②对
`punchline` 幕按幕改稿——其余五幕 `narration` 逐字节比对与改稿前完全一致(仅 `punchline`
变化) ③定稿(`PUT .../picked`)→ `StyleSample.content` 与库内草稿六幕 `narration` 拼接逐字节
相等 ④打开库里一篇真实存在的旧三段式抖音稿(`cmsrgm36f0001jupvvnbxvlx1`, `output.script.sections`
5 块)——深度页 `pickDouyinViewMode` 判定为 `'sections'`(非六幕/非崩溃), 抽屉懒加载
`parseDraftOutput` 正确恢复 5 个 section + hooks + research; 另建一份该草稿的临时克隆走真实
`scope:'section'` 改稿 HTTP 调用全链路验证「改稿仍可用」, 验证完删除克隆, **原稿只读查未做
任何写入** ⑤手工构造一条含无来源数字(`87%`)的六幕稿喂给真实 `lintSixActScript`, 确认产出
`error` 级问题; 真实生成响应里也自然复现了同类问题(`trivia` 幕「2025 年」无 facts 佐证)且
仍 200 保存, 双重验证「lint 不阻断」⑥`typecheck` + `test`(1566) + `build` 全绿。

过程中④走查发现两个真实 bug 并修复(均为单独 fix commit): 一是抽屉懒加载恢复
(`src/lib/cockpit/draft-restore.ts` 的 `parseDraftOutput`)完全没有六幕形态判据——关闭抽屉
再打开同一条**新生成**的六幕稿(组件整体重挂载, 触发的正是这条懒加载路径)时六幕面板会
整体消失(不崩溃, 但改稿功能不可用), 已补上六幕稿判据(优先于 sections 判别, 与
`script-mapping.ts`/`douyin-view-mode.ts` 判别顺序一致), 并把该文件的 `durationSec` 白名单
从 `[30,45,60]` 补到 `[30,45,60,90]`(90 此前会被直接判非法丢弃); 二是抽屉内时长选择器
(`content-drawer.tsx`)默认值硬编码 45 且下拉选项只有 30/45/60——生成请求每次都显式携带
`durationSec`, 后端「六幕默认 90 秒」的改动在抽屉这一实际入口从未真正生效过, 也缺失 spec
里要求的「<60 秒 UI 提示」, 一并补上(默认值改 90、下拉加 90 选项、<60 秒时给出提示文案)。
两处修复各补了对应单测(`tests/lib/cockpit/draft-restore.test.ts` 新增六幕懒加载恢复
describe 块, 3 条用例)。E2E 过程中产生的测试用 `ScriptDraft`(生成稿 1 条 + 旧稿克隆 1 条)与
对应 `StyleSample`(1 条)已清理; 用户真实存在的旧三段式草稿全程只读, 内容与创建时间未变。

### 内容详情整页 + 步骤条 (十四期新增)

一句话: 内容详情从右拉抽屉(7 个标签平级按钮, 每次打开都硬编码停在「概览」)改为独立整页
路由(`/content/detail/[id]`, 可刷新/可分享), 新增连线步骤条自动定位到内容当前所在阶段;
录制/剪辑阶段对已生成的六幕稿(十三期)新增逐幕对照指导(台词+配图建议+备注+关键词 chip+
打勾), 无六幕稿的内容退回原有空白备注框, 零迁移。详见
`docs/superpowers/specs/2026-08-17-content-detail-page-design.md` 与
`docs/superpowers/plans/2026-08-17-content-detail-page.md`。

**步骤条** (`src/components/cockpit/stage-stepper.tsx` + 纯函数 `computeStepNodes`,
`src/lib/cockpit/stage-stepper.ts`): 按平台阶段流 (`stageFlowFor`) 渲染圆点+连线, 已完成
(`--olive` 绿) / 当前 (`--gold` 金) / 未到 (灰) 三态, **不锁顺序**——所有节点仍可自由点击
切换标签, 只是导航展示, 不触发阶段推进 (`onSelect` 只调 `setTab`, 不调 `changeStage`)。

**六幕录制/剪辑指导** (`src/components/cockpit/six-act-guide-panel.tsx`): 内容有六幕脚本时,
录制/剪辑两个 tab 从空白备注框换成六张幕卡片(标题+建议时长+台词+配图建议+备注+关键词
chip), 每幕一个「这一幕录完了/剪完了」打勾, 录制与剪辑两侧进度各自独立存储
(`ContentItem.recordingActProgress`/`editingActProgress`, 十三期新增字段) 并持久化到
Postgres。

**数据加载**: 新页面不新建单条内容读写接口, 复用现有 `loadWorkspace()`/`saveWorkspace()`
整仓库机制——抽成共享 hook `useWorkspaceState` (`src/lib/cockpit/use-workspace-state.ts`),
供 `Cockpit.tsx` 与新页面共同使用。所有原来会打开抽屉的入口 (看板卡片/今日推进/灵感库
"已转为内容"/内容数据分析"待复盘") 统一改为 `router.push('/content/detail/[id]')`。

**已知问题(未修复, 见下文「已知问题」)**: 整页架构下, "新建内容后立即跳转"与"删除内容后
跳转回看板"这两个动作都会在防抖自动保存(250ms)完成前就把承载 `useWorkspaceState` 的组件树
卸载, 导致这次写入实际从未落库——详见 §5 Known Issues。

### 人物志 + 个人经历库 (十二期新增)

一句话: 定位体系的每个字段都是商业策略维度(受众/支柱/痛点/商品/产品逻辑/市场), 是一份营销
brief 而不是一个人——用户实际使用后评价"只能是一个没有灵魂的博主, 缺少真人的灵动性和个人
魅力"。十二期补两块: **人物志**(你是谁)与**个人经历库**(你凭什么这么说)。详见
`docs/superpowers/specs/2026-08-16-creator-voice-design.md`。

**人物志** (`CreatorVoice`, userId 单行, 独立于 `PersonaProfile`): 身份(具体的人而非品类
标签) / **我不是什么**(护栏, 防 AI 把你包装成你不是的专家) / 表达能量 / 来路故事 / 立场主张
0-5 条。**不含语言风格字段**——口吻句式口头禅归「风格档案」, 两处都写会让写稿 prompt 收到
自相矛盾的指令。建档走 6 问 AI 访谈(`POST /api/v1/voice/draft`, 起草不落库, 改完保存才 PUT)。

**个人经历库** (`CreatorExperience`, 多条目): 「随手记一笔」零门槛录入(不需分类不需起标题),
DeepSeek 自动打主题/类型(实践/翻车/认知刷新/成果)/检索关键词; keywords 可人工编辑——AI 提取
质量不稳而它直接决定能否被检索到。**打标签失败不丢内容**(LLM 挂了仍原文入库, 响应 tagged:false)。

**检索与注入**: 写稿前 `matchExperiences(topic, items, 3)` 纯函数按关键词命中数+新鲜度取
top3, 注入两处——①研究层 `curatedParts` **最前**(亲身经历 > 用户贴的资料 > 搜索正文)
②写稿 prompt 原文注入 + 护栏句「不相关就别用, 不要硬凑」。命中条目 `usedCount+1`(best-effort)。
体系报告也吃人物志, 否则那份一页纸仍是营销 brief。无人物志/空库时全链路降级为十二期之前行为(零迁移)。

**中文检索的坑(收尾 E2E 真实复现)**: 主题「…用错的方式提问」与关键词「提问技巧」互不为子串,
纯 `includes` 匹配 0 命中, 经历库一度形同虚设。现中文走 **2 字滑窗**、ASCII 走**词边界正则**
(避免 `AI` 命中 `detail`)。另修 `RESEARCH_BRIEF` 的 source 词表——原本只认「URL/用户素材」,
标注为「我的亲身经历」的素材无法归类被整条丢弃。

**成本**: 6 问起草约几分钱; 随手记每条打标签约几厘; 检索与注入零额外调用。

### 账号定位独立视图 (十一期新增)

一句话: 定位体系(人设定位+风格档案)从「设置」页搬出来, 独立成侧栏工作台组**第一项**, 顶部新增体系报告置顶区。 详见 `docs/superpowers/specs/2026-08-15-positioning-view-design.md`。

**背景**: 十期把「人设定位」「风格档案」两张卡做进了设置页, 与 AI 服务配置/雷达配置/内容基准三张一次性配置卡并列——语义错位: 后三张"配一次不动", 前两张是随经营持续回看/迭代的战略资产, 被埋没在配置项容器里 (同一病灶此前已表现为"找不到生图配置")。

**改动**: `NavView` 新增 `'positioning'`, 侧栏 `WORKBENCH_NAV_ITEMS` 首位插入 `{id:'positioning', label:'账号定位', icon:'◌'}` (复用 `review` 键闲置的圆环字符, 不新增图标资源); 新建 `src/components/cockpit/views/positioning.tsx`, `?view=positioning` 直达, 三段纵向结构:

1. **体系报告置顶区**: 视图自行 `GET /api/v1/persona/profile` 取 `systemSummary`——与下方 `PersonaCard` 内部各自取数会有一次重复请求, 按 YAGNI 接受, 不为省一次 GET 引入跨组件状态提升。非空展示 markdown 原文(`<pre>`) + 「导出 .md」; 为空展示引导文案「完成访谈与调研后, 这里会生成你的定位一页纸」。
2. `<PersonaCard />`——十期原组件**原样迁移**, 零字节改动, 只换挂载父组件。
3. `<StyleProfileCard />`——同上, 零改动。

设置页 (`src/components/cockpit/views/settings.tsx`) 相应移除这两张卡的引入与挂载, 现只剩三张真正的一次性配置卡 (AI 服务配置 / 内容基准 / 雷达配置)。旧地址 `?view=settings` 仍打开设置页 (此时页内已无定位卡), 不做重定向/迁移提示 (YAGNI, 用户是唯一使用者)。平台维度的定位切换/侧写 (抖音与小红书分账号侧写) 本期不做, 等小红书接入时再评估。

**验证**: 无纯函数新增 (纯 UI 挂载点搬迁), 走查用 Playwright 直连本机 Chromium 做真实浏览器交互验证 (`?view=positioning` 直达 / 侧栏点击 / 移动端首项 / 设置页只剩三卡 / 明暗主题 / 保存往返写入-核对-恢复), 详见 `.superpowers/sdd/2026-08-15-positioning-view/task-2-report.md`。

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

### 已知 Bug (未修复)

- **十四期整页化引入的数据丢失竞态**(内容详情整页收尾走查发现, 未修复——超出该收尾任务的
  文件改动范围, 记录于此留给下一期处理): `createBlankContent`/`createContentForPlatform`/
  `createContentFromInspiration`(`Cockpit.tsx`)与 `content-detail-client.tsx` 的删除处理函数
  都是"先 `setState(...)`, 紧接着同步 `router.push(...)`"的写法。十三期之前, 打开内容走的是
  同一组件树内的抽屉(`ContentDrawer`), `router.push` 不存在, 这个写法没问题; 十四期把内容详情
  换成独立路由后, `router.push` 会立刻卸载承载 `useWorkspaceState` 的组件树, 而自动保存是
  250ms 防抖(`src/lib/cockpit/use-workspace-state.ts`)——组件卸载时 `useEffect` 清理函数会
  `clearTimeout` 掉这个待发的保存, 写入从未真正发到 `PUT /api/v1/cockpit/workspace`。真实复现
  (真连 docker Postgres, 非 mock): ①新建内容后立即跳转到详情页, 直接查库该行不存在; ②在详情
  页点「删除此内容」, 确认弹窗后正常跳回看板且卡片"消失", 但直接查库该行仍在, 刷新页面卡片
  会重新出现(用户会误以为删除生效, 造成困惑)。同一页面内的编辑(改标题/生成脚本/勾选六幕
  进度)不受影响——因为没有跨路由跳转, 组件树没有被卸载, 250ms 计时器能正常触发。修复方向:
  这几处"变更后立即导航"的调用点需要先 `await` 一次真实保存完成(或把即时保存与防抖保存分开,
  导航前强制走一次同步保存), 再执行 `router.push`/`setState` 卸载路径; 涉及 `Cockpit.tsx`
  与 `content-detail-client.tsx` 两个文件, 不在十四期收尾任务("只改样式"）范围内, 留给下一次
  改动这两个文件的任务顺带修。

### Code 重复

- `match-douyin` POST route + `runAutoSync` 中 "写 douyinAwemeId + enqueue retro" 逻辑重复 (~ 25 行)。 抽 helper 留 future。
- 多个 prompt 文件用同一 `getExpertPersona(niche)` + `JSON_STRICTNESS` 头尾, 但每个文件自己拼。 可以抽 `composeSystemPrompt(niche, taskDescription)` helper。

### LLM 配置

- 视频管线 vision LLM 是 Bailian Qwen-VL,文本 LLM 是 DeepSeek。
- DeepSeek key: 优先读设置「AI 服务配置」卡里的 `AIConfig` 记录 (`provider='deepseek'`, AES-256-GCM 加密存储), 查不到或解密失败时回退 `.env` 里的 `DEEPSEEK_API_KEY` (`src/lib/llm/resolve-key.ts` 的 `resolveDeepSeekApiKey`, 所有消费点——脚本生成/选题生成/灵感总结/标题反馈/热点雷达/内容分析复盘/人设定位访谈起草(八期)/市场调研与体系报告(十期)——统一走它)。
- vision LLM (OpenAI/Bailian) key 仍只在 `.env` (OPENAI_API_KEY, OPENAI_BASE_URL 等), 未纳入本次桥接范围。

### 测试覆盖

- 1376 tests 绝大多数是 API 单测 + 纯函数 + mock prisma (含 Cockpit `model/workflow/schedule/calculations`/迁移映射的原版测试; 四期新增雷达搜索层/热度合成/阅读 prompt/API 路由测试; 五期新增研究层/风格层/两阶段生成/两级改稿/风格档案 API 的 mock 测试; 六期新增 `draft-restore.ts` 窄化解析纯函数测试(含新增的 xiaohongshu 形状嗅探用例) + xiaohongshu 分支两阶段化/`depositStyleSample` 平台分支沉淀测试 + `generate-flow.ts` xiaohongshu 跳过二次保存的回归用例; 七期新增 `GptImageProvider`/`resolveImageApiKey` 单测 + 出图计划 prompt/schema 与 `images/plan`、`images`、`images/archive` 三条路由的 mock 测试(含 idx 字段匹配/写盘容错/zip 打包缺文件跳过等边界) + `draft-restore.ts` 的 `imagePlan`/`images` 窄化解析用例; 七期终审修复新增 `writeGeneratedImage` 原子写 (`src/lib/image/write-generated-image.ts`) 的并发竞态 mock 回归 + `output.images` 父键缺失场景的**真实连 Postgres 集成测试** `tests/lib/image/write-generated-image.integration.test.ts`(需本机 docker compose 起了 postgres, 用真实 `PrismaClient` 建临时 User/ScriptDraft 行、跑写入、`findUnique` 读回断言、afterAll 清理); 八期新增 `PersonaProfile` 数据层(`isProfileEstablished`/`parsePersonaPillars`/`validatePillarHit`)/`buildPersonaSection`/`applyPersonaAdjust`/`pickPersonaBadge` 纯函数测试 + `persona/profile`、`persona/draft` 路由 mock 测试 + 雷达评分/选题/灵感/写稿四处注入点"无档案字符级一致"回归测试; 九期新增 `platform-stages.ts` 七个导出函数的流矩阵测试 + 五类消费点接入回归 (含修复轮的"完成文案按平台阶段流推进"四路断言) + `picked` 路由三种平台语义测试 + `migrate-xhs-stages.ts` 归并脚本测试(含 `completedAt` 区分排期/历史的修复轮用例); 十期新增 `PersonaProfile` 新五字段的数据层测试 (`tests/lib/persona/profile.test.ts`, painPoints/offerings/marketInsight 解析与校验) + 分段 `buildPersonaSection(profile, scope, intent?)` 三段 (`radar`/`write`/`topic`) 全量矩阵测试 (`tests/lib/llm/prompts/persona-section.test.ts`) + `persona/draft`(9 问)/`persona/market-research`/`persona/summary`/`persona/profile`(合并语义) 四条路由 mock 测试 + 雷达 `painHit`/`angleSuggestion` 校验与截断测试 (`tests/lib/radar/run.test.ts`、`tests/lib/llm/prompts/radar-read.test.ts`) + `scripts/generate` intent 透传/`suggestedIntent`/CTA 分岔回归 (`tests/api/scripts/generate.test.ts`) + `computeIntentMix`/`shouldAutoFillIntent` 纯函数测试 (`tests/lib/cockpit/intent-stats.test.ts`))
- UI 一律走手动 E2E (是有意识的取舍); 五期收尾用真实 DeepSeek+Tavily key 额外跑了一轮全链路真实 E2E (非 mock), 见 `.superpowers/sdd/2026-08-13-script-quality/task-8-report.md`; 六期收尾同样用真实 key 跑通抖音懒加载恢复+`picked`自动推进/小红书两阶段生成+整稿改稿+定稿沉淀样本, 并额外用浏览器走查确认了抽屉小红书面板渲染、页顶整稿指令回填六字段骨架、关抽屉重开(不刷新)恢复三处 UI 行为, 详见 `.superpowers/sdd/2026-08-14-drawer-closure-xhs/task-6-report.md`; **七期收尾未跑真实生图 E2E**(用户尚未配置 OpenAI 生图 key, 与 DeepSeek/Tavily 先例同样的降级——mock 全过, 真实成图/打包验证责任转移给用户配 key 后自验), 详见 `.superpowers/sdd/2026-08-14-xhs-image-generation/task-6-report.md`; 八期收尾用真实 DeepSeek+Tavily key 跑通访谈建档(真实起草 5 条具体支柱→保存→established)+真实雷达扫描(`heatFactors` 命中 `pillarHit`/`personaAdjust`)+真实生成一篇抖音稿(临时 `console.log` 验证后移除, 确认 727 字符 persona 段确实注入 system prompt)+无档案回退(临时清空再恢复), 过程中发现并修复了一个环境类问题(radar-worker 长驻进程未重启导致跑的是旧代码, 非产品代码 bug), 详见 `.superpowers/sdd/2026-08-14-persona-driven-topics/task-6-report.md`; 十期收尾用真实 DeepSeek+Tavily key 跑通 9 问访谈建档→市场调研→体系报告→意图 CTA 生成→雷达痛点扫描 (含用 `composeHeat`/`applyPersonaAdjust` 对真实扫描条目重算比对, 证实热度分公式未受痛点影响)→无档案回退→恢复全流程, 过程中发现并修复一处真实 prompt 冲突 bug (抖音写稿 prompt 里硬编码的 CTA 收尾要求盖过了 intent 指引), 详见 `.superpowers/sdd/2026-08-15-positioning-system/task-7-report.md`
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

小红书 AI 配图生成 (七期, 见 §3「小红书 AI 配图生成」小节) 需要一个额外的 key: 设置视图「AI 服务配置」卡新增服务商「OpenAI 生图」(provider `gpt-image`), 保存用户自己的 OpenAI 官方 key (无 `.env` 回退); 生图客户端硬编码直连 `https://api.openai.com/v1`, 需保证本地网络能直达该端点 (不支持代理/自定义网关)。未配置该 key 时「生成配图」按钮走 503 引导文案, 不阻断其余功能; 出图计划阶段仍只需要 DeepSeek key。成本: 出图计划几厘 + 每张 gpt-image-1 约 ¥0.1-0.6, 单篇全生成约 1-3 元。

账号定位体系 (十期, 见 §3「账号定位体系 · 作战室」小节) 不新增配置项, 复用上面已有的两张卡: 访谈起草/体系报告只需要 DeepSeek key (各约几分钱); 市场调研额外需要 Tavily key (同雷达功能), 缺 key 时 400 引导去雷达配置卡配置, 不阻断其余建档步骤; 单次市场调研约几毛钱, 可重跑。

### 测试

```bash
npm run typecheck    # tsc --noEmit
npm test             # vitest, 1376 tests across 110 files (含 Cockpit 纯逻辑层原版测试; 其中 1 个文件是真实连 Postgres 的集成测试, 需先 docker compose up -d postgres)
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

`worker:dev` (`tsx src/jobs/workers/index.ts`) 是长驻进程, 启动时一次性 import 所有依赖文件, **不像
Next dev server 那样对代码改动热重载** —— 改了 `src/lib/radar/`（或任何 worker 会 import 到的模块）
后, 常驻的 worker 进程仍在跑旧代码且不会报错 (只是悄悄少算/漏算新逻辑), 必须手动 kill 后重新
`npm run worker:dev`。 八期 T6 收尾真实验证雷达评分注入时踩到过 (worker 在人设定位 5 个提交之前就
启动着, 扫描出的 `heatFactors` 一直缺 `pillarHit`/`personaAdjust`, 重启后才正常), 与"改 schema 必须
重启"是同一类"长驻进程 + 代码不同步"问题, 重启即愈。

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

### xhs 存量阶段归并 (一次性)

```bash
npm run migrate:xhs-stages          # dry-run (默认): 打印候选卡片 id/title/stage, 不写库
npm run migrate:xhs-stages -- --apply  # 人工确认 dry-run 输出无误后再写库
```

九期引入平台差异化流水线后，小红书 (`xiaohongshu`) 的 `recording`/`editing` 两个阶段被从它的
流程 (`PLATFORM_STAGE_FLOW`, `src/lib/cockpit/platform-stages.ts`) 中剔除，对小红书永远是死阶段。
本脚本一次性归并特性上线前遗留、卡在这两个阶段的小红书存量卡片：单事务内逐卡
`stage → 'script'` + 清理该卡在 `CockpitStageEvent` 里 `recording`/`editing` 的排期记录（历史排期
不动）+ 按去重后的 `userId` 逐个 `bumpCockpitRev`。归并逻辑纯函数见 `planXhsStageMigration`
(`scripts/migrate-xhs-stages.ts`)。

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
│   └── api/v1/                    # 所有 API routes (含 topics/ distributions/ cockpit/workspace/ cockpit/inspirations/ douyin/auto-sync/trigger/ radar/{items,keywords,config,trigger,runs/latest}/ scripts/generate(五期 douyin 两阶段化)/ scripts/[id]/refine(五期新增)/ style/{profile,samples}(五期新增)/ scripts/[id]/images/{plan,route,archive}(七期新增: 出图计划/逐张生图/zip 打包))
├── components/
│   ├── cockpit/                   # Creator Cockpit 移植主体
│   │   ├── Cockpit.tsx             # 顶层组件: state + view 路由 (`NavView`, 三期起见 `lib/cockpit/view-routing.ts`) + 主题/onboarding (侧栏拖拽排序三期已移除)
│   │   ├── views/                 # inspirations/radar(四期新增, 自取数)/momentum(含 schedule tab)/platform(五平台流水线页共用)/pipeline/analytics(含 goals+review tab) + settings.tsx (独立视图)
│   │   ├── analytics/              # 二期 (T4) 从 components/dashboard/ 迁移重塑: prediction-panel/performance-panel + 7 个搬迁 widget + use-dashboard-summary hook
│   │   ├── settings-cards/         # ai-provider-card, baseline-card (二期 T5) + radar-config-card (四期 T6) + style-profile-card (五期新增)
│   │   ├── sidebar.tsx             # 全站共用侧栏 (cockpit 模式 + external 模式), 二期起「平台」外链组已移除, 四期新增「热点雷达」项
│   │   ├── external-shell.tsx      # 站外页面外壳 (侧栏 + mobile-nav + 主题同步), 仅剩 /accounts /agent/discover /content/* 使用
│   │   ├── content-drawer.tsx      # 内容详情抽屉, 二期 (T2) 脚本 tab 加入就地 AI 生成 + 标题实时建议; 五期新增素材框/时长/简报折叠区/分块渲染/换一版/整体指令; 六期新增挂载时懒加载拉回改稿 UI (parseDraftOutput) + 小红书两阶段面板(`XhsScriptPanel`, 与 douyin 分块面板共用 `ResearchBriefDetails` 素材简报子组件) + 素材框对小红书开放 + 生成/改稿/hook 动作四类互斥扩到小红书整稿指令; 七期新增「配图」区块 (一键全生成 + 并发 2 逐张渲染 + 单张重试 + 打包下载链接), 生图动作并入同一互斥矩阵
│   │   ├── onboarding.tsx / shared.tsx
│   ├── content/                   # script-form, script-result (深度写稿入口用), publish-checklist, prediction-card, 分发登记弹窗 etc
│   └── layout/                    # main-layout.tsx (按路径决定是否套 ExternalShell)
├── lib/
│   ├── cockpit/                   # model/workflow/schedule/calculations (纯函数, 零改动移植) + storage.ts(API 适配器) + migrations.ts(migrateWorkspace) + migrate-mapping.ts(存量数据映射) + script-mapping.ts(二期 T1: 生成结果→脚本骨架映射纯函数, 五期扩展 sections→body/hook 映射) + draft-restore.ts(六期: `ScriptDraft.output` → 抽屉改稿 UI 恢复字段的窄化解析纯函数, 形状嗅探同时覆盖 douyin `script.sections` 与 xiaohongshu 顶层 `intro`+`body` 两种形态) + generate-flow.ts(六期: 跳过二次保存的分支条件从只判 douyin 扩到 douyin/xiaohongshu, gongzhonghao 仍走二次保存) + extras.ts/extras-types.ts(复盘/大目标额外数据, 含二期新增 account/settings) + view-routing.ts(`NavView` 定义, 四期新增 `radar`)
│   ├── radar/                     # 四期新增: search.ts(SearchProvider 抽象 + Tavily 实现) / config.ts(RadarConfig 读写+加解密) / scoring.ts(titleFingerprint/clusterByTopic/composeHeat/applyTimeDecay 纯函数) / run.ts(runRadarScan 管线主体)
│   ├── script/                    # 五期新增: research.ts(runResearch 两阶段生成的阶段一, 雷达种子+Tavily+素材框合并→DeepSeek 提炼简报) / style.ts(getStyleContext 风格上下文切换 + depositStyleSample 定稿沉淀)
│   ├── image/                     # 七期新增: provider.ts(ImageProvider 抽象 + GptImageProvider, 直连 api.openai.com, b64_json 返回)
│   ├── llm/                       # DeepSeekTextLLM + OpenAIVisionLLM + prompts/ (四期新增 radar-read.ts; 五期新增 research-brief.ts / script-write-douyin.ts / script-refine.ts; 七期新增 image-plan.ts / resolve-image-key.ts(gpt-image key 解析, 无 .env 回退))
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
├── migrate-cockpit.ts             # 存量数据 → Cockpit 表, dry-run 默认 / --apply 写库
└── migrate-xhs-stages.ts          # 九期: xhs 存量 recording/editing 归并回 script, dry-run 默认 / --apply 写库
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
| 七期: 新增 `jszip` 运行时依赖 (本项目首个"为单一功能引入"的第三方包, 而非框架基础设施) | zip 发布包下载 (`images/archive/route.ts`) 要把多张 PNG + note.txt 打成一个 zip 供用户下载; Node 无内置 zip 打包能力, 手写 zip 格式成本远高于引入成熟库 |

---

## 9. 下一步

Phase A-C、工作台重定位 (Task 1-12)、Creator Cockpit 整体移植 (Task 1-14) 与平台页面融入驾驶舱 (二期, Task 1-8) 均已完成。 尚未做的:

1. **Phase D** — checklist 按平台拆分发布前检查项 (`src/lib/checklist/types.ts` 目前仍单一 schema)
2. **Phase E / SaaS 准备** — NextAuth 登录 + userId 中间件严格 scope + 计费, 本期范围外
3. **本地真用一段时间** — 用 default-user 走完整 Cockpit 闭环 (灵感→转内容→档期拖拽→今日勾选→阶段推进→发布登记→复盘录入), 找实际使用中的痛点
4. **人工走查一期 Task 14 未自动化验证项** — onboarding 冷启动、拖拽排期、双标签页 409 提示、明暗/5 风格切换、375px 移动端视觉 (见 `.superpowers/sdd/2026-08-04-cockpit-adoption/task-14-report.md`)
5. **人工走查二期 Task 8 未自动化验证项** — 抽屉三平台生成回填真机走查、discover 存灵感→灵感池 409 横幅、复盘/大目标新区块数据对照、立即同步真实入队观察、设置卡三项功能等价、明暗模式残留检查 (见 `.superpowers/sdd/2026-08-05-platform-pages-fusion/task-8-report.md` 待人工走查清单)
6. **遗留清理候选** — `PoolButton` 组件与 `TopicIdea`/`ideaId` 选题池链路现无任何 UI 入口 (二期起灵感只走 `CockpitInspiration`), 未来若确认不再需要可整体移除; cockpit 设置视图「账号管理」静态链接卡未单独拆文件 (内联在 `settings.tsx`), 后续扩展时再拆
7. **十期遗留 minor (已知不阻断使用)** — `truncateAngleSuggestion`/`pushCtaLines` 里个别防御性空分支在当前校验顺序下不可达 (zod 先一步抛错), 保留纯防御; `suggestedIntent` 只在生成响应里返回、不落库 `ScriptDraft.output`(重开草稿不保留 AI 建议, spec 未要求持久化); 体系报告「导出 .md」按钮的真实浏览器点击下载走查因扩展当次故障未做 (逻辑走读已确认, 待扩展恢复后补, 同七期先例)

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
