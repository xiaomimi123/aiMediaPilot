# 月度内容规划 Implementation Plan（三十八期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Spec:** 本文件 Context 节即需求真源（用户三决定已确认）。

# 三十八期：月度内容规划——「今天打开就有活干」

## Context

用户（自媒体小白）明确反馈：现有流程「每天找选题→写稿→出片」每步都要决策，第一步就卡死，导致无法行动发布。要的是流程翻转：**一次问答式规划 → 30 天内容路线全排好 → 每天打开只有执行（看今日卡→一键生成脚本→一键出片）**。

已与用户确认的三个决定：①选题纯常青（AI 按人设一次生成 30 天，全锁定，单天可换）；②脚本当天一键生成（规划只定选题+角度+钩子方向）；③每日任务到出片为止（发布沿用现有登记）。

## 核心复用（探索已验证）

- **人设档案**即向导写入目标，不新造表：`PersonaProfile`（含 `pillars` 内容支柱）+ `CreatorVoice`（写入路由 `/api/v1/voice/profile` 已存在）+ 起草-回填模式参照 `src/app/api/v1/persona/draft/route.ts`
- **规划 prompt 注入**：`buildPersonaSection(profile, 'topic')`（`src/lib/llm/prompts/persona-section.ts`——'topic' scope = 受众+支柱+痛点，语义正合，已验证存在）
- **每日脚本**：现有 `POST /api/v1/scripts/generate`（topic=当天选题，materials=`角度:…；钩子方向:…`，niche 照现状传 `'ai-knowledge'`，零侵入）
- **一键出片**：现有 `POST /api/v1/video-templates/[id]/produce` body `{scriptDraftId}`；出镜模板照旧需 upload-source
- **30 条同步生成先例**：`TOPIC_DISCOVERY`（`src/lib/llm/prompts/topic-discovery.ts`）现网同步生成 30 条×6 字段，本功能单条更小 → **同步 HTTP，不建队列**（显式 maxTokens≈6000 防截断）
- **导航/待办挂钩**：`src/lib/nav.ts` 加一行；`src/lib/cockpit/overview.ts::buildTodos` 加字段+push 一条
- 旧 `CockpitGoalCycle/ScheduleObject` 字段不对口不复用；`TopicIdea` 已死不碰

## 数据模型（新建两表，`prisma/schema.prisma`）

```prisma
model ContentPlan {      // 一用户同时仅一条 active；生成新规划自动 archive 旧的（服务端强制）
  id/userId/startDate(YYYY-MM-DD)/totalDays(30)/weeklyCadence/defaultTemplateId?
  personaSnapshot Json   // 生成时的 {audience,pillars,angle,avoid} 快照——档案事后可改，规划要可回溯且内部风格一致
  status active|archived
}
model ContentPlanDay {   // @@unique([planId, dayIndex])
  dayIndex 1..30         // 不冗余存日期——实际日期 = startDate+dayIndex 由纯函数算，防两处漂移
  pillarName/topic(≤60)/angle(≤120)/hookDirection(≤120)
  status pending|scripted|produced   // 只前进不回退
  scriptDraftId?/videoProductionId?/edited(手动改过标记)
}
```

状态机：`pending →(生成脚本)→ scripted →(出片)→ produced`；「换个选题」（reroll）仅 pending 可用——已产出的内容不许被选题覆盖。

## 任务拆分（SDD，六任务）

### Task 1: 数据模型+规划生成接口

schema 两表（改后必须重启 dev+worker）；`src/lib/content-plan/model.ts`（zod：`days` 用 `.length(30)` 严格——**不接受部分成功**，校验过了才开事务落库）；`day-index.ts` 纯函数 `dayIndexFor(startDate, today)`；新 prompt `src/lib/llm/prompts/content-plan-generate.ts`（输入=personaSection('topic')+voiceSection+节奏参数；pillarName 动态 `z.enum([...快照支柱名,''])` 加固）；`POST /api/v1/content-plans/generate`（已有 active 先 archive）。测试：dayIndexFor 边界；不足 30 条整次失败不落库；旧规划被归档。

### Task 2: 单天操作接口

`PATCH .../days/[dayIndex]`（手动编辑三字段，打 edited）；`POST .../reroll`（单天重生成，avoid=本天原题+其余 29 天题目防撞题；scripted/produced 拒绝 409）。

### Task 3: 联动动作

组合动作「调 generate 成功→PATCH 回填 scriptDraftId+scripted」「调 produce 成功→回填 videoProductionId+produced」。测试要点：generate 成功但 PATCH 失败时不能状态卡死（给手动同步入口）。

### Task 4: 问答向导

(`/plan` 无活跃规划时展示)五问——①做什么方向→AI 起草成 pillars（照 persona/draft 起草-回填两段式）②给谁看→audience ③你有什么可讲→CreatorVoice.identity（复用 `/api/v1/voice/profile`）④每周拍几条 ⑤默认模板（下拉 VideoTemplate）。**已建档者①②③直接预填确认卡两秒过**。保存时序：先档案后规划，中途失败不产生悬空态。

### Task 5: /plan 主态页面

列表（今天高亮；日历视图 YAGNI 后置）+ 今日卡三态（pending：生成脚本/换选题；scripted：脚本卡+用模板出片[预选 defaultTemplateId]；produced：成片卡+完成态）。纯函数 `planDayStatusLabel/nextAction` 单测；`pillarRotation` 校验（某支柱 30 天未出现→warning 不重生成）。

### Task 6: 导航+总览

nav.ts 工作区组加 `{href:'/plan', label:'规划', hint:'AI 排好 30 天选题，今天打开就有活干'}`；`buildTodos` 加 `todayPlanDayPending` → push「今天的内容还没写」（tone:warn，排在超时稿之后雷达堆积之前）。

依赖：T1→T2→(T3∥T4)→T5→T6。

## YAGNI（明确不做）

热点位、发布打卡、多规划并存、延误自动顺移/重排、整周批量操作、完成率看板、生成队列化（同步先跑，真超时再迁——接口签名不变）。

## 验证

- 每任务 TDD + 本仓惯例（zod strict、错误措辞契约、`git add` 点名、build 由控制者跑）
- 终审真机端到端：空档案走完五问向导 → 生成 30 天规划 → 今日卡点「生成今日脚本」出六幕稿 → 点「用模板出片」拿到 videoProductionId → 总览待办出现/消失联动；单天 reroll 不撞题抽查
- 规划生成的 LLM 质量抽查：30 条选题是否覆盖全部支柱、是否有重复题（pillarRotation warning 路径真机触发一次）
