# 人物志 + 个人经历库 (cockpit 十二期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让稿子有人味且只有你能写——人物志（你是谁）注入写稿、个人经历库（你凭什么这么说）自动检索并优先于外部资料。Spec: `docs/superpowers/specs/2026-08-16-creator-voice-design.md`。

**Architecture:** 两张新表（`CreatorVoice` 单行 + `CreatorExperience` 多条目）不撑大 `PersonaProfile`；新独立拼装函数 `buildVoiceSection` 与既有 `buildPersonaSection` 解耦；检索走纯函数关键词交集（无向量、无额外 LLM 调用）；注入两处（写稿 prompt + 研究层 curated 通道）。

**Tech Stack:** 同前（无新依赖）。

## Global Constraints

- **零迁移回退**：人物志未建（`identity` 空）或经历库为空时，`buildVoiceSection` 返回 `''`，全链路行为与现状完全一致；既有生成/研究/报告行为不得改变。
- 字段上限逐字：`origin` ≤500、`identity` ≤200、`notIdentity` ≤200、`stances` 0-5 条 `{claim ≤50, reason ≤100}`、`energy` ≤200；`CreatorExperience.content` ≤500、`topic` ≤20、`keywords` 3-5 个、`kind` ∈ `'' | 'practice' | 'failure' | 'insight' | 'result'`。
- 「人物志已建立」判定：`identity.trim()` 非空（唯一最小要素）。经历库无门槛。
- **职责边界**：人物志只管「你是谁」，语言层（口吻/句式/口头禅）完全归既有 `StyleProfile`——**不得**在人物志里新增任何语言风格字段。
- 检索：`matchExperiences(topic, experiences, limit=3)` 纯函数（零 IO），关键词交集 → 匹配数降序 → `createdAt` 新鲜度降序 → top limit。**不做向量检索、不新增 LLM 调用**。
- 写稿 prompt 注入经历时必须包含护栏原文语义：「这些是你的真实经历，优先用它们而不是外部案例；**但不相关就别用，不要硬凑**」。
- `buildPersonaSection` 一行不改；人物志/经历走新函数 `buildVoiceSection`，两套档案分段逻辑不耦合。
- 命中经历 `usedCount + 1`（写稿成功后），失败不计数。
- 随手记条目：DeepSeek 提炼 `{topic, kind, keywords}`，用户**不需要分类**；原文 `content` 原样保存不改写。
- 雷达不注入人物志/经历（本期 YAGNI，避免再加评分逻辑）。
- DeepSeek key 一律 `resolveDeepSeekApiKey`（无 key 503）；API house 约定 `ok()/fail()` + `getOrCreateDefaultUser`；UI 无彩色 emoji；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 数据模型 + 档案层 + 检索纯函数

**Files:** Modify `prisma/schema.prisma`（两张新表，字段逐字见 spec §1）+ `npm run db:push`；Create `src/lib/persona/voice.ts`；Create `src/lib/persona/experience-match.ts`；Test `tests/lib/persona/voice.test.ts`、`tests/lib/persona/experience-match.test.ts`。
**Interfaces (Produces，T2-T5 消费):**
```ts
// voice.ts
export interface VoiceStance { claim: string; reason: string }
export interface CreatorVoiceData { origin: string; identity: string; notIdentity: string; stances: VoiceStance[]; energy: string }
export const CreatorVoiceSchema = z.object({
  origin: z.string().max(500), identity: z.string().max(200), notIdentity: z.string().max(200),
  stances: z.array(z.object({ claim: z.string().min(1).max(50), reason: z.string().max(100) })).max(5),
  energy: z.string().max(200),
});
export function isVoiceEstablished(v: CreatorVoiceData): boolean   // identity.trim() 非空
export async function loadCreatorVoice(userId: string): Promise<CreatorVoiceData | null>
// 无行 或 !isVoiceEstablished → null；stances Json 防御解析（非数组→[]，条目缺 claim 或非字符串→丢弃）
export interface ExperienceItem { id: string; content: string; topic: string; kind: string; keywords: string[]; usedCount: number; createdAt: string }
export async function loadExperiences(userId: string): Promise<ExperienceItem[]>  // 按 createdAt 降序；keywords Json 防御解析
export const EXPERIENCE_KINDS = ['practice', 'failure', 'insight', 'result'] as const;
export function validateExperienceKind(v: unknown): string  // 合法值原样返回，否则 ''
// experience-match.ts —— 纯函数，零 IO
export function matchExperiences(topic: string, items: ExperienceItem[], limit = 3): ExperienceItem[]
// 分词：topic 按空白与常见标点切分 + 保留原串整体作为一个词；与每条的 keywords ∪ [topic字段] 求交集（大小写不敏感、去空白）；
// 命中数 0 的条目排除；排序 = 命中数降序 → createdAt 降序；取 top limit
```
**Test:** schema 边界（origin 501 拒、stances 6 条拒、claim 51 拒）；`isVoiceEstablished` 空/空白/非空；`loadCreatorVoice` 无行→null、未建立→null、stances 畸形防御；`validateExperienceKind` 四合法+非法→''；**`matchExperiences` 重点**：无命中→[]、命中数排序、同命中数按新鲜度、limit 截断、大小写/空白不敏感、空库→[]、空 topic→[]。
- [ ] Step 1: TDD；commit `feat(voice): 人物志与经历库数据层 + 检索纯函数`

## Task 2: 人物志访谈起草 + voice API

**Files:** Create `src/lib/llm/prompts/voice-draft.ts`；Modify `src/lib/llm/prompts/index.ts`；Create `src/app/api/v1/voice/profile/route.ts`（GET/PUT）、`src/app/api/v1/voice/draft/route.ts`（POST）；Test `tests/lib/llm/prompts/voice-draft.test.ts`、`tests/api/voice/profile.test.ts`、`tests/api/voice/draft.test.ts`。
**Interfaces:**
```ts
export const VoiceDraftResponseSchema = z.object({
  origin: z.string().min(20).max(500), identity: z.string().min(5).max(200), notIdentity: z.string().min(5).max(200),
  stances: z.array(z.object({ claim: z.string().min(1).max(50), reason: z.string().min(1).max(100) })).min(1).max(5),
  energy: z.string().min(2).max(200),
  experienceCandidates: z.array(z.string().min(10).max(500)).max(5),  // 从④⑥答案提取的经历候选原文
});
export const VOICE_DRAFT = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { answers: { q: string; a: string }[] }): ContentPart[], responseSchema: VoiceDraftResponseSchema };
```
6 问文案逐字（spec §2）：①你怎么走上这条路的、哪件事让你决定开始做 ②你会怎么跟陌生人介绍自己（一句话） ③你明确不是什么人 ④关于这个领域你有什么跟主流不一样的看法 ⑤你希望观众看完是什么感觉 ⑥你最近一次认知被刷新是什么时候
system 质量要求（会被审查）：**要求 identity 写成具体的人而非品类标签**（给「AI 知识博主」→「一个靠 AI 提高认知的普通人，边学边分享」的反例→正例对照）；**notIdentity 必须原样保留用户的自我否定**（不得美化成优点）；stances 要求具体到可能得罪人，拒绝「我认为要理性看待 AI」这类无立场表述。
profile 路由：GET → `ok({ ...字段, established })`（无行返回全空默认）；PUT → `CreatorVoiceSchema` 校验（非法 400）upsert。draft 路由：`answers` 1-6 条（超 6 → 400）；`resolveDeepSeekApiKey` 无 key 503；**不落库**（upsert/update 未调，测试断言）。
**Test:** schema 边界；system 关键词断言（含反例→正例对照、「不是」保留要求）；draft 不落库；answers 上限；profile GET/PUT 往返与 400。
- [ ] Step 1: TDD；commit `feat(voice): 人物志 6 问访谈起草 + voice API`

## Task 3: 经历库 API（随手记 + AI 打标签）

**Files:** Create `src/lib/llm/prompts/experience-tag.ts`；Modify `src/lib/llm/prompts/index.ts`；Create `src/app/api/v1/experiences/route.ts`（GET 列表 / POST 新增）、`src/app/api/v1/experiences/[id]/route.ts`（PATCH 编辑 / DELETE）；Test `tests/lib/llm/prompts/experience-tag.test.ts`、`tests/api/experiences.test.ts`。
**Interfaces:**
```ts
export const ExperienceTagSchema = z.object({
  topic: z.string().min(1).max(20), kind: z.enum(['practice','failure','insight','result']),
  keywords: z.array(z.string().min(1).max(12)).min(3).max(5),
});
export const EXPERIENCE_TAG = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { content: string }): ContentPart[], responseSchema: ExperienceTagSchema };
```
POST：body `{ content }`（1-500 字，非法 400）→ `resolveDeepSeekApiKey` 无 key 503 → `callStructured(EXPERIENCE_TAG)` → 落库（`content` **原样保存不改写**）→ `ok({ experience })`。打标签失败（LLM 异常）→ 仍落库但 `topic=''`/`kind=''`/`keywords=[]` 并在响应带 `tagged: false`（**不能因为打标签失败就丢掉用户记的内容**）。
GET：`ok({ experiences })` 按 createdAt 降序。PATCH：可改 `content`/`topic`/`kind`/`keywords`（各自校验；`kind` 走 `validateExperienceKind`），归属校验非本人 404。DELETE：归属校验 404。
**Test:** POST 正常/超 500 字 400/空 400/无 key 503/**打标签失败仍落库且 tagged:false**；GET 排序；PATCH 各字段与非法 kind 降 ''；DELETE 他人 404；`content` 原样未被改写断言。
- [ ] Step 1: TDD；commit `feat(voice): 经历库 API (随手记 + AI 打标签)`

## Task 4: 注入（写稿 prompt + 研究层 + 体系报告）

**Files:** Create `src/lib/llm/prompts/voice-section.ts`；Modify `src/lib/llm/prompts/script-write-douyin.ts`、`script-write-xhs.ts`（`buildSystemPrompt` 增可选末参 `voiceSection?: string`，**空/缺省时输出与现状字符级一致**——用 `git show` 旧实现真实对拍，非自比较）；Modify `src/app/api/v1/scripts/generate/route.ts`（douyin/xhs 两分支：`loadCreatorVoice` + `loadExperiences` + `matchExperiences(topic, items, 3)` → `buildVoiceSection` → 传入；写稿成功后命中条目 `usedCount + 1`；**gongzhonghao 不动**）；Modify `src/lib/script/research.ts`（`runResearch` 新增可选入参 `experiences?: ExperienceItem[]`，命中条目文本进 `curatedParts` 最前，排在用户素材与雷达种子同级通道——读现有实现确认拼装顺序后按实际接入）；Modify `src/lib/llm/prompts/persona-summary.ts`（吃人物志：`buildUserMessage` 增 `voice: CreatorVoiceData | null`）+ `src/app/api/v1/persona/summary/route.ts`（传入）；Test 各对应文件。
**Interfaces (Produces):**
```ts
// voice-section.ts
export function buildVoiceSection(voice: CreatorVoiceData | null, experiences: ExperienceItem[]): string
// voice 为 null 且 experiences 为空 → ''；否则拼装：
//   人物志段（identity / 我不是什么 / 立场逐条 / 情绪基调 / 来路精简）
//   经历段（逐条全文 + 类型标签）+ 护栏句「这些是你的真实经历, 优先用它们而不是外部案例; 但不相关就别用, 不要硬凑」
```
**Test:** `buildVoiceSection` 三态（全空→''、仅人物志、人物志+经历含护栏句）；两个写稿 prompt 缺省与旧实现**字符级对拍**（`git show <本期基线commit>:<file>` 抽旧实现跑对比，验证完删临时文件）；generate 路由 wiring（有/无人物志两态、`matchExperiences` 被调、`usedCount` 递增、gongzhonghao 未调 loadCreatorVoice）；research 层经历优先于搜索正文（断言拼装顺序）；summary 含人物志。
- [ ] Step 1: TDD；commit `feat(voice): 人物志与经历注入写稿/研究层/体系报告`

## Task 5: UI（人物志卡 + 经历库卡）

**Files:** Create `src/components/cockpit/settings-cards/voice-card.tsx`（5 字段编辑：origin/identity/notIdentity 文本域、stances 增删列表 ≤5（claim+reason 双输入）、energy 输入；「AI 帮我起草」展开 6 问表单 → POST draft → 草稿回填**含 experienceCandidates 一并展示供用户确认后逐条入库**（调 POST /api/v1/experiences）→ 保存走 PUT；沿用八/十期卡片的起草/保存互斥、confirm 前置、ref 取最新值模式）；Create `src/components/cockpit/settings-cards/experience-card.tsx`（顶部「随手记一笔」textarea + 提交按钮 → POST；下方条目列表：原文、主题标签、类型中文标签、keywords（可编辑）、引用次数、删除按钮；pending 防双击；空库引导文案「记下你的真实经历，写稿时会优先用你自己的故事」）；Modify `src/components/cockpit/views/positioning.tsx`（五段顺序：体系报告 → **人物志卡** → **经历库卡** → 人设定位卡 → 风格档案卡）；Modify `src/app/cockpit.css`（沿 `.panel` 体系）；Test：`EXPERIENCE_KIND_LABELS` 中文映射纯函数若抽出则单测；dev 手工走查（清单：①人物志 6 问起草回填含经历候选 ②stances 增删上限 5 ③随手记一条真实经历→自动出标签 ④条目 keywords 编辑与删除 ⑤五段顺序正确 ⑥空库/未建人物志时引导文案 ⑦明暗主题 ⑧无彩色 emoji）。
**Interfaces:** Consumes T2/T3 API。
- [ ] Step 1: 实现 + 走查；commit `feat(cockpit): 人物志卡 + 经历库卡`

## Task 6: 收尾 — 文档 + 真实 E2E

**Files:** README 十二期段（人物志字段表 + 经历库用法 + 检索规则 + 成本）；spec 回写「## 7. 实际实施结论」。
**真实 E2E（key 就绪；起草/打标签各几分钱）:** ①真实 6 问访谈起草人物志（identity 是具体的人不是品类标签、notIdentity 保留自我否定）→ 保存 → GET established=true ②随手记 3-5 条真实经历 → 自动打标签合理 ③**本期最硬验收**：真实生成一篇与某条经历同主题的抖音稿 → 断言稿子**确实引用了你自己的经历**而非外部案例（贴原文对照），且命中条目 `usedCount` 递增 ④生成一篇与经历库完全无关主题的稿 → 断言 AI **没有硬凑**不相关经历（护栏生效）⑤体系报告重新生成 → 含人物志内容 ⑥空库回退：临时清 identity + 无命中经历 → 生成行为同现状 → 恢复 ⑦typecheck+test+build 全绿。测试产生的经历条目/稿件清理，**用户真实人物志与经历保留**。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(voice): 十二期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 两表(T1) ✓ §2 访谈 6 问(T2)+随手记(T3) ✓ §3 检索纯函数(T1)+注入写稿/研究层(T4)+体系报告(T4) ✓ §4 UI 五段(T5) ✓ §5 YAGNI 未越界（无向量/无定稿提取/无反问补录/无雷达注入/无版本历史） ✓ §6 风险：零迁移(Global)、护栏句(T4)、职责边界(Global)、prompt 长度(T4 上限)、关键词可编辑(T3/T5)、真实 E2E(T6) ✓。
- 类型一致性：`CreatorVoiceData`/`VoiceStance`/`ExperienceItem` T1 唯一定义，T2-T5 消费 ✓；`matchExperiences` T1 定义 T4 调用 ✓；`buildVoiceSection(voice, experiences)` T4 定义并在同任务消费 ✓；`validateExperienceKind` T1 定义 T3 使用 ✓。
- 已知不确定点（实施核实记账本）：`runResearch` 现有 `curatedParts` 拼装顺序与签名（T4 标注按实际接入）；`persona-summary` 的 `buildUserMessage` 现有入参形状（T4 标注）；对拍用的本期基线 commit hash（T4 实施时取当前 main HEAD）。
