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

## 6. 实际实施结论（T1-T6 落地后回写，2026-08-13）

设计文档写于实施前，以下是与草稿假设有出入、或草稿未覆盖、需要落盘存档的实际决策，逐条对应 `progress.md` 里的账本条目：

**(a) Tavily 真实 API 形状与假设有偏差（T2）**：草稿假设的请求体是 `{api_key, query, ..., days, topic}`。WebFetch 核对官方文档（`docs.tavily.com`）后发现两处实质出入：① 鉴权走 `Authorization: Bearer <key>` header，不是 body 里的 `api_key` 字段；② 没有 `days` 参数，走 `time_range: 'day'|'week'|'month'|'year'`——为不破坏对外接口约定，`search.ts` 内部做了分桶换算（`≤1→day / ≤7→week / ≤31→month / 其余→year`）。已按官方文档实现，`SearchResult` 对 T4 消费方的类型契约不受影响。未能用真实 key curl 一次验证，注释里如实注明这是「文档为准」而非「实测为准」，真实形状最终以用户接入后跑出的结果为准。

**(b) 缺 `DEEPSEEK_API_KEY` 的就绪检查方案（T4→T6 闭合）**：`runRadarScan` 本身在 worker 每日 tick 场景下对「未启用/无 Tavily key/无 DEEPSEEK_API_KEY」一律静默返回、不建 `RadarRun`——这对无人值守场景是对的（不该报错吵人）。但手动点击「立即扫描」若复用同一条静默路径，用户排了队却永远等不到反馈，分不清是队列卡住还是配置缺失。最终方案：`POST /api/v1/radar/trigger` 入队前**重复一次同样的判断**并给出明确 HTTP 状态区分——`enabled=false` 或无 Tavily key → 400；服务端环境变量缺 `DEEPSEEK_API_KEY` → 503。两处判断逻辑不同步的风险可接受：trigger 侧只影响「要不要提前拒绝」，`runRadarScan` 仍是「跑不跑、怎么跑」的单一事实来源。因此**不存在专门的"就绪检查" Run 记录**——信号来自 trigger 响应状态码本身，而非查询历史 Run。

**(c) adopt 幂等守卫用 409（T5→T6 闭合）**：`PATCH /api/v1/radar/items/[id] {action:'adopt'}` 初版无状态守卫，双击会因两次请求都读到 `status='new'` 而各自建一条 `CockpitInspiration`，产生孤儿灵感卡（第二条 `inspirationId` 覆盖第一条，第一条再也追溯不回雷达条目）。收尾方案：服务端 `item.status !== 'new'` 一律 `fail(..., 409)`；`ignore` 动作走同一守卫。前端加 pending 态禁用双击是第一道防线，服务端 409 是网络重试/多标签页等 UI 层防不住场景的兜底。

**(d) `GET /api/v1/radar/runs/latest` 独立轻路由，而非并入 `radar/config`**：雷达视图底部「上轮运行摘要」需要的运行统计（`searched/read/kept/errorsCount`）本可以塞进 `radar/config` GET 响应里省一次 fetch，但那样会让 `RadarConfigSafe`（`hasKey/dailyLimit/enabled` 的稳定契约）承担两个不相关的关注点。挑轻方案：独立路由，成本只是多一次 fetch（雷达视图本来就要并发拉 items/keywords/config，多一个不增加往返轮数）。从未跑过扫描时返回 `{run: null}`，前端据此展示引导文案而非一行全零摘要。

**(e) 同 URL 多词只记首词——保守偏差（T4，遗留未处理）**：同一 URL 在多个关键词的搜索结果里命中时，`matchedKeywords` 只记录首次命中的关键词，不跨关键词合并。这不影响 URL/标题指纹去重的正确性，只是展示层的「命中关键词」标签会少列几个——共现加成计算若依赖 `matchedKeywords` 的关键词数量，会偏保守（低估共现强度）。当前调参未触及此偏差；若未来热度公式改为强依赖多词共现，需要回来补上跨关键词合并。

**(f) 其余实际偏差（详见 `.superpowers/sdd/2026-08-13-radar-deep-collection/progress.md`）**：
- `tavilyKeyEncrypted` 用空串表示"未配置"（`@default("")` 而非 nullable），`getRadarConfig`/`getDecryptedTavilyKey` 均显式判空串短路，避免对空串跑 AES-GCM decrypt 抛错（T1/T2）。
- `getSearchProvider` 最终签名是 `(apiKey: string)` 而非草稿设想的 `(config)`，调用方自行从 `RadarConfig` 取出解密后的 key 再传入（T2/T4）。
- `clusterByTopic` 是 O(n²) 实现，日频量级（每日 ≤20 篇）无碍；千级量级需要换算法，聚簇内顺序未定义、消费方不得依赖（T3/T4）。
- worker 每日 repeat 调度层（BullMQ repeatable job 本身的触发时机）没有直接测试，循 `auto-sync-worker` 先例走人工验证——管线核心（纯函数热度合成/搜索层/阅读 prompt/API 路由）全部有 mock 测试覆盖。
- 侧栏插入「热点雷达」项导致 `WORKBENCH_NAV_ITEMS` 下标后移，顺手修了 `external-shell.tsx` 里依赖下标 `[1]` 的移动端捷径（改按 `id` 查找）；移动端捷径未新增雷达入口（符合 brief 范围）。
- 视图/设置卡的 DTO 类型在前端有重复定义（未抽共享类型），四路 fetch（items/keywords/config/runs-latest）已统一错误面 + 重试文案；重试按钮刻意不置 loading 态（已在代码内注释原因）。
- 真实 Tavily + 真实 DeepSeek 的全链路端到端，全期均未跑通（无可用真实 Tavily key）；管线设计已支持，验证责任转移给用户接入真实 key 后自验，与 DeepSeek key 先例一致。
