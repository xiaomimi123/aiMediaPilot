# 创作质量深化 · 抖音口播逐字稿 (cockpit 五期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抖音生成升级为两阶段流水线（联网研究→完整口播逐字稿），配风格学习（定稿即样本）与两级改稿（分块/全稿指令）。Spec: `docs/superpowers/specs/2026-08-13-script-quality-design.md`。

**Architecture:** 研究层复用四期 `SearchProvider`（Tavily）+ DeepSeek 提炼素材简报存 `ScriptDraft.output.research`；写稿层新 prompt 输出 `script.sections[]`（hook/main/cta 分块逐字稿）；风格上下文由 `StyleProfile`（手填说明）与 `StyleSample`（定稿沉淀，≥2 篇切 few-shot）驱动；改稿走独立 refine 路由复用已存简报。全部 UI 长在现有 content-drawer。

**Tech Stack:** 同前（Next.js 14 App Router / Prisma / zod / vitest node 环境 house mock 约定）。

## Global Constraints

- 本期**仅抖音**：xiaohongshu/gongzhonghao 生成路径行为不得改变（generate 路由非 douyin 分支原样直通）。
- 阶段一（研究）任何失败**不阻断**写稿：降级为 `research: null` 直写，响应带 `researchDegraded: true`。
- Tavily 搜索每次生成至多 2 次：主题原词 + 规则拼接 `${topic} 案例 数据`（零额外 AI 调用）；key 走 `getDecryptedTavilyKey`，无 key 视为研究降级而非报错。
- DeepSeek key 一律走 `resolveDeepSeekApiKey(userId)`，禁止直读 `process.env`。
- 风格上下文切换阈值：`StyleSample(platform='douyin')` 数 <2 → 用 StyleProfile.description；≥2 → 最近 3 篇样本 few-shot + 说明附带。
- refineSection 服务端必须校验非目标块 `text` 未变，变了 `fail('AI 修改了未指定的段落, 请重试', 502)`。
- StyleSample 沉淀幂等：同 `sourceScriptDraftId` 已存在则跳过。
- `ScriptDraft.output` 只加键不改列；旧数据无 `research`/`script` 键时抽屉按现状渲染（零迁移）。
- API 一律 `ok()/fail()` + `getOrCreateDefaultUser()`；house mock 约定；UI 无彩色 emoji、`.panel` 体系。
- 每 Task 结束 `npm run typecheck && npm run test` 过后 commit；commit 尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 数据模型（StyleProfile + StyleSample）

**Files:** Modify `prisma/schema.prisma`；`npm run db:push`。
**Interfaces:** Produces 两模型供 T3/T6。字段照 spec §2 逐字：`StyleProfile{userId String @id, description String @default(""), updatedAt DateTime @updatedAt}`；`StyleSample{id cuid, userId, platform String, content String, sourceScriptDraftId String?, createdAt now()}` + `@@index([userId, platform, createdAt])`。User 模型加反向关系 `styleSamples StyleSample[]`（StyleProfile 不建关系，学 RadarConfig 单行先例）。
- [ ] Step 1: 建模 + push + typecheck/test 全绿；commit `feat(style): 风格档案与样本数据模型`

## Task 2: 三个新 prompt 模块（纯 schema+builder，TDD）

**Files:** Create `src/lib/llm/prompts/research-brief.ts`、`src/lib/llm/prompts/script-write-douyin.ts`、`src/lib/llm/prompts/script-refine.ts`；Modify `src/lib/llm/prompts/index.ts` 导出；Test `tests/lib/llm/prompts/script-quality.test.ts`。
**Interfaces (Produces，T3/T4/T5 消费):**
```ts
// research-brief.ts
export const ResearchBriefSchema = z.object({ points: z.array(z.object({
  fact: z.string().min(5).max(200), source: z.string().min(1).max(300), usage: z.string().min(2).max(100),
})).min(1).max(6) });
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>;
export const RESEARCH_BRIEF = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { topic: string; rawMaterials: string }): ContentPart[], responseSchema };
// rawMaterials = 搜索结果正文 + 雷达摘要 + 用户素材 拼接文本（T3 负责拼接与截断至 8000 字）
// system: 专家人设 + “提炼 3-6 条对这条抖音口播视频有用的素材要点; fact 必须具体(数字/案例/事件), 拒绝泛泛而谈; source 填来源 URL 或 '用户素材'; usage 一句话说明这条素材在稿子里怎么用” + JSON_STRICTNESS

// script-write-douyin.ts
export const ScriptSectionSchema = z.object({ role: z.enum(['hook','main','cta']), startSec: z.number().int().nonnegative(), endSec: z.number().int().positive(), text: z.string().min(10).max(500) });
export const DouyinFullScriptSchema = z.object({
  sections: z.array(ScriptSectionSchema).min(3).max(6),
  hooks: z.array(z.object({ text: z.string().min(5).max(100), rationale: z.string().min(5).max(200) })).length(3),
  titles: z.array(z.object({ text: z.string().min(5).max(60), hookType: z.string().min(2).max(30) })).length(3),
  cover: z.object({ textOverlay: z.string().min(2).max(20), shotIdea: z.string().min(5).max(200), colorTone: z.string().min(2).max(50) }),
});
export type DouyinFullScript = z.infer<typeof DouyinFullScriptSchema>;
export interface StyleContext { mode: 'description' | 'samples'; description: string; samples: string[] } // T3 同名类型的唯一定义处
export const SCRIPT_WRITE_DOUYIN = { buildSystemPrompt(niche: string, style: StyleContext): string, buildUserMessage(input: { topic: string; durationSec: 30|45|60; brief: ResearchBrief | null }): ContentPart[], responseSchema: DouyinFullScriptSchema };
// system 要求: sections 是**可直接照着念的口播逐字稿**(口语、短句、无书面语), 第一块 role='hook' 最后一块 role='cta', 秒段连续覆盖 0→durationSec±10%; 素材简报的 fact 要真实引用进正文; style.mode='samples' 时附 “以下是博主本人最近定稿, 模仿其口吻/句式/用词” + 样本, 'description' 时附风格说明段

// script-refine.ts
export const SCRIPT_REFINE = {
  buildSectionSystemPrompt(niche: string, style: StyleContext): string,   // 只重写第 targetIdx 块, 其余块必须逐字原样返回
  buildAllSystemPrompt(niche: string, style: StyleContext): string,       // 按指令重写全部块, 保持块数/role/秒段结构
  buildUserMessage(input: { sections: DouyinFullScript['sections']; instruction: string; targetIdx?: number; brief: ResearchBrief | null }): ContentPart[],
  responseSchema: z.object({ sections: z.array(ScriptSectionSchema).min(3).max(6) }),
};
```
- [ ] Step 1: 先写测试（schema 边界解析：sections 2 块拒/6 块过、role 枚举、refine schema）+ builder 输出含关键指令词断言（如 system 含“逐字稿”“原样返回”、samples 模式含样本文本），RED→GREEN；commit `feat(llm): 研究简报/逐字稿/改稿三 prompt`

## Task 3: 研究层 + 风格层（服务端库，TDD）

**Files:** Create `src/lib/script/research.ts`、`src/lib/script/style.ts`；Test `tests/lib/script/research.test.ts`、`tests/lib/script/style.test.ts`。
**Interfaces:**
- Consumes: `getDecryptedTavilyKey`/`getSearchProvider(apiKey)`（四期 radar 层）、`RESEARCH_BRIEF`（T2）、`resolveDeepSeekApiKey`、`getDeepSeekTextLLM`。
- Produces:
```ts
// research.ts
export async function runResearch(userId: string, input: { topic: string; niche: string; userMaterials?: string }): Promise<ResearchBrief | null>
// 流程: ① findRadarSeed: prisma.radarItem.findFirst({ where: { userId, status: 'adopted', OR: [{ title: { contains: topic.slice(0, 12) } }] } }) 尽力而为, 命中则其 aiSummary/aiAngle/url 进素材池(标注来源 url), 未命中静默跳过
// ② Tavily: getDecryptedTavilyKey → 无 key 跳过搜索; 有 key 搜 topic 原词 + `${topic} 案例 数据` 各 1 次(maxResults 5, time_range 换算沿用现有接口), 单次失败单独跳过
// ③ 素材池(雷达种子+搜索正文+userMaterials)全空 → return null; 否则拼接截断 8000 字 → callStructured(RESEARCH_BRIEF) → 返回 brief
// ④ 任何异常 catch → console.warn + return null (降级, 永不 throw)
export function composeRawMaterials(parts: { label: string; text: string }[], maxLen: number): string  // 纯函数, 按序拼接 `【label】\ntext`, 超长截断
// style.ts
export function pickStyleMode(sampleCount: number): 'description' | 'samples'  // <2 → description, ≥2 → samples (纯函数)
export async function getStyleContext(userId: string, platform: string): Promise<StyleContext>
// StyleProfile.description(无行则 '') + 最近 3 篇 StyleSample; mode 由 pickStyleMode(样本总数) 决定; samples 模式仍带 description
export async function depositStyleSample(userId: string, scriptDraftId: string): Promise<boolean>
// 读 ScriptDraft.output.script.sections → 无 sections 或已存在同 sourceScriptDraftId 样本 → false; 否则 sections.map(s=>s.text).join('\n') 存 StyleSample 返回 true
```
- [ ] Step 1: TDD（research: 无 key 无素材→null / 仅用户素材→跳过搜索仍出简报 / 搜索单次失败不断流 / 雷达种子命中注入 / callStructured 异常→null；composeRawMaterials 截断边界；style: pickStyleMode 0/1/2/3、getStyleContext 两模式、deposit 幂等/无 sections 拒）；commit `feat(script): 研究层与风格层服务端库`

## Task 4: generate 路由两阶段化 + script-mapping 兼容

**Files:** Modify `src/app/api/v1/scripts/generate/route.ts`（douyin 分支改两阶段；请求体新增可选 `materials?: string`、`durationSec?: 30|45|60` 默认 45；响应 data 在原字段外新增 `research`、`sections`、`researchDegraded: boolean`）；Modify `src/lib/cockpit/script-mapping.ts`（mapDouyin：有 `sections` 时 `draft.body = sections.map(s => \`[\${s.role} \${s.startSec}-\${s.endSec}s]\n\${s.text}\`).join('\n\n')`，hook 字段取 role='hook' 块 text；无 sections 走旧逻辑不变）；Test 更新 `tests/api/scripts-generate.test.ts` + `tests/lib/cockpit/script-mapping.test.ts`（实际文件名以 grep 为准）。
**Interfaces:** Consumes T2 `SCRIPT_WRITE_DOUYIN`、T3 `runResearch`/`getStyleContext`。Produces：`ScriptDraft.output` 新形状 `{ research: ResearchBrief|null, script: { sections }, hooks, titles, cover, durationSec }`（T5/T6 消费）。douyin 分支流程：`runResearch`（null→degraded）→ `getStyleContext(user.id,'douyin')` → `callStructured(SCRIPT_WRITE_DOUYIN)` → 存 ScriptDraft。**xiaohongshu/gongzhonghao 分支代码不动**，加一条回归测试断言其响应形状未变。
- [ ] Step 1: TDD（两阶段编排 mock 断言：research null 时仍写稿且 researchDegraded=true；output 持久化形状；旧平台直通回归；mapping 新旧两态）；commit `feat(script): 抖音生成两阶段化, 输出完整逐字稿`

## Task 5: refine 路由（分块/全稿改稿）

**Files:** Create `src/app/api/v1/scripts/[id]/refine/route.ts`；Test `tests/api/scripts-refine.test.ts`。
**Interfaces:** Consumes T2 `SCRIPT_REFINE`、T3 `getStyleContext`。`POST body: { scope: 'section'|'all', sectionIdx?: number, instruction: string(1-200字) }`。流程：读 ScriptDraft（校验 userId、platform='douyin'、output.script.sections 存在，否则 400）→ getStyleContext → callStructured(SCRIPT_REFINE, 复用 output.research 不重搜) → **scope='section' 时服务端校验**：返回 sections 长度一致且除 `sectionIdx` 外每块 `text` 严格相等，违者 `fail('AI 修改了未指定的段落, 请重试', 502)` → 通过则整体替换 output.script.sections 持久化 → `ok({ sections })`。scope='all' 校验块数 3-6 与首块 role='hook' 即可。sectionIdx 越界 400。
- [ ] Step 1: TDD（section 越权改动 502 且 DB 未写 / 合法 section 只变目标块 / all 重写 / sectionIdx 越界 400 / 无 sections 的旧稿 400）；commit `feat(script): 两级改稿路由 (分块守卫)`

## Task 6: 定稿沉淀 + 风格档案 API

**Files:** Modify `src/app/api/v1/scripts/[id]/picked/route.ts`（定稿成功后调 `depositStyleSample(user.id, id)`，失败 console.warn 不阻塞定稿——同该文件既有 stage 推进的容错先例）；Create `src/app/api/v1/style/profile/route.ts`（GET → `{ description }`；PUT body `{ description: string ≤2000 }` upsert）；Create `src/app/api/v1/style/samples/route.ts`（GET → 列表 `{id, platform, content 前 200 字 preview, createdAt}` 按新到旧）；Create `src/app/api/v1/style/samples/[id]/route.ts`（DELETE 校验 userId）；Test `tests/api/style.test.ts` + picked 路由既有测试补沉淀断言。
**Interfaces:** Consumes T3 `depositStyleSample`。Produces 风格档案 API 供 T7 设置卡。
- [ ] Step 1: TDD（picked→沉淀调用且失败不阻塞 / profile GET 空行默认 '' / PUT 往返 / samples 列表 preview 截断 / DELETE 他人 id 404）；commit `feat(style): 定稿沉淀钩子 + 风格档案 API`

## Task 7: 抽屉 UI + 生成流扩展 + 设置卡

**Files:** Modify `src/components/cockpit/content-drawer.tsx` script 页（生成按钮上方加可折叠「素材（可选）」textarea + 时长 select 30/45/60 默认 45；生成后若 `sections` 存在：素材简报折叠区（points 列表，source 为 URL 时 `<a target="_blank">`）+ sections 分块渲染——块头 `{role 中文标签} {startSec}-{endSec}s`、块体多行文本、块右上「换一版」按钮展开一句话指令 input + 确认；页顶「整体指令」同款 input；hook 块下方 3 候选切换沿用现有 picked 交互；分块/整体调用 `POST /api/v1/scripts/{scriptDraftId}/refine`，pending 态禁用防双击，成功后本地替换 sections 并 mergeScript 回填 body）；Modify `src/lib/cockpit/generate-flow.ts`（`GenerateScriptRequest` 加 `materials?: string; durationSec?: number`，透传 fetch body；deps 不变）；Create `src/components/cockpit/settings-cards/style-profile-card.tsx`（description 编辑保存 + 样本列表只读/单条删除，`.panel` 体系）；Modify `src/components/cockpit/views/settings.tsx` 挂卡；Test `tests/lib/cockpit/generate-flow.test.ts` 补透传断言。
**Interfaces:** Consumes T4 响应新字段、T5 refine、T6 风格 API。抽屉需持有 scriptDraftId：T4 响应已含（grep 现有响应确认字段名，若无则 T4 补 `scriptDraftId`——以实际为准并在账本记录）。无彩色 emoji。
- [ ] Step 1: 实现 + dev 手工走查（真点按钮：素材框/时长/生成两阶段文案/分块换一版/整体指令/设置卡保存删样本——StrictMode 教训，不许只 curl）；commit `feat(cockpit): 抽屉逐字稿交互 + 风格档案设置卡`

## Task 8: 收尾 — 文档 + 真实 E2E

**Files:** README（五期功能段：两阶段生成/风格学习/两级改稿 + 成本说明）、spec `docs/superpowers/specs/2026-08-13-script-quality-design.md` 回写「实际实施结论」段。
- [ ] Step 1: 文档；Step 2: 真实 E2E（key 已就绪，当场跑）：①雷达采纳过的选题生成一篇——断言 research 非空且含真实 URL、sections 3-6 块口播体 ②素材框粘一段文本再生成——简报含「用户素材」来源 ③分块改稿一次+整体改稿一次 ④定稿→StyleSample 落库→再生成第 3 篇确认样本数≥2 时 prompt 进 few-shot 模式（日志或 DB 断言）⑤typecheck+test+build 全绿；Step 3: commit `docs(script): 五期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 两阶段+降级(T3/T4) ✓ 风格切换(T3) ✓ 两级改稿+守卫(T5) ✓ §2 双表+幂等+零迁移(T1/T3/T4) ✓ §3 抽屉全项+设置卡(T7) ✓ 定稿沉淀(T6) ✓ §4 YAGNI 未越界 ✓ §5 风险各有对应测试 ✓。
- 类型一致性：`StyleContext` 唯一定义在 T2 script-write-douyin.ts，T3/T5 导入 ✓；`ResearchBrief` T2 定义 T3/T4 消费 ✓；`DouyinFullScript.sections` T2=T4 存储=T5 校验=T7 渲染 ✓。
- 已知不确定点（交实施时以实际为准并记账本）：generate 响应是否已含 scriptDraftId（T7 标注）；既有测试文件名（T4 标注 grep 为准）。
