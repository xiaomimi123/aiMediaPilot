# Builder 产 FilmPlan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ppt-narration` 的 Remotion 链**自己产出 `FilmPlan`** —— 从六幕稿出发，由模型选卡填槽、经校验与修复循环收敛，落库后渲染，取代目前手填 `vp.filmPlan` 的状态。

**Architecture:** 单段式：六幕稿 + 幕时间窗 → 一次 LLM 调用产 `FilmPlan` JSON → `FilmPlanSchema.safeParse` + 时间轴覆盖校验 → 失败则把**精准的**错误喂回，最多修 2 轮 → `clampShotsToSource` 兜底 → 落库 `vp.filmPlan` → `renderFilm`。不引入 Director 阶段（理由见下）。

**Tech Stack:** TypeScript / zod / Prisma / `DeepSeekTextLLM` / Remotion（渲染层已就绪，本计划不碰）

**Spec:** `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（§2 填槽决定、§3.3 `ppt-narration` 链、§6½ 接线时必须传 `mode:'cards'`）

## 为什么是单段式（不接 Director）

现有 `ppt-narration` 旧链是 Director（产 `Shot[]`：claim / visualJob / beats）→ Builder（写 HTML）两段。本计划**不复用 Director**，理由是证据：

- 验证探针（`.superpowers/sdd/2026-08-31-remotion-foundation/spike-builder-filmplan.md`，三条真实六幕稿、三轮）用的就是**单段式**——直接从六幕稿产 `FilmPlan`，最终一次通过率 3/3、卡片分布健康、零编造数字。**这是我们手上唯一的实测数据。**
- Director 的产出（`visualJob`、`beats`、`palette`）是为"模型自由排版"设计的中间语言；填槽架构下版面由组件决定，这些字段没有消费者。为对称而加一段，等于多一次 API 调用和多一个失败面，换不到任何已知收益。
- Director 的单镜上限是 40000ms，与卡片"一镜一个表达"的粒度不匹配。

**代价（明确接受）**：模板的 `shotPaceSec` / `visualTone` / `builderModel` 这些 Director 阶段的配置在新链上暂不生效；`assetIds`（真实素材指派）也不生效。这些属于后续计划，本计划不认领。

## Global Constraints

- **先建后拆**：不改动 `handlePptNarration` / `handleTalkingHeadBroll` / `handleIllustrationTts` 三条旧分支，不删任何旧渲染层文件（`shot-renderer.ts` / `ambient-rig.ts` / `shot-chrome.ts` / `frame-overlap.ts` / `preview-html.ts`）。已有测试断言这些文件都在。
- **`buildFactsSection` 必须显式传第三参数 `'cards'`**。默认值是 `'freeform'`（旧链语义），忘了传**不报任何错**，只会安静地退回"提示词要求条目数不少于 8 条、而 `list` schema 上限是 8"的自相矛盾状态——实测证实这正是 list 注水的根因（电池稿 6 条编 4 条）。见 spec §6½。
- **喂回模型的错误信息属于契约本身**。实测：`z.union` 的 `invalid_union` 把四个分支的失败并排输出，模型读到排第一的 statement 分支「Unrecognized key(s): 'label','value','suffix'」后**放弃整张 `stat` 卡**，存活率 0/3；改 `discriminatedUnion` 后 4/4。任何喂回给模型的报错都必须精准指向单一问题，不得夹带会把模型带偏的其它分支噪音。
- **`remotion/` 有独立 tsconfig，主项目根目录的 `tsc --noEmit` 照不到它。** 一律用 `npm run typecheck:all`（串联两侧）。本会话已因此漏过一个 Critical。
- **改完 worker 代码必须重启 worker**：`worker:dev` 没有 watch，跑的会是旧代码。本会话已因此白跑过一轮验证。
- **改完 prisma schema 必须重启 dev 与 worker**：旧 Prisma client 把新字段读成 `undefined` 而不是报错，症状极具误导性。（本计划**不改** schema——`renderer` 与 `filmPlan Json?` 字段已存在。）
- 注释与文档用中文，说清"为什么"。提交信息结尾带：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## 不做什么（明确的范围外）

- **不接音频**。`ppt-narration` 旧链本身就是无声的（BGM 由包装段加，而 Remotion 分支跳过包装段——见 `video-production-worker.ts` 里 `handlePptNarrationRemotion` 之后那段范围限制注释）。`renderFilm` 的 `audioSrc` 继续传 `null`。
- **不接文案叠加与包装段**。同上，已是记录在案的范围限制。
- **不改 `FilmPlanSchema` 的 schema 定义**（`describeCardsForPrompt()` 的文案可以改）。
- **不动 `stat.value` 的 `.finite()`**（已裁决维持 deferred）。
- **不做"生成前剪辑台"**（用户已确认排在迁移之后）。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/lib/video-production/film-plan-prompt.ts`（新建） | 纯函数：拼 FilmPlan 的 system prompt 与 user message；算幕时间窗；把 zod 问题格式化成给模型看的修复指令。无 IO、无 LLM。 |
| `src/lib/video-production/film-plan-timing.ts`（新建） | 纯函数：`checkFilmPlanTiming(plan, totalMs)` —— schema 拦不住的时间轴问题（空档、超出片长）。 |
| `src/lib/video-production/film-plan-builder.ts`（新建） | 修复循环：调 LLM → `safeParse` → 校验时间轴 → 失败则喂回精准错误重试。依赖注入 LLM，可离线测。 |
| `src/jobs/workers/video-production-worker.ts`（修改） | `handlePptNarrationRemotion` 里接上：preview 产 plan 并落库，master 复用落库的 plan。 |
| `docs/.../2026-08-31-remotion-migration-design.md` + `README.md`（修改） | 接线完成后更新 §6½ 与二十五期小节。 |

---

### Task 1: 幕时间窗 + FilmPlan 提示词

**Files:**
- Create: `src/lib/video-production/film-plan-prompt.ts`
- Test: `tests/lib/video-production/film-plan-prompt.test.ts`

**Interfaces:**
- Consumes: `describeCardsForPrompt()`（`shot-plan.ts`）、`buildFactsSection(acts, brief, 'cards')`（`facts-guard.ts`）、`ScriptAct`（`@/lib/script/six-act`）
- Produces:
  - `export type ActWindow = { act: string; title: string; startMs: number; endMs: number; narration: string }`
  - `export function actWindows(acts: ScriptAct[]): ActWindow[]`
  - `export const FILM_PLAN: { buildSystemPrompt(cardsSection: string, factsSection: string): string; buildUserMessage(windows: ActWindow[]): ContentPart[]; responseSchema: z.ZodType<{ shots: unknown[] }, z.ZodTypeDef, any> }`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { actWindows, FILM_PLAN } from '@/lib/video-production/film-plan-prompt';
import { describeCardsForPrompt } from '@/lib/video-production/shot-plan';
import type { ScriptAct } from '@/lib/script/six-act';

const acts = [
  { act: 'hook', title: '钩子', narration: '刷到过三天赚五千吗', targetSec: 9, facts: [] },
  { act: 'concept_a', title: '现实', narration: '月均成交额不足九百元', targetSec: 11, facts: [] },
] as unknown as ScriptAct[];

describe('actWindows', () => {
  it('按 targetSec 累加出毫秒时间窗, 首尾相接不留缝', () => {
    expect(actWindows(acts)).toEqual([
      { act: 'hook', title: '钩子', startMs: 0, endMs: 9000, narration: '刷到过三天赚五千吗' },
      { act: 'concept_a', title: '现实', startMs: 9000, endMs: 20000, narration: '月均成交额不足九百元' },
    ]);
  });

  it('空稿返回空表, 不抛错', () => {
    expect(actWindows([])).toEqual([]);
  });
});

describe('FILM_PLAN.buildSystemPrompt', () => {
  it('内嵌卡片说明原文 —— 卡片库是唯一事实来源, 不许在这里另写一套', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toContain(describeCardsForPrompt());
  });

  it('明确要求时间窗内铺满、不留空档、不许重叠', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toMatch(/不留空档|不要留空/);
    expect(p).toContain('不许重叠');
  });

  it('只输出 JSON, 不要 markdown 代码块 —— 与 DIRECTOR 的既有约定一致', () => {
    const p = FILM_PLAN.buildSystemPrompt(describeCardsForPrompt(), '');
    expect(p).toContain('只输出 JSON');
  });
});

describe('FILM_PLAN.buildUserMessage', () => {
  it('把每一幕的时间窗与台词都给到模型', () => {
    const [part] = FILM_PLAN.buildUserMessage(actWindows(acts));
    expect(part.type).toBe('text');
    const text = (part as { text: string }).text;
    expect(text).toContain('0');
    expect(text).toContain('9000');
    expect(text).toContain('刷到过三天赚五千吗');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/film-plan-prompt.test.ts`
Expected: FAIL —— `Failed to resolve import "@/lib/video-production/film-plan-prompt"`

- [ ] **Step 3: 实现**

```ts
import { z } from 'zod';
import type { ContentPart } from '@/lib/llm/vision';
import type { ScriptAct } from '@/lib/script/six-act';

/**
 * FilmPlan 提示词(二十七期)。
 *
 * 与旧链 Director/Builder 的关键差异: **模型不写代码、也不写坐标**, 只做三件事——
 * 把一幕拆成几镜、每镜选一张卡、把槽位填上真话。版面与动效由 `remotion/src/cards/`
 * 的固定组件决定(见 spec §2)。
 */

export type ActWindow = {
  act: string;
  title: string;
  startMs: number;
  endMs: number;
  narration: string;
};

/**
 * 幕时间窗。
 *
 * 口径必须与 `synthesizeSrtFromSixActScript` 一致 —— 那个函数就是按 `targetSec`
 * 逐幕累加铺 SRT 的。两边口径一旦分叉, 画面会和字幕/配音错位, 而且**不会有任何报错**。
 */
export function actWindows(acts: ScriptAct[]): ActWindow[] {
  let cursorMs = 0;
  return acts.map((a) => {
    const startMs = cursorMs;
    cursorMs += Math.round(a.targetSec * 1000);
    return { act: a.act, title: a.title, startMs, endMs: cursorMs, narration: a.narration };
  });
}

/**
 * 收口用的宽松 schema。
 *
 * **故意不在这里用 `FilmPlanSchema`** —— `callStructured` 会自己按 schema 重试并在
 * 失败时抛错, 那样我们就拿不到模型的原始产出, 也就没法把**精准的**校验错误喂回去。
 * 修复循环的价值全在错误信息的措辞上(见计划的 Global Constraints), 所以这一层只保证
 * "拿到一个带 shots 数组的对象", 真正的校验交给 `film-plan-builder.ts`。
 */
const LooseFilmPlanSchema = z.object({ shots: z.array(z.any()) });

export const FILM_PLAN = {
  buildSystemPrompt(cardsSection: string, factsSection: string): string {
    const factsBlock = factsSection && factsSection.trim() ? factsSection : '';
    return `你是一个知识类短视频的"画面编排者"。你不写代码、不写坐标、不选颜色——画面由固定的卡片组件渲染，你只负责把内容拆成一镜一镜，为每一镜选一张卡片，并把槽位填上。

${cardsSection}

时间轴规则：
- 下面会给你每一幕的时间窗（起止毫秒）与台词。**把每一幕拆成 1~4 镜**，让画面跟着台词走，不要一幕只给一镜。
- 每一镜的 startMs/endMs 必须落在它所属那一幕的时间窗之内，**幕内首尾相接铺满、不留空档**（留空档观众看到的就是黑屏）。
- 镜与镜之间**不许重叠**。
- 每一镜至少 1200 毫秒——比这更短观众读不完。
${factsBlock}

只输出 JSON，不要 markdown 代码块标记，不要解释文字。顶层字段只有一个：shots（数组）。每一镜的字段是 shotId、startMs、endMs、card、slots。`;
  },

  buildUserMessage(windows: ActWindow[]): ContentPart[] {
    const body = windows
      .map((w) => `【${w.title}】${w.startMs} ~ ${w.endMs} 毫秒\n${w.narration}`)
      .join('\n\n');
    return [{ type: 'text', text: `逐幕台词与时间窗：\n\n${body}\n\n请给出完整的分镜填槽方案。` }];
  },

  responseSchema: LooseFilmPlanSchema,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/film-plan-prompt.test.ts`
Expected: PASS（6 条）

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/film-plan-prompt.ts tests/lib/video-production/film-plan-prompt.test.ts
git commit -m "feat(video): FilmPlan 提示词与幕时间窗"
```

---

### Task 2: 时间轴校验（schema 拦不住的那一半）

**Files:**
- Create: `src/lib/video-production/film-plan-timing.ts`
- Test: `tests/lib/video-production/film-plan-timing.test.ts`

**Interfaces:**
- Consumes: `FilmPlan`（`shot-plan.ts` 的 `z.infer` 类型）
- Produces: `export function checkFilmPlanTiming(plan: FilmPlan, totalMs: number): string[]` —— 返回**给模型看的**问题描述数组，空数组表示通过

`FilmPlanSchema` 已经拦掉了"重叠"与"endMs <= startMs"。它拦不住的是：**空档**（两镜之间有缝 → 黑屏）、**超出片长**（画面比内容长 → 尾巴上是没有台词的画面，旧链真出过这种事故，见 `clampShotsToSource` 的注释）、**开头不从 0 起**。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { checkFilmPlanTiming } from '@/lib/video-production/film-plan-timing';
import type { FilmPlan } from '@/lib/video-production/shot-plan';

const shot = (id: string, startMs: number, endMs: number) => ({
  shotId: id, startMs, endMs, card: 'statement' as const, slots: { text: '一句话' },
});
const plan = (...shots: ReturnType<typeof shot>[]) => ({ shots }) as unknown as FilmPlan;

describe('checkFilmPlanTiming', () => {
  it('首尾相接铺满时没有问题', () => {
    expect(checkFilmPlanTiming(plan(shot('a', 0, 5000), shot('b', 5000, 10000)), 10000)).toEqual([]);
  });

  it('中间留空档时报出空档的位置与长度', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 4000), shot('b', 5000, 10000)), 10000);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('4000');
    expect(issues[0]).toContain('5000');
  });

  it('不从 0 开始时报出来', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 800, 10000)), 10000);
    expect(issues.some((i) => i.includes('0'))).toBe(true);
  });

  it('超出片长时报出来 —— 尾巴上会是没有台词的画面', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 12000)), 10000);
    expect(issues.some((i) => i.includes('12000') && i.includes('10000'))).toBe(true);
  });

  it('结尾差得少于 1 帧(33ms)不算问题 —— 取整误差不该逼模型重来', () => {
    expect(checkFilmPlanTiming(plan(shot('a', 0, 9980)), 10000)).toEqual([]);
  });

  it('问题描述里不夹带卡片类型的名字 —— 那会把模型引去改卡片而不是改时间', () => {
    const issues = checkFilmPlanTiming(plan(shot('a', 0, 4000), shot('b', 5000, 10000)), 10000);
    expect(issues.join('')).not.toContain('statement');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/film-plan-timing.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现**

```ts
import type { FilmPlan } from '@/lib/video-production/shot-plan';

/**
 * 取整容差: 30fps 下一帧约 33 毫秒。
 * 比一帧还小的缝隙在成片里根本不存在, 拿它去逼模型重跑一轮纯属浪费。
 */
const TOLERANCE_MS = 33;

/**
 * `FilmPlanSchema` 拦不住的时间轴问题(二十七期)。
 *
 * schema 已经拦掉"重叠"与"endMs <= startMs"。剩下三类它管不着, 但每一类都会直接
 * 毁掉成片:
 * - **空档**: 两镜之间有缝, 观众看到的就是黑屏。
 * - **超出片长**: 旧链真出过 —— 素材 155 秒、分镜排到 234 秒, 尾巴上 79 秒既没人声
 *   也没台词(见 `director-prompt.ts` 的 `clampShotsToSource` 注释)。
 * - **不从 0 起**: 片头一段黑屏。
 *
 * 返回的字符串会被**原样喂回给模型**, 所以措辞是契约的一部分: 每条只讲一个问题、
 * 只讲时间、给出具体数字, 不提卡片类型(提了模型会跑去改卡片而不是改时间)。
 */
export function checkFilmPlanTiming(plan: FilmPlan, totalMs: number): string[] {
  const shots = [...plan.shots].sort((a, b) => a.startMs - b.startMs);
  if (shots.length === 0) return ['分镜是空的, 至少要有一镜。'];

  const issues: string[] = [];

  if (shots[0].startMs > TOLERANCE_MS) {
    issues.push(`第一镜从 ${shots[0].startMs} 毫秒才开始, 片头会有一段黑屏。第一镜必须从 0 开始。`);
  }

  for (let i = 1; i < shots.length; i += 1) {
    const gap = shots[i].startMs - shots[i - 1].endMs;
    if (gap > TOLERANCE_MS) {
      issues.push(
        `${shots[i - 1].endMs} 毫秒到 ${shots[i].startMs} 毫秒之间有 ${gap} 毫秒没有任何画面(黑屏)。` +
          `把前一镜的 endMs 延到 ${shots[i].startMs}, 或者把后一镜的 startMs 提到 ${shots[i - 1].endMs}。`,
      );
    }
  }

  const lastMs = shots[shots.length - 1].endMs;
  if (lastMs > totalMs + TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒, 但内容只有 ${totalMs} 毫秒。超出的部分是没有台词的画面, 把最后一镜的 endMs 改成 ${totalMs}。`,
    );
  }
  if (lastMs < totalMs - TOLERANCE_MS) {
    issues.push(
      `最后一镜到 ${lastMs} 毫秒就结束了, 但内容有 ${totalMs} 毫秒, 结尾会有一段黑屏。把最后一镜的 endMs 改成 ${totalMs}。`,
    );
  }

  return issues;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/film-plan-timing.test.ts`
Expected: PASS（6 条）

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/film-plan-timing.ts tests/lib/video-production/film-plan-timing.test.ts
git commit -m "feat(video): FilmPlan 时间轴校验 —— 空档/超长/不从零起"
```

---

### Task 3: 修复循环（本计划的核心）

**Files:**
- Create: `src/lib/video-production/film-plan-builder.ts`
- Test: `tests/lib/video-production/film-plan-builder.test.ts`

**Interfaces:**
- Consumes: `FILM_PLAN` / `ActWindow`（Task 1）、`checkFilmPlanTiming`（Task 2）、`FilmPlanSchema` / `FilmPlan`（`shot-plan.ts`）、`CallStructuredOpts`（`@/lib/llm/vision`）
- Produces:
  - `export const MAX_REPAIR_ROUNDS = 2`
  - `export function formatIssuesForModel(issues: string[]): string`
  - `export type FilmPlanLLM = { callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: unknown }> }`
  - `export async function buildFilmPlan(opts: { llm: FilmPlanLLM; windows: ActWindow[]; cardsSection: string; factsSection: string; totalMs: number }): Promise<{ plan: FilmPlan; rounds: number }>`

实测依据（三轮探针）：一次通过率从 0/3 → 2/3 → 3/3，需要修复时**都在第一轮内收敛**，没有一次用到第 3 次尝试。所以 `MAX_REPAIR_ROUNDS = 2` 是有余量的。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { buildFilmPlan, formatIssuesForModel, MAX_REPAIR_ROUNDS } from '@/lib/video-production/film-plan-builder';
import type { ActWindow } from '@/lib/video-production/film-plan-prompt';

const windows: ActWindow[] = [
  { act: 'hook', title: '钩子', startMs: 0, endMs: 10000, narration: '刷到过三天赚五千吗' },
];

const good = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'statement', slots: { text: '三天赚五千?' } }] };
// value 是字符串 —— 正是探针里模型真实犯过的那个错
const badValue = { shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'stat', slots: { label: '成交额', value: '900' } }] };
const gap = { shots: [
  { shotId: 's1', startMs: 0, endMs: 4000, card: 'statement', slots: { text: '一' } },
  { shotId: 's2', startMs: 6000, endMs: 10000, card: 'statement', slots: { text: '二' } },
] };

/** 按顺序吐出预设答案的假 LLM, 并记下每次收到的 user message。 */
const fakeLLM = (responses: unknown[]) => {
  const seen: string[] = [];
  return {
    seen,
    calls: () => responses.length - remaining.length,
    callStructured: async (opts: any) => {
      seen.push(opts.userMessage.map((p: any) => p.text ?? '').join('\n'));
      const next = remaining.shift();
      if (next === undefined) throw new Error('假 LLM 被多调了一次');
      return { result: next, usage: {} };
    },
  };
  function noop() {}
};

describe('formatIssuesForModel', () => {
  it('逐条列出, 不夹带别的卡片类型的噪音', () => {
    const text = formatIssuesForModel(['A 有问题', 'B 有问题']);
    expect(text).toContain('A 有问题');
    expect(text).toContain('B 有问题');
    expect(text).not.toContain('invalid_union');
  });
});

describe('buildFilmPlan', () => {
  it('一次就对时不重试', async () => {
    const llm = fakeLLM([good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(0);
    expect(r.plan.shots).toHaveLength(1);
    expect(llm.seen).toHaveLength(1);
  });

  it('schema 错误被喂回后收敛, 且喂回的是精准的那一条', async () => {
    const llm = fakeLLM([badValue, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('slots.value');
    // 关键: 不许把"这镜该用 statement"这类会让模型弃卡的噪音喂回去
    expect(llm.seen[1]).not.toContain('Unrecognized key');
    expect(llm.seen[1]).not.toContain('expected "statement"');
  });

  it('时间轴空档也会被喂回', async () => {
    const llm = fakeLLM([gap, good]);
    const r = await buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 });
    expect(r.rounds).toBe(1);
    expect(llm.seen[1]).toContain('4000');
    expect(llm.seen[1]).toContain('6000');
  });

  it('修满 MAX_REPAIR_ROUNDS 仍不对就抛错, 错误里带最后一轮的问题', async () => {
    const llm = fakeLLM([badValue, badValue, badValue]);
    await expect(
      buildFilmPlan({ llm: llm as any, windows, cardsSection: '卡片说明', factsSection: '', totalMs: 10000 }),
    ).rejects.toThrow(/slots\.value/);
    expect(llm.seen).toHaveLength(MAX_REPAIR_ROUNDS + 1);
  });
});
```

> 注意：上面 `fakeLLM` 里引用了未定义的 `remaining`，这是**故意留给实现者修的**——请把它改成 `const remaining = [...responses];` 放在函数体开头，并删掉多余的 `calls()` 与 `noop()`。写测试替身时保持它最小。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/film-plan-builder.test.ts`
Expected: FAIL —— 模块不存在（以及测试替身自身的 `remaining is not defined`，按上面的注意事项修好）

- [ ] **Step 3: 实现**

```ts
import type { CallStructuredOpts } from '@/lib/llm/vision';
import { FILM_PLAN, type ActWindow } from '@/lib/video-production/film-plan-prompt';
import { checkFilmPlanTiming } from '@/lib/video-production/film-plan-timing';
import { FilmPlanSchema, type FilmPlan } from '@/lib/video-production/shot-plan';

/**
 * 最多修几轮。
 *
 * 实测(三轮探针, 三条真实六幕稿): 一次通过率 0/3 → 2/3 → 3/3, 需要修的那几次
 * **都在第一轮内收敛**, 一次都没用到第 3 次尝试。2 轮是有余量的数字, 不是猜的。
 */
export const MAX_REPAIR_ROUNDS = 2;

export type FilmPlanLLM = {
  callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: unknown }>;
};

/**
 * 把问题列表拼成给模型的修复指令。
 *
 * **这段文字是契约的一部分, 不是日志。** 实测教训: `z.union` 报的 `invalid_union`
 * 把四个卡片分支的失败并排输出, 模型读到排第一的 statement 分支
 * 「Unrecognized key(s): 'label','value','suffix'」之后, 三条稿子无一例外地**放弃
 * 整张 `stat` 卡**(存活率 0/3), 而不是去修那个字段。错误信息不是在教它改类型,
 * 是在教它别用这张卡。所以这里只讲"哪一条路径上是什么问题、该怎么改",
 * 绝不把其它分支的噪音带进来。
 */
export function formatIssuesForModel(issues: string[]): string {
  return [
    '你上一版的方案有下面这些问题，请**只修这些问题**，其余部分原样保留：',
    ...issues.map((i, n) => `${n + 1}. ${i}`),
    '',
    '重新输出完整的 JSON（同样只有 shots 一个顶层字段），不要解释文字。',
  ].join('\n');
}

/** zod 的 issue → 一句人话。`discriminatedUnion` 保证了这里拿到的是单一分支的问题。 */
function describeZodIssues(plan: unknown): string[] {
  const r = FilmPlanSchema.safeParse(plan);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const path = i.path.join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
}

/**
 * 产出 FilmPlan, 带修复循环。
 *
 * 为什么不用 `callStructured` 的 `responseSchema` 直接上 `FilmPlanSchema`:
 * 那样失败时是它自己按原样重试并最终抛错, 我们**拿不到模型的原始产出, 也就没有机会
 * 把精准的错误喂回去**。修复循环的全部价值在错误措辞上, 所以校验必须由我们自己做。
 */
export async function buildFilmPlan(opts: {
  llm: FilmPlanLLM;
  windows: ActWindow[];
  cardsSection: string;
  factsSection: string;
  totalMs: number;
}): Promise<{ plan: FilmPlan; rounds: number }> {
  const systemPrompt = FILM_PLAN.buildSystemPrompt(opts.cardsSection, opts.factsSection);
  let userMessage = FILM_PLAN.buildUserMessage(opts.windows);
  let lastIssues: string[] = [];

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round += 1) {
    const { result } = await opts.llm.callStructured({
      systemPrompt,
      userMessage,
      responseSchema: FILM_PLAN.responseSchema,
    });

    const parsed = FilmPlanSchema.safeParse(result);
    const issues = parsed.success
      ? checkFilmPlanTiming(parsed.data, opts.totalMs)
      : describeZodIssues(result);

    if (issues.length === 0 && parsed.success) {
      return { plan: parsed.data, rounds: round };
    }

    lastIssues = issues;
    userMessage = [{ type: 'text', text: formatIssuesForModel(issues) }];
  }

  throw new Error(`FilmPlan 修了 ${MAX_REPAIR_ROUNDS} 轮仍不合格:\n${lastIssues.join('\n')}`);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/film-plan-builder.test.ts`
Expected: PASS（5 条）

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/film-plan-builder.ts tests/lib/video-production/film-plan-builder.test.ts
git commit -m "feat(video): FilmPlan 修复循环 —— 喂回精准错误而不是 union 噪音"
```

---

### Task 4: 接进 worker

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`（`handlePptNarrationRemotion`，约 556-584 行）
- Test: `tests/jobs/video-production-film-plan-wiring.test.ts`

**Interfaces:**
- Consumes: `buildFilmPlan`（Task 3）、`actWindows`（Task 1）、`describeCardsForPrompt`（`shot-plan.ts`）、`buildFactsSection`（`facts-guard.ts`）、既有的 `loadActs` / `loadResearch` / `resolveDeepSeekApiKey` / `templateOf` / `reportFreeze` / `renderFilm`
- Produces: 无对外接口；行为变化是 `vp.filmPlan` 由系统产出并落库

**行为约定：**
- `mode === 'preview'`：产 plan → `prisma.videoProduction.update({ data: { filmPlan: plan } })` → 渲染。
- `mode === 'master'`：**复用落库的 plan**，不重新调 LLM——与旧链 `direction.json` 的既有先例一致（避免正式导出和预览不是同一份画面）。落库的 plan 为空时抛错，不静默回退到重新生成。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/jobs/workers/video-production-worker.ts'),
  'utf-8',
);
const BRANCH = SRC.slice(
  SRC.indexOf('async function handlePptNarrationRemotion'),
  SRC.indexOf('export async function reportFreeze'),
);

describe('handlePptNarrationRemotion 接上 FilmPlan 生成', () => {
  it('preview 走 buildFilmPlan, 不再直接读手填的 vp.filmPlan', () => {
    expect(BRANCH).toContain('buildFilmPlan');
  });

  it('buildFactsSection 必须显式传 cards —— 默认的 freeform 会让 list 凑数', () => {
    expect(BRANCH).toMatch(/buildFactsSection\([^)]*'cards'\)/s);
  });

  it('产出的 plan 落库到 filmPlan, 供 master 复用', () => {
    expect(BRANCH).toContain('filmPlan');
    expect(BRANCH).toContain('videoProduction.update');
  });

  it('master 不重新调 LLM —— 与旧链 direction.json 的先例一致', () => {
    expect(BRANCH).toMatch(/mode === 'preview'/);
  });

  it('静止体检仍然接着 —— 这个项目栽过两次"新出片路径绕过体检"', () => {
    expect(BRANCH).toContain('reportFreeze');
  });
});

describe('先建后拆: 旧渲染层一个文件都没删', () => {
  for (const f of [
    'src/lib/video-production/shot-renderer.ts',
    'src/lib/video-production/ambient-rig.ts',
    'src/lib/video-production/shot-chrome.ts',
    'src/lib/video-production/frame-overlap.ts',
  ]) {
    it(`${f} 还在`, () => {
      expect(fs.existsSync(path.join(process.cwd(), f))).toBe(true);
    });
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/jobs/video-production-film-plan-wiring.test.ts`
Expected: FAIL —— 前 4 条失败（分支里还没有 `buildFilmPlan`）；最后一组"旧文件还在"应当已经通过

- [ ] **Step 3: 实现**

把 `handlePptNarrationRemotion` 的开头改成下面这样（`await setStatus('building');` 之后、`const lastMs = ...` 之前）：

```ts
  await setStatus('building');

  const template = await templateOf(vp.templateId);

  let plan: FilmPlan;
  if (mode === 'preview') {
    await setStatus('directing');
    const deepseekKey = await resolveDeepSeekApiKey(vp.userId);
    if (!deepseekKey) throw new Error('未配置 DeepSeek key');

    const acts = await loadActs(vp.contentId);
    if (acts.length === 0) throw new Error('取不到六幕稿, 无法编排画面');

    const windows = actWindows(acts);
    const totalMs = windows[windows.length - 1].endMs;

    // `'cards'` 不能省: 默认的 `'freeform'` 会下发旧链的"条目数不少于 8 条",
    // 与 `list` 卡 items 上限 8 自相矛盾, 实测会把模型逼去编条目凑数(见 spec §6½)。
    const factsSection = buildFactsSection(acts, await loadResearch(vp.contentId), 'cards');

    await setStatus('building');
    const llm = new DeepSeekTextLLM({ apiKey: deepseekKey, defaultModel: 'deepseek-chat' });
    const built = await buildFilmPlan({
      llm,
      windows,
      cardsSection: describeCardsForPrompt(),
      factsSection,
      totalMs,
    });
    plan = built.plan;
    console.log(`[video-production] FilmPlan 产出完成 (修复 ${built.rounds} 轮, ${plan.shots.length} 镜)`);

    // 落库供 master 复用 —— 与旧链把 Director 结果写进 direction.json 是同一个理由:
    // 正式导出必须和用户看过的预览是同一份画面, 不能重新问一次模型。
    await prisma.videoProduction.update({ where: { id: vp.id }, data: { filmPlan: plan } });
  } else {
    if (!vp.filmPlan) throw new Error('没有已保存的 FilmPlan, 请先生成预览');
    plan = FilmPlanSchema.parse(vp.filmPlan);
  }

  const lastMs = Math.max(...plan.shots.map((s) => s.endMs));
```

并把文件顶部的 import 补上（跟随既有 import 分组）：

```ts
import { actWindows } from '@/lib/video-production/film-plan-prompt';
import { buildFilmPlan } from '@/lib/video-production/film-plan-builder';
import { FilmPlanSchema, describeCardsForPrompt, type FilmPlan } from '@/lib/video-production/shot-plan';
```

原来那两行 `const template = await templateOf(vp.templateId);` 与 `const plan = FilmPlanSchema.parse(vp.filmPlan);` 要删掉（`template` 已提到上面，`plan` 由分支赋值）。**其余部分（`fps` / `aspect` / `renderFilm` / `reportFreeze` / `setStatus`）一行不动。**

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/jobs/video-production-film-plan-wiring.test.ts && npm run typecheck:all`
Expected: 全部 PASS，两侧 tsc 无输出

- [ ] **Step 5: 提交**

```bash
git add src/jobs/workers/video-production-worker.ts tests/jobs/video-production-film-plan-wiring.test.ts
git commit -m "feat(video): FilmPlan 接进 worker —— 画面不再靠手填"
```

---

### Task 5: 端到端真机验证 + 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（§6½）
- Modify: `README.md`（二十五期小节）
- Test: 无新增单测；本任务的产出是**一条真的片子**

- [ ] **Step 1: 重启 worker**

`worker:dev` 没有 watch，不重启跑的是旧代码（本项目已因此白跑过一轮验证）。

```bash
# 停掉现有 worker 进程后重新起
npm run worker:dev
```

- [ ] **Step 2: 挑一条真实内容跑预览**

从库里选一条有六幕稿的 `ppt-narration` 内容，把它的 `VideoProduction` 的 `renderer` 置成 `'remotion'`，触发预览生成。记录：

- FilmPlan 修复了几轮（worker 日志里 `FilmPlan 产出完成 (修复 N 轮, M 镜)` 那行）
- 卡片分布（四种各几镜）
- 静止体检那行日志
- 成片时长 / 画幅 / 渲染耗时

- [ ] **Step 3: 人工核对画面**

抽 3~5 帧，逐条确认：

- `stat` 卡的数字在六幕稿的 facts 台账里找得到出处（编造数字是这个项目反复吃过亏的地方）
- `list` 的条目有出处、没有为凑数编的
- `contrast` 的 connector 选得对（互斥两项是 `versus`，同一事物前后变化才是 `arrow`）
- 文字没有被裁、没有越出安全区

**任何一条不过就是 BLOCKED**，停下来报告，不要绕过。

- [ ] **Step 4: 更新文档**

- spec §6½「接线时必须做的一件事」：接线已完成，改成记录**已经这样接了**、并指向 Task 4 里那条断言 `'cards'` 的测试。
- README 二十五期小节：把「`filmPlan` 全程手填（未改 Builder 提示词），验证的是渲染通路本身，不是模型能不能填对槽」这句改成实际状态，并写上本次端到端的实测数字。

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-08-31-remotion-migration-design.md README.md
git commit -m "docs(video): Builder 产 FilmPlan 已接线, 记录端到端实测"
```

---

## Self-Review

**1. Spec 覆盖** —— spec §2「Builder 不再写代码，改为填槽」是本计划的全部：Task 1 提示词 / Task 3 修复循环 / Task 4 接线；§3.3 的 `ppt-narration` 链 → Task 4；§6½ 的 `mode:'cards'` 约定 → Task 4 Step 3 的代码与 Task 4 Step 1 的断言测试（这条从"只能靠文档提醒"升级成"有测试钉住"）；§四 体检层「整片静止保留零改动」→ Task 4 保留 `reportFreeze`。

**未覆盖且是有意的**：另外两条交付链（`illustration-tts` / `talking-head-broll`）、字级对齐进管线、体检层的 `renderStill` 改造、音频与包装段接入、模板配置（`shotPaceSec`/`visualTone`/`builderModel`/`assetIds`）在新链上生效——都在"不做什么"里写明了。

**2. 占位扫描** —— 无 TBD。每个代码步骤都是可直接粘贴的完整代码。Task 3 的测试替身里**故意留了一个 `remaining` 未定义**并在紧随其后的注意事项里点名要怎么修——这是让实现者真的读懂测试替身，不是占位符。

**3. 类型一致** —— `ActWindow` 在 Task 1 定义、Task 3 的 `buildFilmPlan` 参数与 Task 4 的调用逐字一致；`FilmPlan` 来自既有的 `shot-plan.ts`，Task 2 消费、Task 3 产出、Task 4 使用；`checkFilmPlanTiming(plan, totalMs)` 的签名在 Task 2 定义、Task 3 调用一致；`MAX_REPAIR_ROUNDS` 在 Task 3 定义并被同任务的测试引用。

**4. 已知风险** ——
- **`actWindows` 与 `synthesizeSrtFromSixActScript` 的口径必须一致**（都按 `targetSec` 累加）。两边分叉会让画面和字幕错位，**而且不会有任何报错**。Task 1 的注释写明了这条，但**没有测试跨模块钉住它**——这是本计划最薄弱的一处，接下一份计划时应当补一条一致性测试。
- 模板配置在新链上不生效（见"不做什么"）。用户如果在模板编辑器里改 `shotPaceSec` 却看不到变化，是这个原因。
- 本计划仍**不产出音频**，成片是无声的。这与旧 `ppt-narration` 分支的行为一致（BGM 由包装段加，而 Remotion 分支跳过包装段）。
