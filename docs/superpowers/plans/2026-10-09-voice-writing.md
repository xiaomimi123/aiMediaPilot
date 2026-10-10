# 主号文案改进 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 稿子像用户本人在说话：故事节拍结构 + 说话样本 + 每日选题先问材料、按用户回答写 + 润色（选题页「我自己写了一篇」与作品脚本步「润色」）。

**Architecture:**
- 写稿核心 `src/lib/script/write.ts` 加新规矩，可选带 `samples`（说话样本）与 `answers`（用户回答）。
- 段落键名不变，只改显示名与占比；`checkDuration` 改为只看全片。
- 新增 `src/lib/script/polish.ts`（润色 + 新加内容检测）与 `src/lib/voice/samples.ts`（说话样本）。
- 每日选题把「实测清单」泛化为「问题」：`questions` / `answers`，旧 `checklist` 读取时转换。

**Tech Stack:** Next.js 14、Prisma 5、zod、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-10-09-voice-writing-design.md`

## Global Constraints

- 段名（键名不变）：hook=钩子 0.10、conceptA=我是谁·当时 0.15、conceptB=遇到什么 0.20、fact=怎么做的 0.20、bridge=结果 0.25、close=经验或悬念 0.10。
- 默认目标时长 75 秒（`Project.targetSec` 默认值、每日选题 `TARGET_SEC`、润色默认）。
- 只有全片超出上限才触发自修；单段超出只放进 `hints`。
- 说话样本：写稿带最近 3 篇，每篇截前 800 字。
- 润色：只用原文内容；连续 12 字以上原文没有的片段计为 `added`；改动全部列出。
- 经历和数字只来自【用户提供的事实】或【用户的回答】，否则写【待补：…】。
- 页面文字一律中文。

## Review Focus

1. **已定稿或已录制的作品点「润色」**：不能悄悄改掉已定稿的稿子。→ Task 6 测试 `refuses to replace the script after it is finalized`。
2. **用户回答里有原文以外的经历**：答案是事实，应该用；但不能把参考稿里的【待补】留着的地方编成别的。→ Task 5 测试 `writes from answers and keeps unanswered gaps as 待补`（检查传给写稿的 answers 与 facts）。
3. **润色把原文压短时漏列改动或偷偷加句子**：新加片段必须标出。→ Task 4 测试 `flags sentences that are not in the original`。
4. **旧选题（只有 checklist、results）**：照样能答、能按回答写。→ Task 5 测试 `turns an old checklist into questions with its results as answers`。
5. **说话样本很长或很多**：只带最近 3 篇、每篇 800 字。→ Task 2 测试 `uses the latest 3 samples trimmed to 800 characters`。

---

## 文件结构

```
src/lib/script/model.ts          段名与占比
src/lib/script/duration.ts       ok 只看全片 + hints
src/lib/script/write.ts          新规矩 + samples/answers
src/lib/script/polish.ts         润色(新)
src/lib/voice/samples.ts         说话样本(新)
prisma/schema.prisma             VoiceSample; DailyTopic.questions/answers; Project.targetSec 默认 75
src/lib/topics/generate.ts       定选题产出 questions; rewriteWithAnswers
src/lib/topics/daily.ts          DailyCard.questions/answers; answerDaily; 采用带问答
src/lib/topics/deps.ts           写稿带样本
src/lib/tools/write-script.ts    编导写稿带样本
src/app/api/voice-samples/route.ts、[id]/route.ts
src/app/api/scripts/polish/route.ts
src/app/api/projects/route.ts    POST 支持带脚本建作品
src/app/api/projects/[id]/route.ts  PATCH 支持整篇替换脚本(仅 draft)
src/components/settings/voice-samples-card.tsx
src/components/topics/daily-topics.tsx   问题与「按我的话写」
src/components/topics/own-script.tsx     「我自己写了一篇」
src/components/project/polish-panel.tsx  润色结果面板(两处共用)
src/components/project/script-pane.tsx   「润色」按钮
src/components/project/recording-pane.tsx  「加为说话样本」
```

---

### Task 1: 故事节拍与时长规则

**Files:** `src/lib/script/model.ts`、`src/lib/script/duration.ts`、`src/lib/script/write.ts`（`repairMessage` 只列全片问题）、`prisma/schema.prisma`（`targetSec @default(75)`）、`src/lib/topics/generate.ts`（`TARGET_SEC = 75`）、`src/lib/project/create.ts`（不传 targetSec，用库默认）

**Interfaces:**
- Produces:
  - `ROLE_LABEL` / `ROLE_SHARE` 新值
  - `DurationReport.hints: string[]`：单段超出的提示
  - `DurationReport.ok`：只看全片
  - `DEFAULT_TARGET_SEC = 75`（`model.ts` 导出）

- [ ] **Step 1: 写失败测试**（`tests/lib/script/duration.test.ts` 追加，并把现有断言段名 / 占比 / ok 语义的用例改为新规则）

```ts
it('uses story beats as segment names and shares', () => {
  expect(ROLE_LABEL).toEqual({ hook: '钩子', conceptA: '我是谁·当时', conceptB: '遇到什么', fact: '怎么做的', bridge: '结果', close: '经验或悬念' });
  expect(Object.values(ROLE_SHARE).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  expect(ROLE_SHARE.bridge).toBe(0.25);
  expect(DEFAULT_TARGET_SEC).toBe(75);
});
it('only the whole film over its limit fails; a long segment is just a hint', () => {
  // 第 1 段远超预算, 全片仍在上限内
  const r = checkDuration(scriptWith(['很长'.repeat(40), '短', '短', '短', '短', '短']), 75);
  expect(r.ok).toBe(true);
  expect(r.hints[0]).toContain('第1段「钩子」');
  expect(r.issues).toEqual([]);
  const over = checkDuration(scriptWith(Array(6).fill('长'.repeat(120))), 75);
  expect(over.ok).toBe(false);
  expect(over.issues[0]).toContain('全片约');
});
```

（`scriptWith(texts)` 在测试文件里按 `SEGMENT_ROLES` 拼一个 `Script`。）

- [ ] **Step 2: 运行确认失败** — `npx vitest run tests/lib/script`
- [ ] **Step 3: 实现**
  - **`model.ts`：** 新段名与占比，导出 `DEFAULT_TARGET_SEC = 75`。顶部注释改为「故事节拍」。
  - **`duration.ts`：** 单段超出的说明移到 `hints`。`issues` 只放全片超出。`ok = totalSec <= totalLimitSec`。
  - **`write.ts`：** 自修条件用 `!report.ok`（已是）。`repairMessage` 用 `report.issues` 加 `report.hints`，让模型知道删哪段。
  - **schema：** `targetSec Int @default(75)`，然后 `npx prisma db push`（只影响新建项目）。
  - **`generate.ts`：** `TARGET_SEC = DEFAULT_TARGET_SEC`。
- [ ] **Step 4: 测试、提交** — `npx vitest run && npm run typecheck`，全绿（其它测试里写死的段名、默认 60 秒按新值更新，每处记 Ruling）。提交 `feat(script): 故事节拍段名与占比, 只看全片时长, 默认 75 秒`。

---

### Task 2: 说话样本

**Files:**
- 新建：`src/lib/voice/samples.ts`、`src/app/api/voice-samples/route.ts`、`src/app/api/voice-samples/[id]/route.ts`、`src/components/settings/voice-samples-card.tsx`
- 修改：`prisma/schema.prisma`（`VoiceSample`，见 spec §3.3）、`src/app/settings/page.tsx`（加卡片，锚点 `#voice`）、`src/components/project/recording-pane.tsx`（「加为说话样本」）
- 测试：`tests/lib/voice/samples.test.ts`、`tests/components/settings/voice-samples-card.test.tsx`

**Interfaces:**
- Produces:
  - `SAMPLE_COUNT = 3`
  - `SAMPLE_CHARS = 800`
  - `listSamples(db)`
  - `addSample(db, { title?, text, source })`：空文本抛「样本是空的」
  - `deleteSample(db, id)`
  - `recentSampleTexts(db): Promise<string[]>`

- [ ] **Step 1: 写失败测试**
  - `samples.test.ts`（内存假库）：
    - `uses the latest 3 samples trimmed to 800 characters`：种 5 篇，最新那篇 1000 字 → 返回 3 篇，顺序新到旧，首篇长 800。
    - `rejects an empty sample`。
    - `adds and deletes`。
  - `voice-samples-card.test.tsx`：
    - 列出标题、来源（手动 / 自己写的 / 转写）与前 60 字。
    - 新增（标题 + 正文，「保存」）→ POST `{ title, text }`。
    - 删除先在页面里确认（沿用页面内确认条）→ DELETE。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
  - **库函数：** `recentSampleTexts` 取 `orderBy createdAt desc, take 3`，每篇 `text.slice(0, 800)`。
  - **接口：** `GET` / `POST /api/voice-samples`；`DELETE /api/voice-samples/[id]`。POST 的 source 固定为 `manual`。
  - **转写按钮：** `recording-pane.tsx` 有转写时显示「加为说话样本」。点击后 POST `/api/voice-samples`，带 `{ title: 项目标题, text: 转写全文, source: 'transcript' }`；接口允许 `transcript`，其余一律记 `manual`。
- [ ] **Step 4: 测试、提交** — `feat(voice): 说话样本(设置页增删、转写一键加入)`。

---

### Task 3: 写稿带新规矩、样本、回答

**Files:**
- 修改：`src/lib/script/write.ts`、`src/lib/tools/write-script.ts`、`src/lib/topics/deps.ts`
- 测试：`tests/lib/script/write.test.ts`（追加）

**Interfaces:**
- Consumes：Task 2 的 `recentSampleTexts`
- Produces：`writeScript(opts & { samples?: string[]; answers?: { q: string; a: string }[] })`

- [ ] **Step 1: 写失败测试**

```ts
it('asks to sound like the blogger talking, not an article', async () => {
  const llm = fakeLLM([raw(onBudget)]);
  await writeScript({ llm, direction: 'x', targetSec: 75, personaText: '' });
  for (const s of ['写得像博主本人在说话，不像文章', '先交代「我是谁、我当时在干嘛」', '不写「其实」「所以结论很直接」', '用具体的东西']) expect(llm.systems[0]).toContain(s);
});
it('includes speaking samples and the user answers', async () => {
  const llm = fakeLLM([raw(onBudget)]);
  await writeScript({ llm, direction: 'x', targetSec: 75, personaText: '', samples: ['样本一原文', '样本二原文'], answers: [{ q: '你收藏了多少？', a: '一百多个' }, { q: '留下哪几个？', a: '' }] });
  expect(llm.calls[0]).toContain('【说话样本】（模仿说话方式，不抄句子）\n样本一原文\n---\n样本二原文');
  expect(llm.calls[0]).toContain('【用户的回答】\n问：你收藏了多少？\n答：一百多个');
  expect(llm.calls[0]).not.toContain('留下哪几个');
});
```

- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
  - **SYSTEM_PROMPT：** 加 spec §3.2 的规矩，原文照录。
  - **`firstMessage`：** 加两节。
    - 【说话样本】：放在【账号定位】之后，各篇之间用 `\n---\n` 分隔。
    - 【用户的回答】：放在【用户提供的事实】之后，只列有答案的条目。
  - **事实规则：** 「只能来自【用户提供的事实】」改为「只能来自【用户提供的事实】或【用户的回答】」。
  - **调用处：** `write-script.ts` 与 `deps.ts` 的 `createGenDeps` 都传 `samples: await recentSampleTexts(db)`。`GenDeps` 加 `samples: string[]`，`oneTopic` 透传。
- [ ] **Step 4: 测试、提交** — `feat(script): 写稿像本人说话(新规矩) + 带说话样本与用户回答`。

---

### Task 4: 润色

**Files:**
- 新建：`src/lib/script/polish.ts`、`src/app/api/scripts/polish/route.ts`
- 测试：`tests/lib/script/polish.test.ts`

**Interfaces:**
- Produces:
  - `PolishOutSchema`：`{ title, segments: [{text}] x6, changes: [{kind:'删'|'挪'|'改'|'错字', what}], questions: string[] }`
  - `polishScript(opts: { llm: StructuredLLM; text: string; targetSec: number }): Promise<{ title: string; script: Script; report: DurationReport; changes: Change[]; questions: string[]; added: string[] }>`
  - `findAdded(polished: string, original: string, run = 12): string[]`（复用 `findCopied` 的反向：润色稿里不在原文中的连续片段）
  - `splitOriginal(text: string): Script`：不改字，按句号 / 换行均分成 6 段（「用原文建作品」用）
  - `POST /api/scripts/polish { text, targetSec? }` → 上面的结果（`script`、`report`、`changes`、`questions`、`added`、`title`）

- [ ] **Step 1: 写失败测试**
  - `returns a 6-beat script with every change listed and questions to confirm`：假模型返回 6 段、2 条改动、1 个问题，原样带回；`script.segments[i].role === SEGMENT_ROLES[i]`。
  - `flags sentences that are not in the original`：润色稿多了一句「这句是模型自己加的内容哦」，结果 `added` 包含它；润色稿全部来自原文时 `added` 为 `[]`。
  - `repairs once when still over the target`：第一次返回超长，第二次正常 → 调用 2 次，`report.ok` 为真。
  - `splitOriginal keeps every character`：拼回去等于原文（去空白后）。
  - `refuses empty text`：抛「稿子是空的」。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
  - **系统提示：** 只用原文内容、不加新内容、不改说法和口头禅、压到目标时长、改动全列、意思不清处写进 `questions`、按 6 个故事节拍切段。
  - **用户消息：** 【原文】+ 目标时长 + 节拍说明。
  - **自修：** 超长时调用一次 `repairMessage`（与写稿共用）。
  - **`findAdded`：** 用 `findCopied(polishedSegmentText, original)` 的思路，找出润色稿中「不在原文里」的 ≥12 字片段。实现方式：按标点切句，每句去空白后若长度 ≥12 且不是原文（去空白）的子串，就计入。
  - **接口：** 无可用模型 → 400「没有可用的模型」；模型失败 → 400 加中文原因。
- [ ] **Step 4: 测试、提交** — `feat(script): 润色(压到目标时长、改动全列、新加内容检测)`。

---

### Task 5: 每日选题先问材料

**Files:**
- 修改：`prisma/schema.prisma`（`DailyTopic.questions Json @default("[]")`、`answers Json?`）、`src/lib/topics/generate.ts`、`src/lib/topics/daily.ts`、`src/lib/topics/deps.ts`、`src/app/api/topics/daily/[id]/route.ts`、`src/components/topics/daily-topics.tsx`
- 测试：`tests/lib/topics/generate.test.ts`、`tests/lib/topics/daily.test.ts`、`tests/components/topics/daily-topics.test.tsx`（追加或改写实测清单相关用例）

**Interfaces:**
- Produces:
  - `TopicPlan.questions: string[]`：3–5 个；实测项转成「实测：<test>，记下：<record>」。
  - `NewDailyTopic.questions`
  - `topicQuestions(t: { questions?: unknown; checklist?: unknown; results?: unknown; answers?: unknown }): { questions: string[]; answers: string[] }`：旧数据兼容。
  - `rewriteWithAnswers(d, t, answers: string[])`：替代 `rewriteWithResults`。
  - `answerDaily(db, deps, id, answers)`：替代 `rewriteDaily`。
  - `DailyCard.questions` / `answers` / `answered: boolean`
  - 接口 action `answer`；保留 `rewrite` 作为同义词。

- [ ] **Step 1: 写失败测试**
  - **generate：**
    - `plans questions to collect real material`：假模型返回 `questions` 4 个 → `saved[0].questions` 长度 4。
    - 实测类的 checklist 合并成问题。
    - 定选题提示词含「questions」与「能讲成故事的真事」。
  - **generate：** `writes from answers and keeps unanswered gaps as 待补`。`rewriteWithAnswers` 传给 `write` 的 `answers` 只含已答项，`facts` 不含未答问题。
  - **generate：** `refuses to write with no answers`：抛「先答至少一个问题」。
  - **daily：** `turns an old checklist into questions with its results as answers`：只有 `checklist` / `results` 的旧行 → 卡片 `questions`、`answers` 正确。
  - **daily：** `answerDaily stores answers, rewrites and marks the card as written from your words`。
  - **daily：** `carries answered and unanswered questions into the project chat on adopt`：消息含「你答过的材料」与「还没答的问题」。
  - **UI：**
    - 显示问题和多行输入框，未答时「按我的话写」不可点。
    - 答一题后可点 → POST `{ action: 'answer', answers }`。
    - `answered` 为假时卡片标「参考稿」，为真时标「按你的话写的」。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
  - **定选题：** `PLAN_SYSTEM` 加 `questions` 说明（问能讲成故事的真事：数量、具体是哪个、哪一次、当时什么感受）。`normalizePlan` 产出 `questions`：模型给的问题，加上实测清单转出的问题，去重，最多 6 个。
  - **数据：** 保存时写 `questions`；`checklist` 照旧写，读取统一走 `topicQuestions`。
  - **`rewriteWithAnswers`：** 把非空答案组成 `answers: {q,a}[]` 传给 `write`，并带上 `samples`。全空时抛错。
  - **`answerDaily`：** 存 `answers`，更新 `script` / `prediction`。`answered` 的判定：`answers` 至少一项非空。
  - **采用：** 有问题时写一条对话消息，分两节：「你答过的材料：问/答…」「还没答的问题：…」。
  - **UI：** 「实测清单」区块改为「要问你的（N 个）」，按钮改为「按我的话写」，卡片角标显示「参考稿」或「按你的话写的」。
- [ ] **Step 4: 测试、提交** — `feat(topics): 每日选题先问材料(问题+按我的话写), 实测清单并入问题`。

---

### Task 6: 润色入口

**Files:**
- 新建：`src/components/project/polish-panel.tsx`、`src/components/topics/own-script.tsx`
- 修改：`src/app/api/projects/route.ts`、`src/app/api/projects/[id]/route.ts`、`src/components/project/script-pane.tsx`、`src/components/project/project-workspace.tsx`（把替换回调传给 ScriptPane）、`src/components/topics/topics-view.tsx`
- 测试：`tests/app/projects-route.test.ts`（或现有路由测试文件，追加）、`tests/components/project/polish-panel.test.tsx`、`tests/components/topics/own-script.test.tsx`、`tests/components/script-pane.test.tsx`（追加）

**Interfaces:**
- Consumes：Task 4 的 `/api/scripts/polish`、`splitOriginal`；Task 2 的 `addSample`
- Produces:
  - `POST /api/projects { title?, script?, targetSec?, voiceSampleText? }`：带 `script` 时建项目并写入脚本；带 `voiceSampleText` 时存为样本（`own_script`）；之后跑一次稿子预测（失败不影响）。
  - `PATCH /api/projects/[id] { replaceScript: Script }`：仅 `stage === 'draft'` 允许，否则 409「已定稿的稿子不能直接替换：先在编导对话里说要改」。
  - `PolishPanel({ result, onUse, onKeep })`：显示 6 段、改动清单、需确认处、`added` 标黄。

- [ ] **Step 1: 写失败测试**
  - **路由：**
    - `creates a project with a given script and saves the original as a sample`。
    - `refuses to replace the script after it is finalized`。
    - `replaces a draft script`。
  - **PolishPanel：** 列出改动（每条「删：…」等）、问题、新加片段提示；「用润色版」与「保留原文」回调。
  - **OwnScript：**
    - 贴原文 → 点「润色」→ POST `/api/scripts/polish`。
    - 「用润色版建作品」→ POST `/api/projects`（带 `script`、`voiceSampleText` = 原文），跳转作品页。
    - 「用原文建作品」→ 带 `splitOriginal` 结果，同样存样本。
  - **ScriptPane：**
    - draft 阶段有「润色」按钮 → 调 polish → 面板「用润色版」→ 调 `onReplace(script)`。
    - 定稿后按钮不显示。
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
  - 两处共用 `PolishPanel`。
  - **`own-script.tsx`：** 折叠卡「我自己写了一篇」，含标题、正文、目标时长（默认 75）。挂在选题页「今日选题」上方。
  - **`script-pane.tsx`：** 把当前稿子拼成全文送去润色，`targetSec` 用项目的。
  - **`project-workspace.tsx`：** `onReplace` → PATCH `replaceScript` → 刷新项目。
- [ ] **Step 4: 测试、提交** — `feat(script): 润色入口(选题页「我自己写了一篇」、脚本步「润色」)`。

---

### Task 7: 文档与真机验收

- [ ] **README：** 补「说话样本」「我自己写了一篇 / 润色」「每日选题先问材料」，默认 75 秒。
- [ ] **真机（会用模型额度）：**
  1. 重启网页服务（schema 改过）：`launchctl kickstart -k gui/$(id -u)/com.mediapilot.dev`。
  2. 设置页「说话样本」加入用户 2026-10-09 的《Vibe Coding 两年半，我踩过的坑》原文。
  3. 选题页「我自己写了一篇」贴同一篇 → 润色 → 对比 2026-10-09 手工润色版（改动清单、需确认处应含 hermes 与时间线）。
  4. 今天两个选题各答两三句 → 「按我的话写」→ 与原参考稿对比。
  5. 结果给用户评判，实测写入 spec 末尾。
- [ ] **收尾提交：** 全量测试 + 类型检查后提交 `docs: README 补文案改进, spec 记录实测`。
