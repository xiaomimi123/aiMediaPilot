# 抽屉改稿闭环 + 小红书两阶段接入 (cockpit 六期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 修五期抽屉两个已知限制（scriptDraftId 关联回写 + 懒加载拉回 + 定稿推进复活）；B 小红书接入两阶段生成（沿用 6 区块 schema、整稿改稿、样本独立积累）。Spec: `docs/superpowers/specs/2026-08-14-drawer-closure-xhs-design.md`。

**Architecture:** A 复用旧 `POST /api/v1/scripts` 的 cockpit 关联逻辑与既有 `GET /api/v1/scripts/[id]`，抽屉懒加载沿五期竞态守卫模式；B 复用五期 runResearch/getStyleContext/refine 骨架，新增 XHS 写稿与整稿改稿两个 prompt，refine 路由按 platform 分支判别、schema 各自独立。

**Tech Stack:** 同五期（Next.js 14 App Router / Prisma / zod / vitest node house mock）。

## Global Constraints

- 公众号（gongzhonghao）分支任何行为不得改变；douyin 生成/改稿既有行为除「新增 cockpitContentId 关联与懒加载」外不得改变。
- cockpitContentId 回写 best-effort：校验归属，失败仅 console.warn 不阻断生成响应（照旧 `POST /api/v1/scripts` src/app/api/v1/scripts/route.ts:42-55 的既有逻辑）。
- `CockpitContent.scriptDraftId` 是服务端字段：回写不触碰 cockpit rev（不调 bumpCockpitRev——server-store 明确它不随 workspace PUT 写入，不扩大 409 面）。
- 懒加载拉回失败/旧形态稿（无 script.sections 或无 research/intro）静默降级为现状渲染；防御解析沿 mapDouyin 窄化风格；竞态守卫沿五期 currentItemIdRef 模式。
- XHS 输出 schema 逐字沿用现有 `XHSScriptResponseSchema`（titles/coverText/intro/body/tags/shotIdeas，字段与 min/max 不变）；标题/正文 emoji 保留（平台惯例）；UI 界面字形仍禁彩色 emoji。
- XHS 整稿改稿服务端校验 titles/coverText/tags/shotIdeas 四键未变，违者 `fail('AI 修改了不该动的区块, 请重试', 502)` 不写库；`scope:'section'` 对 xiaohongshu 返回 400。
- XHS 风格：getStyleContext(userId,'xiaohongshu') 独立积累；定稿沉淀文本 = `intro + '\n' + body`；覆盖更新语义同抖音。
- xiaohongshu 分支退役 inspirationId/styleHints（同五期抖音先例）；durationSec 对 xiaohongshu 忽略。
- DeepSeek key 一律 resolveDeepSeekApiKey；研究降级不阻断（researchDegraded 语义同五期）。
- API house 约定 ok()/fail() + getOrCreateDefaultUser；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: generate 路由 cockpitContentId 关联回写 + generate-flow 透传

**Files:** Modify `src/app/api/v1/scripts/generate/route.ts`（请求体加可选 `cockpitContentId?: string`；douyin 与 xiaohongshu 分支在 ScriptDraft 落库后 best-effort 回写——xiaohongshu 分支本任务先只在其现有单阶段落库处预留同一 helper 调用位，若该分支当前不落库 ScriptDraft 则本任务只接 douyin，xiaohongshu 留给 T4 落库时接入并在报告注明）；抽出私有 helper `linkCockpitContent(userId, cockpitContentId, scriptDraftId)`（归属校验 + update + catch console.warn，逻辑照抄 `src/app/api/v1/scripts/route.ts:42-55`）；Modify `src/lib/cockpit/generate-flow.ts`（`GenerateScriptRequest` 加 `cockpitContentId?: string`，fetch body 透传——抽屉调用处传 `item.id`）；Modify `src/components/cockpit/content-drawer.tsx` 调用处补参。
**Interfaces:** Produces：generate 响应不变；副作用 `CockpitContent.scriptDraftId` 被写（T2 懒加载与 picked 推进的前提）。
**Test:** `tests/api/scripts/generate.test.ts` 补：带 cockpitContentId 生成 → cockpitContent.update 被调且参数正确；归属不符/不存在 → console.warn 且生成响应仍 200；不带 → 不调 update。generate-flow 测试补透传断言。
- [ ] Step 1: TDD 实现；commit `feat(script): 生成回写 CockpitContent.scriptDraftId 关联`

## Task 2: 抽屉懒加载拉回 + 定稿推进复活验证

**Files:** Modify `src/components/cockpit/content-drawer.tsx`（script 页挂载/切 item 的 useEffect：本地无生成态且 `item.scriptDraftId` 非空 → `GET /api/v1/scripts/${item.scriptDraftId}` 拉回 output，防御解析出 sections/research/hooks/titles/durationSec 恢复改稿 UI；解析不出（旧形态/畸形）静默保持现状；await 后 currentItemIdRef 守卫；加载中不阻塞骨架编辑）；确认 `GET /api/v1/scripts/[id]` 响应形状（先读 `src/app/api/v1/scripts/[id]/route.ts`，若无 GET 方法则本任务补一个只读 GET：归属校验 + ok({ id, platform, topic, output, picked })）。
**Interfaces:** Consumes T1 的 scriptDraftId 关联。Produces：抽屉重开可继续改稿（五期 spec §6(c) 限制解除）。
**Test:** 懒加载解析纯函数抽到 `src/lib/cockpit/draft-restore.ts`（`parseDraftOutput(output: unknown) → { sections?, research?, hooks?, titles?, durationSec? } | null`）单测：完整五期形态/旧 retentionBeats 形态→null/畸形单键缺失不炸；picked 推进复活：`tests/api/scripts/picked.test.ts` 补集成断言——mock CockpitContent(stage='script', scriptDraftId 关联) → picked 全就绪 → stage 推进 recording 被调（既有逻辑，之前因关联缺失测不到真路径）。
- [ ] Step 1: TDD 实现 + dev 手工走查（生成→关抽屉→重开→改稿 UI 恢复→换一版可用）；commit `feat(cockpit): 抽屉懒加载拉回改稿状态, 定稿推进复活`

## Task 3: XHS 写稿 + 整稿改稿两个 prompt

**Files:** Create `src/lib/llm/prompts/script-write-xhs.ts`、`src/lib/llm/prompts/xhs-refine.ts`；Modify `src/lib/llm/prompts/index.ts` 导出；Test `tests/lib/llm/prompts/xhs-quality.test.ts`。
**Interfaces (Produces，T4/T5 消费):**
```ts
// script-write-xhs.ts —— schema 逐字复用现有 XHSScriptResponseSchema（从 script-generate-xiaohongshu.ts import，不复制）
export const SCRIPT_WRITE_XHS = {
  buildSystemPrompt(niche: string, style: StyleContext): string,   // StyleContext 从 script-write-douyin.ts import
  buildUserMessage(input: { topic: string; brief: ResearchBrief | null }): ContentPart[],
  responseSchema: XHSScriptResponseSchema,
};
// system 要求: 小红书图文笔记语感(情感化短段落/换行多/关键句 ** 加粗/比抖音更温), 简报 fact 自然引进 intro 或 body(brief null 时该段省略),
// samples 模式附 "以下是博主本人最近定稿笔记, 模仿其口吻/句式" + 样本, description 模式附风格说明段; 保留 titles 含 emoji 惯例
// xhs-refine.ts
export const XHS_REFINE = {
  buildSystemPrompt(niche: string, style: StyleContext): string,   // 按指令重写 intro+body, 其余区块不输出
  buildUserMessage(input: { intro: string; body: string; instruction: string; brief: ResearchBrief | null }): ContentPart[],
  responseSchema: z.object({ intro: z.string().min(20).max(150), body: z.string().min(150).max(800) }),  // 与 XHSScriptResponseSchema 同边界
};
```
**Test:** schema 边界（intro 19/150/151、body 149/800/801）；system 关键词断言（写稿含「图文笔记」「加粗」、samples 模式嵌样本文本；refine 含「只重写」或等义约束词）；brief null 时素材段省略。
- [ ] Step 1: RED→GREEN；commit `feat(llm): 小红书两阶段写稿 + 整稿改稿 prompt`

## Task 4: generate 路由 xiaohongshu 分支两阶段化 + 沉淀平台扩展

**Files:** Modify `src/app/api/v1/scripts/generate/route.ts`（xiaohongshu 分支改两阶段：runResearch（materials 透传、durationSec 忽略）→ getStyleContext(user.id,'xiaohongshu') → callStructured(SCRIPT_WRITE_XHS) → `prisma.scriptDraft.create` output=`{ research, titles, coverText, intro, body, tags, shotIdeas }` → linkCockpitContent（T1 helper）→ 响应 data 加 research/researchDegraded/scriptDraftId；退役该分支 styleHints/inspirationApplied；**gongzhonghao 分支字符级不动**，补回归断言）；Modify `src/lib/script/style.ts`（depositStyleSample 按 draft.platform 取文本源：douyin=sections join，xiaohongshu=`intro + '\n' + body`，其余平台返回 false；防御读取）；Modify `src/lib/cockpit/script-mapping.ts` 若 xiaohongshu 映射需感知新 output 形状（现有 mapXiaohongshu 读 titles/intro/body/tags——新形状这些键名不变，预期零改动，验证后在报告注明）。
**Interfaces:** Consumes T3 SCRIPT_WRITE_XHS、五期 runResearch/getStyleContext、T1 linkCockpitContent。Produces：xhs ScriptDraft.output 新形状（T5 refine/T6 抽屉消费）。
**Test:** `tests/api/scripts/generate.test.ts` 补 xhs 两阶段编排（research null 降级仍写稿、output 持久化形状、cockpitContentId 关联、styleHints 不再被调）；gongzhonghao 回归；`tests/lib/script/style.test.ts` 补平台分支沉淀（xhs 文本源、其余平台 false）。
- [ ] Step 1: TDD 实现；commit `feat(script): 小红书生成两阶段化 + 沉淀平台扩展`

## Task 5: refine 路由 xiaohongshu 整稿支持

**Files:** Modify `src/app/api/v1/scripts/[id]/refine/route.ts`（platform 分支：douyin 走现有逻辑不变；xiaohongshu：`scope:'section'` → `fail('小红书暂不支持分块改稿', 400)`；`scope:'all'` → 校验 output 有 intro/body（无则 400 旧稿文案）→ getStyleContext(user.id,'xiaohongshu') → callStructured(XHS_REFINE, brief=output.research) → 服务端校验响应仅含 intro/body 且写库时 titles/coverText/tags/shotIdeas 四键原样保留（从 draft.output spread，只覆盖 intro/body）——若 spread 实现天然保证四键不变，则「校验」以「实现构造上不可能改动 + 测试断言四键原样」达成，报告注明；持久化 → ok({ intro, body })）。
**Interfaces:** Consumes T3 XHS_REFINE、T4 xhs output 形状。Produces：ok({intro, body}) 供 T6 抽屉。
**Test:** `tests/api/scripts/refine.test.ts` 补：xhs section 400；xhs all 成功且四键原样（objectContaining 断言 titles/tags 等未变）；无 intro/body 旧稿 400；douyin 既有全部用例不回归。
- [ ] Step 1: TDD 实现；commit `feat(script): 小红书整稿改稿 (四键保留)`

## Task 6: 抽屉 XHS 渲染 + 收尾文档 + 真实 E2E

**Files:** Modify `src/components/cockpit/content-drawer.tsx`（xiaohongshu 生成后：素材简报折叠区复用五期组件；intro/body/tags/shotIdeas 渲染区 + 页顶整稿指令框（调 refine scope:'all'，成功后本地替换 intro/body 并 mergeScript 回填骨架）；素材框对 xhs 开放（durationSec select 仅 douyin 显示——现状已如此则不动）；懒加载条件按平台判别（T2 的 parseDraftOutput 扩展 xhs 形状：`{ research?, intro?, body?, tags?, shotIdeas? }`）；互斥矩阵纳入 xhs 整稿改稿动作）；README 六期段；spec 回写「实际实施结论」。
**Interfaces:** Consumes T4 响应、T5 refine、T2 draft-restore。
**Test:** parseDraftOutput xhs 形状用例；dev 手工走查（xhs 生成→简报/正文渲染→整稿指令→关抽屉重开恢复→定稿沉淀）。真实 E2E（key 已就绪）：①douyin 生成带 cockpitContentId → DB 验证关联 → 关抽屉重开改稿 UI 恢复 → picked 全就绪 → stage 自动推进 recording ②xhs 真实两阶段生成（research 非空、6 区块合规）③xhs 整稿改稿（intro/body 变、四键原样）④xhs 定稿 → StyleSample platform='xiaohongshu' 落库 ⑤typecheck+test+build 全绿。
- [ ] Step 1: 实现+走查；Step 2: 真实 E2E；Step 3: commit `feat(cockpit): 抽屉小红书两阶段交互 + 六期收尾`

---

## Self-Review 记录

- Spec 覆盖：§1 A-1(T1) A-2(T2) A-3(T2 测试) ✓ §2 B prompt(T3) 生成(T4) 整稿改稿(T5) 沉淀(T4) 抽屉(T6) ✓ §3 YAGNI 未越界 ✓ §4 风险各有测试对应 ✓。
- 类型一致性：linkCockpitContent T1 定义 T4 消费 ✓；parseDraftOutput T2 定义 T6 扩展 ✓；XHS_REFINE responseSchema 边界与 XHSScriptResponseSchema intro/body 一致 ✓；StyleContext/ResearchBrief 沿五期唯一定义处 import ✓。
- 已知不确定点（实施时核实并记账本）：GET /api/v1/scripts/[id] 是否已有 GET 方法（T2 标注）；xiaohongshu 现有分支是否落库 ScriptDraft（T1 标注，不落则关联接入推迟到 T4）；mapXiaohongshu 对新形状是否零改动（T4 标注）。
