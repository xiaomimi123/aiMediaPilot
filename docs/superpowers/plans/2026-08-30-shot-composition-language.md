# 画面语言层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把无人出镜成片的画面从「幻灯片」变成「有框架的信息画面」——拆掉三处主动封顶的提示词、补上一层常驻框架、把幻灯片语汇的版面骨架换成三种构图契约、加一道能查出元素遮挡的体检。

**Architecture:** 三处改动分居三层且互不依赖：提示词层（删封顶 + 换骨架）、渲染层（常驻框架统一注入，不交给模型自觉）、体检层（遮挡关读 DOM 真实几何）。任何一个任务单独合入都能出片。

**Tech Stack:** TypeScript · DeepSeek(Builder/Director prompt) · Playwright 无头 Chromium · GSAP · ffmpeg · vitest

**Spec:** `docs/superpowers/specs/2026-08-30-shot-composition-language-design.md`（执行者必须先读，尤其 §1.3 两个否定结果与 §1.6 三条订正——它们解释了为什么本计划**不做**某些看起来显然该做的事）

## Global Constraints

- **范围只有无人出镜两条链**：`ppt-narration`、`illustration-tts`。`talking-head-broll` 不作为目标与验收对象。
- **不加「变化频率」体检维度。** 三种度量都无法把我们和参考片分开（spec §1.3 否定一）。写了也是会通过但没用的指标。
- **不加「内容必须铺满画面」类规则。** 参考片同样留大片空白（spec §1.6 订正二），逼模型填满正是 `frame-detail.ts` 当初防的「大色块刷分」。方向是补框架，不是填内容。
- **不动色调。** 四条参考帧均亮度 213/119/113/105，「亮底深字」不是通例（spec §1.6 订正三）。
- **凡是「每一镜都必须有」的东西，一律在渲染层注入，不写进提示词。** 项目里凡是让模型自觉的规则都被违反过；环境运动层就是因此放在 `shot-renderer.ts` 而非 Builder。
- 测试跑 `npx vitest run <path>`；类型检查 `npx tsc --noEmit`。改 worker 代码后**必须重启 worker**（`worker:dev` 没有 watch，本会话已因此白跑过一轮验证）。
- 提交信息用中文，说清「为什么」，结尾带 `Co-Authored-By` 与 `Claude-Session` 两行。

## File Structure

| 文件 | 职责 | 变化 |
| --- | --- | --- |
| `src/lib/video-production/director-prompt.ts` | 导演提示词与 Shot schema | 删掉「构图从简」那条规则 |
| `src/lib/video-production/builder-prompt.ts` | Builder 提示词 | 删「构图从简」「停在终态」；illustration 那句改成实话 |
| `src/lib/video-production/facts-guard.ts` | 事实护栏 + 版面骨架下发 | layoutBlock 换成三种构图契约；消解与「不许做箭头图」的冲突 |
| `src/lib/video-production/shot-chrome.ts` | **新建**。常驻框架层：章节标签 / 镜头编号 / 预览字幕 / 背景纹理 | 新增 |
| `src/lib/video-production/shot-renderer.ts` | 渲染与体检 | 注入 shot-chrome；几何采集补文本遮挡 |
| `src/lib/video-production/frame-overlap.ts` | **新建**。遮挡判定纯函数 | 新增 |
| `src/jobs/workers/video-production-worker.ts` | 出片编排 | 给 `renderShotToClip` 传 chrome 上下文；接遮挡判定进重试 |

任务 1/2/3/4 互不依赖，可任意顺序；任务 5 依赖前四个。

---

### Task 1: 拆掉三处封顶指令

**Files:**
- Modify: `src/lib/video-production/director-prompt.ts`（规则列表里「第一版要求构图从简」那一条）
- Modify: `src/lib/video-production/builder-prompt.ts`（`styleGuidance` 与「停在有内容的终态」那一条）
- Test: `tests/lib/video-production/prompt-ceiling.test.ts`（新建）

**Interfaces:**
- Consumes: 无
- Produces: 无新导出。`DIRECTOR.buildSystemPrompt` 与 `BUILDER.buildSystemPrompt` 签名不变。

- [ ] **Step 1: 写失败的测试**

新建 `tests/lib/video-production/prompt-ceiling.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { DIRECTOR } from '@/lib/video-production/director-prompt';
import { BUILDER } from '@/lib/video-production/builder-prompt';

/*
 * 这三句是画面质量的天花板, 而且是**主动写下的**取舍(「第一版构图从简」),
 * 写下之后没人回来改过。实测确认: 现有版面骨架下发了、模型也照做了, 产出仍然是
 * 幻灯片 —— 因为提示词要的就是幻灯片。锁住它们不许回来。
 */

describe('提示词不许再给画面封顶', () => {
  it('导演提示词里没有「构图从简」', () => {
    const p = DIRECTOR.buildSystemPrompt();
    expect(p).not.toContain('构图从简');
    expect(p).not.toContain('不追求视觉丰富度');
  });

  it('Builder 提示词里没有「构图从简」, 也不要求「不需要复杂运镜」', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60']);
    expect(p).not.toContain('构图从简');
    expect(p).not.toContain('不需要复杂运镜');
  });

  it('Builder 不再要求「停在有内容的终态」—— 那句明说进场做完就停', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60']);
    expect(p).not.toContain('停在有内容的终态');
    // 但「不许空屏」这条硬约束要留着 —— 它防的是另一件事
    expect(p).toContain('不许出现整屏纯色');
  });

  it('illustration 风格不再承诺做不到的手绘效果', () => {
    const p = BUILDER.buildSystemPrompt(['#111', '#eee', '#f60'], 'illustration');
    // 我们产出的是 HTML, 画不出手绘角色与物件(spec §1.6 订正一)
    expect(p).not.toContain('手绘感');
    expect(p).toContain('扁平');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/prompt-ceiling.test.ts`
Expected: FAIL —— 四条都失败（三句封顶指令都还在，illustration 那句写着「手绘感矢量插画构图」）

- [ ] **Step 3: 改导演提示词**

在 `src/lib/video-production/director-prompt.ts` 的规则列表里，把这一整条：

```
- 第一版要求构图从简：优先保证时长覆盖完整、字幕/文字清晰可读，不追求视觉丰富度和复杂运镜——用简单的文字卡片+基础过渡即可，不要设计复杂的隐喻或多层构图。
```

替换成：

```
- 每个镜头的 visualJob 要能对应一种**构图意图**，而不只是"展示这句话"：prove(摆证据)/compare(两组对照)/clarify(用体量说明)/reveal(揭示转折)。构图契约由画面层按 visualJob 选，你只需要把意图写准。
```

- [ ] **Step 4: 改 Builder 提示词**

在 `src/lib/video-production/builder-prompt.ts` 里做两处替换。

其一，`styleGuidance` 整个换掉：

```ts
    const styleGuidance = visualStyle === 'illustration'
      // 我们产出的是 HTML/CSS/GSAP, **画不出手绘角色与物件**。原来那句承诺
      // 「手绘感矢量插画构图」是做不到的(spec §1.6 订正一), 改成实话: 扁平几何。
      ? '扁平几何风格：纯色块、圆角矩形、线条与简单图标构成画面，不要试图画写实或手绘的人物与物件——HTML 做不到，硬做出来的效果比不画更差。'
      : '信息画面风格：用区块、层次与对照组织信息，而不是把一句话放大居中。';
```

其二，删掉这一条硬约束的后半句：

```
- 镜头的任何时刻都必须有可读内容：不许出现整屏纯色、没有任何文字或图形的空屏时间段；动画结束后画面要停在有内容的终态，而不是淡出成空白。
```

改成：

```
- 镜头的任何时刻都必须有可读内容：不许出现整屏纯色、没有任何文字或图形的空屏时间段。
```

**为什么只删后半句**：前半句防的是空屏（真实事故：一个 23 秒纯空白镜头进了成片），必须留；后半句「停在终态」明说进场做完就停，是画面变死的源头之一。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/prompt-ceiling.test.ts`
Expected: PASS（4 条）

- [ ] **Step 6: 跑既有提示词测试, 确认没打碎别的断言**

Run: `npx vitest run tests/lib/video-production/`
Expected: 全绿。若有旧测试断言了被删的句子，说明那条测试锁的是这次要改掉的行为——把断言改成新句子，并在测试里写一句为什么改。

- [ ] **Step 7: 提交**

```bash
git add src/lib/video-production/director-prompt.ts src/lib/video-production/builder-prompt.ts tests/lib/video-production/prompt-ceiling.test.ts
git commit -m "fix(video): 拆掉三处主动给画面封顶的提示词"
```

---

### Task 2: 常驻框架层

画面上始终在场、不随内容变的四件构件。**由渲染层统一注入**，不写进提示词。

**Files:**
- Create: `src/lib/video-production/shot-chrome.ts`
- Modify: `src/lib/video-production/shot-renderer.ts`（`RenderShotOpts` 加 `chrome`；`renderShotToClip` 里注入）
- Modify: `src/jobs/workers/video-production-worker.ts`（三条链的 `renderShotToClip` 调用点传 chrome）
- Test: `tests/lib/video-production/shot-chrome.test.ts`（新建）

**Interfaces:**
- Consumes: `parseSrtCues(srt: string): { startMs: number; endMs: number; text: string }[]`（`@/lib/video/timeline`）；`ACT_LABELS: Record<ActKey, string>`（`@/lib/script/six-act`）
- Produces:
  - `export const CHROME_MARKER = '__mp_chrome__'`
  - `export interface ChromeOpts { width: number; height: number; actLabel: string | null; shotNo: number; shotTotal: number; cues: { startMs: number; endMs: number; text: string }[]; shotStartMs: number }`
  - `export function buildShotChrome(opts: ChromeOpts): string`（返回一段自包含 JS，追加在时间线之后）
  - `export function hasShotChrome(html: string): boolean`

- [ ] **Step 1: 写失败的测试**

新建 `tests/lib/video-production/shot-chrome.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { buildShotChrome, hasShotChrome, CHROME_MARKER } from '@/lib/video-production/shot-chrome';

/*
 * 常驻框架层的动因是拆参考片拆出来的(spec §1.6 订正二)。
 *
 * 680 第 180 秒: 一张卡在左、右边三分之二全空 —— 和我们被批评「卡片龟缩左上」的
 * 构图一模一样。它不难看, 是因为画面上有一套始终在场的框架: 系列号 / 章节标签 /
 * 卡片编号 / 底部字幕 / 背景纹理。**我们的空是真空**, 这五样一个都没有。
 *
 * 所以要补的是框架, 不是内容 —— 逼模型把画面填满是反方向, 那正是 frame-detail.ts
 * 当初防的「大色块刷分」。
 */

const base = {
  width: 1920, height: 1080,
  actLabel: '概念A', shotNo: 3, shotTotal: 8,
  shotStartMs: 10000,
  cues: [
    { startMs: 9000, endMs: 10500, text: '上一镜的尾巴' },
    { startMs: 10500, endMs: 13000, text: '这一镜的第一句' },
    { startMs: 13000, endMs: 16000, text: '这一镜的第二句' },
  ],
};

describe('buildShotChrome', () => {
  const js = buildShotChrome(base);

  it('带标记, 好让校验知道这一镜挂没挂上', () => {
    expect(js).toContain(CHROME_MARKER);
    expect(hasShotChrome(`<html><script>${CHROME_MARKER}</script></html>`)).toBe(true);
    expect(hasShotChrome('<html></html>')).toBe(false);
  });

  it('章节标签、镜头编号都在', () => {
    expect(js).toContain('概念A');
    expect(js).toContain('3 / 8');
  });

  it('字幕按镜头起点转成相对时间 —— 渲染器 seek 的是镜头内的秒数, 不是全片', () => {
    // 10500ms 的那句, 相对这一镜(起点 10000ms)是 0.5 秒
    expect(js).toContain('0.5');
    // 上一镜的尾巴(9000ms 起)不该出现在这一镜里
    expect(js).not.toContain('上一镜的尾巴');
    expect(js).toContain('这一镜的第一句');
  });

  it('挂在同一条 shot 时间线上 —— 渲染器靠 seek 这条线截图', () => {
    expect(js).toContain("__timelines");
    expect(js).toContain("'shot'");
  });

  it('没有六幕信息时不画章节标签, 而不是画一个空标签', () => {
    const js2 = buildShotChrome({ ...base, actLabel: null });
    expect(js2).toContain('3 / 8');   // 编号照旧
    expect(js2).not.toMatch(/chapter-label/);
  });

  it('框架层不许挡住内容 —— 全部 pointer-events:none 且贴边', () => {
    expect(js).toContain('pointer-events:none');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/shot-chrome.test.ts`
Expected: FAIL —— `Cannot find module '@/lib/video-production/shot-chrome'`

- [ ] **Step 3: 写 shot-chrome.ts**

新建 `src/lib/video-production/shot-chrome.ts`：

```ts
/**
 * 常驻框架层(二十四期)——画面上始终在场、不随内容变的四件构件。
 *
 * **动因是拆参考片拆出来的, 而且它推翻了我们对自己画面的批评。**
 *
 * 我们的成片被指「卡片龟缩左上, 右下三分之二全空」。但参考片 680 第 180 秒是同样的
 * 构图: 一张卡在左, 右边三分之二全空。它不难看, 区别在于画面上有一套始终在场的框架:
 * 左上系列号 `XILO · S040`、顶部章节标签「分析结果」、卡片编号 `01`、底部字幕、
 * 背景细网格纹理。
 *
 * **我们的空是真空** —— 这几样一个都没有, 预览阶段连字幕都没有(字幕是最后才用 ffmpeg
 * 烧的, 所以预览里的画面永远缺一块)。
 *
 * 所以正确的方向是**补框架, 不是填内容**。逼模型把画面填满是反方向, 那正是
 * `frame-detail.ts` 当初防的「大色块刷分」: 占比够了, 但那块面积里是空的。
 *
 * 放在渲染这一步而不是让 Builder 自己写: 它是每一镜都必须有的东西, 交给模型就会
 * 时有时无 —— 这个项目里凡是「让模型自觉」的规则都被违反过(环境运动层同理)。
 */

export const CHROME_MARKER = '__mp_chrome__';

export interface ChromeOpts {
  width: number;
  height: number;
  /** 这一镜属于六幕里的哪一幕。取不到(老任务/非六幕稿)就不画, 不画空标签。 */
  actLabel: string | null;
  /** 第几镜, 从 1 起。 */
  shotNo: number;
  shotTotal: number;
  /** 全片字幕。函数内部按 shotStartMs 裁到这一镜并转成相对时间。 */
  cues: { startMs: number; endMs: number; text: string }[];
  /** 这一镜在全片里的起点(毫秒)。 */
  shotStartMs: number;
}

/** 这份 HTML 挂过常驻框架了吗。 */
export function hasShotChrome(html: string): boolean {
  return html.includes(CHROME_MARKER);
}

export function buildShotChrome(opts: ChromeOpts): string {
  const { width, height } = opts;
  const short = Math.min(width, height);
  // 字号按短边取, 竖屏横屏一套代码
  const labelPx = Math.round(short * 0.022);
  const capPx = Math.round(short * 0.042);
  const pad = Math.round(short * 0.035);

  /*
   * 字幕转成**相对这一镜**的秒数: 渲染器 seek 的是镜头内的时间线, 不是全片时间轴。
   * 只保留与这一镜有交叠的那几句, 上一镜的尾巴不该出现在这一镜里。
   */
  const local = opts.cues
    .filter((c) => c.endMs > opts.shotStartMs)
    .map((c) => ({
      from: Math.max(0, (c.startMs - opts.shotStartMs) / 1000),
      to: (c.endMs - opts.shotStartMs) / 1000,
      text: c.text,
    }))
    .filter((c) => c.to > 0);

  const chapter = opts.actLabel
    ? `
  var chapter = document.createElement('div');
  chapter.className = 'chapter-label';
  chapter.textContent = ${JSON.stringify(opts.actLabel)};
  chapter.style.cssText = 'position:fixed;left:${pad}px;top:${pad}px;pointer-events:none;z-index:9990;' +
    'font-size:${labelPx}px;letter-spacing:0.15em;opacity:0.45;';
  document.body.appendChild(chapter);`
    : '';

  return `
/* ${CHROME_MARKER}: 常驻框架层 —— 章节 / 编号 / 字幕 / 纹理, 每一镜都有 */
(function () {
  var tl = window.__timelines && window.__timelines['shot'];
  if (!tl) return;

  /* 背景纹理: 极淡网格。铺在最底层, 让"空"变成"留白"而不是"真空"。 */
  var grid = document.createElement('div');
  grid.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:0;opacity:0.5;' +
    'background-image:linear-gradient(currentColor 1px, transparent 1px),' +
    'linear-gradient(90deg, currentColor 1px, transparent 1px);' +
    'background-size:${Math.round(short * 0.06)}px ${Math.round(short * 0.06)}px;' +
    'color:rgba(128,128,128,0.10);';
  document.body.insertBefore(grid, document.body.firstChild);
${chapter}

  /* 镜头编号 */
  var no = document.createElement('div');
  no.textContent = '${opts.shotNo} / ${opts.shotTotal}';
  no.style.cssText = 'position:fixed;right:${pad}px;top:${pad}px;pointer-events:none;z-index:9990;' +
    'font-size:${labelPx}px;letter-spacing:0.1em;opacity:0.35;font-variant-numeric:tabular-nums;';
  document.body.appendChild(no);

  /* 预览字幕。**预览阶段就要有** —— 现在字幕是最后用 ffmpeg 烧的, 所以预览里的
     画面永远缺底部这一块, 看起来比成片更空。这里画的只是预览用的近似, 正式字幕
     仍由 ass-captions 烧, 两者不冲突(成片走的是 master 档, 这一层同样在)。 */
  var cap = document.createElement('div');
  cap.style.cssText = 'position:fixed;left:6%;right:6%;bottom:${Math.round(height * 0.08)}px;' +
    'pointer-events:none;z-index:9991;text-align:center;font-size:${capPx}px;font-weight:700;' +
    'line-height:1.3;text-shadow:0 2px 8px rgba(0,0,0,0.35);';
  document.body.appendChild(cap);

  var CUES = ${JSON.stringify(local)};
  // 挂在同一条时间线上: 渲染器靠 seek 这条线逐帧截图, 挂在别处的东西截图时不动
  CUES.forEach(function (c) {
    tl.call(function () { cap.textContent = c.text; }, null, c.from);
    tl.call(function () { if (cap.textContent === c.text) cap.textContent = ''; }, null, c.to);
  });
})();
`.trim();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/shot-chrome.test.ts`
Expected: PASS（6 条）

- [ ] **Step 5: 接进渲染器**

在 `src/lib/video-production/shot-renderer.ts` 的 `RenderShotOpts` 里加一个字段（放在 `ambient` 之后）：

```ts
  /**
   * 常驻框架层的上下文。不给就不挂 —— 老任务与单元测试零迁移。
   * 见 shot-chrome.ts: 它补的是「我们的空是真空」这个问题。
   */
  chrome?: import('./shot-chrome').ChromeOpts;
```

在 `renderShotToClip` 里，紧接现有的环境运动层注入之后，再注入一次：

```ts
  const withChrome = opts.chrome
    ? injectBeforeBodyEnd(withAmbient, buildShotChrome(opts.chrome))
    : withAmbient;
```

并把后续写盘的 `withAmbient` 改成 `withChrome`。顶部补 import：

```ts
import { buildShotChrome } from '@/lib/video-production/shot-chrome';
```

**顺序很重要**：框架层要在环境运动层**之后**注入。环境层会把 body 的既有子节点搬进一个 `stage` 容器再缩放；框架层的元素必须留在 `stage` 外面，否则章节标签和字幕会跟着相机漂移。

- [ ] **Step 6: worker 三个调用点传 chrome**

在 `src/jobs/workers/video-production-worker.ts` 顶部加：

```ts
import { parseSrtCues } from '@/lib/video/timeline';
import { ACT_LABELS, type ActKey } from '@/lib/script/six-act';
```

在每个 `for (const shot of ...)` 渲染循环之前，先算一次全片字幕与六幕边界：

```ts
    // 常驻框架层要的三样: 全片字幕、六幕边界、总镜数。都是现成数据, 只是从没上过画面。
    const chromeCues = parseSrtCues(vp.srt);
    const chromeActs = (vp.alignedActs as { act?: string; startMs?: number; endMs?: number }[] | null) ?? [];
    const shotTotal = direction.shots.length;
```

在每个 `renderShotToClip({ ... })` 调用里补一个参数：

```ts
        chrome: {
          width: shotFrame.width,
          height: shotFrame.height,
          // 这一镜落在哪一幕里 —— 取不到就不画标签, 不画空标签
          actLabel: (() => {
            const hit = chromeActs.find(
              (a) => typeof a.startMs === 'number' && typeof a.endMs === 'number' &&
                shot.startMs >= a.startMs && shot.startMs < a.endMs,
            );
            return hit?.act ? (ACT_LABELS[hit.act as ActKey] ?? null) : null;
          })(),
          shotNo: shotIndex + 1,
          shotTotal,
          cues: chromeCues,
          shotStartMs: shot.startMs,
        },
```

`shotFrame` 在各分支里的变量名不同（有的叫 `frame`），按该分支实际使用的画幅变量填；**必须是渲染视口那一个**，填错了框架层会按错的画幅算字号（真机踩过：写死 1920x1080 让竖屏 B-roll 只占 32% 高度）。

- [ ] **Step 7: 类型检查 + 全量**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 均通过

- [ ] **Step 8: 真机验一镜**

复用一条已有成片的 `source.html` 渲一镜，确认框架层真的出现在画面上：

```bash
npx tsx -e "
import { renderShotToClip } from '@/lib/video-production/shot-renderer';
import fs from 'fs/promises';
(async () => {
  const html = await fs.readFile('video-productions/ddbd3156-57b/shots/4/source.html', 'utf-8');
  await fs.mkdir('/tmp/chrome-probe', { recursive: true });
  await renderShotToClip({
    html, durationMs: 6000, fps: 15, workDir: '/tmp/chrome-probe',
    outputClipPath: '/tmp/chrome-probe/clip.mp4', frame: { width: 1920, height: 1080 },
    chrome: { width: 1920, height: 1080, actLabel: '概念A', shotNo: 3, shotTotal: 8,
      shotStartMs: 0, cues: [{ startMs: 0, endMs: 6000, text: '这是预览字幕' }] },
  });
  console.log('ok');
})();
"
ffmpeg -y -v error -ss 3 -i /tmp/chrome-probe/clip.mp4 -frames:v 1 /tmp/chrome-probe/f.png
```

打开 `/tmp/chrome-probe/f.png` 肉眼确认四样都在：左上「概念A」、右上「3 / 8」、底部「这是预览字幕」、极淡网格。**任何一样没出现就不要往下走** —— 注入顺序错了的典型症状是标签跟着画面一起缩放或整个不见。

- [ ] **Step 9: 提交**

```bash
git add src/lib/video-production/shot-chrome.ts src/lib/video-production/shot-renderer.ts src/jobs/workers/video-production-worker.ts tests/lib/video-production/shot-chrome.test.ts
git commit -m "feat(video): 常驻框架层 —— 参考片同样留白, 区别是有框架撑着"
```

---

### Task 3: 三种构图契约替换幻灯片骨架

**Files:**
- Modify: `src/lib/video-production/facts-guard.ts`（`layoutBlock` 整段）
- Test: `tests/lib/video-production/facts-guard.test.ts`（已有则追加，没有则新建）

**Interfaces:**
- Consumes: 无
- Produces: `buildFactsSection(acts, brief?)` 签名不变，只改它产出的文本。

- [ ] **Step 1: 写失败的测试**

追加到 `tests/lib/video-production/facts-guard.test.ts`（文件不存在则新建，import 照下面写）：

```ts
import { describe, it, expect } from 'vitest';
import { buildFactsSection } from '@/lib/video-production/facts-guard';
import type { ScriptAct } from '@/lib/script/six-act';

const actsWith = (n: number): ScriptAct[] => ([{
  act: 'hook', narration: '台词', beats: [],
  facts: Array.from({ length: n }, (_, i) => ({
    claim: `事实${i}`, value: `${i}00元`, source: '来源', confidence: 'high' as const,
  })),
} as unknown as ScriptAct]);

describe('版面骨架换成构图契约', () => {
  it('不再用幻灯片语汇 —— 「圆角浅色卡 + 小标题 + 要点行」本来就是 PPT 的构件', () => {
    const s = buildFactsSection(actsWith(3));
    expect(s).not.toContain('圆角浅色卡');
    expect(s).not.toContain('带图标的要点');
  });

  it('给出三种构图契约, 并说清各自用在什么时候', () => {
    const s = buildFactsSection(actsWith(3));
    for (const k of ['evidence', 'relation', 'volume']) expect(s).toContain(k);
    expect(s).toContain('连接符');
  });

  it('料不够时不给构图契约 —— 没素材还压密度, 模型只会靠编来填满', () => {
    const s = buildFactsSection(actsWith(1));
    expect(s).not.toContain('evidence');
  });

  it('relation 的连接符与事实纪律不冲突: 只许画 claim 本身的逻辑关系', () => {
    const s = buildFactsSection(actsWith(3));
    // 事实纪律那条「不许做箭头图」是防**从数据里编因果**, 不是禁止一切连接符
    expect(s).toContain('镜头 claim 本身');
  });

  it('事实纪律照旧保留 —— 换构图不等于放开编数字', () => {
    const s = buildFactsSection(actsWith(3));
    expect(s).toContain('画面事实纪律');
    expect(s).toContain('清单之外的任何数字');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/facts-guard.test.ts`
Expected: FAIL —— 前四条失败（现在给的是幻灯片语汇，没有三种契约）

- [ ] **Step 3: 换掉 layoutBlock**

在 `src/lib/video-production/facts-guard.ts` 里，把 `layoutBlock` 的整个模板字符串换成：

```ts
  // 构图契约只在**真有料可铺**时给 —— 没素材还压构图, 模型只会靠编来填满画面,
  // 那正是事实护栏要防的事。两者必须联动, 不能各说各话。(这条判断沿用上一版)
  const layoutBlock = entries.length >= 2
    ? `

构图契约(按这一镜的 visualJob 选一种, 不要每镜都用居中大字):
- **evidence**(对应 prove): 把一份真材料放成画面主体(占一半以上面积), 文字退成压在旁边的注解。没有第二个信息区。
- **relation**(对应 compare / reveal): 左区 + 中间连接符 + 右区。**连接符不能省** —— 它才是把两组东西连成一个论断的东西; 少了它就只是两张卡并排摆着。连接符画的是**镜头 claim 本身**说的那层关系(A 变成 B、A 对比 B), 不是从上面事实清单里推出来的因果, 后者仍然被下面的事实纪律禁止。
- **volume**(对应 clarify): 一份真实条目清单铺成一到两栏, 条目数不少于 8 条。**允许密** —— 密本身就是内容, 用体量说明"有多少"。

三种都不合适时就用单区块, 但**不要把一句话放大居中当作构图** —— 画面的框架(章节、编号、字幕、底纹)由渲染层统一提供, 你不需要也不应该自己画这些, 空的地方留空即可。`
    : '';
```

**这里消解了一处冲突**：本文件下面的事实纪律写着「素材里没有明确因果关系的，不许做成箭头图/流程图/因果链这类断言式图形」。`relation` 要求连接符，两者字面上打架。分界是：连接符渲染的是**镜头 claim 自己陈述的关系**（导演写的那句论断），而事实纪律禁止的是**从数据里自行推出因果**。契约文字里必须把这句分界写明，否则模型会二选一地忽略其中一条。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/facts-guard.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/facts-guard.ts tests/lib/video-production/facts-guard.test.ts
git commit -m "fix(video): 版面骨架换成三种构图契约 —— 原来那套写的就是幻灯片"
```

---

### Task 4: 元素遮挡体检

**Files:**
- Create: `src/lib/video-production/frame-overlap.ts`
- Modify: `src/lib/video-production/shot-renderer.ts`（`ShotGeometry` 加 `occluded`；`page.evaluate` 里采集）
- Modify: `src/jobs/workers/video-production-worker.ts`（判定接进重试）
- Test: `tests/lib/video-production/frame-overlap.test.ts`（新建）

**Interfaces:**
- Consumes: `ShotGeometry`（`@/lib/video-production/frame-layout`）
- Produces:
  - `export interface OccludedText { coverRatio: number; text: string }`
  - `export function judgeOverlap(samples: { occluded: OccludedText[] }[]): { ok: boolean; reason?: string }`
  - `export const MAX_COVER_RATIO = 0.15`

- [ ] **Step 1: 写失败的测试**

新建 `tests/lib/video-production/frame-overlap.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { judgeOverlap, MAX_COVER_RATIO } from '@/lib/video-production/frame-overlap';

/*
 * 真实缺陷: 我们成片第 20 秒, 顶部标题「差距不在技术，在提问」被两张卡片压住,
 * 「差距」二字完全被盖掉。现有五道体检关(空屏/空壳/版面/裁字/静止)**没有一道
 * 查元素互相遮挡**, 所以它一路进了成片。
 */

describe('judgeOverlap', () => {
  it('没有遮挡 → 过', () => {
    expect(judgeOverlap([{ occluded: [] }, { occluded: [] }]).ok).toBe(true);
  });

  it('单帧偶发的轻微遮挡 → 过(阈值以下)', () => {
    expect(judgeOverlap([{ occluded: [{ coverRatio: 0.05, text: '轻微' }] }]).ok).toBe(true);
  });

  it('文字被盖住超过阈值 → 拦, 并说出被盖的是哪句', () => {
    const r = judgeOverlap([{ occluded: [{ coverRatio: 0.62, text: '差距不在技术，在提问' }] }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('差距不在技术');
    expect(r.reason).toContain('62%');
  });

  it('阈值本身留在导出常量上, 不写魔法数字', () => {
    expect(MAX_COVER_RATIO).toBe(0.15);
    expect(judgeOverlap([{ occluded: [{ coverRatio: MAX_COVER_RATIO, text: '正好卡线' }] }]).ok).toBe(true);
  });

  it('没有取样帧 → 过, 不是"因为量不到所以判不合格"', () => {
    expect(judgeOverlap([]).ok).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/frame-overlap.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写 frame-overlap.ts**

```ts
/**
 * 元素遮挡检查(二十四期)。
 *
 * 补的是体检里缺的一维: **元素之间的关系**。
 *
 * 现有五道关 —— 空屏、空壳色块、版面、文字被裁、整片静止 —— 每一道看的都是
 * 「某个元素自己怎么样」, 没有一道看「两个元素撞没撞上」。真实缺陷: 成片第 20 秒
 * 顶部标题「差距不在技术，在提问」被两张卡片压住, 「差距」二字完全被盖掉, 一路进了成片。
 *
 * 判据读 DOM 真实几何(矩形相交), 不从像素猜 —— 从像素猜文字有没有被盖是个死胡同,
 * 这个项目在并排检测上已经绕过两圈才回到读 DOM(见 frame-layout.ts)。
 */

export interface OccludedText {
  /** 这段文字被其它不透明元素盖住的面积比例 0~1。 */
  coverRatio: number;
  /** 被盖住的文字, 报告里要说出来 —— 只说"有遮挡"没法定位。 */
  text: string;
}

/**
 * 盖住多少算不合格。
 *
 * 15% 偏宽松是故意的: 这一维刚接上, 先让它**能报出来**。密度阈值当初就是因为第一次
 * 标定太紧, 反复返工了三轮; 收紧要等有了真实分布再说。
 */
export const MAX_COVER_RATIO = 0.15;

export function judgeOverlap(
  samples: { occluded: OccludedText[] }[],
): { ok: boolean; reason?: string } {
  const worst = samples
    .flatMap((s) => s.occluded)
    .filter((o) => o.coverRatio > MAX_COVER_RATIO)
    .sort((a, b) => b.coverRatio - a.coverRatio)[0];

  if (!worst) return { ok: true };
  return {
    ok: false,
    reason:
      `有文字被其它元素盖住: 「${worst.text.slice(0, 20)}」被覆盖 ` +
      `${Math.round(worst.coverRatio * 100)}%。把它挪开或调整层级, 不要让文字压在卡片下面。`,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/frame-overlap.test.ts`
Expected: PASS（5 条）

- [ ] **Step 5: 在浏览器里采集遮挡**

在 `src/lib/video-production/frame-layout.ts` 的 `ShotGeometry` 接口里加一个字段：

```ts
  /** 被其它元素盖住的文字(二十四期)。见 frame-overlap.ts。 */
  occluded?: { coverRatio: number; text: string }[];
```

在 `src/lib/video-production/shot-renderer.ts` 的 `page.evaluate` 几何采集块里，`return { sideBySide, sidePair, clipped }` 之前插入：

```ts
        /*
         * 文字被别的元素盖住。真实缺陷: 顶部标题被两张卡片压住, 「差距」二字全没了。
         * 只看**叶子文本节点**: 容器天然包着子元素, 拿容器比会满屏假阳性。
         * 判"盖住"用 z-index 与文档顺序都不可靠(层叠上下文规则复杂), 改用一个更笨
         * 但可靠的判据: 对方是不透明背景块, 且矩形相交。
         */
        const occluded: { coverRatio: number; text: string }[] = [];
        const texts = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false;
          if (el.children.length > 0) return false;            // 只要叶子
          return (el.textContent ?? '').trim().length > 0;
        });
        const solids = Array.from(document.querySelectorAll('body *')).filter((el) => {
          const st = window.getComputedStyle(el);
          if (st.display === 'none' || Number(st.opacity) < 0.5) return false;
          const bg = st.backgroundColor;
          if (!bg || bg === 'transparent' || bg.endsWith(', 0)')) return false;
          const r = el.getBoundingClientRect();
          return r.width * r.height > 0;
        });
        for (const t of texts) {
          const a = t.getBoundingClientRect();
          const areaA = a.width * a.height;
          if (areaA <= 0) continue;
          let covered = 0;
          for (const s of solids) {
            if (s === t || s.contains(t) || t.contains(s)) continue;
            const b = s.getBoundingClientRect();
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w > 0 && h > 0) covered = Math.max(covered, (w * h) / areaA);
          }
          if (covered > 0.02) {
            occluded.push({ coverRatio: covered, text: (t.textContent ?? '').trim().slice(0, 40) });
          }
        }

```

并把 return 改成 `return { sideBySide: sidePair !== null, sidePair, clipped, occluded };`，同时把 `.catch(() => (...))` 的兜底对象补上 `occluded: []`。

- [ ] **Step 6: 判定接进重试循环**

在 `src/jobs/workers/video-production-worker.ts` 里，`buildShotHtmlWithRetry` 的判定链上，紧跟 `layoutJ` 那一段之后加：

```ts
    // 元素遮挡(二十四期): 前五道关都在看单个元素自己怎么样, 没有一道看两个元素撞没撞上
    const overlapJ = judgeOverlap(
      health.geometry.map((g) => ({ occluded: g.occluded ?? [] })),
    );
    if (!overlapJ.ok) {
      lastReason = overlapJ.reason ?? '有文字被遮挡';
      feedback = `\n\n上一版渲染出来的实际效果不合格: ${lastReason}`;
      console.warn(`[video-production] 镜头 ${shot.shotId} 第 ${attempt} 次有遮挡: ${lastReason}`);
      continue;
    }
```

顶部补 import：

```ts
import { judgeOverlap } from '@/lib/video-production/frame-overlap';
```

**放在 layout 之后、attempts.push 之前**：和其它画面关同一层级，不合格就重写这一镜。

- [ ] **Step 7: 真机验它能报出已知缺陷**

已知 `ddbd3156-57b` 第 4 镜（14 秒那一镜）有标题被卡片压住的问题。用它当样本：

```bash
npx tsx -e "
import { probeShotHealth } from '@/lib/video-production/shot-renderer';
import { judgeOverlap } from '@/lib/video-production/frame-overlap';
import fs from 'fs/promises';
(async () => {
  const html = await fs.readFile('video-productions/ddbd3156-57b/shots/4/source.html', 'utf-8');
  const h = await probeShotHealth({ html, durationMs: 14000, workDir: '/tmp/ov-probe', frame: { width: 1920, height: 1080 } });
  console.log(JSON.stringify(h.geometry.map((g) => g.occluded), null, 1));
  console.log(judgeOverlap(h.geometry.map((g) => ({ occluded: g.occluded ?? [] }))));
})();
"
```

Expected: 至少一帧的 `occluded` 里出现被盖的标题文字，`judgeOverlap` 返回 `ok: false`。
**如果返回 ok:true**，说明采集判据没抓到这个缺陷——不要调低阈值凑，先去看采集到的 `occluded` 数组是空的（判据错）还是 coverRatio 太小（阈值错），两者的修法不同。

- [ ] **Step 8: 全量 + 提交**

```bash
npx tsc --noEmit && npx vitest run
git add src/lib/video-production/frame-overlap.ts src/lib/video-production/frame-layout.ts src/lib/video-production/shot-renderer.ts src/jobs/workers/video-production-worker.ts tests/lib/video-production/frame-overlap.test.ts
git commit -m "feat(video): 元素遮挡体检 —— 补上体检里缺的「元素之间的关系」这一维"
```

---

### Task 5: 真机对照验收

**Files:** 无代码改动（只跑验证与文档）
- Modify: `README.md`（把结论写进画面质量那一节）

- [ ] **Step 1: 重启 worker**

```bash
pkill -f "tsx src/jobs/workers"; sleep 2
npm run worker:dev > /tmp/worker.log 2>&1 &
sleep 15 && grep "Workers started" /tmp/worker.log
```

`worker:dev` 没有 watch，不重启跑的就是旧代码——本会话已经因此白跑过一轮验证。

- [ ] **Step 2: 用同一条稿子重跑一遍出片**

在成片页对 `ddbd3156-57b` 点「开始制作」（它的六幕稿与 SRT 都在，会重跑导演 + Builder）。这会真实消耗 DeepSeek 额度，**动手前跟用户确认一次**。

- [ ] **Step 3: 逐镜对照**

新旧两版各抽同样的时间点抽帧，肉眼逐项核对：

```bash
for t in 8 20 35 45 55; do
  ffmpeg -y -v error -ss $t -i video-productions/ddbd3156-57b/preview.mp4 -frames:v 1 /tmp/new-${t}s.png
done
```

逐项确认：①左上章节标签、右上镜头编号、底部字幕、背景纹理**四样都在**；②不再有文字被卡片压住；③至少有一镜用上了 relation 的连接符或 volume 的多条目清单，而不是清一色的居中大字。

- [ ] **Step 4: 交给用户判断**

把新旧两版一起发给用户，问一句：还像不像 PPT。**这一条不设自动指标** —— spec §1.3 已经证明自造指标会通过但没用，最终由人判断。

- [ ] **Step 5: 把结论写进 README**

在 README 画面质量那一节末尾追加实测结论：四件框架构件是否都上了画面、遮挡关有没有真报出东西、用户的判断是什么。**如果用户仍然说像 PPT，如实写进去**，并把它作为下一轮（叙事化）的起点，不要粉饰。

- [ ] **Step 6: 提交**

```bash
git add README.md
git commit -m "docs(video): 画面语言层的真机对照结论"
```

---

## Self-Review

**1. Spec 覆盖** —— spec §3.2 的骨架三种 → Task 3；常驻框架层 → Task 2；删封顶指令 → Task 1；§3.3 的 A(元素遮挡) → Task 4；§4 验收 → Task 5。**未覆盖且是有意的**：§3.1 素材需求声明层、§3.3 的 B(素材位填充率)、§3.4 重渲粒度 —— 这三项构成第二份计划（素材层），它们依赖 `AssetRequest` 表与 `ContentAsset` 的录入通道，与本计划正交，单独合入各自都能工作。

**2. 占位扫描** —— 无 TBD；每个代码步骤都给了可直接粘贴的完整代码；每个验证步骤都给了可执行命令与期望，并对"期望没达到时怎么办"给了分岔（Task 4 Step 7）。

**3. 类型一致** —— `ChromeOpts` 在 Task 2 定义、Task 2 Step 6 的 worker 调用点逐字段对应；`OccludedText` 在 Task 4 定义，`ShotGeometry.occluded` 的字段名 `coverRatio`/`text` 与之一致；`judgeOverlap` 的入参形状 `{ occluded: OccludedText[] }[]` 与 Step 6 的 `health.geometry.map(...)` 一致。

**4. 已知风险** —— Task 2 的注入顺序（框架层必须在环境运动层之后）是唯一一处顺序敏感的地方，写进了 Step 5 的说明并在 Step 8 给了肉眼验收；Task 4 的遮挡采集用「不透明背景块 + 矩形相交」代替真正的层叠判断，会漏掉半透明遮挡，这是有意的取舍（层叠上下文规则复杂，先要能报出来）。
