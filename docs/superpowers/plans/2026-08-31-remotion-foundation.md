# Remotion 地基与图文口播链跑通 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Remotion 渲染层立在仓库里，建立「填槽」数据契约与第一批卡片组件，让 `ppt-narration` 一条链端到端出片——旧管线一行不删。

**Architecture:** 新增 `remotion/` 子项目（React 组件 + video-talkcraft 运动系统），worker 通过 `@remotion/renderer` 的 Node API 以 `inputProps` 驱动它。Builder 的产出从自由 HTML 改为受 zod 约束的 `ShotPlan[]`（选卡片 + 填槽），画面由我们写的卡片组件保证。

**Tech Stack:** Remotion 4.0.399（`remotion` / `@remotion/bundler` / `@remotion/renderer`）· React 19 · TypeScript · zod · vitest · video-talkcraft template（PolyForm Noncommercial，已获书面商用授权）

**Spec:** `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（执行者必须先读，尤其 §2「Builder 不再写代码，改为填槽」——那是本期所有设计的根）

## Global Constraints

- **Builder 不写代码。** 它的产出是受 schema 约束的 `ShotPlan[]`：选卡片类型 + 填槽位。**模型不接触坐标、样式、动效参数**。任何让模型自由排版的设计都是走回头路（spec §2）。
- **先建后拆。** 本期**一行旧代码都不删**。`shot-renderer.ts` / `ambient-rig.ts` / `shot-chrome.ts` / `frame-*.ts` 原样保留，旧链路必须始终能出片。
- **搬进来的零件不假定正确。** 已实测发现 `NumberRoll` 千分位写死（把 `1850%` 渲成 `+1,850%`）。每个搬入的零件都要过我们自己的单测。授权允许修改。
- **只选一套设计语言。** video-talkcraft 有两套：`motion-systems/theme.ts`（深空色系）与 `components/lib.tsx`（纸白/墨蓝/黄红）。**本期只用 `lib.tsx` 那套**，混用会串味。
- **不加「变化频率」体检**（三种度量都无法把我们和参考片分开，会通过但没用）；**不动色调策略**（样本不支持）；**不做剪辑台**（排在迁移之后）。
- **保留 LICENSE。** 搬入的 video-talkcraft 文件所在目录必须带 `LICENSE-video-talkcraft`，注明来源与授权。
- Node 20 即可（**已实测**：Remotion 4.0.399 在本机 v20.20.2 正常 bundle 与渲染，无需切换 Node 版本）。
- 测试 `npx vitest run <path>`；类型检查 `npx tsc --noEmit`。**改 worker 代码后必须重启 worker**（`worker:dev` 没有 watch，本会话已因此白跑过一轮验证）。
- 注释与提交信息用中文，说清「为什么」，结尾带 `Co-Authored-By` 与 `Claude-Session` 两行。

## 已实测的事实（不要重新验证，直接用）

| 事实 | 数值 | 来源 |
| --- | --- | --- |
| bundle 可复用 | **0.8 秒** bundle 一次，两个 composition 复用同一份 | 本会话实测 |
| 渲染耗时 | 64 秒片 / 1918 帧 → **36~48 秒** | 本会话实测 |
| 竖屏 | 同一份代码只改画幅参数即可，运动系统全部走 `useVideoConfig` | 本会话实测 |
| 字级对齐 | `faster-whisper small`，64 秒音频 **24 秒**对齐完，16 句 15 句 `match=1.00` | 本会话实测 |
| 依赖面 | 搬入的运动系统只 import `react` 与 `remotion` | 本会话实测 |

## File Structure

| 文件 | 职责 |
| --- | --- |
| `remotion/package.json` · `remotion/tsconfig.json` | 子项目配置（不并入主 `package.json`，避免 Next.js 构建拖进 Remotion 依赖） |
| `remotion/src/index.ts` · `Root.tsx` | 注册 `landscape` / `portrait` 两个 composition |
| `remotion/src/Film.tsx` | 顶层合成：读 `inputProps` 渲染整片 |
| `remotion/src/cards/index.ts` | `CardType → 组件` 注册表 |
| `remotion/src/cards/*.tsx` | 每种卡片一个文件，槽位即 props |
| `remotion/src/motion/` | 来自 video-talkcraft，含 `LICENSE-video-talkcraft` |
| `src/lib/video-production/shot-plan.ts` | **新建**：`ShotPlan` 的 zod schema + 卡片槽位定义。主项目与 Remotion 共用的契约 |
| `src/lib/video-production/remotion-render.ts` | **新建**：bundle 缓存 + `renderFilm()` |
| `src/jobs/workers/video-production-worker.ts` | 新增 `remotion` 渲染分支（**不改动既有分支**） |

任务顺序：1 → 2 → 3 → 4 → 5，后一个依赖前一个。

---

### Task 1: Remotion 子项目落地 + bundle 缓存

**Files:**
- Create: `remotion/package.json`, `remotion/tsconfig.json`, `remotion/src/index.ts`, `remotion/src/Root.tsx`, `remotion/src/Film.tsx`
- Create: `src/lib/video-production/remotion-render.ts`
- Test: `tests/lib/video-production/remotion-render.test.ts`

**Interfaces:**
- Produces:
  - `export type FilmInput = { shots: unknown[]; audioSrc: string | null; aspect: '16:9' | '9:16' }`（Task 3 会把 `shots` 收紧成 `ShotPlan[]`）
  - `export async function getBundle(): Promise<string>` —— 带进程内缓存，同一进程只 bundle 一次
  - `export async function renderFilm(opts: { input: FilmInput; outputPath: string; fps?: number; durationInFrames: number }): Promise<void>`

- [ ] **Step 1: 建 Remotion 子项目**

```bash
mkdir -p remotion/src
```

`remotion/package.json`：

```json
{
  "name": "mediapilot-remotion",
  "private": true,
  "version": "1.0.0",
  "dependencies": {
    "@remotion/bundler": "4.0.399",
    "@remotion/renderer": "4.0.399",
    "remotion": "4.0.399",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  }
}
```

`remotion/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": false, "esModuleInterop": true,
    "skipLibCheck": true, "noEmit": true
  },
  "include": ["src"]
}
```

**为什么独立 package.json**：Remotion 拖着 React 19 与自己的渲染器，并入主项目会让 Next.js 构建把它们一起打进去。子项目只在 worker 渲染时被 `bundle()` 读取，运行时互不干扰。

- [ ] **Step 2: 写最小合成**

`remotion/src/Film.tsx`：

```tsx
import React from 'react';
import {AbsoluteFill, Audio, staticFile, useVideoConfig} from 'remotion';

export type FilmInput = {
  shots: unknown[];
  audioSrc: string | null;
  aspect: '16:9' | '9:16';
};

/**
 * 顶层合成。本任务只验通路: 拿到 inputProps、画一块底、挂上音频。
 * 真正的画面在 Task 4 由卡片组件接管。
 */
export const Film: React.FC<FilmInput> = ({audioSrc}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: '#f3eeeb', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{fontFamily: 'sans-serif', fontSize: 48, color: '#1a1a2e'}}>
        {width}×{height}
      </div>
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
```

`remotion/src/Root.tsx`：

```tsx
import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';

const DEFAULTS = {shots: [], audioSrc: null, aspect: '16:9' as const};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="landscape" component={Film} durationInFrames={300} fps={30}
      width={1920} height={1080} defaultProps={DEFAULTS}
    />
    <Composition
      id="portrait" component={Film} durationInFrames={300} fps={30}
      width={1080} height={1920} defaultProps={{...DEFAULTS, aspect: '9:16' as const}}
    />
  </>
);
```

`remotion/src/index.ts`：

```ts
import {registerRoot} from 'remotion';
import {RemotionRoot} from './Root';
registerRoot(RemotionRoot);
```

- [ ] **Step 3: 装依赖**

```bash
cd remotion && npm install && cd ..
```

- [ ] **Step 4: 写失败的测试**

`tests/lib/video-production/remotion-render.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getBundle } from '@/lib/video-production/remotion-render';

/*
 * bundle 复用是这次迁移的一个关键成本项 —— spec §7 把它列为"实施第一步就要量"的未知数。
 * 实测: bundle 一次 0.8 秒, 两个 composition 复用同一份。所以 getBundle 必须缓存,
 * 每条片子重新 bundle 会把渲染提速的优势吃掉一大半。
 */

describe('getBundle', () => {
  it('同一进程内只 bundle 一次 —— 第二次调用直接返回缓存', async () => {
    const a = await getBundle();
    const t0 = Date.now();
    const b = await getBundle();
    const elapsed = Date.now() - t0;
    expect(b).toBe(a);
    // 缓存命中应当是毫秒级; 给 200ms 余量避免机器抖动误判
    expect(elapsed).toBeLessThan(200);
  }, 120_000);
});
```

- [ ] **Step 5: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/remotion-render.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 6: 写 remotion-render.ts**

```ts
import path from 'path';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import type { FilmInput } from '../../../remotion/src/Film';

export type { FilmInput };

/**
 * Remotion 渲染入口(二十五期)。
 *
 * **bundle 必须缓存。** 实测 bundle 一次 0.8 秒, 而一条 64 秒片子渲染 36~48 秒 ——
 * 每条片子重新 bundle 看似只多 0.8 秒, 但 worker 是长驻进程, 一天几十条累积起来是
 * 纯浪费, 而且 bundle 期间 CPU 与渲染争抢。同一进程内 bundle 一次即可, 两个
 * composition(横屏/竖屏)共用同一份产物 —— 这条也实测过。
 */
let bundlePromise: Promise<string> | null = null;

export async function getBundle(): Promise<string> {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.resolve(process.cwd(), 'remotion/src/index.ts'),
    });
  }
  return bundlePromise;
}

export async function renderFilm(opts: {
  input: FilmInput;
  outputPath: string;
  durationInFrames: number;
  fps?: number;
}): Promise<void> {
  const serveUrl = await getBundle();
  const id = opts.input.aspect === '9:16' ? 'portrait' : 'landscape';
  const composition = await selectComposition({
    serveUrl, id, inputProps: opts.input as unknown as Record<string, unknown>,
  });
  await renderMedia({
    composition: { ...composition, durationInFrames: opts.durationInFrames, fps: opts.fps ?? 30 },
    serveUrl,
    codec: 'h264',
    outputLocation: opts.outputPath,
    inputProps: opts.input as unknown as Record<string, unknown>,
  });
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/remotion-render.test.ts`
Expected: PASS

- [ ] **Step 8: 真机验一条 3 秒片**

```bash
npx tsx -e "
import { renderFilm } from '@/lib/video-production/remotion-render';
(async () => {
  const t0 = Date.now();
  await renderFilm({ input: { shots: [], audioSrc: null, aspect: '16:9' },
    outputPath: '/tmp/remotion-probe.mp4', durationInFrames: 90 });
  console.log('渲染完成', ((Date.now()-t0)/1000).toFixed(1), '秒');
})();
"
ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 /tmp/remotion-probe.mp4
```

Expected: 输出 `1920,1080` 与约 `3.0` 秒。**渲不出来不要往下走** —— 后面每个任务都建立在这条通路上。

- [ ] **Step 9: 提交**

```bash
git add remotion/ src/lib/video-production/remotion-render.ts tests/lib/video-production/remotion-render.test.ts
git commit -m "feat(remotion): 渲染层地基 —— 子项目 + bundle 缓存"
```

---

### Task 2: 搬入 video-talkcraft 运动系统与组件

**Files:**
- Create: `remotion/src/motion/`（从 `~/Desktop/remotion-spike/video-talkcraft/template/` 复制）
- Create: `remotion/src/motion/LICENSE-video-talkcraft`
- Test: `tests/lib/video-production/number-roll.test.ts`

**Interfaces:**
- Produces: `remotion/src/motion/` 下可 import 的 `CameraRig` / `Plane` / `Live` / `Subtitles` / `FlowerWord` / `SmashWord` / `HighlightSweep` / `NumberRoll` / `DrawPath` / `Chip` / `BeatHit`，以及 `lib.tsx` 的调色板 `C` 与 `FONT_CN` / `FONT_MONO`

- [ ] **Step 1: 复制文件并保留授权声明**

```bash
VT=~/Desktop/remotion-spike/video-talkcraft
mkdir -p remotion/src/motion
cp $VT/template/motion-systems/{camera.tsx,env.tsx,life.tsx,transitions.tsx,Subtitles.tsx,theme.ts,timing.ts,hooks.ts,time.ts,shots.ts,ui.tsx,Counter.tsx} remotion/src/motion/
cp $VT/template/components/{components.tsx,lib.tsx,mascot.tsx,pencil.tsx} remotion/src/motion/
cp $VT/LICENSE remotion/src/motion/LICENSE-video-talkcraft
```

在 `remotion/src/motion/` 下新建 `README.md`：

```markdown
# 本目录代码来自 video-talkcraft

来源：https://github.com/Vincentwei1021/video-talkcraft
许可：PolyForm Noncommercial 1.0.0（见 `LICENSE-video-talkcraft`）
商用授权：本项目已取得作者书面授权函，覆盖将 `template/` 代码用于商业产品。

**本目录的文件可以修改**（授权允许），但每次修改要在文件内注明改了什么、为什么，
以便日后与上游对照。已知修改见各文件内的「本项目修改」注释。

**设计语言只用 `lib.tsx` 那一套**（纸白 / 墨蓝 / 黄红）。`theme.ts` 是另一套深空色系，
两套混用会串味；本期不用它，保留仅为将来评估。
```

- [ ] **Step 2: 写失败的测试（锁住已知缺陷的修法）**

`tests/lib/video-production/number-roll.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * 搬进来的零件不假定正确 —— 这是本期的全局约束之一。
 *
 * 已实测的缺陷: NumberRoll 写死 `toLocaleString('en-US')`, 于是把 1850% 渲成
 * `+1,850%`。百分比、年份、编号加千分位都是错的。修法是加一个 `grouping` 开关
 * 并**默认关闭** —— 默认值必须是"不加逗号", 因为出错的那一类(百分比/年份)比
 * 需要千分位的那一类(金额)更常见, 而且加错了比不加更显眼。
 *
 * 这里用源码断言而不是渲染断言: 渲染一帧要起 Chromium, 对一个格式化开关不值当。
 */

const SRC = path.join(process.cwd(), 'remotion/src/motion/components.tsx');

describe('NumberRoll 的千分位', () => {
  const src = fs.readFileSync(SRC, 'utf-8');

  it('有 grouping 开关, 且默认关闭', () => {
    expect(src).toMatch(/grouping\s*\?\s*:\s*boolean/);
    expect(src).toMatch(/grouping\s*=\s*false/);
  });

  it('不再无条件调用 toLocaleString', () => {
    const unconditional = /\{v\.toLocaleString\('en-US'\)\}/.test(src);
    expect(unconditional).toBe(false);
  });

  it('关闭时走 String(v) —— 不是换一种加逗号的写法', () => {
    expect(src).toContain("grouping ? v.toLocaleString('en-US') : String(v)");
  });
});
```

- [ ] **Step 3: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/number-roll.test.ts`
Expected: FAIL —— 三条都失败（原文件没有 `grouping`）

- [ ] **Step 4: 修 NumberRoll**

在 `remotion/src/motion/components.tsx` 里，把 `NumberRoll` 的 props 与实现改成：

```tsx
export const NumberRoll: React.FC<{
  to: number;
  at: number;
  dur?: number;
  size?: number;
  color?: string;
  prefix?: string;
  suffix?: string;
  /**
   * 千分位分组。**本项目修改：默认关闭。**
   * 上游写死 `toLocaleString('en-US')`，实测把 `1850%` 渲成 `+1,850%`。
   * 百分比、年份、编号加逗号都是错的，而这几类比金额更常见。
   */
  grouping?: boolean;
  x: number;
  y: number;
}> = ({to, at, dur = 40, size = 150, color = C.yellow, prefix = '', suffix = '', grouping = false, x, y}) => {
```

并把渲染那一行改成：

```tsx
      {grouping ? v.toLocaleString('en-US') : String(v)}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/number-roll.test.ts`
Expected: PASS（3 条）

- [ ] **Step 6: 确认没有拖进第三方依赖**

```bash
grep -rhoE "from '[^.][^']*'" remotion/src/motion/*.tsx remotion/src/motion/*.ts | sort -u
```

Expected: 只出现 `from 'react'` 与 `from 'remotion'`。**出现任何其它包就停下来报告** —— 全局约束里「依赖只有 react + remotion」是这次选型的理由之一。

- [ ] **Step 7: 提交**

```bash
git add remotion/src/motion/ tests/lib/video-production/number-roll.test.ts
git commit -m "feat(remotion): 搬入 video-talkcraft 运动系统, 并修掉 NumberRoll 的千分位缺陷"
```

---

### Task 3: `ShotPlan` 填槽契约

**Files:**
- Create: `src/lib/video-production/shot-plan.ts`
- Test: `tests/lib/video-production/shot-plan.test.ts`

**Interfaces:**
- Produces:
  - `export const CARD_TYPES = ['statement', 'stat', 'contrast', 'list'] as const`
  - `export type CardType = (typeof CARD_TYPES)[number]`
  - `export const ShotPlanSchema` / `export type ShotPlan`
  - `export const FilmPlanSchema` / `export type FilmPlan`
  - `export function describeCardsForPrompt(): string` —— 给导演提示词用的卡片说明

- [ ] **Step 1: 写失败的测试**

`tests/lib/video-production/shot-plan.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, FilmPlanSchema, CARD_TYPES, describeCardsForPrompt } from '@/lib/video-production/shot-plan';

/*
 * 填槽契约是本期的核心决定(spec §2): Builder 不写代码, 只选卡片 + 填槽位。
 *
 * 这里锁住的是"约束真的存在"——schema 必须拒绝模型的自由发挥, 否则填槽就退化成
 * 另一种形式的自由排版。二十四期的教训: 规则被 100% 遵守、产出 100% 是 PPT,
 * 因为规则本身写的就是 PPT。这次把规则变成 schema, 违反即解析失败。
 */

describe('ShotPlanSchema', () => {
  const base = { shotId: 's1', startMs: 0, endMs: 3000 };

  it('接受合法的 stat 卡', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'stat',
      slots: { label: '月均成交额', value: 900, prefix: '不足 ', suffix: ' 元' },
    });
    expect(r.success).toBe(true);
  });

  it('拒绝未知卡片类型 —— 模型不能发明卡片', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'fancy-3d-globe', slots: {} });
    expect(r.success).toBe(false);
  });

  it('拒绝槽位缺失 —— stat 卡没有 value 就是没填完', () => {
    const r = ShotPlanSchema.safeParse({ ...base, card: 'stat', slots: { label: '只有标签' } });
    expect(r.success).toBe(false);
  });

  it('拒绝多余槽位 —— 模型不能自带私货字段(比如坐标)', () => {
    const r = ShotPlanSchema.safeParse({
      ...base, card: 'statement',
      slots: { text: '一句话', x: 200, y: 300 },
    });
    expect(r.success).toBe(false);
  });

  it('拒绝 endMs <= startMs', () => {
    const r = ShotPlanSchema.safeParse({
      shotId: 's1', startMs: 3000, endMs: 3000, card: 'statement', slots: { text: 'x' },
    });
    expect(r.success).toBe(false);
  });
});

describe('FilmPlanSchema', () => {
  const shot = (id: string, a: number, b: number) => ({
    shotId: id, startMs: a, endMs: b, card: 'statement' as const, slots: { text: id },
  });

  it('接受时间轴连续、不重叠的分镜', () => {
    const r = FilmPlanSchema.safeParse({ shots: [shot('a', 0, 1000), shot('b', 1000, 2000)] });
    expect(r.success).toBe(true);
  });

  it('拒绝时间轴重叠 —— 两镜同时在演是我们自建管线查不出的那类结构问题', () => {
    const r = FilmPlanSchema.safeParse({ shots: [shot('a', 0, 1500), shot('b', 1000, 2000)] });
    expect(r.success).toBe(false);
  });

  it('拒绝空分镜', () => {
    expect(FilmPlanSchema.safeParse({ shots: [] }).success).toBe(false);
  });
});

describe('describeCardsForPrompt', () => {
  it('每种卡片都出现在给导演的说明里 —— 漏一种模型就永远不会选它', () => {
    const text = describeCardsForPrompt();
    for (const t of CARD_TYPES) expect(text).toContain(t);
  });

  it('说明里写了"什么时候用", 不只是列字段', () => {
    expect(describeCardsForPrompt()).toMatch(/什么时候用|用在/);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

Run: `npx vitest run tests/lib/video-production/shot-plan.test.ts`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 写 shot-plan.ts**

```ts
import { z } from 'zod';

/**
 * 填槽契约(二十五期)——**Builder 不再写代码**。
 *
 * 二十四期实测: 版面骨架下发了、模型也照做了, 产出仍然是幻灯片, 因为骨架用的
 * 就是幻灯片语汇。**只要画面由模型的审美决定, 画质上限就是模型的审美。**
 *
 * 所以把画面从"模型写的 HTML"换成"模型选卡片 + 填槽位", 画质由我们写的卡片组件
 * 保证。schema 的职责是让"自由发挥"在解析阶段就失败 —— 用 `.strict()` 拒绝
 * 多余字段, 模型想偷偷塞坐标进来是不行的。
 */

export const CARD_TYPES = ['statement', 'stat', 'contrast', 'list'] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** 每种卡片的槽位。`.strict()` 是关键: 多一个字段就解析失败。 */
const SLOTS = {
  statement: z.object({
    text: z.string().min(1).max(24),
    sub: z.string().max(20).optional(),
  }).strict(),

  stat: z.object({
    label: z.string().min(1).max(16),
    value: z.number(),
    prefix: z.string().max(6).optional(),
    suffix: z.string().max(6).optional(),
    note: z.string().max(24).optional(),
  }).strict(),

  contrast: z.object({
    leftLabel: z.string().min(1).max(12),
    leftText: z.string().min(1).max(16),
    rightLabel: z.string().min(1).max(12),
    rightText: z.string().min(1).max(16),
    /** 中间的连接符。**不可省** —— 少了它就只是两张卡并排摆着, 不构成一个论断。 */
    connector: z.enum(['arrow', 'versus', 'plus']),
  }).strict(),

  list: z.object({
    title: z.string().min(1).max(16),
    /** 条目数下限 3: 少于 3 条用不着列表, 用 statement 更好。 */
    items: z.array(z.string().min(1).max(20)).min(3).max(8),
  }).strict(),
} as const;

export const ShotPlanSchema = z
  .discriminatedUnion('card', CARD_TYPES.map((card) =>
    z.object({
      shotId: z.string().min(1),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(1),
      card: z.literal(card),
      slots: SLOTS[card],
    }).strict().refine((s) => s.endMs > s.startMs, {
      message: 'endMs 必须大于 startMs',
    }),
  ) as unknown as [z.ZodTypeAny, ...z.ZodTypeAny[]]);

export type ShotPlan = z.infer<typeof ShotPlanSchema>;

export const FilmPlanSchema = z.object({
  shots: z.array(ShotPlanSchema).min(1),
}).refine(
  (p) => {
    const sorted = [...p.shots].sort((a: any, b: any) => a.startMs - b.startMs);
    for (let i = 1; i < sorted.length; i += 1) {
      if ((sorted[i] as any).startMs < (sorted[i - 1] as any).endMs) return false;
    }
    return true;
  },
  {
    /*
     * 时间轴重叠 = 两镜同时在演。这正是我们自建管线**既查不出也描述不了**的那类
     * 结构问题(裸 GSAP timeline 没有 track/clip 概念), 在这里作为契约的一部分拦掉。
     */
    message: '分镜时间轴不许重叠',
  },
);

export type FilmPlan = z.infer<typeof FilmPlanSchema>;

/**
 * 给导演提示词用的卡片说明。
 *
 * **必须写"什么时候用"而不只是列字段** —— 只列字段的话模型会挑最省事的那张
 * (实测: 它会把所有内容都塞进 statement), 卡片库再大也用不上。
 */
export function describeCardsForPrompt(): string {
  return [
    '可用的画面卡片（每一镜必须选且只选一种，并填满它的槽位）：',
    '',
    '- `statement`：一句判断占据画面。**什么时候用**：开场、转折、收尾这类需要停顿的地方。槽位：text（≤24 字）、sub（可选，≤20 字）。',
    '- `stat`：一个数字是主角，从 0 数上去。**什么时候用**：这一镜的重点就是某个具体数值时。槽位：label、value（数字本身，不带单位）、prefix/suffix（可选，单位与限定词放这里）、note（可选注脚）。',
    '- `contrast`：左右两组东西 + 中间连接符。**什么时候用**：讲 A 与 B 的对照或转变。槽位：leftLabel/leftText、rightLabel/rightText、connector（arrow 表示变成、versus 表示对立、plus 表示叠加）。**连接符不可省**——少了它就只是两张卡并排摆着，不构成一个论断。',
    '- `list`：一份条目清单。**什么时候用**：用"多"本身说明问题时。槽位：title、items（3~8 条，每条 ≤20 字）。少于 3 条请改用 statement。',
    '',
    '不要输出坐标、颜色、字号、动画参数——版面与动效由渲染层决定，你只负责选型与填字。',
  ].join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/shot-plan.test.ts`
Expected: PASS（10 条）

若 `discriminatedUnion` 与 `.refine()` 组合报类型错，改用 `z.union(...)` + 顶层 `superRefine` 校验 `endMs > startMs`；断言行为不变。

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/shot-plan.ts tests/lib/video-production/shot-plan.test.ts
git commit -m "feat(video): 填槽契约 —— 让自由发挥在解析阶段就失败"
```

---

### Task 4: 四张卡片组件

**Files:**
- Create: `remotion/src/cards/index.ts`, `Statement.tsx`, `Stat.tsx`, `Contrast.tsx`, `ListCard.tsx`
- Create: `remotion/src/layout/grid.ts`
- Modify: `remotion/src/Film.tsx`
- Test: `tests/lib/video-production/card-registry.test.ts`

**Interfaces:**
- Consumes: `CardType`（Task 3）；`remotion/src/motion/` 的组件（Task 2）
- Produces: `export const CARDS: Record<CardType, React.FC<any>>`；`export const SAFE = { top, bottom, left, right }`（栅格安全区，按画幅比例）

- [ ] **Step 1: 写栅格与安全区**

`remotion/src/layout/grid.ts`：

```ts
/**
 * 版面约束层(二十五期)——卡片不接受任意坐标, 只能落在具名区域里。
 *
 * 为什么必须有: 验货时**人手填坐标**都撞出了元素重叠(「需求是真的」压在数字上),
 * 让模型填只会更糟。字幕安全区沿用 caption-safe-zone.ts 的既有结论:
 * 按画幅把底部留白抬到 height × 350/1920 以上, 只抬不降。
 */
export const SAFE = {
  topPct: 0.08,
  bottomPct: 350 / 1920, // 与 caption-safe-zone.ts 同一个依据
  leftPct: 0.08,
  rightPct: 0.08,
} as const;

export const safeBox = (width: number, height: number) => ({
  left: Math.round(width * SAFE.leftPct),
  right: Math.round(width * SAFE.rightPct),
  top: Math.round(height * SAFE.topPct),
  bottom: Math.round(height * SAFE.bottomPct),
  innerWidth: Math.round(width * (1 - SAFE.leftPct - SAFE.rightPct)),
  innerHeight: Math.round(height * (1 - SAFE.topPct - SAFE.bottomPct)),
});

/** 字号按短边取, 一套代码同时服务横竖屏。 */
export const scaleFont = (width: number, height: number, base: number) =>
  Math.round((Math.min(width, height) / 1080) * base);
```

- [ ] **Step 2: 写四张卡**

四个文件共用同一骨架：用 `safeBox` 定位、用 `scaleFont` 定字号、内容用 flex 纵向排布（**不用绝对坐标**）、入场用 `Live`（让位生命周期）。以 `Stat.tsx` 为例，其余三张照此结构写：

```tsx
import React from 'react';
import {AbsoluteFill, useVideoConfig, useCurrentFrame, interpolate, Easing} from 'remotion';
import {C, FONT_CN} from '../motion/lib';
import {safeBox, scaleFont} from '../layout/grid';

/**
 * 数字卡：一个数值是主角，从 0 数上去。
 *
 * 不用 motion/components.tsx 的 NumberRoll —— 那个是绝对定位(x/y 必填), 与本项目的
 * 栅格约束冲突。这里复用它的"数上去"手法, 但位置交给 flex。
 */
export const Stat: React.FC<{
  slots: {label: string; value: number; prefix?: string; suffix?: string; note?: string};
  durationInFrames: number;
}> = ({slots, durationInFrames}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);

  const countDur = Math.min(fps * 1.6, durationInFrames * 0.5);
  const p = interpolate(frame, [fps * 0.6, fps * 0.6 + countDur], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  const shown = Math.round(p * slots.value);

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
      }}
    >
      <div style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 34), color: C.blue, letterSpacing: '0.12em'}}>
        {slots.label}
      </div>
      <div
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: C.yellow, marginTop: scaleFont(width, height, 16),
          fontSize: scaleFont(width, height, 170), lineHeight: 1.05,
          WebkitTextStroke: `${scaleFont(width, height, 6)}px ${C.ink}`, paintOrder: 'stroke',
        }}
      >
        {slots.prefix ?? ''}{shown}{slots.suffix ?? ''}
      </div>
      {slots.note ? (
        <div style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 26), color: C.ink, opacity: 0.55, marginTop: scaleFont(width, height, 20)}}>
          {slots.note}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
```

`Statement.tsx`（大字判断 + 可选副句）、`Contrast.tsx`（左右两列 + 中间连接符，`connector` 映射为 `→` / `VS` / `+`）、`ListCard.tsx`（标题 + 条目错峰入场，每条延迟 `i * 0.12s`）照同一骨架实现：**全部用 flex + `safeBox` + `scaleFont`，不出现绝对坐标**。

`remotion/src/cards/index.ts`：

```ts
import {Statement} from './Statement';
import {Stat} from './Stat';
import {Contrast} from './Contrast';
import {ListCard} from './ListCard';

/** CardType → 组件。Task 3 的 CARD_TYPES 每一项都必须在这里有实现。 */
export const CARDS = {
  statement: Statement,
  stat: Stat,
  contrast: Contrast,
  list: ListCard,
} as const;
```

- [ ] **Step 3: 写失败的测试**

`tests/lib/video-production/card-registry.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CARD_TYPES } from '@/lib/video-production/shot-plan';

/*
 * 注册表与契约必须对齐: schema 里有的卡片, 渲染层必须有实现, 否则模型选了一种
 * 我们画不出来的卡, 出片时才炸 —— 这个项目里"契约与实现漂移"栽过不止一次
 * (并排检测写完不接线、ContentAsset 有表无门)。
 *
 * 另外锁住"卡片里不许出现绝对坐标"这条 —— 验货时人手填坐标都撞出了重叠。
 */

const CARDS_DIR = path.join(process.cwd(), 'remotion/src/cards');

describe('卡片注册表', () => {
  const index = fs.readFileSync(path.join(CARDS_DIR, 'index.ts'), 'utf-8');

  it('schema 里的每种卡片都有实现', () => {
    for (const t of CARD_TYPES) {
      expect(index).toMatch(new RegExp(`\\b${t}\\s*:`));
    }
  });

  it('每张卡都有自己的文件', () => {
    const files = fs.readdirSync(CARDS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(CARD_TYPES.length + 1); // +1 = index.ts
  });

  it('卡片里不许出现绝对定位 —— 版面必须走栅格', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');
      expect(src, `${f} 用了 position:absolute`).not.toMatch(/position:\s*['"]absolute/);
    }
  });

  it('卡片都用了安全区 —— 不是各写各的 padding', () => {
    for (const f of fs.readdirSync(CARDS_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(path.join(CARDS_DIR, f), 'utf-8');
      expect(src, `${f} 没有用 safeBox`).toContain('safeBox');
    }
  });
});
```

- [ ] **Step 4: 跑测试确认它先失败再通过**

Run: `npx vitest run tests/lib/video-production/card-registry.test.ts`
先在只建 `grid.ts` 未建卡片时跑一次（Expected: FAIL，目录不存在），建完四张卡再跑（Expected: PASS）。

- [ ] **Step 5: 接进 Film.tsx**

```tsx
import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {CARDS} from './cards';
import {C} from './motion/lib';

export type FilmInput = {
  shots: {shotId: string; startMs: number; endMs: number; card: keyof typeof CARDS; slots: any}[];
  audioSrc: string | null;
  aspect: '16:9' | '9:16';
};

export const Film: React.FC<FilmInput> = ({shots, audioSrc}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: C.paper}}>
      {shots.map((s) => {
        const Card = CARDS[s.card];
        const from = Math.round((s.startMs / 1000) * fps);
        const dur = Math.round(((s.endMs - s.startMs) / 1000) * fps);
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur}>
            <Card slots={s.slots} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: 真机渲一条四卡片样片**

```bash
npx tsx -e "
import { renderFilm } from '@/lib/video-production/remotion-render';
const shots = [
  { shotId:'a', startMs:0, endMs:3000, card:'statement', slots:{ text:'三天用AI赚5000？', sub:'刷到过吗' } },
  { shotId:'b', startMs:3000, endMs:7000, card:'stat', slots:{ label:'月均成交额', value:900, prefix:'不足 ', suffix:' 元', note:'确实有月入过万的个案 · 属少数' } },
  { shotId:'c', startMs:7000, endMs:11000, card:'contrast', slots:{ leftLabel:'技术', leftText:'人人可得', rightLabel:'提问', rightText:'拉开差距', connector:'arrow' } },
  { shotId:'d', startMs:11000, endMs:15000, card:'list', slots:{ title:'差距在哪', items:['明确目标','拆解问题','持续追问'] } },
];
(async () => {
  for (const aspect of ['16:9','9:16']) {
    await renderFilm({ input:{ shots, audioSrc:null, aspect }, outputPath:\`/tmp/cards-\${aspect.replace(':','x')}.mp4\`, durationInFrames: 450 });
    console.log(aspect, 'ok');
  }
})();
"
for f in /tmp/cards-16x9.mp4 /tmp/cards-9x16.mp4; do
  ffmpeg -y -v error -ss 5 -i $f -frames:v 1 ${f%.mp4}.png
done
```

打开两张 png 肉眼确认：四张卡都渲出来了、**竖屏没有元素越界或重叠**、字号在两种画幅下都合理。**任何一张卡看不清或撞在一起就停下来修，不要往下走** —— 版面约束是这一层存在的全部理由。

- [ ] **Step 7: 提交**

```bash
git add remotion/src/cards/ remotion/src/layout/ remotion/src/Film.tsx tests/lib/video-production/card-registry.test.ts
git commit -m "feat(remotion): 四张卡片 + 栅格安全区 —— 版面由系统保证, 不由模型填坐标"
```

---

### Task 5: 接进 worker，`ppt-narration` 端到端出片

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`（**新增分支，不动既有分支**）
- Modify: `prisma/schema.prisma`（`VideoProduction` 加 `renderer` 与 `filmPlan`）
- Test: `tests/jobs/video-production-remotion-branch.test.ts`

**Interfaces:**
- Consumes: `renderFilm`（Task 1）、`FilmPlanSchema`（Task 3）
- Produces: worker 里的 `handlePptNarrationRemotion(vp, mode, setStatus, ...)`

- [ ] **Step 1: 加 schema 字段**

`prisma/schema.prisma` 的 `VideoProduction` 里加：

```prisma
  /// 二十五期: 这条任务走哪套渲染层。'legacy' = 旧的 HTML+GSAP 管线(缺省, 老任务零迁移),
  /// 'remotion' = 新链路。**先建后拆**: 两套并存, 验收通过后才删旧的。
  renderer        String  @default("legacy")
  /// 二十五期: Builder 的填槽产出(FilmPlan)。null = 还没跑到 Builder 或走的是旧链路。
  filmPlan        Json?
```

```bash
npx prisma generate && npx prisma db push
```

**改完 schema 必须重启 dev 与 worker** —— 旧 client 会把新字段读成 undefined 而不是报错，症状极具误导性（项目既有教训）。

- [ ] **Step 2: 写失败的测试**

`tests/jobs/video-production-remotion-branch.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/redis', () => ({ redis: {} }));
vi.mock('@/jobs/queue', () => ({ QUEUES: { VIDEO_PRODUCTION: 'video-production' } }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

/*
 * 先建后拆的验证: 新分支存在, 且**旧分支原样保留**。
 *
 * 这个项目栽过"边建边拆"的相反面 —— 二十三期把检查写完不接线, 直到真机出片才发现
 * 一直没在跑。这里反过来: 两套都在, 由 renderer 字段选, 出问题能立刻退回旧链路。
 */

describe('worker 的渲染分支', () => {
  it('新旧两条渲染路径同时存在', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(process.cwd() + '/src/jobs/workers/video-production-worker.ts', 'utf-8'));
    expect(src).toContain('handlePptNarration');           // 旧的还在
    expect(src).toContain('handlePptNarrationRemotion');   // 新的加上了
    expect(src).toMatch(/renderer\s*===\s*'remotion'/);    // 有分流开关
  });

  it('旧渲染层的文件一个都没删 —— 本期先建后拆', async () => {
    const fs = await import('node:fs');
    for (const f of [
      'src/lib/video-production/shot-renderer.ts',
      'src/lib/video-production/ambient-rig.ts',
      'src/lib/video-production/shot-chrome.ts',
      'src/lib/video-production/frame-overlap.ts',
    ]) {
      expect(fs.existsSync(process.cwd() + '/' + f), `${f} 被删了`).toBe(true);
    }
  });
});
```

- [ ] **Step 3: 跑测试确认它失败**

Run: `npx vitest run tests/jobs/video-production-remotion-branch.test.ts`
Expected: 第一条 FAIL（还没有 Remotion 分支），第二条 PASS

- [ ] **Step 4: 加 worker 分支**

在 `video-production-worker.ts` 的交付模式分岔处（`if (vp.mode === 'talking-head-broll')` 那一段之前）加：

```ts
    /*
     * 二十五期: Remotion 渲染分支。**与旧分支并存, 由 vp.renderer 选。**
     * 先建后拆 —— 新链路验收通过之前, 旧链路必须始终能出片。
     */
    if (vp.renderer === 'remotion' && vp.mode === 'ppt-narration') {
      await handlePptNarrationRemotion(vp, mode, setStatus, outputFileName, readyStatus, outputField);
      return;
    }
```

并新增函数（放在 `handlePptNarration` 之后）：

```ts
/**
 * 图文口播 · Remotion 链(二十五期)。
 *
 * 与旧链的关键差异: **Builder 不写 HTML, 只产 FilmPlan(选卡片 + 填槽)**;
 * 整片一次渲染, 不再有"分镜各渲各的再 concat"这一步。
 */
async function handlePptNarrationRemotion(
  vp: VideoProduction,
  mode: 'preview' | 'master',
  setStatus: SetStatusFn,
  outputFileName: string,
  readyStatus: string,
  outputField: 'previewPath' | 'masterPath',
): Promise<void> {
  await setStatus('building');

  const plan = FilmPlanSchema.parse(vp.filmPlan);
  const lastMs = Math.max(...plan.shots.map((s: any) => s.endMs));
  const fps = mode === 'master' ? 30 : 15;
  const template = await templateOf(vp.templateId);
  const aspect = template?.aspect === '9:16' ? '9:16' : '16:9';

  await setStatus('assembling');
  const outputPath = path.join(vp.productionRoot, outputFileName);
  await renderFilm({
    input: { shots: plan.shots as any, audioSrc: null, aspect },
    outputPath,
    durationInFrames: Math.ceil((lastMs / 1000) * fps),
    fps,
  });

  // 静止体检照旧 —— 它读的是成片 mp4, 与渲染器无关(spec §四)
  const freezeReport = await reportFreeze(outputPath, mode);
  await setStatus(readyStatus, { [outputField]: outputPath, freezeReport });
}
```

顶部补 import：

```ts
import { renderFilm } from '@/lib/video-production/remotion-render';
import { FilmPlanSchema } from '@/lib/video-production/shot-plan';
```

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `npx vitest run tests/jobs/video-production-remotion-branch.test.ts && npx tsc --noEmit`
Expected: 两条测试都 PASS，tsc 无输出

- [ ] **Step 6: 端到端真机出片**

用一条已有内容造一个 Remotion 任务（**手填 filmPlan，本任务不改 Builder 提示词**——那是下一份计划的事）：

```bash
npx tsx -e "
import { prisma } from '@/lib/prisma';
(async () => {
  const src = await prisma.videoProduction.findUnique({ where: { id: 'ddbd3156-57b' }, select: { contentId: true, srt: true, productionRoot: true, templateId: true, userId: true } });
  const id = 'remotion-trial';
  await prisma.videoProduction.upsert({
    where: { id },
    update: { renderer: 'remotion', status: 'queued', filmPlan: null },
    create: { id, userId: src!.userId, contentId: src!.contentId, mode: 'ppt-narration',
      srt: src!.srt, productionRoot: 'video-productions/' + id, templateId: src!.templateId,
      renderer: 'remotion', status: 'queued',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  });
  await prisma.videoProduction.update({ where: { id }, data: { filmPlan: { shots: [
    { shotId:'a', startMs:0, endMs:4000, card:'statement', slots:{ text:'三天用AI赚5000？', sub:'刷到过吗' } },
    { shotId:'b', startMs:4000, endMs:9000, card:'stat', slots:{ label:'月均成交额', value:900, prefix:'不足 ', suffix:' 元' } },
    { shotId:'c', startMs:9000, endMs:14000, card:'contrast', slots:{ leftLabel:'技术', leftText:'人人可得', rightLabel:'提问', rightText:'拉开差距', connector:'arrow' } },
  ] } } });
  console.log('已建', id);
  await prisma.\$disconnect();
})();
"
mkdir -p video-productions/remotion-trial
pkill -f "tsx src/jobs/workers"; sleep 2; npm run worker:dev > /tmp/w.log 2>&1 &
sleep 15
curl -s -X POST http://localhost:3000/api/v1/cockpit/video-productions/remotion-trial/start
```

等 worker 日志出现 `静止体检`，然后：

```bash
ffprobe -v error -show_entries format=duration:stream=width,height -of csv=p=0 video-productions/remotion-trial/preview.mp4
ffmpeg -y -v error -ss 6 -i video-productions/remotion-trial/preview.mp4 -frames:v 1 /tmp/e2e.png
```

Expected: 时长约 14 秒、画幅正确、`/tmp/e2e.png` 上是那张 `stat` 卡。**出不来片就停下来报告，不要绕过 worker 直接渲** —— 这一步验的正是"接进管线"这件事本身。

- [ ] **Step 7: 提交**

```bash
git add prisma/schema.prisma src/jobs/workers/video-production-worker.ts tests/jobs/video-production-remotion-branch.test.ts
git commit -m "feat(video): Remotion 渲染分支接进 worker —— 与旧链并存, 由 renderer 字段选"
```

---

### Task 6: 收尾与文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全量与类型检查**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全绿；用例数应比开工前多约 20 条（Task 1 一条 + Task 2 三条 + Task 3 十条 + Task 4 四条 + Task 5 两条）

- [ ] **Step 2: 写进 README**

在画面质量那一节之后追加一节「二十五期：Remotion 渲染层」，写清：为什么迁（合成发生在画面之外 / 没有组合模型 / 调试循环不可用）、**填槽这个核心决定与它的三条证据**、实测数字（bundle 0.8 秒可复用、64 秒片渲染 36~48 秒、竖屏同码）、以及**旧链路仍然完好、由 `renderer` 字段选**这件事。

- [ ] **Step 3: 提交**

```bash
git add README.md
git commit -m "docs(video): Remotion 渲染层第一批落地"
```

---

## Self-Review

**1. Spec 覆盖** —— spec §3.1 目录结构 → Task 1/2/4；§3.2 渲染调用 → Task 1；§2 填槽契约 → Task 3；§3.4 版面约束层 → Task 4；§3.3 的 `ppt-narration` → Task 5；§六 先建后拆 → Task 5 的 `renderer` 字段与那条"旧文件一个都没删"的测试。

**未覆盖且是有意的**（属于后续计划）：§3.3 的另外两条链、§3.5 字级对齐进管线、§四 体检层的 `renderStill` 改造与字级对齐质量关、Builder 提示词改成产 `FilmPlan`（Task 5 里手填 filmPlan 是刻意的——先验渲染通路，再验模型能不能填对）。

**2. 占位扫描** —— 无 TBD；每个代码步骤都给了可直接粘贴的完整代码；`Statement`/`Contrast`/`ListCard` 三张卡给的是骨架 + 明确约束（flex + `safeBox` + `scaleFont`，无绝对坐标）而非逐行代码，因为它们与 `Stat.tsx` 结构相同、内容不同——这是"照此结构写"，不是"自己看着办"。

**3. 类型一致** —— `FilmInput` 在 Task 1 定义、Task 4 扩展 `shots` 的形状、Task 5 传入；`CardType` / `CARD_TYPES` 在 Task 3 定义，Task 4 的注册表与测试都引用它；`renderFilm` 的参数名（`input` / `outputPath` / `durationInFrames` / `fps`）在 Task 1 定义、Task 4 Step 6 与 Task 5 Step 4 的调用逐字一致。

**4. 已知风险** —— Task 5 Step 6 手填 `filmPlan` 绕过了 Builder，所以本计划**不验证模型能否填对槽**；那是下一份计划的头号风险，写在这里以免被误认为已解决。
