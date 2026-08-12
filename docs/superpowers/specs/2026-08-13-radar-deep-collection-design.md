# AI 深度采集 · 热点雷达（cockpit 四期）

**日期:** 2026-08-13
**背景:** 用户判断公开热榜数据不够准确，要求「AI 阅读式」深度采集：按行业关键词全网搜索→逐篇阅读→提炼→评估热度，并具备关键词学习能力。评估过 ego-lite（AI 代理浏览器）后确认其不适合无人值守管线；本期为纯服务端方案，**零 Claude 额度消耗**（阅读评分走用户自己的 AI provider，现为 DeepSeek）。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 执行体 | 应用内管线：BullMQ 定时 job + 用户自己的 AI key（拒绝定时 Claude 代理方案——用户明确不消耗 Claude 额度） |
| 内容源 | 搜索驱动全网深读：行业关键词 → 搜索 API（默认 Tavily，返回干净正文；抽象接口可换）→ 逐篇 AI 阅读 |
| 学习深度 | 关键词自进化（AI 从高热内容提取候选词 → 用户审批采纳/忽略）；复盘反哺权重明确不做（样本不足易过拟合） |
| 落地形态 | 独立「热点雷达」侧栏视图（灵感库选题正下方）；采纳动作写入灵感库（走既有事务化 inspirations 路由） |

## 1. 管线

每日定时（BullMQ repeatable，仿 auto-sync-worker 模式）+ 雷达页「立即扫描」手动触发（仿二期 trigger 超时模式）：

```
活跃 RadarKeyword → Tavily 搜索（近期结果，含正文）→ URL+标题指纹双去重
→ AI 逐篇阅读（zod 结构化输出：摘要 / 可做角度 / 相关度 / 新鲜度 / 讨论强度 / 可做性 / 候选关键词）
→ 相关性闸门（relevance < 40 丢弃不入库）
→ 热度合成（四维加权 + 同话题跨源共现加成；展示时叠加时间衰减）
→ 写 RadarItem + 候选词入 RadarKeyword(candidate) + RadarRun 运行日志
```

每日阅读上限默认 20 篇（成本护栏，可配）。预估成本：DeepSeek 每篇几厘，Tavily 免费档每月 1000 次检索足够。

## 2. 数据模型（服务端域，不进 cockpit workspace state）

- `RadarKeyword`：`{id, userId, text, status: 'active'|'candidate'|'ignored', source: 'manual'|'ai', createdAt}`
- `RadarItem`：`{id, userId, url, titleHash(去重指纹), title, sourceSite, publishedAt?, collectedAt, matchedKeywords Json, aiSummary, aiAngle, heatScore Int, heatFactors Json(四维+共现), status: 'new'|'adopted'|'ignored', inspirationId?, runId}`
- `RadarRun`：`{id, userId, startedAt, finishedAt?, keywordsUsed Json, searched, read, kept, errors Json}`
- `RadarConfig`：`{userId(单行), tavilyKeyEncrypted(复用 AIConfig 的 AES-256-GCM 加密), dailyLimit(默认 20), enabled}`

架构原则：雷达数据由视图自取数（dashboard summary 先例），**不撑大 WorkspaceState、不扩大 409 面**；「收入灵感库」调用既有 `POST /api/v1/cockpit/inspirations`（事务 + bumpCockpitRev 白送）并回写 RadarItem.adopted + inspirationId。

## 3. 视图与设置

- 侧栏「热点雷达」（灵感库选题正下方，工作台组内；单色字形，无 emoji）。页面三块：
  1. 候选关键词审批条（页顶）：AI 新词一键采纳/忽略
  2. 热度排行：卡片（热度分+分项可解释 / 来源链接 / AI 摘要 / 可做角度 / 命中词标），动作 收入灵感库 / 忽略；关键词分组筛选
  3. 「立即扫描」+ 上轮运行摘要一行
- 设置视图新增「雷达配置」卡：Tavily key（加密存储）、关键词管理（增删/启停）、每日上限、开关。

## 4. 不做（YAGNI）

复盘反哺关键词权重；需登录态的源（抖音热点宝等——将来 ego-browser 交互式补采）；趋势曲线（v2）；候选词自动采纳；多搜索源并发（抽象接口先留、单实现起步）。

## 5. 风险

| 风险 | 对策 |
|---|---|
| 搜索质量参差 | 相关性闸门 <40 丢弃；关键词可随时停用 |
| 热度分主观 | 分项因子透明入库、排行页可解释展示 |
| 重复刷屏 | URL + 标题指纹双去重；同话题聚簇计共现而非重复入库 |
| Tavily 单点依赖 | SearchProvider 抽象接口，实施仅 Tavily 一个实现 |
| 真实 E2E 依赖用户 key | 管线全链路可 mock 测试；真实跑一轮需用户配 Tavily key 后自验（同 DeepSeek key 先例） |
