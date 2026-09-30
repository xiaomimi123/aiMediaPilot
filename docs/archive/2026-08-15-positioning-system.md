# 账号定位体系 · 作战室 (cockpit 十期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐账号体系前半段（关键痛点/商品服务/产品逻辑/市场前景/体系总结）并让它真正改变选题与生成（雷达痛点识别、内容意图分层、CTA 指向产品、角度避红海）。Spec: `docs/superpowers/specs/2026-08-15-positioning-system-design.md`。

**Architecture:** 扩展八期 `PersonaProfile`（不新建表）+ 内容卡新增 `intent` 列；`buildPersonaSection(profile, scope)` 按用途分段注入避免 prompt 暴长；市场调研复用四期 Tavily 搜索层；痛点不加调权只进语义与展示（避免第三层热度调整）。

**Tech Stack:** 同前（无新依赖）。

## Global Constraints

- **零迁移回退**：新字段全部可选，缺失时对应注入段省略；「档案已建立」判定沿用八期（`audience` 非空 + `pillars ≥1`）不变；八期已建档用户新字段为空即按八期行为运行。
- 字段上限逐字：painPoints 3-6 条 `{pain ≤30字, evidence ≤60字}`；offerings 1-5 项 `{name ≤20, type: 'tool'|'service'|'course', description ≤80, targetPain ≤30}`；productLogic ≤500；marketInsight 四段各 ≤300；systemSummary ≤2000。
- `CockpitContent.intent` 取值 `'' | 'reach' | 'trust' | 'convert'`（空=未标注）；中文标签 引流 / 建立信任 / 转化。
- **痛点不新增热度调权系数**——只进 relevance 判断语义 + 卡片标注；`painHit`/`angleSuggestion`/`intent` 一律严格枚举/等值校验，非法降为空（pillarHit 宽进严出先例）。
- `buildPersonaSection(profile, scope)` 分段：`'radar'`=受众/支柱/痛点/机会位；`'write'`=受众/痛点/角度/机会位 + 按 intent 的 CTA 指引；`'topic'`=受众/支柱/痛点。**全档案任何时候不整体注入 prompt**。
- intent 五处同批改（九期教训）：DB 列 + `model.ts` 类型 + `server-store` 映射 + 抽屉编辑 + 生成回填；老卡空值走「未标注」不炸。
- 市场调研无 Tavily key → 400 + 引导文案，不阻断其余建档；`researchedAt` 落库，UI 超 30 天提示重跑（不自动重跑）。
- 草稿不落库、保存才 PUT（八期语义不变）；DeepSeek key 一律 `resolveDeepSeekApiKey`（无 key 503）。
- UI 无彩色 emoji；API house 约定 `ok()/fail()` + `getOrCreateDefaultUser`；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 数据模型 + 档案层扩展

**Files:** Modify `prisma/schema.prisma`（PersonaProfile 加 5 字段 + CockpitContent 加 `intent String @default("")`）+ `npm run db:push`；Modify `src/lib/persona/profile.ts`（类型与 schema 扩展 + 防御解析）；Modify `src/lib/cockpit/model.ts`（`ContentItem.intent` 类型 + `CONTENT_INTENTS`/`INTENT_LABELS` 常量）；Modify `src/lib/cockpit/server-store.ts`（intent 读写映射——**注意 scriptDraftId 是只读下发的先例，intent 与 platform 同属可写字段，照 platform 处理**）；Test `tests/lib/persona/profile.test.ts` 扩展、`tests/lib/cockpit/` 相关。
**Interfaces (Produces):**
```ts
// src/lib/persona/profile.ts —— 八期既有类型上扩展
export interface PersonaPain { pain: string; evidence: string }
export interface PersonaOffering { name: string; type: 'tool' | 'service' | 'course'; description: string; targetPain: string }
export interface PersonaMarketInsight { landscape: string; mainstream: string; unmet: string; opportunity: string; researchedAt: string }
export interface PersonaProfileData {  // 八期字段 + 新增
  audience: string; targetFans: string; pillars: PersonaPillar[]; angle: string; avoid: string;
  painPoints: PersonaPain[]; offerings: PersonaOffering[]; productLogic: string;
  marketInsight: PersonaMarketInsight | null; systemSummary: string;
}
export const PersonaProfileSchema = z.object({ /* 八期五项 + */
  painPoints: z.array(z.object({ pain: z.string().min(1).max(30), evidence: z.string().max(60) })).max(6),
  offerings: z.array(z.object({ name: z.string().min(1).max(20), type: z.enum(['tool','service','course']), description: z.string().max(80), targetPain: z.string().max(30) })).max(5),
  productLogic: z.string().max(500),
  marketInsight: z.object({ landscape: z.string().max(300), mainstream: z.string().max(300), unmet: z.string().max(300), opportunity: z.string().max(300), researchedAt: z.string() }).nullable(),
  systemSummary: z.string().max(2000),
});
export function validateIntent(value: unknown): '' | 'reach' | 'trust' | 'convert'  // 非法一律 ''
// src/lib/cockpit/model.ts
export const CONTENT_INTENTS = ['reach', 'trust', 'convert'] as const;
export type ContentIntent = '' | (typeof CONTENT_INTENTS)[number];
export const INTENT_LABELS: Record<Exclude<ContentIntent, ''>, string> = { reach: '引流', trust: '建立信任', convert: '转化' };
```
`loadPersonaProfile` 对新 Json 字段同样防御解析（畸形条目丢弃、非数组→[]、marketInsight 缺字段→null）；`isProfileEstablished` 判定不变（只看 audience+pillars）。
**Test:** 新字段 schema 边界（painPoints 7 条拒、pain 31 字拒、offering type 非枚举拒、productLogic 501 拒、systemSummary 2001 拒）；`loadPersonaProfile` 畸形 Json 防御；`validateIntent` 四态；server-store intent 往返（写入+读出）；八期既有用例零回归。
- [ ] Step 1: TDD；commit `feat(persona): 定位档案扩展 + 内容意图字段`

## Task 2: 分段注入函数 + profile API 扩展

**Files:** Modify `src/lib/llm/prompts/persona-section.ts`（`buildPersonaSection(profile, scope)` 签名扩展——**八期调用点全部传 scope，不保留无参重载**，四个既有调用点同批改：radar-read wiring 传 `'radar'`、topic-discovery/inspiration-insight 传 `'topic'`、写稿两处传 `'write'`）；Modify `src/app/api/v1/persona/profile/route.ts`（GET/PUT 覆盖新字段，PUT 走扩展后的 PersonaProfileSchema）；Test `tests/lib/llm/prompts/persona-section.test.ts` 扩展 + `tests/api/persona/profile.test.ts` 扩展。
**Interfaces (Produces，T4/T5 消费):**
```ts
export type PersonaSectionScope = 'radar' | 'write' | 'topic';
export function buildPersonaSection(profile: PersonaProfileData | null, scope: PersonaSectionScope, intent?: ContentIntent): string
// null/未建立 → ''；scope 决定包含哪些段（见 Global Constraints）；
// scope='write' 且 intent 非空时追加该 intent 的 CTA 指引段（reach/trust/convert 三套文案，convert 段列出 offerings 名称与说明）
```
**Test:** 三 scope 各自包含/不包含的字段断言（radar 不含 CTA 段、write 不含支柱列表、topic 不含机会位以外……以 Global Constraints 分段表为准）；profile null → ''；新字段为空时对应段省略（八期档案不含新字段 → 输出与八期一致，字符级对拍 `git show` 旧实现）；intent 三态 CTA 段差异；profile API 新字段往返与 400 边界。
- [ ] Step 1: TDD；commit `feat(persona): 分段注入函数 + 档案 API 扩展`

## Task 3: 访谈扩展（9 问起草全字段）

**Files:** Modify `src/lib/llm/prompts/persona-draft.ts`（responseSchema 扩展到 painPoints/offerings/productLogic——`marketInsight`/`systemSummary` **不由访谈起草**；system prompt 要求痛点具体可验证、offerings 与痛点对应、productLogic 写清「刷到→关注→信任→付费」路径）；Modify `src/app/api/v1/persona/draft/route.ts`（answers 上限 5→9）；Test `tests/lib/llm/prompts/persona-draft.test.ts` + `tests/api/persona/draft.test.ts` 扩展。
**Interfaces:** Consumes T1 类型。Produces：draft 响应含新字段（T6 表单消费）。
```ts
export const PersonaDraftResponseSchema = z.object({ /* 八期五项(pillars min3 max5) + */
  painPoints: z.array(z.object({ pain: z.string().min(1).max(30), evidence: z.string().max(60) })).min(3).max(6),
  offerings: z.array(z.object({ name: z.string().min(1).max(20), type: z.enum(['tool','service','course']), description: z.string().max(80), targetPain: z.string().max(30) })).min(1).max(5),
  productLogic: z.string().min(20).max(500),
});
```
9 问文案逐字（spec §2）：① 你是谁/账号做什么 ② 最想吸引什么样的人关注 ③ 你最擅长/最有信息差的内容 ④ **你的目标人群最头疼什么** ⑤ **你打算靠什么变现、具体卖什么** ⑥ 观众为什么选择看你而不是别人 ⑦ 绝对不想碰的内容或方向 ⑧ **观众从刷到你到付费中间要经历什么** ⑨ **你怎么看这个赛道现在的竞争**
**Test:** schema 边界（painPoints 2 条拒/7 条拒、offerings 0 项拒、productLogic 19 字拒）；system 关键词断言（含「具体」「路径」，拒绝空泛痛点的示例）；路由 answers 9 条通过 / 10 条 400；起草不落库断言（upsert/update 未调）。
- [ ] Step 1: TDD；commit `feat(persona): 9 问访谈起草全字段`

## Task 4: 市场调研 + 体系报告

**Files:** Create `src/lib/llm/prompts/market-research.ts`、`src/lib/llm/prompts/persona-summary.ts`；Modify `src/lib/llm/prompts/index.ts`；Create `src/app/api/v1/persona/market-research/route.ts`、`src/app/api/v1/persona/summary/route.ts`；Test `tests/lib/llm/prompts/positioning.test.ts`、`tests/api/persona/market-research.test.ts`、`tests/api/persona/summary.test.ts`。
**Interfaces:**
```ts
export const MarketInsightSchema = z.object({ landscape: z.string().min(10).max(300), mainstream: z.string().min(10).max(300), unmet: z.string().min(10).max(300), opportunity: z.string().min(10).max(300) });
export const MARKET_RESEARCH = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { audience: string; pillars: string[]; searchDigest: string }): ContentPart[], responseSchema: MarketInsightSchema };
export const PERSONA_SUMMARY = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { profile: PersonaProfileData }): ContentPart[], responseSchema: z.object({ summary: z.string().min(100).max(2000) }) };
```
market-research 路由：档案未建立 400；`getDecryptedTavilyKey` 无 key → `fail('未配置 Tavily key, 请在「雷达配置」卡保存后重试', 400)`；查询 2 条（`${pillars[0]} 赛道 现状`、`${audience} 内容 账号`——以实际档案取值拼接，pillars 为空时退化为仅第二条）；搜索失败单条跳过、全失败 → `fail('市场搜索失败, 请稍后重试', 502)`；`resolveDeepSeekApiKey` 无 key 503；汇总后落库 `marketInsight = {...result, researchedAt: new Date().toISOString()}`（spread 保留 profile 其余字段）→ `ok({ marketInsight })`。
summary 路由：档案未建立 400；`resolveDeepSeekApiKey` 无 key 503；生成后落库 `systemSummary` → `ok({ summary })`。
**Test:** 两 prompt schema 边界与 system 关键词；market-research 无 Tavily key 400 / 无档案 400 / 搜索全失败 502 / 成功落库含 researchedAt / spread 保留其余字段；summary 无档案 400 / 成功落库。
- [ ] Step 1: TDD；commit `feat(persona): 市场调研 + 体系报告路由`

## Task 5: 雷达痛点识别 + 生成侧意图与 CTA

**Files:** Modify `src/lib/llm/prompts/radar-read.ts`（zod 加 `painHit: z.string().max(30).nullable().optional().default(null)`、`angleSuggestion: z.string().max(40).nullable().optional().default(null)`；persona 段走 `scope='radar'`；relevance 语义句在有痛点时补「是否戳中上述痛点」；**无档案时输出与现状字符级一致**）；Modify `src/lib/radar/run.ts`（`validatePainHit` 严格等值校验 painPoints 的 pain 文本、angleSuggestion 截断兜底；写入 `heatFactors.painHit`/`heatFactors.angleSuggestion`；**不新增调权**）；Modify `src/lib/persona/profile.ts` 加 `validatePainHit(hit: unknown, pains: PersonaPain[]): string | null`；Modify `src/lib/llm/prompts/script-write-douyin.ts`、`script-write-xhs.ts`（persona 段走 `scope='write'` 并透传 intent）；Modify `src/app/api/v1/scripts/generate/route.ts`（请求体加 `intent?: string`，`validateIntent` 校验；未指定时由写稿响应新增字段 `suggestedIntent` 返回——**prompt 输出 schema 加 `suggestedIntent: z.enum(['reach','trust','convert']).nullable().optional().default(null)`**，服务端 `validateIntent` 后随响应返回；douyin/xhs 两分支同款，gongzhonghao 不动）；Test 对应各测试文件。
**Interfaces:** Consumes T1 `validateIntent`/T2 `buildPersonaSection(profile, scope, intent)`。Produces：`heatFactors.painHit/angleSuggestion`（T6 徽标）、generate 响应 `suggestedIntent`（T6 回填）。
**Test:** radar-read 两态（无档案字符级一致、有痛点含语义句）；`validatePainHit` 严格匹配/非字符串→null；run wiring 写入两键且热度分未被痛点改动（断言 `heatScore` 与八期同输入一致）；写稿 prompt 三 intent 的 CTA 段差异 + convert 段含 offerings 名称；generate 路由 intent 合法透传/非法降空/未指定返回 suggestedIntent；gongzhonghao 回归不变。
- [ ] Step 1: TDD；commit `feat(persona): 雷达痛点识别 + 生成侧意图与 CTA`

## Task 6: UI（定位卡扩展 / 意图编辑与徽标 / 组合比例 / 雷达展示）

**Files:** Modify `src/components/cockpit/settings-cards/persona-card.tsx`（新增痛点增删列表 ≤6、商品服务增删列表 ≤5（含 type 下拉）、产品逻辑文本域；「市场调研」按钮 → POST market-research，展示四段 + `researchedAt`，超 30 天显示「调研已过期，建议重跑」；「生成定位体系」按钮 → POST summary，展示 markdown + 「导出 .md」下载；访谈表单 5 问扩 9 问；draft 回填含新字段；沿用八期起草/保存互斥与 confirm 前置）；Modify `src/components/cockpit/content-drawer.tsx`（概览 tab 加意图下拉 `INTENT_LABELS` + 未标注；生成响应 `suggestedIntent` 在内容卡 intent 为空时自动回填并 notify 提示）；Modify `src/components/cockpit/views/pipeline.tsx`（卡片意图徽标；顶部一行内容组合比例「引流 X% / 信任 Y% / 转化 Z% / 未标注 N 条」+ 静态提示句「转化内容长期为 0 时，专业信任无法变现」）；Modify `src/components/cockpit/views/radar.tsx`（条目卡显示「戳中痛点：X」与角度建议，两字段缺失不渲染）；Create `src/lib/cockpit/intent-stats.ts`（`computeIntentMix(items) → { reach, trust, convert, untagged, total }` 纯函数，百分比四舍五入且三者和 ≤100）；Test `tests/lib/cockpit/intent-stats.test.ts`（空集合/全未标注/混合/四舍五入边界）+ dev 手工走查（清单：①定位卡 9 问起草回填 ②痛点/商品增删上限 ③市场调研出四段与时间 ④体系报告生成与导出 ⑤抽屉意图下拉保存 ⑥看板徽标与比例条 ⑦雷达痛点/角度展示 ⑧无档案时全部降级不炸）。
**Interfaces:** Consumes T1-T5 全部。
- [ ] Step 1: TDD（intent-stats）+ 实现 + 走查；commit `feat(cockpit): 定位体系 UI + 意图徽标与组合比例`

## Task 7: 收尾 — 文档 + 真实 E2E

**Files:** README 十期段（定位体系字段表 + 建档三步 + 意图分层说明 + 成本）；spec 回写「## 6. 实际实施结论」。
**真实 E2E（key 均就绪；市场调研约几毛、生成几分钱）:** ①9 问真实作答 → draft 起草含 3-6 痛点/1-5 offerings/productLogic → 保存 → GET 校验 ②真实市场调研一轮 → marketInsight 四段非空 + researchedAt ③真实体系报告生成 + 导出 md 校验 ④真实雷达扫描 → 新条目 heatFactors 含 painHit/angleSuggestion，且**热度分逻辑未受痛点影响**（对照同关键词八期基线）⑤真实生成一篇 intent='convert' 的抖音稿 → CTA 指向 offerings 中的真实产品名 ⑥无档案回退（临时清 audience）→ 生成/扫描行为同现状 → 恢复 ⑦typecheck+test+build 全绿。E2E 产生的测试内容卡/稿清理，真实档案保留。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(persona): 十期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 档案 5 字段 + intent 列(T1) ✓ §2 访谈 9 问(T3)/市场调研(T4)/体系报告(T4) ✓ §3 注入①雷达痛点(T5) ②内容意图(T1 列+T5 建议+T6 编辑) ③CTA 按意图(T5) ④机会位(T2 分段+T5 写稿) + 组合比例(T6) ✓ §4 YAGNI 未越界 ✓ §5 风险：prompt 暴长(T2 分段)/调研过期(T6 提示)/intent 五处同批(T1+T5+T6)/幻觉校验(T1 validateIntent+T5 validatePainHit)/无 Tavily key(T4 400) ✓。
- 类型一致性：PersonaPain/PersonaOffering/PersonaMarketInsight T1 唯一定义，T2-T5 消费 ✓；`buildPersonaSection(profile, scope, intent?)` T2 定义 T5 调用 ✓；`ContentIntent`/`INTENT_LABELS` T1 定义 T6 消费 ✓；`validateIntent` T1、`validatePainHit` T5 定义处一致 ✓；`heatFactors.painHit/angleSuggestion` T5 写=T6 读 ✓。
- 已知不确定点（实施核实记账本）：八期 `buildPersonaSection` 的既有四个调用点确切位置（T2 标注 grep）；pipeline.tsx 顶部比例条与九期平台分岔的交互（T6 标注：平台视图按该平台内容统计、总览按全量）。
