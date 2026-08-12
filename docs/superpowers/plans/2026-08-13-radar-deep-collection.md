# AI 深度采集 · 热点雷达 (cockpit 四期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服务端 AI 深度采集管线（关键词→Tavily 搜索→DeepSeek 逐篇阅读评分→热度合成→雷达池）+ 独立「热点雷达」视图（候选词审批/热度排行/立即扫描）+ 设置「雷达配置」卡。零 Claude 消耗。Spec: `docs/superpowers/specs/2026-08-13-radar-deep-collection-design.md`。

**Architecture:** 雷达为服务端域（视图自取数，学 dashboard summary 先例，不进 WorkspaceState）；采纳入灵感库复用既有事务化 inspirations 路由；worker 仿 auto-sync-worker 重复任务模式；手动触发仿二期 trigger 超时模式。搜索层 `SearchProvider` 抽象 + Tavily 单实现；阅读评分走既有 `AIConfig` 体系（DeepSeek）。

**Tech Stack:** 同前 + Tavily HTTP API（无 SDK 依赖，直接 fetch）。

## Global Constraints

- **零新增 cockpit workspace 写路径**：唯一写 cockpit 表的动作是「收入灵感库」，且必须复用 `POST /api/v1/cockpit/inspirations` 的事务逻辑（create+bump 同事务）——采纳路由在服务端直接调用同等事务（cockpitInspiration.create + bumpCockpitRev(tx)）并同事务更新 RadarItem。
- Tavily key 用 `src/lib/crypto`（AIConfig 同款 AES-256-GCM——先核实实际模块路径/函数名）加密存储；任何响应不得回显明文 key（掩码同 AIConfig 先例）。
- AI 阅读输出走 zod 结构化校验（`src/lib/llm/prompts/` 体系新增 radar-read prompt，`callStructured` 复用）；相关性 <40 丢弃。
- 纯函数可测：热度合成、去重指纹、共现聚簇必须是无 IO 纯函数单测覆盖。
- API 一律 `ok()/fail()` + `getOrCreateDefaultUser()`；路由测试 house mock 约定。
- UI 无彩色 emoji；新视图/卡片用 cockpit 字形与 `.panel` 体系。
- 每 Task 结束 `npm run typecheck && npm run test` 过后 commit（含路由/构建的加 build）；commit 尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。
- 每日上限硬闸门在 worker 内实施（读满即停），不依赖前端。

---

## Task 1: 数据模型（4 表）

**Files:** Modify `prisma/schema.prisma`（RadarKeyword / RadarItem / RadarRun / RadarConfig 按 spec §2 字段；User 反向关系；`@@index([userId, status])` on keyword/item，`@@index([userId, heatScore])` on item；RadarItem.url + userId 唯一约束防重）；`npm run db:push`。
**Interfaces:** Produces 四模型供 T2-T5。
- [ ] Step 1: 模型 + push + typecheck/test 全绿；commit `feat(radar): 雷达数据模型 (4 表)`

## Task 2: 搜索层 + 配置存取

**Files:** Create `src/lib/radar/search.ts`（`SearchProvider` 接口 `{search(query, opts): Promise<SearchResult[]>}`，`SearchResult = {url, title, content, publishedAt?, sourceSite}`；`TavilySearchProvider`（fetch `https://api.tavily.com/search`，`search_depth:'advanced'`, `include_raw_content:true`, `days` 近期过滤——以 Tavily 实际 API 文档字段为准，实施时用 curl 验证一次真实响应形状再定型）；Create `src/lib/radar/config.ts`（RadarConfig 读写 + key 加解密复用 AIConfig 的 crypto 模块——先 grep 实际实现路径）；Test `tests/lib/radar/search.test.ts`（mock fetch：正常/空/401/超时）+ config 加解密往返测试。
**Interfaces:** Produces `getSearchProvider(config)` 与 `getRadarConfig/saveRadarConfig` 供 T4/T5。
- [ ] Step 1: TDD 实现；commit `feat(radar): Tavily 搜索层 + 加密配置存取`

## Task 3: 阅读评分管线（纯函数核心）

**Files:** Create `src/lib/llm/prompts/radar-read.ts`（system/user prompt + zod：`{summary(≤120字), angle(≤80字), relevance 0-100, freshness 0-100, discussion 0-100, feasibility 0-100, suggestedKeywords string[](0-3)}`，prompt 面向「AI 知识类抖音创作者」视角评估）；Create `src/lib/radar/scoring.ts` 纯函数：`titleFingerprint(title)`（规范化+hash）、`clusterByTopic(items)`（标题指纹/关键词重合聚簇）、`composeHeat(read, cooccurrence)`（四维加权：relevance .35 / freshness .2 / discussion .25 / feasibility .2，共现每 +1 源 +8 分封顶 +24，clamp 0-100）、`applyTimeDecay(score, collectedAt, now)`（展示层用：每 24h -8 分，floor 30%）。**权重常量集中导出便于调参。**
**Test:** `tests/lib/radar/scoring.test.ts` TDD 全覆盖（指纹归一/聚簇/加权/封顶/衰减边界）；prompt schema 解析用例。
- [ ] Step 1: RED→GREEN；commit `feat(radar): 阅读 prompt + 热度合成纯函数`

## Task 4: worker + 手动触发

**Files:** Create `src/jobs/workers/radar-worker.ts`（重复任务每日一次仿 auto-sync-worker 注册；主体：读 config(enabled/上限) → 活跃词逐个搜索 → 双去重(URL 唯一约束 + titleFingerprint 对库) → 逐篇 `callStructured` 阅读（失败单篇跳过记 errors）→ 闸门 <40 丢弃 → 聚簇共现 → composeHeat → 事务写 RadarItem 批 + suggestedKeywords 去重后入 candidate → RadarRun 完整记录；读满 dailyLimit 即停）；注册到 `src/jobs/workers/index.ts`；Create `src/app/api/v1/radar/trigger/route.ts`（Promise.race 4s 超时 → 503，二期先例）。
**Test:** `tests/jobs/radar-worker.test.ts`（mock search/llm/prisma：正常轮/闸门丢弃/上限截停/单篇失败不断轮/候选词去重）+ trigger 路由测试。
- [ ] Step 1: TDD 实现；commit `feat(radar): 采集 worker (每日+手动触发)`

## Task 5: API 层

**Files:** Create `src/app/api/v1/radar/items/route.ts`（GET `?status=&keyword=` 列表，默认 status=new 按 heatScore 降序，展示分带 applyTimeDecay）；`items/[id]/route.ts`（PATCH `{action:'adopt'|'ignore'}`——adopt：**单事务** cockpitInspiration.create(text=title+angle+summary+url) + bumpCockpitRev(tx) + RadarItem 更新 adopted/inspirationId；ignore 仅状态）；`keywords/route.ts`（GET 全量分组 / POST 新增手动词）；`keywords/[id]/route.ts`（PATCH status：candidate→active/ignored、active⇄ignored）；`config/route.ts`（GET 掩码 / PUT 保存）。
**Test:** `tests/api/radar/*.test.ts` house 约定：adopt 事务断言（create+bump+update 同 tx）、ignore、列表过滤排序、keywords 状态机、config 掩码不回显明文。
- [ ] Step 1: TDD 实现；commit `feat(radar): 雷达 API (items/keywords/config/adopt 事务)`

## Task 6: 雷达视图 + 设置卡 + 侧栏

**Files:** Create `src/components/cockpit/views/radar.tsx`（自取数：items+keywords+last run；三块布局按 spec §3——候选词审批条 / 热度排行卡（分数+分项 title 提示、来源链接 target=_blank、摘要/角度、命中词 .badge、收入灵感库/忽略按钮，动作后本地移除+提示）/ 底部 立即扫描（trigger，toast）+ 上轮摘要行；空态引导去设置配 key）；Create `src/components/cockpit/settings-cards/radar-config-card.tsx`（key 输入(掩码显示)/每日上限/开关/关键词管理列表）；Modify `sidebar.tsx`+`view-routing.ts`（新 NavView `'radar'`，工作台组灵感库选题下方；测试矩阵补 radar 用例）；Modify `views/settings.tsx` 挂卡；`Cockpit.tsx` 挂视图。
**Interfaces:** Consumes T5 API。无 emoji；`.panel` 体系。
- [ ] Step 1: 实现 + view-routing 测试扩展；dev 手工走查（空态/配置/审批/排行动作）；commit `feat(radar): 热点雷达视图 + 设置卡 + 侧栏项`

## Task 7: 收尾 — 文档 + 端到端

**Files:** README（雷达功能段 + 配置说明 + 成本说明）、spec 回写实际结论。
- [ ] Step 1: 文档；Step 2: 端到端清单：①无 key 空态引导 ②配 key(假)后 trigger→RadarRun 记录 errors ③mock 数据下排行/审批/采纳→灵感库出现+雷达卡变 adopted（采纳事务实测）④关键词状态机 ⑤侧栏/寻址/明暗/无 emoji 扫描 ⑥typecheck+test+build 全绿；**真实全链路（真 Tavily key + 真 DeepSeek 阅读）标注为用户配 key 后自验项**；Step 3: commit `docs(radar): 四期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 管线(T3/T4) ✓ §2 模型+架构原则(T1, adopt 事务 T5) ✓ §3 视图/设置(T6) ✓ 学习=候选词审批(T4 产出+T5 状态机+T6 审批条) ✓ YAGNI 边界未越 ✓。
- 前期教训内嵌：cockpit 写必须事务+bump（T5 adopt）、trigger 超时先例（T4）、纯函数先行 TDD（T3）、真实 API 形状先 curl 验证再定型（T2 Tavily）、密钥加密+掩码（T2/T5/T6）、无 emoji（T6）、真实 E2E 依赖用户 key 提前声明（T7）。
- 类型一致性：SearchResult T2=T4 消费 ✓；radar-read zod T3=T4 ✓；heatFactors Json T3 产出=T5/T6 展示 ✓。
