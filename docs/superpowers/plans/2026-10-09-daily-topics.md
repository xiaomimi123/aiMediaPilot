# 每日选题与初稿 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每晚 23:00 自动从对标爆款 / 自己作品的续集 / 点子池挑 3 个选题，每个用编导写一篇 60 秒口播初稿并做流量预测；总览与选题页展示，「就做这个」才建成作品。

**Architecture:** `src/lib/topics/` 新增四块：`candidates.ts`（挑候选，纯逻辑 + 存取接口）、`generate.ts`（定选题 → 写稿 → 照抄检查 → 预测 → 保存，单篇失败不影响其他）、`daily.ts`（列出 / 采用 / 不要 / 过期 / 点子池）、`deps.ts`（接 Prisma 与当前模型）。预测从 `src/lib/predict/run.ts` 拆出「直接给一篇稿子打分」的 `predictScript`，与作品预测共用 `inputHash` 算法，采用时直接存成作品的稿子预测。定时沿用每晚任务（launchd + `--scheduled` 跳过 + 失败补跑）。

**Tech Stack:** Next.js 14、Prisma 5（Postgres，`db push`）、zod、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-10-09-daily-topics-design.md`

## Global Constraints

- 每天最多 3 个；来源 `benchmark` / `sequel` / `idea`，先各取 1 个，没料的由其余来源顺位补。
- 对标候选：近 14 天、`isHit`、未忽略、未被用过；按 `ratio` 降序。
- 续集候选：已关联发布作品的项目；片尾一段含 `下期|下一期|单独讲|单独来讲|下次|后面再说|留着`，或播放 ≥ 近 10 条公开作品播放中位数 × 2；有钩子的优先，其次按播放降序。
- 点子候选：`TopicIdea.status = 'fresh'`，按 `createdAt` 升序。
- 不重复：`DailyTopic @@unique([source, sourceId])`，出过的（任何状态）不再进候选。
- 写稿：`writeScript`，`targetSec = 60`，账号定位（`PersonaProfile id='me'`）+ 已采纳写法经验；对标来源传 `reference` 并跑 `findCopiedInScript`。
- 预测失败 → `prediction = null`，选题照出；单个候选失败 → 跳过（不写 DailyTopic，下次还能出），记原因。
- 同一天已有 `created ≥ 1` 的生成记录 → `--scheduled` 补跑跳过。
- 默认 23:00，补跑 +60、+120 分钟；手动每天最多 3 次。
- 3 天前生成且仍为 `new` 的 → `expired`。
- 页面文字一律中文。

## Review Focus

1. **同一候选被两次运行同时写入**（手动「立即运行」与定时重叠）→ 唯一约束冲突不应让整次运行失败，冲突的那个算跳过。→ Task 3 测试 `skips a candidate that another run already saved`。
2. **用户在页面上连点两次「就做这个」** → 只建一个作品。→ Task 5 测试 `adopting twice creates one project`。
3. **续集来源的项目没有定稿也没有转写** → 不进候选、不报错。→ Task 1 测试 `ignores sequel projects with no script or transcript`。
4. **模型返回的选题方向为空或格式不对** → 这个候选跳过并记原因，不写出空稿。→ Task 3 测试 `skips a candidate when the topic plan is malformed`。
5. **采用后的作品预测与选题里看到的不一致**（目标时长或分段不同导致 hash 不同而重打）→ 采用时存同一 hash 的预测，作品页显示的就是选题卡上的数。→ Task 2 测试 `predictScript hashes the same as a project prediction of that script`。

---

## 文件结构

```
prisma/schema.prisma                   + TopicIdea / DailyTopic / DailyTopicRun
src/lib/topics/candidates.ts           候选来源与挑选
src/lib/topics/generate.ts             每晚生成编排
src/lib/topics/daily.ts                列出 / 采用 / 不要 / 过期 / 点子池
src/lib/topics/deps.ts                 接 Prisma 与当前模型
src/lib/predict/run.ts                 拆出 scriptSegments / segmentsHash / loadPredictContext / predictScript
src/lib/tasks/nightly.ts               + topics 任务
src/lib/douyin/collect-log.ts          + TOPICS_SPEC / readTopicsStatus
scripts/daily-topics.ts                每晚脚本
scripts/com.mediapilot.daily-topics.plist
src/app/api/topics/daily/route.ts      GET 今日选题 + 最近一次生成记录
src/app/api/topics/daily/[id]/route.ts POST { action: 'adopt' | 'dismiss' }
src/app/api/topics/ideas/route.ts      GET / POST 点子
src/app/api/topics/ideas/[id]/route.ts DELETE 点子
src/app/api/settings/tasks/route.ts    + topics 状态
src/lib/overview/load.ts               + daily(今日选题卡片与原因) + topics 任务状态
src/components/topics/daily-topics.tsx 今日选题卡片(选题页)
src/components/topics/idea-pool.tsx    点子池
src/components/topics/topics-view.tsx  顶部挂上两块
src/components/overview/today-panel.tsx  + 今日选题
```

---

### Task 1: 数据表与候选挑选

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/topics/candidates.ts`
- Test: `tests/lib/topics/candidates.test.ts`

**Interfaces:**
- Produces:
  - `type TopicSource = 'benchmark' | 'sequel' | 'idea'`
  - `interface Candidate { source: TopicSource; sourceId: string; material: string; reference?: string; benchmarkVideoId?: string }`
  - `interface CandidateStore { usedKeys(): Promise<Set<string>>; benchmarkHits(since: Date): Promise<{ id: string; ratio: number | null; author: string; topic: string | null; desc: string; transcript: string | null }[]>; ownWorks(): Promise<{ projectId: string; title: string; lastText: string | null; play: number }[]>; freshIdeas(): Promise<{ id: string; text: string; createdAt: Date }[]> }`
  - `SEQUEL_HOOK: RegExp`
  - `loadPools(store: CandidateStore, now: Date): Promise<Record<TopicSource, Candidate[]>>`
  - `pickCandidates(pools: Record<TopicSource, Candidate[]>, max?: number): Candidate[]`
  - `localDay(d: Date): string`（复用 `src/lib/retro/metrics-store.ts` 的同名函数，重新导出）

- [ ] **Step 1: schema**

按 spec §5 追加 `TopicIdea`、`DailyTopic`、`DailyTopicRun` 三个 model（字段、注释、索引、`@@unique([source, sourceId])` 逐字照抄）。

Run: `npx prisma db push && npm run typecheck` → in sync。（改了 schema：真机前 `launchctl kickstart -k gui/$(id -u)/com.mediapilot.dev`。）

- [ ] **Step 2: 写失败测试 `tests/lib/topics/candidates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadPools, pickCandidates, SEQUEL_HOOK, type Candidate, type CandidateStore } from '@/lib/topics/candidates';

const now = new Date('2026-10-09T15:00:00Z');
const c = (source: Candidate['source'], id: string): Candidate => ({ source, sourceId: id, material: id });

function store(over: Partial<CandidateStore> = {}): CandidateStore {
  return {
    usedKeys: async () => new Set<string>(),
    benchmarkHits: async () => [],
    ownWorks: async () => [],
    freshIdeas: async () => [],
    ...over,
  };
}

describe('pickCandidates', () => {
  it('takes one from each source first', () => {
    expect(pickCandidates({ benchmark: [c('benchmark', 'b1'), c('benchmark', 'b2')], sequel: [c('sequel', 's1')], idea: [c('idea', 'i1')] }).map((x) => x.sourceId)).toEqual(['b1', 's1', 'i1']);
  });
  it('fills from the other sources when one is empty', () => {
    expect(pickCandidates({ benchmark: [c('benchmark', 'b1'), c('benchmark', 'b2')], sequel: [], idea: [c('idea', 'i1'), c('idea', 'i2')] }).map((x) => x.sourceId)).toEqual(['b1', 'i1', 'b2']);
  });
  it('returns fewer than 3 or none when material runs out', () => {
    expect(pickCandidates({ benchmark: [], sequel: [c('sequel', 's1')], idea: [] })).toHaveLength(1);
    expect(pickCandidates({ benchmark: [], sequel: [], idea: [] })).toEqual([]);
  });
});

describe('loadPools', () => {
  it('ranks benchmark hits by ratio and drops used ones', async () => {
    const p = await loadPools(
      store({
        usedKeys: async () => new Set(['benchmark:b2']),
        benchmarkHits: async () => [
          { id: 'b1', ratio: 3, author: 'A', topic: 'AI 回消息', desc: 'x', transcript: '原文1' },
          { id: 'b2', ratio: 9, author: 'B', topic: '已用', desc: 'y', transcript: null },
          { id: 'b3', ratio: 5, author: 'C', topic: null, desc: '文案三', transcript: null },
        ],
      }),
      now,
    );
    expect(p.benchmark.map((x) => x.sourceId)).toEqual(['b3', 'b1']);
    expect(p.benchmark[1]).toMatchObject({ benchmarkVideoId: 'b1', reference: '原文1' });
  });
  it('picks sequels with a next-episode hook first, then strong performers', async () => {
    const p = await loadPools(
      store({
        ownWorks: async () => [
          { projectId: 'p1', title: '普通', lastText: '谢谢大家', play: 100 },
          { projectId: 'p2', title: '爆了', lastText: '谢谢', play: 900 },
          { projectId: 'p3', title: 'U盘', lastText: '值得单独来讲一期 账本我都给大家留着', play: 200 },
          { projectId: 'p4', title: '一般', lastText: '好', play: 150 },
        ],
      }),
      now,
    );
    expect(p.sequel.map((x) => x.sourceId)).toEqual(['p3', 'p2']);
  });
  it('ignores sequel projects with no script or transcript', async () => {
    const p = await loadPools(store({ ownWorks: async () => [{ projectId: 'p9', title: '空', lastText: null, play: 99999 }] }), now);
    expect(p.sequel).toEqual([]);
  });
  it('uses fresh ideas oldest first', async () => {
    const p = await loadPools(
      store({ freshIdeas: async () => [{ id: 'i2', text: '后写', createdAt: new Date('2026-10-08') }, { id: 'i1', text: '先写', createdAt: new Date('2026-10-01') }] }),
      now,
    );
    expect(p.idea.map((x) => x.material)).toEqual(['先写', '后写']);
  });
  it('recognises the hook words', () => {
    for (const t of ['下期讲', '下一期', '单独讲', '值得单独来讲一期', '下次说', '后面再说', '账本留着']) expect(SEQUEL_HOOK.test(t)).toBe(true);
    expect(SEQUEL_HOOK.test('谢谢大家')).toBe(false);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/topics/candidates.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/topics/candidates.ts`**

```ts
import { median } from '@/lib/benchmark/rules';
export { localDay } from '@/lib/retro/metrics-store';

export type TopicSource = 'benchmark' | 'sequel' | 'idea';
export const SOURCES: TopicSource[] = ['benchmark', 'sequel', 'idea'];

export interface Candidate {
  source: TopicSource;
  sourceId: string;
  /** 给定选题用的材料: 对标的选题/文案、续集的标题与片尾、点子原话 */
  material: string;
  /** 对标原文(写稿时作参考、做照抄检查) */
  reference?: string;
  benchmarkVideoId?: string;
}

export interface CandidateStore {
  /** 出过选题的 `${source}:${sourceId}` */
  usedKeys(): Promise<Set<string>>;
  benchmarkHits(since: Date): Promise<{ id: string; ratio: number | null; author: string; topic: string | null; desc: string; transcript: string | null }[]>;
  /** 已关联发布作品的项目: 片尾一段(定稿或转写的最后一段) + 播放 */
  ownWorks(): Promise<{ projectId: string; title: string; lastText: string | null; play: number }[]>;
  freshIdeas(): Promise<{ id: string; text: string; createdAt: Date }[]>;
}

export const BENCHMARK_DAYS = 14;
export const SEQUEL_HOOK = /下期|下一期|单独(来)?讲|下次|后面再说|留着/;

export async function loadPools(store: CandidateStore, now: Date): Promise<Record<TopicSource, Candidate[]>> {
  const used = await store.usedKeys();
  const fresh = (source: TopicSource, id: string) => !used.has(`${source}:${id}`);

  const hits = (await store.benchmarkHits(new Date(now.getTime() - BENCHMARK_DAYS * 86400_000)))
    .filter((h) => fresh('benchmark', h.id))
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  const benchmark = hits.map((h) => ({
    source: 'benchmark' as const,
    sourceId: h.id,
    material: `对标作品（${h.author}，平时的 ${h.ratio ?? '?'} 倍）：${h.topic ?? h.desc.replace(/#\S+/g, '').trim().slice(0, 80)}`,
    reference: h.transcript ?? undefined,
    benchmarkVideoId: h.id,
  }));

  const works = (await store.ownWorks()).filter((w) => w.lastText && fresh('sequel', w.projectId));
  const mid = median(works.map((w) => w.play));
  const sequel = works
    .map((w) => ({ w, hook: SEQUEL_HOOK.test(w.lastText!), strong: mid > 0 && w.play >= mid * 2 }))
    .filter((x) => x.hook || x.strong)
    .sort((a, b) => Number(b.hook) - Number(a.hook) || b.w.play - a.w.play)
    .map(({ w }) => ({ source: 'sequel' as const, sourceId: w.projectId, material: `自己的作品《${w.title}》（播放 ${w.play}）的续集。原片结尾：${w.lastText}` }));

  const idea = (await store.freshIdeas())
    .filter((i) => fresh('idea', i.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((i) => ({ source: 'idea' as const, sourceId: i.id, material: i.text }));

  return { benchmark, sequel, idea };
}

/** 先各来源取 1 个, 再按来源顺序轮流补, 最多 max 个 */
export function pickCandidates(pools: Record<TopicSource, Candidate[]>, max = 3): Candidate[] {
  const queues = SOURCES.map((s) => [...pools[s]]);
  const out: Candidate[] = [];
  while (out.length < max && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= max) break;
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
```

（续集的「近 10 条」中位数由 `ownWorks` 只返回最近 10 条公开作品对应的项目来保证——见 Task 3 的 `createCandidateStore`。）

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run tests/lib/topics && npm run typecheck`
Expected: 全绿。

```bash
git add prisma/schema.prisma src/lib/topics tests/lib/topics
git commit -m "feat(topics): 每日选题数据表 + 三个来源的候选与挑选

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 预测拆出「给一篇稿子打分」

**Files:**
- Modify: `src/lib/predict/run.ts`
- Test: `tests/lib/predict/predict-script.test.ts`

**Interfaces:**
- Produces（`src/lib/predict/run.ts`）：
  - `scriptSegments(script: Script, targetSec: number): NonNullable<ScoreInput['segments']>`
  - `segmentsHash(x: unknown): string`（sha256 前 12 位，与现在作品预测一致）
  - `type PredictContext = Omit<PredictInput, 'published' | 'segments' | 'transcript'>`
  - `loadPredictContext(db: PrismaClient, benchmarkVideoId: string | null): Promise<PredictContext>`
  - `interface ScriptPrediction { scores: DimScore[]; inputHash: string; formulaVersion: number; result: PredictionResult }`
  - `predictScript(llm: StructuredLLM, modelLabel: string, ctx: PredictContext, segments: NonNullable<ScoreInput['segments']>): Promise<ScriptPrediction>`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { predictScript, runPrediction, scriptSegments, segmentsHash, type PredictContext, type PredictDeps } from '@/lib/predict/run';
import { DIMS } from '@/lib/predict/formula';
import type { Script } from '@/lib/script/model';
import type { StructuredLLM } from '@/lib/script/write';

const script: Script = {
  segments: [
    { id: 's1', role: 'hook', text: '一个U盘干到品类第一' },
    { id: 's2', role: 'context', text: '去年我盯了一个赛道' },
  ],
} as unknown as Script;
const llm: StructuredLLM = { callStructured: async () => ({ result: { scores: DIMS.map((dim) => ({ dim, score: 3, reason: 'x' })) }, usage: {} }) } as unknown as StructuredLLM;
const ctx: PredictContext = { persona: '', benchmark: '', benchmarkHit: false, baselines: {}, baselineViews: 3000, calibratedCount: 0, publicWorks: 5, formula: { version: 1, params: (await import('@/lib/predict/formula')).DEFAULT_PARAMS } } as unknown as PredictContext;

describe('predictScript', () => {
  it('scores a script without a project', async () => {
    const r = await predictScript(llm, '模型', ctx, scriptSegments(script, 60));
    expect(r.scores).toHaveLength(DIMS.length);
    expect(r.result.center).not.toBeNull();
    expect(r.formulaVersion).toBe(1);
  });
  it('predictScript hashes the same as a project prediction of that script', async () => {
    const segments = scriptSegments(script, 60);
    const saved: string[] = [];
    const deps: PredictDeps = {
      llm,
      modelLabel: '模型',
      load: async () => ({ ...ctx, published: false, segments, transcript: null }),
      save: async (row) => (saved.push(row.inputHash), { id: 'x' }),
      trimDrafts: async () => {},
    };
    await runPrediction(deps, 'p1', 'draft');
    expect(saved[0]).toBe((await predictScript(llm, '模型', ctx, segments)).inputHash);
    expect(saved[0]).toBe(segmentsHash(segments));
  });
});
```

（`DEFAULT_PARAMS` 若在 `formula.ts` 里叫别的名字，用它实际导出的默认参数常量；没有导出就在测试里用 `ensureActiveFormula` 的种子参数——执行时按实际名字改，并记 Ruling。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/predict/predict-script.test.ts`
Expected: FAIL（导出不存在）。

- [ ] **Step 3: 实现（只搬代码，行为不变）**

在 `run.ts`：
1. 把 `load` 里算 `segments` 的表达式抽成 `scriptSegments(script, targetSec)`（`checkDuration` + `ROLE_LABEL` 映射），`load` 改为调用它。
2. 把 `runPrediction` 里算 hash 的表达式抽成 `segmentsHash(x)`，`runPrediction` 改为 `segmentsHash(useTranscript ? input.transcript : input.segments)`。
3. 把 `load` 里与项目无关的部分（persona、history/baselines/baselineViews、calibratedCount、publicWorks、formula、benchmark/benchmarkHit）抽成 `loadPredictContext(db, benchmarkVideoId)`；`load` 改为 `{ ...(await loadPredictContext(db, p.benchmarkVideoId)), published, segments, transcript }`。
4. 新增：

```ts
export async function predictScript(llm: StructuredLLM, modelLabel: string, ctx: PredictContext, segments: NonNullable<ScoreInput['segments']>): Promise<ScriptPrediction> {
  const scores = await scoreStable({ llm, modelLabel } as PredictDeps, { segments, transcript: null, persona: ctx.persona, benchmark: ctx.benchmark });
  const result = computePrediction({ scores: scoreMap(scores), baselines: ctx.baselines, baselineViews: ctx.baselineViews, benchmarkHit: ctx.benchmarkHit, calibratedCount: ctx.calibratedCount, params: ctx.formula.params, publicWorks: ctx.publicWorks });
  return { scores, inputHash: segmentsHash(segments), formulaVersion: ctx.formula.version, result };
}
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run tests/lib/predict && npm run typecheck`
Expected: 全绿（含现有预测测试）。

```bash
git add src/lib/predict tests/lib/predict
git commit -m "refactor(predict): 拆出 predictScript(不依赖作品给稿子打分), 与作品预测同一 hash

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 每晚生成编排

**Files:**
- Create: `src/lib/topics/generate.ts`、`src/lib/topics/deps.ts`
- Test: `tests/lib/topics/generate.test.ts`

**Interfaces:**
- Consumes: Task 1 `loadPools` / `pickCandidates` / `Candidate` / `localDay`；Task 2 `predictScript` / `scriptSegments` / `ScriptPrediction`；`writeScript`、`findCopiedInScript`
- Produces:
  - `TopicPlanSchema = z.object({ title: z.string().min(1), why: z.string().min(1), hook: z.string().min(1), direction: z.string().min(10) })`
  - `interface GenDeps { llm: StructuredLLM | null; noModelReason: string; now: Date; store: CandidateStore; personaText: string; lessons: string | undefined; write: typeof writeScript; predict(script: Script, benchmarkVideoId: string | undefined): Promise<ScriptPrediction | null>; save(t: NewDailyTopic): Promise<'saved' | 'duplicate'>; markIdeaUsed(id: string): Promise<void>; recordRun(r: { day: string; created: number; skipped: { source?: TopicSource; reason: string }[] }): Promise<void>; doneToday(day: string): Promise<boolean> }`
  - `interface NewDailyTopic { day: string; source: TopicSource; sourceId: string; title: string; why: string; hook: string; direction: string; script: Script; copied: CopiedRun[]; prediction: ScriptPrediction | null }`
  - `generateDailyTopics(d: GenDeps, opts?: { scheduled?: boolean }): Promise<{ created: number; skipped: { source?: TopicSource; reason: string }[]; alreadyDone: boolean }>`
  - `createGenDeps(db: PrismaClient, now: Date): Promise<GenDeps>`（deps.ts）
  - `createCandidateStore(db: PrismaClient): CandidateStore`（deps.ts）

- [ ] **Step 1: 写失败测试 `tests/lib/topics/generate.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { generateDailyTopics, type GenDeps, type NewDailyTopic } from '@/lib/topics/generate';
import type { StructuredLLM } from '@/lib/script/write';
import type { Script } from '@/lib/script/model';

const now = new Date('2026-10-09T15:00:00Z');
const script = (t: string) => ({ segments: [{ id: 's1', role: 'hook', text: t }] }) as unknown as Script;
const plan = (title: string) => ({ title, why: '对上定位', hook: '开头一句', direction: `讲 ${title} 的方向说明，至少十个字` });

function deps(over: Partial<GenDeps> = {}) {
  const saved: NewDailyTopic[] = [];
  const runs: { created: number; skipped: unknown[] }[] = [];
  const used: string[] = [];
  const d: GenDeps = {
    llm: { callStructured: async ({ userMessage }: { userMessage: { text: string }[] }) => ({ result: plan(userMessage[0].text.includes('点子') ? '点子题' : userMessage[0].text.includes('续集') ? '续集题' : '对标题'), usage: {} }) } as unknown as StructuredLLM,
    noModelReason: '还没有可用的模型',
    now,
    store: {
      usedKeys: async () => new Set(),
      benchmarkHits: async () => [{ id: 'b1', ratio: 5, author: 'A', topic: 'AI 回消息', desc: '', transcript: '对标原文一二三四五六七八九十一二' }],
      ownWorks: async () => [{ projectId: 'p1', title: 'U盘', lastText: '单独来讲一期', play: 300 }],
      freshIdeas: async () => [{ id: 'i1', text: '讲讲 vibe coding 踩过的坑', createdAt: new Date('2026-10-01') }],
    },
    personaText: '定位',
    lessons: undefined,
    write: (async ({ direction }: { direction: string }) => ({ title: 't', script: script(direction), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'],
    predict: async () => ({ scores: [], inputHash: 'h', formulaVersion: 1, result: { center: 4500 } as never }),
    save: async (t) => (saved.push(t), 'saved'),
    markIdeaUsed: async (id) => void used.push(id),
    recordRun: async (r) => void runs.push(r),
    doneToday: async () => false,
    ...over,
  };
  return { d, saved, runs, used };
}

describe('generateDailyTopics', () => {
  it('writes three topics, one per source, with drafts and predictions', async () => {
    const { d, saved, runs, used } = deps();
    const r = await generateDailyTopics(d);
    expect(r).toMatchObject({ created: 3, skipped: [] });
    expect(saved.map((s) => [s.source, s.title])).toEqual([['benchmark', '对标题'], ['sequel', '续集题'], ['idea', '点子题']]);
    expect(saved[0]).toMatchObject({ day: '2026-10-09', prediction: { inputHash: 'h' } });
    expect(used).toEqual(['i1']);
    expect(runs).toEqual([{ day: '2026-10-09', created: 3, skipped: [] }]);
  });
  it('keeps a topic when its prediction fails', async () => {
    const { d, saved } = deps({ predict: async () => null });
    await generateDailyTopics(d);
    expect(saved).toHaveLength(3);
    expect(saved[0].prediction).toBeNull();
  });
  it('skips a candidate whose draft fails and keeps the rest', async () => {
    const { d, saved, runs } = deps({
      write: (async ({ direction }: { direction: string }) => {
        if (direction.includes('续集')) throw new Error('模型这次没按 6 段格式交稿');
        return { title: 't', script: script(direction), report: { ok: true }, rounds: 0 };
      }) as unknown as GenDeps['write'],
    });
    const r = await generateDailyTopics(d);
    expect(saved.map((s) => s.source)).toEqual(['benchmark', 'idea']);
    expect(r.skipped).toEqual([{ source: 'sequel', reason: '写稿失败：模型这次没按 6 段格式交稿' }]);
    expect(runs[0].created).toBe(2);
  });
  it('skips a candidate when the topic plan is malformed', async () => {
    const { d, saved } = deps({ llm: { callStructured: async () => ({ result: { title: '', why: '', hook: '', direction: '' }, usage: {} }) } as unknown as StructuredLLM });
    const r = await generateDailyTopics(d);
    expect(saved).toEqual([]);
    expect(r.skipped.every((s) => s.reason.startsWith('定选题失败'))).toBe(true);
  });
  it('skips a candidate that another run already saved', async () => {
    const { d } = deps({ save: async (t) => (t.source === 'benchmark' ? 'duplicate' : 'saved') });
    const r = await generateDailyTopics(d);
    expect(r.created).toBe(2);
    expect(r.skipped).toEqual([{ source: 'benchmark', reason: '这个选题刚被另一次运行生成过' }]);
  });
  it('flags copied lines from a benchmark reference', async () => {
    const { d, saved } = deps({ write: (async () => ({ title: 't', script: script('对标原文一二三四五六七八九十一二'), report: { ok: true }, rounds: 0 })) as unknown as GenDeps['write'] });
    await generateDailyTopics(d);
    expect((saved[0].copied as unknown[]).length).toBeGreaterThan(0);
  });
  it('records why nothing was generated', async () => {
    const none = deps({ store: { usedKeys: async () => new Set(), benchmarkHits: async () => [], ownWorks: async () => [], freshIdeas: async () => [] } });
    expect(await generateDailyTopics(none.d)).toMatchObject({ created: 0, skipped: [{ reason: '没有可用的选题来源：加几个对标账号，或在点子池里写几句' }] });
    const noModel = deps({ llm: null });
    expect(await generateDailyTopics(noModel.d)).toMatchObject({ created: 0, skipped: [{ reason: '还没有可用的模型' }] });
    expect(noModel.runs).toHaveLength(1);
  });
  it('a scheduled run skips when today already succeeded; a manual run does not', async () => {
    const { d, saved } = deps({ doneToday: async () => true });
    expect(await generateDailyTopics(d, { scheduled: true })).toMatchObject({ alreadyDone: true, created: 0 });
    expect(saved).toEqual([]);
    expect((await generateDailyTopics(d)).created).toBe(3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/topics/generate.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/topics/generate.ts`**

```ts
import { z } from 'zod';
import type { Script } from '@/lib/script/model';
import type { StructuredLLM, writeScript } from '@/lib/script/write';
import { findCopiedInScript, type CopiedRun } from '@/lib/benchmark/copy-check';
import type { ScriptPrediction } from '@/lib/predict/run';
import { loadPools, localDay, pickCandidates, type Candidate, type CandidateStore, type TopicSource } from './candidates';

export const TARGET_SEC = 60;
export const NO_SOURCE_REASON = '没有可用的选题来源：加几个对标账号，或在点子池里写几句';

export const TopicPlanSchema = z.object({ title: z.string().min(1), why: z.string().min(1), hook: z.string().min(1), direction: z.string().min(10) });

const PLAN_SYSTEM = `你是抖音 AI 知识类博主的编导，根据给你的一条素材定一个今天能做的选题。
- 只基于素材和账号定位，不编"最近很火的XX"这类素材里没有的热点，不编数字。
- 对标素材：借选题和角度，换成博主自己的经历和视角，不照抄原话。
- 续集素材：接着原片结尾留下的话头讲，或把原片里最受欢迎的点展开。
- 点子素材：把博主的一句话点子展开成能讲 60 秒的选题。
- title：选题标题（20 字内）；why：为什么值得做（一句）；hook：开头钩子（一句口语）；direction：给写稿的方向说明（讲什么、什么角度、用什么例子）。
只输出 JSON：{"title": "", "why": "", "hook": "", "direction": ""}`;

const SOURCE_LABEL: Record<TopicSource, string> = { benchmark: '对标', sequel: '续集', idea: '点子' };

export interface NewDailyTopic {
  day: string;
  source: TopicSource;
  sourceId: string;
  title: string;
  why: string;
  hook: string;
  direction: string;
  script: Script;
  copied: CopiedRun[];
  prediction: ScriptPrediction | null;
}

export interface GenDeps {
  llm: StructuredLLM | null;
  noModelReason: string;
  now: Date;
  store: CandidateStore;
  personaText: string;
  lessons: string | undefined;
  write: typeof writeScript;
  predict(script: Script, benchmarkVideoId: string | undefined): Promise<ScriptPrediction | null>;
  save(t: NewDailyTopic): Promise<'saved' | 'duplicate'>;
  markIdeaUsed(id: string): Promise<void>;
  recordRun(r: { day: string; created: number; skipped: { source?: TopicSource; reason: string }[] }): Promise<void>;
  doneToday(day: string): Promise<boolean>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function generateDailyTopics(d: GenDeps, opts: { scheduled?: boolean } = {}) {
  const day = localDay(d.now);
  if (opts.scheduled && (await d.doneToday(day))) return { created: 0, skipped: [], alreadyDone: true };
  const skipped: { source?: TopicSource; reason: string }[] = [];
  let created = 0;
  const finish = async () => {
    await d.recordRun({ day, created, skipped });
    return { created, skipped, alreadyDone: false };
  };
  if (!d.llm) {
    skipped.push({ reason: d.noModelReason });
    return finish();
  }
  const picks = pickCandidates(await loadPools(d.store, d.now));
  if (!picks.length) {
    skipped.push({ reason: NO_SOURCE_REASON });
    return finish();
  }
  for (const c of picks) {
    const r = await oneTopic(d, d.llm, c, day).catch((e: unknown) => ({ error: msg(e) }));
    if ('error' in r) skipped.push({ source: c.source, reason: r.error });
    else created++;
  }
  return finish();
}

async function oneTopic(d: GenDeps, llm: StructuredLLM, c: Candidate, day: string): Promise<{ ok: true } | { error: string }> {
  let plan: z.infer<typeof TopicPlanSchema>;
  try {
    const { result } = await llm.callStructured({
      systemPrompt: PLAN_SYSTEM,
      userMessage: [{ type: 'text', text: `【账号定位】\n${d.personaText || '（未填写）'}\n\n【素材（${SOURCE_LABEL[c.source]}）】\n${c.material}` }],
      responseSchema: TopicPlanSchema,
    });
    plan = TopicPlanSchema.parse(result);
  } catch (e) {
    return { error: `定选题失败：${msg(e).slice(0, 80)}` };
  }
  let script: Script;
  try {
    script = (await d.write({ llm, direction: `${plan.title}。${plan.direction}\n开头钩子：${plan.hook}`, targetSec: TARGET_SEC, personaText: d.personaText, reference: c.reference, lessons: d.lessons })).script;
  } catch (e) {
    return { error: `写稿失败：${msg(e)}` };
  }
  const copied = c.reference ? findCopiedInScript(script, c.reference) : [];
  const prediction = await d.predict(script, c.benchmarkVideoId).catch(() => null);
  const saved = await d.save({ day, source: c.source, sourceId: c.sourceId, ...plan, script, copied, prediction });
  if (saved === 'duplicate') return { error: '这个选题刚被另一次运行生成过' };
  if (c.source === 'idea') await d.markIdeaUsed(c.sourceId);
  return { ok: true };
}
```

（`write` 的 `direction` 里带上标题与钩子，测试里用 `direction.includes('续集')` 区分候选——测试的假 `llm` 按素材返回「续集题」，方向里就含「续集」。）

- [ ] **Step 4: 实现 `src/lib/topics/deps.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import { writeScript } from '@/lib/script/write';
import { ScriptSchema } from '@/lib/script/model';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { formatLessons, loadActiveLessons } from '@/lib/retro/lessons';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { loadPredictContext, predictScript, scriptSegments } from '@/lib/predict/run';
import type { CandidateStore } from './candidates';
import { TARGET_SEC, type GenDeps } from './generate';

export function createCandidateStore(db: PrismaClient): CandidateStore {
  return {
    async usedKeys() {
      const rows = await db.dailyTopic.findMany({ select: { source: true, sourceId: true } });
      return new Set(rows.map((r) => `${r.source}:${r.sourceId}`));
    },
    async benchmarkHits(since) {
      const rows = await db.benchmarkVideo.findMany({ where: { isHit: true, status: { not: 'ignored' }, publishedAt: { gte: since } }, include: { account: true } });
      return rows.map((v) => {
        const a = AnalysisSchema.safeParse(v.analysis);
        return { id: v.id, ratio: v.ratio, author: v.account.nickname, topic: a.success ? a.data.topic : null, desc: v.desc, transcript: v.transcript };
      });
    },
    async ownWorks() {
      const works = await db.publishedWork.findMany({ where: { isPrivate: false, projectId: { not: null } }, orderBy: { publishedAt: 'desc' }, take: 10 });
      const out = [];
      for (const w of works) {
        const p = await db.project.findUnique({ where: { id: w.projectId! } });
        if (!p) continue;
        const t = await loadCurrentTranscript(db, p.id);
        const s = ScriptSchema.safeParse(p.script);
        const lastText = t?.data.lines.slice(-3).map((l) => l.text).join(' ') || (s.success ? s.data.segments.at(-1)?.text ?? null : null);
        out.push({ projectId: p.id, title: p.title, lastText, play: w.play });
      }
      return out;
    },
    freshIdeas: () => db.topicIdea.findMany({ where: { status: 'fresh' } }),
  };
}

export async function createGenDeps(db: PrismaClient, now: Date): Promise<GenDeps> {
  const model = await getActiveModel(db);
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const lessons = await loadActiveLessons(db);
  return {
    llm: model?.llm ?? null,
    noModelReason: NO_MODEL_MESSAGE,
    now,
    store: createCandidateStore(db),
    personaText: formatPersona(persona as PersonaLike | null),
    lessons: lessons.length ? formatLessons(lessons) : undefined,
    write: writeScript,
    async predict(script, benchmarkVideoId) {
      if (!model) return null;
      try {
        return await predictScript(model.llm, model.label, await loadPredictContext(db, benchmarkVideoId ?? null), scriptSegments(script, TARGET_SEC));
      } catch {
        return null;
      }
    },
    async save(t) {
      try {
        await db.dailyTopic.create({ data: { ...t, script: t.script as unknown as Prisma.InputJsonValue, copied: t.copied as unknown as Prisma.InputJsonValue, prediction: (t.prediction ?? undefined) as unknown as Prisma.InputJsonValue } });
        return 'saved';
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') return 'duplicate';
        throw e;
      }
    },
    markIdeaUsed: async (id) => void (await db.topicIdea.update({ where: { id }, data: { status: 'used' } })),
    recordRun: async (r) => void (await db.dailyTopicRun.create({ data: { day: r.day, created: r.created, skipped: r.skipped as unknown as Prisma.InputJsonValue } })),
    doneToday: async (day) => (await db.dailyTopicRun.count({ where: { day, created: { gte: 1 } } })) > 0,
  };
}
```

（字段名 `isHit`、`publishedAt`、`transcript`、`desc`、`account.nickname` 以 `BenchmarkVideo` 现有 schema 为准；不一致时按实际字段改并记 Ruling。）

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run tests/lib/topics && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/topics tests/lib/topics
git commit -m "feat(topics): 每晚生成编排(定选题→写稿→照抄检查→预测→保存, 单篇失败不影响其他) + Prisma 接线

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 每晚任务接入

**Files:**
- Create: `scripts/daily-topics.ts`、`scripts/com.mediapilot.daily-topics.plist`
- Modify: `package.json`（`"topics:daily": "tsx scripts/daily-topics.ts"`）、`src/lib/tasks/nightly.ts`、`src/lib/douyin/collect-log.ts`、`src/app/api/settings/tasks/route.ts`、`src/lib/overview/load.ts`
- Test: `tests/lib/tasks/nightly.test.ts`、`tests/lib/douyin/collect-log.test.ts`（追加）

**Interfaces:**
- Produces: `NIGHTLY_TASKS.topics`；`TOPICS_SPEC`；`readTopicsStatus(now?, file?)`

- [ ] **Step 1: 写失败测试**

`nightly.test.ts` 追加：

```ts
describe('daily topics task', () => {
  it('runs at 23:00 with retries at 0:00 and 1:00', () => {
    const t = NIGHTLY_TASKS.topics;
    expect(t).toMatchObject({ label: '每日选题', launchdLabel: 'com.mediapilot.daily-topics', npmScript: 'topics:daily', scriptFile: 'scripts/daily-topics.ts', log: 'logs/daily-topics.log', defaultHour: 23, defaultMinute: 0 });
    const T = `<plist><dict><key>StartCalendarInterval</key><dict><key>Hour</key><integer>23</integer><key>Minute</key><integer>0</integer></dict></dict></plist>`;
    const times = [...renderPlist(T, '/p', 23, 0, t.retryAfterMin).matchAll(/<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(times).toEqual(['23:0', '0:0', '1:0']);
  });
});
```

`collect-log.test.ts` 追加：

```ts
import { TOPICS_SPEC } from '@/lib/douyin/collect-log';
describe('daily topics log', () => {
  it('reads runs started with 开始生成 and finished with 生成完成', () => {
    const now = new Date('2026-10-09T15:30:00.000Z');
    const ok = '[2026-10-09T15:00:00.000Z] 开始生成\n[2026-10-09T15:04:00.000Z] 生成完成: 3 个\n';
    expect(parseRunLog(ok, now, TOPICS_SPEC).state).toBe('ok');
    expect(parseRunLog('[2026-10-09T15:00:00.000Z] 开始生成\n[2026-10-09T15:00:01.000Z] 生成失败: 还没有可用的模型\n', now, TOPICS_SPEC)).toMatchObject({ state: 'failing' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/tasks tests/lib/douyin`
Expected: FAIL。

- [ ] **Step 3: 实现**

`collect-log.ts`：

```ts
export const TOPICS_SPEC: RunLogSpec = {
  start: '开始生成',
  done: '生成完成',
  noun: '每日选题',
  install: '在「设置 · 每晚任务」开启每晚定时，或点「立即运行」先跑一次。',
};

export function readTopicsStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'daily-topics.log')): Promise<CollectStatus> {
  return readRunStatus(file, now, TOPICS_SPEC);
}
```

`nightly.ts` 的 `NIGHTLY_TASKS` 加：

```ts
  topics: {
    label: '每日选题',
    launchdLabel: 'com.mediapilot.daily-topics',
    npmScript: 'topics:daily',
    scriptFile: 'scripts/daily-topics.ts',
    log: 'logs/daily-topics.log',
    defaultHour: 23,
    defaultMinute: 0,
    /** 失败时 0:00、1:00 补跑; 脚本带 --scheduled, 今天已生成过就跳过 */
    retryAfterMin: [60, 120] as number[],
  },
```

`scripts/com.mediapilot.daily-topics.plist`：照 `com.mediapilot.scan-benchmarks.plist` 复制，`Label` 改为 `com.mediapilot.daily-topics`，命令 `exec npm run topics:daily -- --scheduled`，时间 23:00，日志 `logs/daily-topics.log`，注释说明「每晚 23:00 出 3 个选题与初稿（在回采、巡检之后）」。

`scripts/daily-topics.ts`：

```ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { createGenDeps } from '../src/lib/topics/deps';
import { generateDailyTopics } from '../src/lib/topics/generate';

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  try {
    const scheduled = process.argv.includes('--scheduled');
    const r = await generateDailyTopics(await createGenDeps(db, new Date()), { scheduled });
    if (r.alreadyDone) return log('今天已经生成过选题，这次定时补跑跳过');
    log('开始生成');
    const why = r.skipped.map((s) => s.reason).join('；');
    // 一个都没生成: 没模型算失败(要补跑), 没来源算完成(补跑也没用, 原因在「今天」里提示)
    if (r.created === 0 && r.skipped.some((s) => !s.source && s.reason !== '没有可用的选题来源：加几个对标账号，或在点子池里写几句')) {
      log(`生成失败: ${why}`);
      process.exitCode = 1;
      return;
    }
    log(`生成完成: ${r.created} 个${why ? `（跳过：${why}）` : ''}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  log(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
```

（「开始生成」放在生成之后打印会让日志里开始与结束时间相同；为了让 `parseRunLog` 判断成功，「开始生成」与「生成完成 / 失败」必须成对出现，顺序与时间先后无关——若执行时发现要求时间先后，把「开始生成」移到 `generateDailyTopics` 之前、跳过分支之后（跳过分支先单独判断 `doneToday`），记 Ruling。）

`settings/tasks/route.ts`：`statuses` 加 `topics: await readTopicsStatus()`。
`overview/load.ts`：任务列表加 `['topics', await readTopicsStatus(now)]`。

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（设置页每晚任务卡片会多出「每日选题」一项）。

```bash
git add scripts package.json src/lib/tasks src/lib/douyin src/app/api/settings src/lib/overview tests
git commit -m "feat(topics): 每晚任务接入(23:00, 失败 0:00/1:00 补跑, 今天已生成就跳过)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 列出、采用、不要、过期、点子池

**Files:**
- Create: `src/lib/topics/daily.ts`、`src/app/api/topics/daily/route.ts`、`src/app/api/topics/daily/[id]/route.ts`、`src/app/api/topics/ideas/route.ts`、`src/app/api/topics/ideas/[id]/route.ts`
- Test: `tests/lib/topics/daily.test.ts`

**Interfaces:**
- Produces:
  - `interface DailyCard { id: string; day: string; source: TopicSource; title: string; why: string; hook: string; script: Script; copied: number; predictedCenter: number | null; sourceLabel: string; status: string }`
  - `EXPIRE_DAYS = 3`
  - `listDaily(db, now): Promise<{ topics: DailyCard[]; lastRun: { day: string; created: number; reasons: string[] } | null }>`（先把过期的标 `expired`；返回 `status = 'new'` 的，按 `predictedCenter` 降序，没预测的排后）
  - `adoptDaily(db, id): Promise<{ projectId: string }>`（事务内：只有 `new` 才能采用；建作品 + 写稿子预测 + 选题标 `adopted` 记 `projectId`；对标来源带 `benchmarkVideoId` 并把对标作品标 `adopted`）
  - `dismissDaily(db, id): Promise<void>`
  - `listIdeas(db)`、`addIdea(db, text)`、`deleteIdea(db, id)`

- [ ] **Step 1: 写失败测试 `tests/lib/topics/daily.test.ts`**

用一个内存假库（只实现用到的 `dailyTopic` / `dailyTopicRun` / `project` / `prediction` / `topicIdea` / `benchmarkVideo` / `personaProfile` / `$transaction` 方法），覆盖：

```ts
it('lists new topics by prediction, expiring ones older than 3 days', ...)
  // 种子: d1(今天, center 3000)、d2(今天, center 8000)、d3(今天, 无预测)、d4(4 天前, new)
  // listDaily → ['d2','d1','d3']，d4 状态变 expired
it('adoptDaily creates a project whose script is the draft and stores the same prediction', ...)
  // 断言 project.create 的 title/script/targetSec=60，prediction.create 的 kind='draft'、inputHash 与选题里一致；选题 status='adopted'、projectId 已记
it('adopting twice creates one project', ...)
  // 两次 adoptDaily：第二次抛出「这个选题已经处理过了」，project 只建了 1 个
it('dismissDaily hides it and it never comes back as a candidate', ...)
  // dismiss 后 listDaily 不含它；createCandidateStore(...).usedKeys() 仍含它的 key
it('ideas can be added, listed and soft-deleted', ...)
  // addIdea 空白文字抛「点子是空的」；deleteIdea 后状态 deleted，listIdeas 不含已删
it('lastRun reports the reasons of the latest run', ...)
```

（每个用例按上面注释写出完整断言；假库写在测试文件顶部。）

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/topics/daily.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/topics/daily.ts` 与 4 个接口**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Script } from '@/lib/script/model';
import type { ScriptPrediction } from '@/lib/predict/run';
import { localDay, type TopicSource } from './candidates';
import { TARGET_SEC } from './generate';

export const EXPIRE_DAYS = 3;
const LABEL: Record<TopicSource, string> = { benchmark: '对标', sequel: '续集', idea: '点子' };

export interface DailyCard { id: string; day: string; source: TopicSource; sourceLabel: string; title: string; why: string; hook: string; script: Script; copied: number; predictedCenter: number | null; status: string }

export async function listDaily(db: PrismaClient, now: Date) {
  const cutoff = localDay(new Date(now.getTime() - EXPIRE_DAYS * 86400_000));
  await db.dailyTopic.updateMany({ where: { status: 'new', day: { lte: cutoff } }, data: { status: 'expired' } });
  const rows = await db.dailyTopic.findMany({ where: { status: 'new' } });
  const topics: DailyCard[] = rows
    .map((t) => {
      const p = t.prediction as unknown as ScriptPrediction | null;
      return { id: t.id, day: t.day, source: t.source as TopicSource, sourceLabel: LABEL[t.source as TopicSource], title: t.title, why: t.why, hook: t.hook, script: t.script as unknown as Script, copied: (t.copied as unknown[]).length, predictedCenter: p?.result?.center ?? null, status: t.status };
    })
    .sort((a, b) => (b.predictedCenter ?? -1) - (a.predictedCenter ?? -1));
  const run = await db.dailyTopicRun.findFirst({ orderBy: { createdAt: 'desc' } });
  const lastRun = run ? { day: run.day, created: run.created, reasons: (run.skipped as { reason: string }[]).map((s) => s.reason) } : null;
  return { topics, lastRun };
}

export async function adoptDaily(db: PrismaClient, id: string): Promise<{ projectId: string }> {
  return db.$transaction(async (tx) => {
    const claimed = await tx.dailyTopic.updateMany({ where: { id, status: 'new' }, data: { status: 'adopted' } });
    if (!claimed.count) throw new Error('这个选题已经处理过了');
    const t = await tx.dailyTopic.findUniqueOrThrow({ where: { id } });
    const persona = await tx.personaProfile.findUnique({ where: { id: 'me' } });
    const p = await tx.project.create({
      data: {
        title: t.title,
        script: t.script as Prisma.InputJsonValue,
        targetSec: TARGET_SEC,
        personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
        ...(t.source === 'benchmark' ? { benchmarkVideoId: t.sourceId } : {}),
      },
    });
    const pred = t.prediction as unknown as ScriptPrediction | null;
    if (pred) await tx.prediction.create({ data: { projectId: p.id, kind: 'draft', formulaVersion: pred.formulaVersion, inputHash: pred.inputHash, scores: pred.scores as unknown as Prisma.InputJsonValue, result: pred.result as unknown as Prisma.InputJsonValue } });
    if (t.source === 'benchmark') await tx.benchmarkVideo.update({ where: { id: t.sourceId }, data: { status: 'adopted' } });
    await tx.dailyTopic.update({ where: { id }, data: { projectId: p.id } });
    return { projectId: p.id };
  });
}

export async function dismissDaily(db: PrismaClient, id: string) {
  const r = await db.dailyTopic.updateMany({ where: { id, status: 'new' }, data: { status: 'dismissed' } });
  if (!r.count) throw new Error('这个选题已经处理过了');
}

export const listIdeas = (db: PrismaClient) => db.topicIdea.findMany({ where: { status: { not: 'deleted' } }, orderBy: { createdAt: 'desc' } });

export async function addIdea(db: PrismaClient, text: string) {
  const t = text.trim();
  if (!t) throw new Error('点子是空的');
  return db.topicIdea.create({ data: { text: t.slice(0, 500) } });
}

export const deleteIdea = (db: PrismaClient, id: string) => db.topicIdea.update({ where: { id }, data: { status: 'deleted' } });
```

接口：
- `GET /api/topics/daily` → `ok(await listDaily(prisma, new Date()))`
- `POST /api/topics/daily/[id]` body `{ action }`：`adopt` → `ok(await adoptDaily(...))`，`dismiss` → `ok({})`；错误 → `fail(message, 409)`
- `GET /api/topics/ideas` → `ok(await listIdeas(prisma))`；`POST` body `{ text }` → `ok(await addIdea(...))`，错误 400
- `DELETE /api/topics/ideas/[id]` → `ok(await deleteIdea(...))`

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/topics src/app/api/topics tests/lib/topics
git commit -m "feat(topics): 今日选题列出/就做这个/不要/3 天过期 + 点子池接口

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 页面

**Files:**
- Create: `src/components/topics/daily-topics.tsx`、`src/components/topics/idea-pool.tsx`
- Modify: `src/components/topics/topics-view.tsx`、`src/lib/overview/load.ts`、`src/components/overview/today-panel.tsx`
- Test: `tests/components/daily-topics.test.tsx`、`tests/components/idea-pool.test.tsx`、`tests/components/today-panel.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5 接口与 `DailyCard`
- Produces: `OverviewData.daily: { topics: { id: string; title: string; sourceLabel: string; why: string; predictedCenter: number | null }[]; reason: string | null }`

- [ ] **Step 1: 写失败测试**

`daily-topics.test.tsx`：
- 列出卡片：标题、来源标签、why、「预测 ~4,500」或「预测没算出来」；顺序按接口返回。
- 点「展开初稿」显示 6 段文字与开头钩子；`copied > 0` 时显示「有 N 处和对标原文太像，改写后再用」。
- 点「就做这个」→ POST `{ action: 'adopt' }`，成功后跳转 `/projects/<id>?step=script`（mock `next/navigation` 的 `useRouter().push`，断言调用参数）。
- 点「不要」→ POST `{ action: 'dismiss' }`，卡片消失。
- 没有选题：显示 `lastRun.reasons` 的第一条；连记录都没有时显示「今晚 23:00 会自动生成；也可以在「设置 · 每晚任务」立即运行」。

`idea-pool.test.tsx`：
- 回车保存 → POST `{ text }`，输入框清空，列表出现；空白不提交。
- 列表显示状态「没用过 / 已出选题」；点「删除」→ DELETE。

`today-panel.test.tsx` 追加：
- `daily.topics` 有内容时显示「今日选题」三张小卡（标题、来源、预测），链接 `/topics#daily`。
- 没有时显示 `daily.reason`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/daily-topics.test.tsx tests/components/idea-pool.test.tsx tests/components/today-panel.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现**

`daily-topics.tsx`（客户端组件，样式沿用 `.card` / `.btn-primary` / `.btn-secondary` / `.chip`）：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DailyCard } from '@/lib/topics/daily';
import { fmtViews } from '@/lib/predict/formula';
import { ROLE_LABEL } from '@/lib/script/model';

type Data = { topics: DailyCard[]; lastRun: { day: string; created: number; reasons: string[] } | null };

export function DailyTopics() {
  const router = useRouter();
  const [d, setD] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const j = await fetch('/api/topics/daily').then((r) => r.json()).catch(() => ({ success: false }));
    setD(j.success ? j.data : { topics: [], lastRun: null });
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (id: string, action: 'adopt' | 'dismiss') => {
    setBusy(id);
    setErr(null);
    const j = await fetch(`/api/topics/daily/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(null);
    if (!j.success) return setErr(j.message);
    if (action === 'adopt') router.push(`/projects/${j.data.projectId}?step=script`);
    else await load();
  };

  if (!d) return null;
  return (
    <section id="daily" className="card space-y-3">
      <h2 className="text-[15px] font-semibold">今日选题</h2>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {d.topics.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">{d.lastRun?.reasons[0] ?? '今晚 23:00 会自动生成；也可以在「设置 · 每晚任务」立即运行'}</p>
      ) : (
        <ul className="space-y-3">
          {d.topics.map((t) => (
            <li key={t.id} className="rounded-[var(--r-md)] bg-[var(--bg-inset)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">{t.sourceLabel}</span>
                <b className="text-[15px]">{t.title}</b>
                <span className="ml-auto text-xs text-[var(--text-tertiary)]">{t.predictedCenter !== null ? `预测 ~${fmtViews(t.predictedCenter)}` : '预测没算出来'}</span>
              </div>
              <p className="mt-1 text-[var(--text-secondary)]">{t.why}</p>
              {t.copied > 0 && <p className="mt-1 text-xs text-[var(--warning)]">{`有 ${t.copied} 处和对标原文太像，改写后再用`}</p>}
              {open === t.id && (
                <div className="mt-2 space-y-1 rounded-[var(--r-md)] bg-[var(--bg-surface)] p-3">
                  <p className="text-xs text-[var(--text-tertiary)]">{`开头钩子：${t.hook}`}</p>
                  {t.script.segments.map((s) => (
                    <p key={s.id}>
                      <span className="mr-1 text-xs text-[var(--text-tertiary)]">{ROLE_LABEL[s.role]}</span>
                      {s.text}
                    </p>
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary" disabled={busy === t.id} onClick={() => void act(t.id, 'adopt')}>就做这个</button>
                <button className="btn-secondary" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? '收起初稿' : '展开初稿'}</button>
                <button className="btn-secondary" disabled={busy === t.id} onClick={() => void act(t.id, 'dismiss')}>不要</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

（作品页 `?step=script` 若现有工作区不支持该参数，就跳 `/projects/<id>`，记 Ruling——工作区默认停在当前步骤，新作品有稿未定稿时就是「脚本」。）

`idea-pool.tsx`：输入框（`placeholder="随手写一句点子，回车保存"`）+ 列表（文字、状态「没用过」/「已出选题」、删除按钮）；调用 Task 5 的点子接口。

`topics-view.tsx`：在现有内容最上面依次渲染 `<DailyTopics />`、`<IdeaPool />`。

`overview/load.ts`：`OverviewData` 加 `daily`；用 `listDaily(db, now)` 取前 3 个映射成小卡；没有时 `reason = lastRun?.reasons[0] ?? null`。

`today-panel.tsx`：在「在做的作品」之前加「今日选题」：有卡片时每张一行（来源 chip、标题、预测），整块链接 `/topics#daily`；没有时显示 `daily.reason`（为空则不显示这一块）。

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/components src/lib/overview tests/components
git commit -m "feat(topics): 选题页「今日选题」与点子池 + 总览「今天」显示今日选题

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-10-09-daily-topics-design.md`（追加实测）

- [ ] **Step 1: README**：「现在能做什么」加一条「每日选题」：每晚 23:00 从对标爆款 / 自己作品的续集 / 点子池挑 3 个选题，各写一篇 60 秒口播初稿并预测播放；总览「今天」与「选题」页可看，「就做这个」才建成作品；点子池在「选题」页。命令 `npm run topics:daily`。

- [ ] **Step 2: 真机（会用模型额度，一晚的量）**
1. `npx prisma db push` 已做；`launchctl kickstart -k gui/$(id -u)/com.mediapilot.dev` 重启网页服务。
2. 设置页「每晚任务」出现「每日选题」，开启定时（23:00）——用接口 `PUT /api/settings/tasks/topics/schedule` 或页面开关。
3. 「选题」页点子池写一句「讲讲 vibe coding 两年半踩过的坑」。
4. 设置页「每日选题」点「立即运行」，等日志出现「生成完成」；「选题」页与总览「今天」出现选题卡，含点子来源与续集来源（U盘那条片尾有「单独来讲一期」）。
5. 展开一篇初稿检查；对其中一个点「就做这个」，作品页脚本即初稿、预测与卡片上一致。对另一个点「不要」，刷新后不再出现。
6. 结果截图给用户；实测写入 spec 末尾。

- [ ] **Step 3: 收尾**

```bash
npx vitest run && npm run typecheck
git add README.md docs/superpowers/specs/2026-10-09-daily-topics-design.md
git commit -m "docs: README 补每日选题, spec 记录实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
