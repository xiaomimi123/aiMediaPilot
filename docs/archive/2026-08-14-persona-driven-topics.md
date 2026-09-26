# 人设定位驱动选题 (cockpit 八期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人设档案（AI 访谈起草+设置卡编辑）注入雷达评分/选题灵感/写稿角度，让全链路选题围绕「我是谁、我要吸引谁」。Spec: `docs/superpowers/specs/2026-08-14-persona-driven-topics-design.md`。

**Architecture:** PersonaProfile userId 单行表（学 StyleProfile）；`buildPersonaSection` 纯函数是唯一注入实现，四个 prompt 拼接消费；雷达侧新增 `pillarHit` 输出 + `applyPersonaAdjust` 后处理调权；无档案时全链路行为与现状严格一致（回退零迁移）。

**Tech Stack:** 同前（无新依赖）。

## Global Constraints

- **回退语义**：无档案（`audience` 空或 `pillars` 空）时一切行为与现状完全一致——prompt 不注入、评分不调权、无徽标；`loadPersonaProfile` 未建立返回 null，`buildPersonaSection(null)` 返回 `''`。
- 字段上限：audience/targetFans/angle/avoid ≤300 字；pillar name ≤10 字、description ≤60 字；pillars 0-5 条（建立判定要求 ≥1）。
- pillarHit 宽进严出：模型输出必须严格等于档案某支柱 name，否则按 null 处理（`validatePillarHit` 纯函数）。
- 调权常量集中导出：`PERSONA_ADJUST = { pillarBonus: 8, offPillarFactor: 0.7 }`（同 HEAT_WEIGHTS 先例）；命中 +8 clamp 100，有档案未命中 ×0.7 四舍五入，无档案不动；heatFactors 记 `personaAdjust: number`（实际加减值）。
- 老雷达条目无 pillarHit：不渲染徽标、不调权（展示层防御）。
- draft 起草只回填表单不落库，保存才 PUT（草稿不覆盖已存档案）。
- DeepSeek key 一律 resolveDeepSeekApiKey（draft 路由无 key 503）；gongzhonghao 写稿 prompt 不动。
- UI 无彩色 emoji（徽标单色 .badge 体系）；API house 约定 ok()/fail() + getOrCreateDefaultUser。
- 每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 档案数据层（表 + 纯函数 + profile API）

**Files:** Modify `prisma/schema.prisma`（PersonaProfile 照 spec §1 逐字：`userId String @id, audience String @default(""), targetFans String @default(""), pillars Json @default("[]"), angle String @default(""), avoid String @default(""), updatedAt DateTime @updatedAt`，无 User 关系）+ `npm run db:push`；Create `src/lib/persona/profile.ts`；Create `src/lib/llm/prompts/persona-section.ts`；Modify `src/lib/llm/prompts/index.ts` 导出；Create `src/app/api/v1/persona/profile/route.ts`；Test `tests/lib/persona/profile.test.ts`、`tests/lib/llm/prompts/persona-section.test.ts`、`tests/api/persona/profile.test.ts`。
**Interfaces (Produces):**
```ts
// src/lib/persona/profile.ts
export interface PersonaPillar { name: string; description: string }
export interface PersonaProfileData { audience: string; targetFans: string; pillars: PersonaPillar[]; angle: string; avoid: string }
export const PersonaProfileSchema = z.object({
  audience: z.string().max(300), targetFans: z.string().max(300),
  pillars: z.array(z.object({ name: z.string().min(1).max(10), description: z.string().max(60) })).max(5),
  angle: z.string().max(300), avoid: z.string().max(300),
});
export function isProfileEstablished(p: PersonaProfileData): boolean  // audience.trim() 非空 && pillars.length ≥ 1
export async function loadPersonaProfile(userId: string): Promise<PersonaProfileData | null>
// findUnique({where:{userId}}) → 无行或 !isProfileEstablished → null；pillars Json 防御解析（畸形条目丢弃）
export function validatePillarHit(hit: unknown, pillars: PersonaPillar[]): string | null  // 严格等于某 name 才返回, 否则 null
// src/lib/llm/prompts/persona-section.ts
export function buildPersonaSection(profile: PersonaProfileData | null): string
// null → ''；非 null → 中文结构化段：目标受众/想吸引的粉丝/内容支柱(逐条 name：description)/差异化角度/忌讳（空字段行省略）
```
profile API：GET 无行返回全空默认对象 + `established: boolean`；PUT body 走 PersonaProfileSchema（非法 400）upsert 全量覆盖。
- [ ] Step 1: TDD（isProfileEstablished 边界、loadPersonaProfile 畸形 pillars 防御、validatePillarHit 严格匹配/大小写不同→null、buildPersonaSection null 空串+字段省略、API GET/PUT 往返与 400）；commit `feat(persona): 人设档案数据层 + 注入段纯函数`

## Task 2: 访谈起草（prompt + draft 路由）

**Files:** Create `src/lib/llm/prompts/persona-draft.ts`；Modify `src/lib/llm/prompts/index.ts`；Create `src/app/api/v1/persona/draft/route.ts`；Test `tests/lib/llm/prompts/persona-draft.test.ts`、`tests/api/persona/draft.test.ts`。
**Interfaces:**
```ts
// persona-draft.ts —— responseSchema 直接复用 T1 PersonaProfileSchema 加 pillars min(3)（起草要求 3-5 条）
export const PersonaDraftResponseSchema = PersonaProfileSchema.extend({
  pillars: z.array(z.object({ name: z.string().min(1).max(10), description: z.string().min(1).max(60) })).min(3).max(5),
});
export const PERSONA_DRAFT = {
  buildSystemPrompt(niche: string): string,   // 定位教练角色: 基于访谈与既有创作痕迹起草人设档案; 支柱要具体可选题, 拒绝"分享干货"式空话
  buildUserMessage(input: { answers: { q: string; a: string }[]; styleDescription: string; sampleExcerpts: string[]; radarKeywords: string[] }): ContentPart[],
  responseSchema: PersonaDraftResponseSchema,
};
```
draft 路由：`POST body { answers: [{q: string, a: string}] 1-8 条, a 可空串 }`（非法 400）→ resolveDeepSeekApiKey 无 key 503 → 组装输入：answers + StyleProfile.description（无行 ''）+ 最近 3 篇 StyleSample.content 各截前 200 字 + RadarKeyword(status='active') 的 text 列表 → callStructured(PERSONA_DRAFT) → `ok({ draft })`——**不落库**。
- [ ] Step 1: TDD（schema 边界、system 关键词「支柱」「具体」断言、路由 400/503/成功不调 upsert、输入组装断言）；commit `feat(persona): AI 访谈起草 prompt + draft 路由 (不落库)`

## Task 3: 雷达注入（评分语义 + pillarHit + 调权）

**Files:** Modify `src/lib/llm/prompts/radar-read.ts`（`buildSystemPrompt(niche: string, personaSection?: string)`——personaSection 非空时拼入并把 relevance 语义句换为「对上述定位的价值」，空/缺省保留原句原文案；zod 加 `pillarHit: z.string().max(10).nullable().optional().default(null)`；system 在有 persona 时要求输出命中的支柱名或 null，无 persona 时不提 pillarHit——schema optional 兼容两态）；Modify `src/lib/radar/scoring.ts`（新纯函数 `applyPersonaAdjust(heat: number, pillarHit: string | null, hasProfile: boolean): { heat: number; adjust: number }`——命中 +PERSONA_ADJUST.pillarBonus clamp 100；hasProfile 且未命中 ×offPillarFactor 四舍五入；无档案原样返回 adjust 0；常量 `PERSONA_ADJUST` 导出）；Modify `src/lib/radar/run.ts`（扫描开始时 `loadPersonaProfile(userId)` 一次 → buildPersonaSection 传入 radar-read → 每篇读完 `validatePillarHit` 校验 → `applyPersonaAdjust` 调权 → heatFactors 增 `personaAdjust` 与 `pillarHit`）；Test 更新 `tests/lib/llm/prompts/`（radar-read 两态）、`tests/lib/radar/scoring.test.ts`（applyPersonaAdjust 边界：命中 95→100 clamp、未命中 80→56、无档案不动）、`tests/jobs/radar-worker.test.ts` 或 run 相关测试（wiring：有/无档案两轮）。
**Interfaces:** Consumes T1 `loadPersonaProfile`/`buildPersonaSection`/`validatePillarHit`。Produces：RadarItem.heatFactors 新增 `personaAdjust: number`、`pillarHit: string | null`（T5 徽标消费）。
- [ ] Step 1: TDD；commit `feat(persona): 雷达评分注入 (pillarHit + 调权)`

## Task 4: 选题/灵感/写稿注入

**Files:** Modify `src/lib/llm/prompts/topic-discovery.ts`、`inspiration-insight.ts`、`script-write-douyin.ts`、`script-write-xhs.ts`——四者 buildSystemPrompt 增加可选 `personaSection?: string` 末参（空/缺省时输出与现状**字符级一致**，测试断言），非空时拼入（写稿两处拼在 getExpertPersona 之后、任务描述之前）；Modify 对应调用方：`src/app/api/v1/discover/topics/route.ts`、`inspiration/insights/generate` 路由、`scripts/generate/route.ts` douyin 与 xhs 分支——各自 `loadPersonaProfile(user.id)` → `buildPersonaSection` → 传入（gongzhonghao 分支不动）。Test：四 prompt 两态断言（缺省字符级一致 + 非空含受众文本）+ 调用方 wiring 测试（mock loadPersonaProfile 断言传参）。
**Interfaces:** Consumes T1。Produces：无新形状（纯注入）。
- [ ] Step 1: TDD；commit `feat(persona): 选题/灵感/写稿三处注入`

## Task 5: UI（设置卡 + 访谈表单 + 雷达徽标）

**Files:** Create `src/components/cockpit/settings-cards/persona-card.tsx`（五字段编辑：pillars 增删列表（≤5）+ 「AI 帮我起草」展开 5 问表单（问题文案照 spec §2 五问逐字）→ POST draft → 草稿回填各字段（仅表单态）→ 保存走 PUT；draft 503 → notify 引导；pending 防双击；`.panel` 体系）；Modify `src/components/cockpit/views/settings.tsx` 挂卡；Modify `src/components/cockpit/views/radar.tsx`（条目卡：heatFactors.pillarHit 非空 → 支柱名徽标；有 personaAdjust<0（或 hasProfile 语义等价字段）→「偏离定位」徽标；两字段缺失（老条目）→ 无徽标；页顶无档案时一行引导「建立人设档案让选题更贴合定位 → 设置」）；Test：徽标条件渲染若可抽纯函数则单测（`pickPersonaBadge(heatFactors) → {type:'pillar',name}|{type:'off'}|null`，放 `src/lib/radar/persona-badge.ts`），dev 手工走查（建档访谈→保存→雷达页引导消失）。
**Interfaces:** Consumes T1 profile API、T2 draft、T3 heatFactors 新字段。
- [ ] Step 1: TDD（persona-badge 纯函数）+ 实现 + dev 走查；commit `feat(cockpit): 人设定位卡 + 访谈表单 + 雷达徽标`

## Task 6: 收尾 — 文档 + 真实 E2E

**Files:** README 八期段（人设档案/访谈建档/三处注入/调权规则）；spec 回写「## 6. 实际实施结论」。
**真实 E2E（key 均已就绪）:** ①访谈表单真实作答一轮 → draft 起草返回 3-5 支柱（真实 DeepSeek）→ 修改保存 → GET established=true ②真实雷达扫描一轮 → 断言新条目 heatFactors 含 pillarHit/personaAdjust、雷达页出现支柱/偏离徽标 ③真实生成一篇抖音稿 → 对比 system prompt（日志或代码断点确认 persona 段注入）且稿件角度体现受众 ④无档案回退：临时清空档案再各跑一次生成+扫描确认行为同现状（跑完恢复档案）⑤typecheck+test+build 全绿。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(persona): 八期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 表+API+建立判定(T1) ✓ §2 五问表单+draft 不落库(T2/T5) ✓ §3 注入 1 雷达(T3) 注入 2 选题灵感(T4) 注入 3 写稿(T4) 共享 buildPersonaSection(T1) ✓ §4 YAGNI 未越界 ✓ §5 风险：长度上限(T1 schema)/pillarHit 幻觉(T1 validatePillarHit+T3 wiring)/常量可调(T3)/老条目零迁移(T5 徽标防御)/草稿不落库(T2) ✓。
- 类型一致性：PersonaProfileData/PersonaPillar T1 唯一定义，T2 draft schema extend、T3/T4 loadPersonaProfile 消费 ✓；heatFactors.pillarHit/personaAdjust T3 写=T5 pickPersonaBadge 读 ✓；PERSONA_ADJUST T3 定义并在测试引用 ✓。
- 已知不确定点（实施核实记账本）：inspiration-insight 调用方的实际路由路径（T4 grep 为准）；radar run 测试文件实际名（T3 grep 为准）。
