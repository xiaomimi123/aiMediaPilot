# 三十一期：生成前剪辑台（FilmPlan 工作台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **执行前提**：三十期完成（只剩 Remotion 一条渲染路）。用户已拍板（2026-09-03）：调的对象 = FilmPlan 分镜方案；预览 = renderStill 静态卡面（架构留逐镜动态渲染的位置）；素材挂载不在本期。开工前重跑冲突扫描。

**Goal:** 在成片详情页给用户一个「生成前剪辑台」：模型产完 FilmPlan 后先停一步，用户逐镜查看卡面、改文字/换卡/调时长，确认后才渲染。

**Architecture:** 新增一个可选的暂停点：`vp.status = 'plan_ready'`（模型产完 plan、未渲染）。剪辑台读落库的 `filmPlan`，每镜用 `renderStill` 出一张卡面图（服务端渲染、按 plan 内容 hash 缓存），编辑操作全部经 `FilmPlanSchema` + `checkFilmPlanTiming` 校验后写回 `filmPlan`，点「开始渲染」继续走渲染段。不引入新的存储形态——剪辑台读写的就是生产用的那份 plan，**所见即所渲**。

**Spec:** 本计划自带设计（上一段 + 关键决定），实施中与 `2026-08-31-remotion-migration-design.md` §2 填槽契约对齐。

## 关键设计决定

1. **暂停点是可选的**：面板上一个开关「渲染前先让我看一眼分镜」（默认开）。关掉则行为与三十期一致（产完直接渲）。worker 在产完 plan 后检查该开关：开 → `setStatus('plan_ready')` 返回；用户确认 → 面板调 `POST .../render` 重新入队，worker 发现已有 plan 且 status 来自确认 → 跳过产 plan 直接渲。
2. **编辑能力以 schema 为界**：能改的 = 槽位文字、卡片类型（换卡时槽位按目标卡重填，界面引导）、时间窗（拖拽或数字输入）。**不能改的 = schema 外的一切**（坐标/颜色/动效——填槽架构的立身之本，剪辑台不开后门）。每次保存走 `FilmPlanSchema.safeParse` + `checkFilmPlanTiming`，错误用与修复循环同源的措辞展示给用户（人读的和模型读的是同一套错误文案——它们已被实测打磨过）。
3. **卡面图服务端 renderStill**：`GET /api/v1/cockpit/video-productions/[id]/shot-still/[shotIndex]` → 渲该镜中点一帧 PNG，缓存键 = shot 内容 JSON 的 hash，plan 改了自动失效。首屏 17 镜并发渲 still 的耗时**执行时先量**（bundle 已缓存，预期每张 <1s；超过 3s/张就上懒加载 + 队列）。
4. **时间窗编辑的守恒约束**：总时长锁定（等于 TTS 音频时长）——拖一镜的边界是在**相邻两镜间转移时长**，不是凭空加减。UI 上做成相邻联动的拖柄，这样 `checkFilmPlanTiming` 的「铺满不留空档」天然满足。
5. **动态预览留位不实现**：卡面图组件接口带 `mode: 'still' | 'clip'`，`'clip'` 本期渲染为禁用态提示。

## Task 概要

### Task 1: 暂停点与状态机
- `plan_ready` 状态加进状态机与面板文案；worker 产 plan 后按开关停/不停；确认路由重新入队（jobId 幂等语义沿用 start 路由的先例——先删旧 job 再加）。
- 状态机测试：开关开 → plan_ready；确认 → 渲染完成；开关关 → 直达 preview_ready。

### Task 2: FilmPlan 读写 API
- `GET/PUT /api/v1/cockpit/video-productions/[id]/film-plan`；PUT 全量替换（不做逐镜 PATCH——plan 就几 KB，全量简单且校验完整）；校验失败返回与修复循环同源的错误文案数组。
- 测试：合法改写通过；时间轴留空档被拒且错误文案含具体毫秒数；schema 外字段被拒。

### Task 3: renderStill 卡面接口
- 复用三十期的 `renderShotStill`；hash 缓存落 `productionRoot/stills/`；接口鉴权与文件路由沿用 `[id]/file` 先例。
- 测试：同内容二次请求命中缓存（mtime 不变）；改 plan 后重新渲。

### Task 4: 剪辑台 UI
- 成片详情页（`film-detail.tsx` 所在板块）新增分镜条：横向卡面缩略图列表 + 选中镜的编辑抽屉（卡类型选择器 / 槽位表单（按卡类型动态出字段，字数上限即 schema 上限，超限即时红）/ 时间窗拖柄）。
- 保存 → PUT → 刷新该镜 still；「开始渲染」→ 确认路由。
- 布局沿用本板块既有的单页纵向结构（二十三期排版结论：页面级两栏被实测否决过，别再试）。

### Task 5: 端到端 + 文档
- 真机：新建任务 → plan_ready 停下 → 界面上改一镜文字 + 换一张卡 + 拖一次时长 → 渲染 → 成片体现全部三处改动（抽帧核对）。**用户亲手操作一遍是验收门。**
- README 新节「生成前剪辑台」；docs/ 下补 `docs/film-plan-workbench.md`（用法 + 设计取舍，按全局文档规则）。

## Self-Review 要点
- 最大 UX 风险：still 渲染慢导致首屏白格子——Task 3 的耗时实测是硬前置，量完再定加载策略。
- 换卡时槽位迁移（statement→stat 时 text 塞哪）没有无损映射——界面上做成「换卡=清空重填该镜」，诚实优于聪明。
- 用户改完的 plan 再触发「重新生成」会被模型覆盖——确认对话框里写明这一点（改动会丢），并在 worker 里让「重新生成」跳过 plan_ready 开关直接产新 plan。
