# 抖音逐字稿六幕改造 (cockpit 十三期 / 路线 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抖音写稿从三段式（hook/main×N/cta）改为向 `srt2slides/script_spec.md` 对齐的六幕结构 + 事实核查 + lint 硬检查，为 C 期 `align`（录音对回六幕边界）铺路。Spec: `docs/superpowers/specs/2026-08-16-six-act-script-design.md`。

**Architecture:** 新 schema 与 lint 纯函数先行（T1/T2），写稿 prompt 与生成路由接上（T3），再逐个补齐五个下游消费点（T4/T5），最后 UI 与收尾（T6/T7）。**旧稿零迁移**：所有消费点按 `output.script` 里是 `sections` 还是 `acts` 分岔，旧稿保持旧路径。

**Tech Stack:** 同前（无新依赖）。

## Global Constraints

- **旧稿零迁移**：`output.script.sections` = 旧三段式，`output.script.acts` = 新六幕。**每一处消费点都必须显式分岔并各写一条旧稿测试**——用户库里现有三段式稿子，任一处漏分岔就会打不开（本期最大风险）。不写迁移脚本。
- 六幕 key 与顺序固定逐字：`hook` / `concept_a` / `concept_b` / `trivia` / `synthesis` / `punchline`。
- 每幕字段：`act` / `title`(≤20) / `narration` / `visual`(≤80) / `note`(≤120) / `targetSec` / `beats`(3-5 个 `{keyword}`) / `facts`(`{claim, value, source, confidence: 'high'|'medium'|'low'}`)。`four_dims`: `{gain, surprise, clarity, appeal}`。
- **不做 5 层剪辑时间线**（footage/caption/bgm/sfx）；不产 `code` 字段；**每幕不给绝对 startSec/endSec**，只给 `targetSec`。
- 时长占比固定：hook 10% / concept_a 22.5% / concept_b 22.5% / trivia 15% / synthesis 22.5% / punchline 7.5%；`targetSec = Math.round(durationSec × 占比)`；prompt 按中文口播 **4-5 字/秒**换算字数目标。durationSec 选项 30/45/60/**90（六幕默认）**。
- lint **不阻断保存**：生成后服务端自动跑，`lintIssues` 随响应返回并落库进 `output.lintIssues`，仅展示。
- 说明性字段（narration/visual/note/title 之外的长文）沿十期「宽进严出」纪律（宽收 max + `transform` 截断）；主键性字段（`act` 枚举、`title`）严格拒绝。
- 十二期人物志/经历注入不受影响（`buildVoiceSection` 与写稿 prompt 解耦），改造时不得动它。
- xiaohongshu / gongzhonghao 两分支**字符级不动**并补回归断言。
- API house 约定 `ok()/fail()` + `getOrCreateDefaultUser`；UI 无彩色 emoji；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit（docker Postgres 需在跑）；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 六幕 schema + 时长分配纯函数

**Files:** Create `src/lib/script/six-act.ts`；Test `tests/lib/script/six-act.test.ts`。
**Interfaces (Produces，T2-T6 消费):**
```ts
export const ACT_KEYS = ['hook','concept_a','concept_b','trivia','synthesis','punchline'] as const;
export type ActKey = (typeof ACT_KEYS)[number];
export const ACT_LABELS: Record<ActKey, string> = {
  hook: '开场钩子', concept_a: '概念A', concept_b: '概念B',
  trivia: '冷知识', synthesis: '知识串联', punchline: '金句收尾',
};
/** 占比取 script_spec 区间中值并归一化, 合计 = 1 */
export const ACT_RATIOS: Record<ActKey, number> = {
  hook: 0.10, concept_a: 0.225, concept_b: 0.225, trivia: 0.15, synthesis: 0.225, punchline: 0.075,
};
export interface ActFact { claim: string; value: string; source: string; confidence: 'high'|'medium'|'low' }
export interface ActBeat { keyword: string }
export interface ScriptAct {
  act: ActKey; title: string; narration: string; visual: string; note: string;
  targetSec: number; beats: ActBeat[]; facts: ActFact[];
}
export interface FourDims { gain: string; surprise: string; clarity: string; appeal: string }
export const SixActScriptSchema: z.ZodType<{ acts: ScriptAct[]; four_dims: FourDims }, z.ZodTypeDef, any>;
// acts 恰好 6 项且 act 值按 ACT_KEYS 顺序(用 superRefine 校验顺序, 不只校验集合);
// title ≤20 严格; narration min 10 宽收 max 1500 → transform 截断 800;
// visual 宽收 max 300 → 截 80; note 宽收 max 400 → 截 120;
// beats 3-5; facts 0-8; targetSec int ≥1
export function allocateActSeconds(durationSec: number): Record<ActKey, number>;
// 按 ACT_RATIOS 分配并四舍五入; 余数补给 concept_a(占比最大之一), 保证 sum === durationSec
export function isSixActScript(script: unknown): script is { acts: ScriptAct[]; four_dims: FourDims };
// 唯一的形状判别入口 —— 六处消费点都用它分岔, 避免各写各的判别逻辑
```
**Test:** schema 顺序校验（乱序 6 项拒 / 缺 1 幕拒 / 多 1 幕拒）；宽进严出截断（narration 1200 字 → 800、visual 200 → 80、note 300 → 120）；title 21 字拒；beats 2 个拒 / 6 个拒；facts confidence 非枚举拒；`allocateActSeconds` 三档（30/45/60/90）各自 sum 等于入参且每幕 ≥1；`isSixActScript` 四态（六幕对象 true / 旧 sections 对象 false / null false / 缺 four_dims false）。
- [ ] Step 1: TDD；commit `feat(script): 六幕 schema + 时长分配纯函数`

## Task 2: lint 硬检查纯函数

**Files:** Create `src/lib/script/six-act-lint.ts`；Test `tests/lib/script/six-act-lint.test.ts`。
**Interfaces:** Consumes T1 类型。Produces：
```ts
export interface LintIssue { level: 'error'|'warn'; act: string; message: string }
export function lintSixActScript(script: { acts: ScriptAct[]; four_dims: FourDims }): LintIssue[];
```
规则逐条（移植自 `/Users/lizhishaoniange/Desktop/杂货铺/自媒体工程文件/lint.py`，实施时**先读该文件**核对数字识别口径）：
- **error**：六幕缺失/顺序错；`four_dims` 任一项空串；任一幕 `title`/`narration`/`visual` 为空；**narration 中出现数字但 `facts` 里没有 `value` 或 `claim` 包含该数字的条目**；`facts` 条目 `source` 为空；`hook.narration` 开头 30 字内出现寒暄词（`大家好`/`欢迎来到`/`今天我们来聊聊`/`我是`）。
- **warn**：narration 含空洞形容词（`非常`/`极其`/`震撼`/`颠覆`）；单句（按 `。！？` 切）超 30 字；句首出现悬空指代（`这个`/`那个`）；`punchline.narration` 与 `hook.narration` 无 2 字以上共同词（未回扣钩子）。
**Test:** 每条规则一正一反；数字识别边界（`2026年` 算数字需核查 / `第一` 不算 / 小数 `3.5` 算）；全通过时返回 `[]`；error 与 warn 混合时顺序稳定（按幕序）。
- [ ] Step 1: TDD（先读 lint.py 对齐口径）；commit `feat(script): 六幕 lint 硬检查`

## Task 3: 写稿 prompt 六幕化 + 生成路由

**Files:** Modify `src/lib/llm/prompts/script-write-douyin.ts`（`DouyinFullScriptSchema` 的 `sections` 换成 T1 的 `acts` + `four_dims`，`hooks`/`titles`/`cover`/`suggestedIntent` **保持不变**；system prompt 吸收 `script_spec.md` 的创作原则——科普严谨性 6 条、禁止事项 6 条、六幕职责与占比、每幕字数目标，**实施时先读该文件原文**，不要凭记忆写）；Modify `src/app/api/v1/scripts/generate/route.ts`（douyin 分支：`durationSec` 选项加 90 且 douyin 默认改 90；调 `allocateActSeconds` 把各幕目标秒数传进 `buildUserMessage`；落库 `output.script.acts` + `output.four_dims`；生成后调 `lintSixActScript`，结果落 `output.lintIssues` 并随响应返回 `lintIssues`；**xhs/gongzhonghao 分支字符级不动**）；Test 对应两文件。
**Interfaces:** Consumes T1/T2。Produces：新 `output` 形状与响应字段 `lintIssues`（T6 展示）。
**Test:** schema 六幕往返；system prompt 关键词断言（含「不说没把握的数字」「无开场白」「冷知识」「金句」「回扣」）；路由 douyin 默认 durationSec=90、90 档 targetSec 分配正确、`lintIssues` 落库且随响应返回、lint 有 error 时仍 200 保存（不阻断）；xhs/gongzhonghao 回归（响应形状与调用参数不变）。
- [ ] Step 1: TDD；commit `feat(script): 抖音写稿六幕化 + 生成时自动 lint`

## Task 4: 改稿按幕 + 定稿沉淀 + 骨架回填

**Files:** Modify `src/app/api/v1/scripts/[id]/refine/route.ts`（新增 `scope:'act'` + `actKey`：只重写该幕、服务端校验其余五幕 `narration` 逐字不变（同现有 section 守卫先例，违者 502 不写库）；`scope:'all'` 对六幕稿重写全部六幕并校验 key 与顺序；**旧 sections 稿仍走 `scope:'section'`+`sectionIdx` 原逻辑**，两套并存按 `isSixActScript` 分岔）；Modify `src/lib/script/style.ts`（`depositStyleSample` 的 douyin 分支：六幕稿取 `acts.map(a => a.narration).join('\n')`，旧稿取 `sections.map(s => s.text)`）；Modify `src/lib/cockpit/script-mapping.ts`（`mapDouyin`：六幕稿 `hook` 幕 narration → `draft.hook`，六幕汇总（`[幕标签] narration` 逐幕拼接）→ `draft.body`；旧稿逻辑一行不动）。
**Interfaces:** Consumes T1 `isSixActScript`/`ACT_KEYS`/`ACT_LABELS`。
**Test:** refine：六幕稿 `scope:'act'` 只变目标幕（其余五幕逐字不变）/ 越权改动 502 不写库 / `actKey` 非法 400 / `scope:'all'` 六幕重写 / **旧稿 `scope:'section'` 回归不变**；style：六幕取 narration、旧稿取 text 两态；mapping：六幕两态 + 旧稿零改动断言。
- [ ] Step 1: TDD；commit `feat(script): 改稿按幕 + 定稿沉淀与骨架回填分岔`

## Task 5: 深度脚本页六幕分岔

**Files:** Modify `src/components/content/script-result.tsx` 的 `DouyinView`（当前已按 `retentionBeats` / `sections` 两态分岔，**再加第三态**：`isSixActScript` 为真时渲染六幕列表——每幕标题+建议时长+台词+配图建议+关键词+事实核查表；三态互斥，任一态缺字段都不崩）；Test `tests/components/`（若无组件测试基建则抽纯函数 `pickDouyinViewMode(data) → 'legacy'|'sections'|'six-act'|'empty'` 到 `src/lib/cockpit/douyin-view-mode.ts` 并单测四态）。
**Interfaces:** Consumes T1 `isSixActScript`。
**Test:** `pickDouyinViewMode` 四态；六幕稿缺 `facts`/`beats` 时不崩（防御渲染）。
- [ ] Step 1: TDD；commit `feat(content): 深度脚本页支持六幕稿`

## Task 6: 抽屉六幕渲染 + lint 展示

**Files:** Modify `src/components/cockpit/content-drawer.tsx`（douyin 面板按 `isSixActScript` 分岔：六幕稿渲染六张幕卡片（幕标签 + `targetSec` + 台词 + 配图建议 + 备注 + 关键词 chips + 事实核查列表），每幕右上「改这一幕」按钮 → `scope:'act'` + 一句话指令（沿五期分块改稿交互与竞态守卫模式）；页顶整稿指令保留；**lint 结果条**：error 红点 / warn 黄点分组展示，点开列出 `act + message`，明确标注「仅提示，不影响保存」；旧 sections 稿走原渲染与原改稿路径）；Modify `src/app/cockpit.css`（幕卡片与 lint 条样式，沿 `.panel` 体系，无彩色 emoji）；Test：dev 手工走查（清单：①生成一篇六幕稿看六卡渲染 ②改单幕只变该幕 ③整稿指令 ④lint 有 error 时红点与文案 ⑤打开一篇**旧三段式稿**确认原样可用可改 ⑥明暗主题）。
**Interfaces:** Consumes T1-T4。
- [ ] Step 1: 实现 + 走查；commit `feat(cockpit): 抽屉六幕卡片 + lint 结果展示`

## Task 7: 收尾 — 文档 + 真实 E2E

**Files:** README 十三期段（六幕结构表 + lint 规则 + 时长建议 + 旧稿兼容说明）；spec 回写「## 6. 实际实施结论」。
**真实 E2E（key 就绪；每篇几分钱）:** ①真实生成一篇 90 秒六幕稿——断言六幕齐全有序、`four_dims` 非空、`facts` 里每个数字标了来源、`targetSec` 合计=90 ②对其中一幕按幕改稿——断言其余五幕逐字未变 ③定稿→`StyleSample` 内容为六幕 narration 拼接 ④**打开一篇库里已有的旧三段式抖音稿**——抽屉与深度页都不崩、改稿仍可用（本期最大风险的收口）⑤lint 人工造一条含无来源数字的稿验证 error 出现且仍能保存 ⑥typecheck+test+build 全绿。E2E 产生的稿件清理，用户真实档案/经历不动。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(script): 十三期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 六幕结构+时长分配(T1) ✓ §2 lint(T2) ✓ §3 六处牵连——写稿 prompt+生成路由(T3)/改稿+沉淀+回填(T4)/深度页(T5)/抽屉(T6) ✓ §4 YAGNI 未越界（无 5 层时间线、无迁移脚本、无 code 字段、lint 不阻断） ✓ §5 风险：宽进严出(T1)、prompt 不整篇塞(T3)、旧稿每处显式测试(T1 `isSixActScript` + T3-T6 各自回归 + T7 真实旧稿走查)、lint 误报不阻断(T3)、短时长提示(T3/T6) ✓。
- 类型一致性：`ActKey`/`ScriptAct`/`FourDims`/`LintIssue` 均 T1/T2 唯一定义，T3-T6 消费 ✓；`isSixActScript` T1 定义、T4/T5/T6 分岔共用 ✓；`allocateActSeconds` T1 定义、T3 调用 ✓。
- 已知不确定点（实施核实记账本）：`lint.py` 的数字识别正则口径（T2 标注先读原文）；`script_spec.md` 创作原则原文（T3 标注先读，不凭记忆）；本仓是否有组件测试基建（T5 标注，无则抽纯函数）。
