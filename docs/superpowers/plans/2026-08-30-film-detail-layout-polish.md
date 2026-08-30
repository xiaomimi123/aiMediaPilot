# 成片详情页排版收尾 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把成片详情页的首屏从「38% 在重复同一句状态」压成「一眼看到画面和它的毛病」，并清掉上一轮重排留下的四处碎问题。

**Architecture:** 三处独立改动，互不依赖，可分别评审：①状态区三块合成一块（页面层）；②预览区让活跃度面板挤进首屏（页面层）；③共用时间线编辑台的三处退化情形（组件层，成片页与模板试做台同时受影响）。

**Tech Stack:** Next.js 14 App Router · React 18 · Tailwind · vitest + @testing-library/react (jsdom) · Chrome 扩展真机测量

**Spec:** 无独立 spec。需求来自 2026-08-30 的真机走查，背景与实测数字见本文档「背景」一节；执行者读这一节即可，不需要回看会话。

---

## 背景（这份计划要修的是什么）

上一轮（commit `26b57b9`）把这一页从 3.17 屏压到 1.98 屏、主操作改成贴底条。走查截图之后暴露出没解决的问题，全部有实测数字：

| # | 问题 | 实测 |
| --- | --- | --- |
| 1 | 首屏被重复的状态表达占满 | 状态区三块共 **293px**，视口 771px = **38%**；四处在说同一件事：页面副标题「这条片子走到哪一步了，以及下一步等谁」/「等你」卡 /卡里「预览好了，等你看过之后确认导出」/ 阶段条高亮「预览就绪」 |
| 2 | 画面活跃度看不见 | 面板顶在 **y=429**，横屏播放器 385 高把它推到折叠线以下；横屏时 685(播放器)+16(gap)+342(面板 min-w-[19rem]) = 1043 > 正文宽 1062 的可用空间，于是换行 |
| 3 | 编辑台右列比画布矮 | 画布 220 高，右列约 130 高 → **约 90px 死空间** |
| 4 | 字幕空轨占位 | 这条片子 `captions.length === 0`，仍渲染「字幕 0」标题 + 一条 20px 空轨 |
| 5 | 短场景块只显示一个字符 | 2.5 秒镜头在 60 秒时间线上占 4%，块宽约 42px，`truncate` 之后只剩「"…」 |
| 6 | 模板试做台没走查 | 上一轮改了共用组件 `timeline-editor.tsx` 的内部排布，试做台要跑完文案→切分→画面三步才显示编辑台，会真实消耗 DeepSeek 额度，因此没验 |

## Global Constraints

从项目既有规则与本页现状抄来，每条任务都隐含这些约束：

- **有 PageShell 的是页面，没有的是区块**（README §5.4 硬规则）。不允许用 `embedded`/`compact`/`standalone` 这类 prop 让一个组件在两种身份间切换；需要那种 prop 时拆成两个组件。**尺寸约束参数（如 `canvasMaxHeightPx`）不算身份开关**，可以加。
- `timeline-editor.tsx` 被 **两个** 页面共用：`src/components/films/film-layout-editor.tsx`（成片详情）与 `src/components/templates/studio.tsx`（模板试做台）。改它必须同时考虑两边。
- **不给 `canvasMaxHeightPx` 时必须保持老行为**（只按宽度约束），否则试做台画布会跟着变小 —— 那里画布放的是 Builder 出的真实 HTML，大才有用。
- 布局数字的验收标准是**真机 DOM 测量**，不是肉眼看截图（项目既有实践：README「用 DOM 量渲染后的页面」）。每个任务末尾都有一条测量步骤，给出期望区间。
- 测试跑 `npx vitest run <path>`；类型检查 `npx tsc --noEmit`。jsdom 里没有 `ResizeObserver`，渲染 `TimelineEditor` 的测试必须先塞 stub（见 `tests/components/timeline-editor.test.tsx` 顶部现有写法）。
- 提交信息用中文，说清「为什么」而不只是「做了什么」，结尾带 `Co-Authored-By` 与 `Claude-Session` 两行（照抄仓库最近几条 commit 的格式）。
- dev server 已在 3000 端口跑着；**本计划不改 prisma schema，不需要重启 worker**。

## File Structure

| 文件 | 职责 | 本计划里的变化 |
| --- | --- | --- |
| `src/app/films/[id]/page.tsx` | 成片详情页壳：取数、探画幅、拼 initial | 去掉与状态卡重复的 `description` |
| `src/components/films/film-detail.tsx` | 详情页正文：状态、预览、编辑台、操作条、发布登记 | 状态区三块合一；预览区改成能容下并排面板 |
| `src/components/films/film-layout-editor.tsx` | 成片语境下的版面编辑（包共用编辑台） | 无改动（画布高度维持 220） |
| `src/components/templates/timeline-editor.tsx` | **共用**时间线编辑台 | 字幕空轨不渲染；窄场景块不渲染标签；提示文字移进右列 |
| `tests/components/film-detail-status.test.tsx` | 新建：状态区结构 | 新增 |
| `tests/components/timeline-editor.test.tsx` | 已有：编辑台结构与尺寸 | 追加三组用例 |

各任务之间没有代码依赖，可以任意顺序执行；建议按 1→2→3→4 做，因为 1、2 都动 `film-detail.tsx`，连着做少一次上下文切换。

---

### Task 1: 状态区三块合成一块

把「页面副标题 + 等你卡 + 阶段条」压成一个卡片：第一行是「等你」徽标 + 那一句话，第二行是阶段条。副标题整句删掉。

**Files:**
- Modify: `src/app/films/[id]/page.tsx`（`<PageShell>` 的 `description` prop）
- Modify: `src/components/films/film-detail.tsx:238-284`（「下一步等谁」卡与 `<ol>` 阶段条两块）
- Test: `tests/components/film-detail-status.test.tsx`（新建）

**Interfaces:**
- Consumes: `stageHint(status)`、`waitingOn(status)`、`stageIndex(status)`、`PRODUCTION_STAGES`，均来自 `@/lib/cockpit/production-stage`（签名不变）
- Produces: 无新导出。`FilmDetail` 的 props 不变。

- [ ] **Step 1: 写失败的测试**

新建 `tests/components/film-detail-status.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

import { FilmDetail } from '@/components/films/film-detail';

const base = {
  id: 'f1', title: '测试片', mode: 'ppt-narration', status: 'preview_ready',
  createdAt: '2026-08-30', errorMessage: null, hasPreview: true, hasMaster: false,
  templateName: '图文口播', scriptDraftId: null, publishedUrl: null,
  scenes: [], captions: [], savedLayouts: {}, brollEnabled: true,
  frame: { width: 1920, height: 1080 }, freezeReport: null,
};

afterEach(cleanup);

describe('成片详情的状态区', () => {
  it('「等你」徽标与阶段条在**同一个卡片**里 —— 拆成两块时它们在说同一件事, 却各占一份边距', () => {
    const { container } = render(<FilmDetail initial={base} />);
    const badge = screen.getByText('等你');
    const card = badge.closest('[data-testid="film-status"]');
    expect(card).not.toBeNull();
    // 阶段条必须在同一张卡里
    expect(card?.textContent).toContain('预览就绪');
    expect(card?.textContent).toContain('构思分镜');
  });

  it('失败时不画阶段条 —— 把失败画成「进行到某一步」是在美化它', () => {
    render(<FilmDetail initial={{ ...base, status: 'failed', errorMessage: '渲染炸了' }} />);
    const card = screen.getByText('失败').closest('[data-testid="film-status"]');
    expect(card?.textContent).toContain('渲染炸了');
    expect(card?.textContent).not.toContain('构思分镜');
  });

  it('状态卡只出现一次 —— 合并的目的就是不再有第二处说同一件事', () => {
    const { container } = render(<FilmDetail initial={base} />);
    expect(container.querySelectorAll('[data-testid="film-status"]').length).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/components/film-detail-status.test.tsx`
Expected: FAIL —— 找不到 `[data-testid="film-status"]`（现在是两个各自独立的块，都没有这个标记）

- [ ] **Step 3: 合并两块**

改 `src/components/films/film-detail.tsx`，把现在的「下一步等谁」卡（`{/* 「下一步等谁」放在最上面 */}` 起）与紧随其后的 `<ol>` 阶段条，换成下面这一块：

```tsx
      {/*
        **状态与进度合成一块。** 拆开时它们在说同一件事却各占一份边距: 实测状态区三块
        (页面副标题 + 等你卡 + 阶段条)共 293px, 而视口 771px —— 38% 的首屏在重复
        「这条片子停在预览就绪、等你确认导出」, 把真正要看的画面和它的毛病推到折叠线以下。
        合并之后徽标、那一句话、阶段条在同一张卡里, 读一次就够。
      */}
      <div
        data-testid="film-status"
        className={cn(
          'mb-6 rounded-md border-l-2 px-4 py-3',
          failed
            ? 'border-destructive/70 bg-destructive/[0.06]'
            : wait === 'you'
              ? 'border-foreground/50 bg-secondary/60'
              : 'border-border bg-card',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {failed ? '失败' : wait === 'you' ? '等你' : wait === 'machine' ? '在跑' : '完成'}
          </p>
          <p className="text-sm leading-relaxed">{stageHint(film.status)}</p>
        </div>

        {film.errorMessage ? (
          <p className="mt-2 whitespace-pre-wrap break-all font-mono text-xs text-destructive">
            {film.errorMessage}
          </p>
        ) : null}

        {/* failed 不画进度 —— 把失败画成"进行到某一步"是在美化它 */}
        {!failed ? (
          <ol className="mt-2 flex flex-wrap gap-x-1 gap-y-1">
            {PRODUCTION_STAGES.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs',
                    i < idx
                      ? 'text-muted-foreground'
                      : i === idx
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground/40',
                  )}
                >
                  {s.label}
                </span>
                {i < PRODUCTION_STAGES.length - 1 ? (
                  <span className="text-xs text-muted-foreground/30">›</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
```

- [ ] **Step 4: 删掉重复的页面副标题**

改 `src/app/films/[id]/page.tsx`，把 `<PageShell>` 上的 `description` 整个删掉（连 prop 一起），并在 `<PageShell` 上方加一行说明：

```tsx
    {/*
      不给 description: 「这条片子走到哪一步了，以及下一步等谁」和下面那张状态卡
      说的是同一件事, 而它占掉首屏 26px + 一份页头边距。状态卡说得更准(它带真实状态)。
    */}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/components/film-detail-status.test.tsx`
Expected: PASS（3 个用例）

- [ ] **Step 6: 真机测量**

浏览器打开 `http://localhost:3000/films/ddbd3156-57b`，在控制台跑：

```js
const shell = document.querySelector('.max-w-5xl');
const st = document.querySelector('[data-testid="film-status"]');
const cs = getComputedStyle(st);
const 状态区占位 = Math.round(st.getBoundingClientRect().height) + parseInt(cs.marginBottom);
const header = shell.querySelector('header');
const hcs = getComputedStyle(header);
console.log({ 状态区占位, 页头占位: Math.round(header.getBoundingClientRect().height) + parseInt(hcs.marginBottom) });
```

Expected: 状态区占位 ≤ **120px**（改前 102+54=156），页头占位 ≤ **115px**（改前 137）。两者相加 ≤ **235px**（改前 293）。

- [ ] **Step 7: 提交**

```bash
git add src/app/films/\[id\]/page.tsx src/components/films/film-detail.tsx tests/components/film-detail-status.test.tsx
git commit -m "fix(films): 状态区三块合一 —— 首屏 38% 在重复同一句话"
```

---

### Task 2: 让画面活跃度挤进首屏

横屏时面板换行到播放器下面（y=429，折叠线以下）。播放器从 50vh 收到 45vh、面板最小宽从 19rem 收到 17rem，两个数一起改才够横屏并排。

**Files:**
- Modify: `src/components/films/film-detail.tsx`（`<video>` 的 `max-h-[50vh]`，以及包住 `<FreezePanel>` 的 `min-w-[19rem]`）
- Test: 无新单测（这是纯尺寸，jsdom 量不出真实布局）；验收靠 Step 3 的真机测量

**Interfaces:**
- Consumes: `film.frame`（已有，`{ width, height }`）
- Produces: 无

- [ ] **Step 1: 收播放器高度**

把 `src/components/films/film-detail.tsx` 里 `<video>` 的 className 中 `max-h-[50vh]` 改成 `max-h-[45vh]`，并把上面那段注释补一句：

```
               * 45vh 是**算出来的**, 不是调出来的: 横屏 1920x1080 在 45vh(=347px, 视口 771)
               * 下宽 617px, 加 16px gap 加面板最低 272px = 905px, 装得进正文宽 1062px ——
               * 于是活跃度面板能贴在播放器右边、留在首屏里。50vh 时播放器 685px 宽,
               * 三者相加 1043px 装不下, 面板就换行掉到折叠线以下(实测 y=429)。
```

- [ ] **Step 2: 收面板最小宽**

同一文件，把包住 `<FreezePanel>` 的 `className="min-w-[19rem] max-w-2xl flex-1"` 改成 `className="min-w-[17rem] max-w-2xl flex-1"`。

- [ ] **Step 3: 真机测量（横屏与竖屏各一条）**

横屏 `http://localhost:3000/films/ddbd3156-57b`：

```js
const v = document.querySelector('video');
const panel = [...document.querySelectorAll('div')].find(e => e.textContent.startsWith('画面活跃度') && e.className.includes('rounded-md'));
const R = e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
console.log({ 播放器: R(v), 面板: R(panel), 面板在右侧: R(panel).x > R(v).x + R(v).w - 10, 面板在首屏: R(panel).y < innerHeight });
```

Expected 横屏：`面板在右侧: true`，`面板在首屏: true`，播放器宽约 617。

竖屏 `http://localhost:3000/films/f125c260-433`：同一段脚本。
Expected 竖屏：`面板在右侧: true`，`面板在首屏: true`，播放器宽约 195。

- [ ] **Step 4: 量整页**

两条片子各跑：

```js
const s = document.querySelector('main');
const approve = [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认导出'));
console.log({ 屏数: +(s.scrollHeight / innerHeight).toFixed(2), 确认导出在视口内: approve.getBoundingClientRect().top < innerHeight, 横向溢出: s.scrollWidth > s.clientWidth });
```

Expected: 屏数 ≤ **1.75**（改前 1.98），`确认导出在视口内: true`，`横向溢出: false`。

- [ ] **Step 5: 提交**

```bash
git add src/components/films/film-detail.tsx
git commit -m "fix(films): 画面活跃度挤进首屏 —— 播放器 45vh + 面板 17rem 才够并排"
```

---

### Task 3: 编辑台三处退化情形

共用组件的三个问题：字幕空轨占位、窄场景块只剩一个字、右列比画布矮 90px。

**Files:**
- Modify: `src/components/templates/timeline-editor.tsx`（字幕轨块、场景块 label、提示文字位置）
- Test: `tests/components/timeline-editor.test.tsx`（追加）

**Interfaces:**
- Consumes: `captions: CaptionCue[]`、`scenes: EditorScene[]`（签名不变）
- Produces: 新增导出 `export const MIN_LABEL_WIDTH_PCT = 6;` —— 场景块窄于时间线宽度的百分之几就不画标签。测试与注释都引用这个常量，不写魔法数字。

- [ ] **Step 1: 写失败的测试**

在 `tests/components/timeline-editor.test.tsx` 末尾追加：

```tsx
describe('TimelineEditor 退化情形', () => {
  it('没有字幕时整条字幕轨不渲染 —— 「字幕 0」加一条空轨是纯占位', () => {
    const { container } = render(
      <TimelineEditor
        scenes={scenes} captions={[]} frame={{ width: 1920, height: 1080 }}
        onLayoutChange={() => {}} onSelect={() => {}} captionStyle={captionStyle}
        canvasMaxHeightPx={220}
      />,
    );
    expect(container.textContent).not.toContain('字幕 0');
  });

  it('有字幕时照常渲染', () => {
    const { container } = render(
      <TimelineEditor
        scenes={scenes}
        captions={[{ startMs: 0, endMs: 1000, text: '第一句' }]}
        frame={{ width: 1920, height: 1080 }}
        onLayoutChange={() => {}} onSelect={() => {}} captionStyle={captionStyle}
        canvasMaxHeightPx={220}
      />,
    );
    expect(container.textContent).toContain('字幕 1');
  });

  it('窄到放不下字的场景块不画标签 —— 截成一个字符比留白更难看, 也更没用', () => {
    // 第一幕 1.5 秒 / 全片 60 秒 = 2.5%, 低于 MIN_LABEL_WIDTH_PCT
    const uneven = [
      { id: 'tiny', startMs: 0, endMs: 1500, label: '很短的一幕', claim: '很短的一幕', layout: 'content-full' as const, previewHtml: '' },
      { id: 'long', startMs: 1500, endMs: 60000, label: '很长的一幕', claim: '很长的一幕', layout: 'content-full' as const, previewHtml: '' },
    ];
    render(
      <TimelineEditor
        scenes={uneven} captions={[]} frame={{ width: 1920, height: 1080 }}
        onLayoutChange={() => {}} onSelect={() => {}} captionStyle={captionStyle}
        canvasMaxHeightPx={220}
      />,
    );
    // 块还在(点得到、有 tooltip), 只是不显示文字
    const tiny = screen.getByTitle(/很短的一幕/);
    expect(tiny.textContent).toBe('');
    const long = screen.getByTitle(/很长的一幕/);
    expect(long.textContent).toBe('很长的一幕');
  });

  it('操作提示跟着控制区走, 不留在时间线下面', () => {
    const { container } = render(
      <TimelineEditor
        scenes={scenes} captions={[]} frame={{ width: 1920, height: 1080 }}
        onLayoutChange={() => {}} onSelect={() => {}} captionStyle={captionStyle}
        canvasMaxHeightPx={220}
      />,
    );
    const canvas = container.querySelector<HTMLElement>('[style*="aspect-ratio"]');
    expect(canvas?.parentElement?.textContent).toContain('按住拖动时间线');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/components/timeline-editor.test.tsx`
Expected: FAIL —— 前 4 条新用例失败（`字幕 0` 仍在、窄块仍有文字、提示不在画布同区）；原有 4 条仍 PASS

- [ ] **Step 3: 字幕空轨条件渲染**

`src/components/templates/timeline-editor.tsx`，把「字幕」标题与轨道那两块（`<p>字幕 {captions.length}</p>` 与紧随的 `<div className="relative h-5">`）整体包进条件：

```tsx
          {/*
            没有字幕就整条不画。**「字幕 0」加一条 20px 空轨是纯占位** —— 图文口播
            这条链本来就没有字幕轨, 每次都给它留一行, 只是在时间线里插一条永远空着的带子。
          */}
          {captions.length > 0 ? (
            <>
              <p className="mb-1 mt-2 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                字幕 {captions.length}
              </p>
              <div className="relative h-5">
                {captionTrack.map((b) => (
                  <div
                    key={b.id}
                    style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                    className="absolute top-0 h-full overflow-hidden truncate rounded-sm bg-foreground/15 px-1 text-[0.6rem] text-muted-foreground"
                    title={b.label}
                  >
                    {b.label}
                  </div>
                ))}
              </div>
            </>
          ) : null}
```

- [ ] **Step 4: 窄场景块不画标签**

同一文件，在组件外层加常量（放在现有 `SHEEN_*` 那类常量附近，文件顶部导出区）：

```tsx
/**
 * 场景块窄于时间线宽度的百分之几就不画标签。
 *
 * 块宽是**按时长等比映射**的, 短镜头必然很窄: 实测一条 60 秒片子里 2.5 秒的镜头
 * 占 4%、约 42px, `truncate` 之后只剩「"…」一个字符 —— 那既读不出内容, 又比留白更脏。
 * 低于这个阈值就只留色块(仍然点得到, tooltip 仍给全文), 让宽块把字讲清楚。
 */
export const MIN_LABEL_WIDTH_PCT = 6;
```

再把场景块的 `{b.label}` 换成：

```tsx
                  {b.widthPct >= MIN_LABEL_WIDTH_PCT ? b.label : null}
```

- [ ] **Step 5: 提示文字挪进右列**

同一文件，把时间线下面那句提示（`按住拖动时间线，预览会跟着停在那一刻。…`）整段 `<p>` 从时间线区剪下来，粘到右列（`这一幕的版面` 那块之后、右列 `</div>` 之前），并把注释补上：

```tsx
          {/*
            提示跟着控制区走。放在时间线下面时右列比画布矮约 90px, 空一块;
            挪上来既填了那块空, 也离它讲的那两个操作(拖时间线、点场景块)更近。
          */}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npx vitest run tests/components/timeline-editor.test.tsx`
Expected: PASS（8 条原有 + 4 条新增 = 12 条）

- [ ] **Step 7: 真机测量右列死空间**

`http://localhost:3000/films/ddbd3156-57b`，控制台：

```js
const canvas = [...document.querySelectorAll('div')].find(e => e.style.aspectRatio && e.className.includes('bg-black'));
const right = canvas.nextElementSibling;
const h = e => Math.round(e.getBoundingClientRect().height);
console.log({ 画布高: h(canvas), 右列高: h(right), 死空间: h(canvas) - h(right), 有字幕轨: document.body.innerText.includes('字幕 0') });
```

Expected: `死空间` ≤ **40px**（改前约 90），`有字幕轨: false`。

- [ ] **Step 8: 提交**

```bash
git add src/components/templates/timeline-editor.tsx tests/components/timeline-editor.test.tsx
git commit -m "fix(templates): 编辑台三处退化 —— 空字幕轨/窄块单字/右列空一块"
```

---

### Task 4: 模板试做台真机走查

Task 3 改的是**共用**组件，试做台必须亲眼看一遍。它要跑完「文案→切分→画面」三步才显示编辑台，会真实消耗 DeepSeek 额度。

**Files:**
- 无代码改动（除非走查发现问题，那时按发现回到 Task 3 的文件修）
- Modify: `README.md`（走查结论写进「成片详情页重排」那一节末尾）

**Interfaces:** 无

- [ ] **Step 1: 先跟用户确认额度**

试做台走一趟会真实调用 DeepSeek（文案 + 切分 + 逐镜 Builder）。**动手前明确问一句**「这次走查要真实消耗额度，跑吗」，等回答。用户说不跑就跳到 Step 4，把「未走查」如实写进 README，不要假装验过。

- [ ] **Step 2: 跑一次试做**

浏览器打开 `http://localhost:3000/templates/03ab863b-186/studio`（模板「图文口播」），依次点「文案」→「切分」→「画面」，等编辑台出现。

- [ ] **Step 3: 量它**

控制台：

```js
const canvas = [...document.querySelectorAll('div')].find(e => e.style.aspectRatio && e.className.includes('bg-black'));
const s = document.querySelector('main');
const R = e => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
console.log({
  画布: R(canvas), 画布未被封顶: canvas.style.height === '',
  画布与版面选项同区: canvas.parentElement.className.includes('md:flex-row'),
  屏数: +(s.scrollHeight / innerHeight).toFixed(2), 横向溢出: s.scrollWidth > s.clientWidth,
});
```

Expected: `画布未被封顶: true`（试做台不传 `canvasMaxHeightPx`，画布保持 `max-w-md` 老尺寸），`画布与版面选项同区: true`，`横向溢出: false`。

**如果画布旁边挤不下版面选项**（试做台画布 448px 宽，正文 1062px，右列剩约 600px，理论够），说明 `md:flex-row` 的断点对这一页不合适 —— 那就回 Task 3 把断点从 `md:` 提到 `lg:`，重跑 Task 3 的测试与本步。

- [ ] **Step 4: 把结论写进 README**

在 README「成片详情页重排(二十三期收尾)」那一节末尾追加一句实话，二选一：

跑了：
```
**模板试做台已一并走查**(它与成片页共用同一个时间线编辑台): 画布保持老尺寸不受封顶影响, 画布与版面选项并排, 无横向溢出。
```

没跑：
```
**模板试做台尚未真机走查** —— 它与成片页共用同一个时间线编辑台, 但要跑完「文案→切分→画面」三步才显示编辑台, 会真实消耗 DeepSeek 额度。组件层的结构测试(`tests/components/timeline-editor.test.tsx`)覆盖了两种配置, 页面层的观感待补。
```

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs(films): 记下试做台走查结论"
```

---

### Task 5: 收尾 —— 全量与整页复量

**Files:** 无改动（只跑验证）

- [ ] **Step 1: 全量测试**

Run: `npx vitest run`
Expected: 全绿。用例数应为 2538 + 3(Task 1) + 4(Task 3) = **2545**，文件数 220 + 1 = **221**。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无输出

- [ ] **Step 3: 三条片子整页复量**

横屏 `ddbd3156-57b`、竖屏 `f125c260-433`、纯真人一镜到底 `15f0ccb2-1a`（这条没有分镜，编辑台不显示，用来确认合并后的状态区在「没有编辑台」时也不塌），各跑：

```js
const s = document.querySelector('main');
const approve = [...document.querySelectorAll('button')].find(b => b.textContent.includes('确认导出'));
const panel = [...document.querySelectorAll('div')].find(e => e.textContent.startsWith('画面活跃度') && e.className.includes('rounded-md'));
console.log({
  屏数: +(s.scrollHeight / innerHeight).toFixed(2),
  活跃度在首屏: panel ? panel.getBoundingClientRect().top < innerHeight : '无面板',
  确认导出在视口内: approve ? approve.getBoundingClientRect().top < innerHeight : '无按钮',
  横向溢出: s.scrollWidth > s.clientWidth,
});
```

Expected: 三条都是 屏数 ≤ **1.75**、`活跃度在首屏: true`、`横向溢出: false`。

- [ ] **Step 4: 把最终数字写进 README**

把「成片详情页重排」那一节里的 `**3.17 屏 → 1.98 屏**` 更新成实际量到的最终值，并补一句首屏的变化：

```
收尾一轮又把状态区三块合成一块(实测 293px → ≤235px)、播放器收到 45vh 让活跃度面板能贴在旁边 —— **首屏第一次同时装下画面和它的毛病**。
```

- [ ] **Step 5: 提交**

```bash
git add README.md
git commit -m "docs(films): 排版收尾的最终实测数字"
```

---

## Self-Review

**1. 覆盖检查** —— 背景表里 6 条问题各有归属：#1 → Task 1；#2 → Task 2；#3 → Task 3 Step 5；#4 → Task 3 Step 3；#5 → Task 3 Step 4；#6 → Task 4。

**2. 占位扫描** —— 无 TBD/TODO；每个代码步骤都给了可直接粘贴的完整代码或完整的 className 替换；每个测量步骤都给了可直接粘贴的脚本和期望区间。

**3. 类型一致** —— 新增导出只有 `MIN_LABEL_WIDTH_PCT`（Task 3 Step 4 定义，同任务 Step 1 的测试引用，命名一致）；`data-testid="film-status"` 在 Task 1 的测试与实现里拼写一致；`FilmDetail` props 未变，Task 1 的测试 fixture 字段与 `film-detail.tsx` 里 `interface Film` 的字段逐个对得上（含上一轮新增的 `freezeReport`）。

**4. 已知风险** —— Task 2 的 45vh / 17rem 是按视口 771px、正文宽 1062px 算的；换一个视口高度或侧栏宽度，横屏可能重新换行。这不是 bug（`flex-wrap` 本来就该按空间自适应），但期望值只在这个视口下成立，测量步骤里已注明具体数字来源。
