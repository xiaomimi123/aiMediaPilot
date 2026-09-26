# 剪辑台升级 Implementation Plan（三十二期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让四张卡用上闲置的动效资产、给每一镜一层用户可调的样式参数、把剪辑台的静态卡面升级成 Player 实时预览。

**Architecture:** 动效抽成纯函数（`anim.ts`，时间 → 样式）供卡片按 flex 布局消费；样式参数 `shot.style` 存进 FilmPlan 本身（模型不填，三重保证）；剪辑台用 `@remotion/player` 直接渲染 `Film` 组件，单镜循环与整片播放两模式共用同一份合成代码。

**Tech Stack:** Remotion 4.0.399（`remotion` + `@remotion/player`）、React（主项目 18.3.1 / 子项目 19——**跨版本渲染是本期最大未知数，Task 0 前置验证**）、zod、Next.js 14.2

**Spec:** `docs/superpowers/specs/2026-09-05-workbench-live-preview-design.md`

## Global Constraints

- **不动填槽契约**：模型仍然只选卡 + 填文字。`describeCardsForPrompt()` 一个字不提 style。
- **模型不碰 style 的三重保证**（spec §4.3）：提示词不提 / `buildFilmPlan` 产出后剥掉 / schema 里 optional。
- **不扩卡片库**（三十三期）、**不做常驻层**（三十四期）、**不做全局参数与落位偏移**（YAGNI）。
- **不抄 overlay-studio 的实现**：它的导出是 puppeteer 逐帧截图，正是三十期刚删除的架构。学交互与参数模型，不学渲染路径。
- **跨项目 import 禁令仍在**（二十五期 Ruling-1）：`remotion/` 与主项目各自定义类型，不互相 import 源码——**Task 0 的 Player 集成是这条禁令的唯一例外**（Player 必须在浏览器里渲染 Film 组件），例外范围仅限「主项目 import remotion 子项目的 React 组件」，反向（remotion 子项目 import 主项目）仍然禁止。
- **`remotion/` 独立 tsconfig**，验证一律 `npm run typecheck:all`；删除期起 `npm run build` 也是必跑项（Next 静态分析能抓到 tsc/vitest 盖不住的问题）。
- **改 worker 必须重启**（`worker:dev` 无 watch）；**改 prisma schema 必须重启 dev 与 worker**（本计划不改 schema）。
- 注释、文档、提交信息用中文，说清「为什么」。提交信息结尾带：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## File Structure

| 文件 | 职责 |
| --- | --- |
| `remotion/src/motion/anim.ts`（新建） | 动效的「时间 → 样式」纯函数。手法出处标注到 `components.tsx` 的具体组件。 |
| `remotion/src/cards/*.tsx`（修改×4） | 各自接上 anim 函数；接收并消费 `style` 参数。 |
| `remotion/src/Film.tsx` + `src/lib/video-production/remotion-render.ts`（修改） | `FilmInput.shots[].style` 双侧同步；Film 把 style 传给卡片。 |
| `src/lib/video-production/shot-plan.ts`（修改） | `ShotStyleSchema` + 每个 variant 加 `style?`；`stripPlanStyle()`。 |
| `src/lib/video-production/card-controls.ts`（新建） | 参数控件声明（纯数据，主项目侧）。 |
| `src/lib/video-production/film-plan-builder.ts`（修改） | 产出后剥 style。 |
| `src/app/api/v1/cockpit/video-productions/[id]/audio/route.ts`（新建） | 音频静态路由，支持 Range。 |
| `src/components/films/film-plan-workbench.tsx`（修改） | 接入 Player 双模预览 + 参数面板。 |
| `src/components/films/plan-preview.tsx`（新建） | Player 封装（含降级到 renderStill）。 |

---

### Task 0: Spike —— 主项目能否渲染 Remotion Player

**这是前置门。失败则按 spec §5.1 的退路重排后续任务，不要硬上。**

**Files:**
- Modify: `package.json`（加 `remotion` + `@remotion/player`，同版本 `4.0.399`）
- Create: `src/components/films/__spike-player.tsx`（**验完即删**）

- [ ] **Step 1: 装包**

```bash
npm i remotion@4.0.399 @remotion/player@4.0.399
```

- [ ] **Step 2: 写最小探针组件**

```tsx
'use client';
import {Player} from '@remotion/player';
import {Film} from '../../../remotion/src/Film';

export function SpikePlayer() {
  return (
    <Player
      component={Film as never}
      inputProps={{
        shots: [{shotId: 's1', startMs: 0, endMs: 3000, card: 'statement', slots: {text: '探针'}}],
        audioSrc: null, bgm: null, captions: [], sourceVideo: null,
        aspect: '16:9', visualStyle: 'card',
      }}
      durationInFrames={45} fps={15} compositionWidth={1920} compositionHeight={1080}
      style={{width: 480}} controls loop
    />
  );
}
```

> `inputProps` 的字段清单以届时的 `FilmInput` 为准——执行时先读 `remotion/src/Film.tsx` 的类型定义抄全，缺字段 tsc 会报。

- [ ] **Step 3: 挂到 film-detail 临时位置，起 dev 打开页面看**

Run: `npm run dev`，浏览器打开任一成片详情页
Expected: 看到卡片渲染出来并循环播放。**看不到就记录报错原文**（React hooks 版本冲突？`useVideoConfig` 报 context 缺失？）

- [ ] **Step 4: 跑 build 与 typecheck**

Run: `npm run build && npm run typecheck:all`
Expected: 都通过。build 若因跨目录 import 失败，试 `next.config.js` 的 `transpilePackages: ['remotion']` 或给 tsconfig 加 `remotion/*` 路径映射，记录最终解法。

- [ ] **Step 5: 确认 Node 侧渲染未受影响**

Run: `npx vitest run tests/lib/video-production/remotion-source-video.test.ts`
Expected: 真渲染测试仍全绿（证明主项目装 remotion 没干扰子项目自己的 React 19 渲染路径）。

- [ ] **Step 6: 删探针，记结论**

删掉 `__spike-player.tsx` 与临时挂载点；把「通/不通 + 解法 + 报错原文」写进 `.superpowers/sdd/<workspace>/task-0-spike.md`。**通了才继续 Task 1；不通则停下报告，由协调者按 spec §5.1 三条退路裁决。**

- [ ] **Step 7: 提交**（仅当通过）

```bash
git add package.json package-lock.json next.config.js tsconfig.json
git commit -m "chore(video): 主项目接入 remotion + @remotion/player"
```

---

### Task 1: 动效纯函数库

**Files:**
- Create: `remotion/src/motion/anim.ts`
- Test: `tests/lib/video-production/anim.test.ts`

**Interfaces:**
- Produces（全部为纯函数，签名统一 `(frame, fps, atSec, ...) => React.CSSProperties`）：
  - `smashIn(frame, fps, atSec)` —— 砸字：从 1.35 倍缩放 + 上移砸落到位，0.42s
  - `fadeUp(frame, fps, atSec)` —— 淡入上移：opacity 0→1 + translateY 18px→0，0.5s
  - `beatHit(frame, fps, atSec)` —— 节拍脉冲：scale 1→1.12→1，0.3s
  - `slideIn(frame, fps, atSec, dir: 'left' | 'right')` —— 侧向滑入：translateX ∓60px→0 + 淡入，0.5s
  - `staggerIn(frame, fps, atSec, index, gapSec = 0.12)` —— 逐条落位：`fadeUp` 延迟 index×gapSec
  - `sweepHighlight(frame, fps, atSec)` —— 荧光笔扫亮：返回 `{backgroundSize: 'X% 100%'}`，0→100% 用 0.45s
  - `drawLine(frame, fps, atSec)` —— 描线：返回 `{clipPath: 'inset(0 X% 0 0)'}`，X 100→0，0.5s

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { smashIn, fadeUp, beatHit, slideIn, staggerIn, sweepHighlight, drawLine } from '../../../remotion/src/motion/anim';

const FPS = 30;

describe('anim 纯函数 —— 三个边界: at 之前 / 进行中 / 结束后', () => {
  it('smashIn: at 之前不可见, 结束后归位', () => {
    expect(smashIn(0, FPS, 1).opacity).toBe(0);
    const mid = smashIn(FPS * 1 + 6, FPS, 1);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    const after = smashIn(FPS * 3, FPS, 1);
    expect(after.opacity).toBe(1);
    expect(after.transform).toBe('scale(1) translateY(0px)');
  });

  it('fadeUp: 结束后 opacity 1 且不再位移', () => {
    expect(fadeUp(0, FPS, 1).opacity).toBe(0);
    expect(fadeUp(FPS * 3, FPS, 1)).toEqual({ opacity: 1, transform: 'translateY(0px)' });
  });

  it('beatHit: 峰值出现在中段, 首尾都回到 scale(1)', () => {
    expect(beatHit(0, FPS, 1).transform).toBe('scale(1)');
    const peak = beatHit(Math.round(FPS * 1.15), FPS, 1).transform as string;
    const v = Number(peak.replace('scale(', '').replace(')', ''));
    expect(v).toBeGreaterThan(1);
    expect(beatHit(FPS * 3, FPS, 1).transform).toBe('scale(1)');
  });

  it('slideIn: 左右方向的初始位移符号相反', () => {
    const l = slideIn(0, FPS, 0, 'left').transform as string;
    const r = slideIn(0, FPS, 0, 'right').transform as string;
    expect(l).toContain('-');
    expect(r).not.toContain('-');
  });

  it('staggerIn: 第 n 条比第 0 条晚 n×gap 起步', () => {
    const at = 0.5;
    const t = Math.round(FPS * (at + 0.12)); // 第 1 条刚起步的时刻
    expect(staggerIn(t, FPS, at, 0).opacity).toBe(1); // 第 0 条早已完成
    expect(staggerIn(t, FPS, at, 1).opacity).toBe(0); // 第 1 条刚要开始
  });

  it('sweepHighlight: 0% → 100%', () => {
    expect(sweepHighlight(0, FPS, 1).backgroundSize).toBe('0% 100%');
    expect(sweepHighlight(FPS * 3, FPS, 1).backgroundSize).toBe('100% 100%');
  });

  it('drawLine: clipPath 从右侧 100% 收到 0%', () => {
    expect(drawLine(0, FPS, 1).clipPath).toBe('inset(0 100% 0 0)');
    expect(drawLine(FPS * 3, FPS, 1).clipPath).toBe('inset(0 0% 0 0)');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/anim.test.ts`
Expected: FAIL —— `Failed to resolve import ".../anim"`

- [ ] **Step 3: 实现**

```ts
import {interpolate, Easing} from 'remotion';

/**
 * 动效的「时间 → 样式」纯函数(三十二期)。
 *
 * **为什么不直接用 `components.tsx` 里的组件**: 那些组件(FlowerWord/SmashWord/
 * HighlightSweep/NumberRoll…)全是绝对定位——`x`/`y` 是必填 props, 与卡片的
 * 栅格 + flex 布局冲突。二十五期写 Stat 卡时撞过一次, 当时的处理是手抄手法、
 * 不用组件(见 Stat.tsx 注释)。四张卡都接动效不能抄四遍, 所以把「时间→样式」
 * 抽成纯函数, 位置仍归 flex。
 *
 * 手法出处(video-talkcraft, 已获书面商用授权, 标注体例见 motion/README.md):
 * - smashIn ← SmashWord 的"过冲砸落"
 * - fadeUp ← FlowerWord 的进场
 * - beatHit ← BeatHit
 * - sweepHighlight ← HighlightSweep 的背景条扫过
 * - drawLine ← DrawPath 的描画
 * slideIn/staggerIn 是本项目新写(原库没有对应组件)。
 *
 * 纯函数的收益: 可单测。本项目其它判据(freeze-check/still-check/时间轴校验)
 * 都是这个路子——能单测的东西才有人在改动后发现它坏了。
 */

/** 归一化进度: at 之前恒 0, 持续 dur 秒线性推进到 1, 之后恒 1。 */
const prog = (frame: number, fps: number, atSec: number, durSec: number): number =>
  interpolate(frame, [atSec * fps, (atSec + durSec) * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

export const smashIn = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.42);
  const e = Easing.out(Easing.back(1.8))(p);
  return {
    opacity: interpolate(p, [0, 0.25], [0, 1], {extrapolateRight: 'clamp'}),
    transform: `scale(${(1 + (1 - e) * 0.35).toFixed(3)}) translateY(${((1 - e) * -22).toFixed(1)}px)`,
  };
};

export const fadeUp = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  const e = Easing.out(Easing.cubic)(p);
  return {opacity: e, transform: `translateY(${((1 - e) * 18).toFixed(1)}px)`};
};

export const beatHit = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.3);
  // 三角波: 0→1→0, 峰值在中点
  const wave = p < 0.5 ? p * 2 : (1 - p) * 2;
  return {transform: `scale(${(1 + wave * 0.12).toFixed(3)})`};
};

export const slideIn = (
  frame: number, fps: number, atSec: number, dir: 'left' | 'right',
): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  const e = Easing.out(Easing.cubic)(p);
  const from = dir === 'left' ? -60 : 60;
  return {opacity: e, transform: `translateX(${((1 - e) * from).toFixed(1)}px)`};
};

export const staggerIn = (
  frame: number, fps: number, atSec: number, index: number, gapSec = 0.12,
): React.CSSProperties => fadeUp(frame, fps, atSec + index * gapSec);

export const sweepHighlight = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.45);
  return {backgroundSize: `${Math.round(p * 100)}% 100%`};
};

export const drawLine = (frame: number, fps: number, atSec: number): React.CSSProperties => {
  const p = prog(frame, fps, atSec, 0.5);
  return {clipPath: `inset(0 ${Math.round((1 - p) * 100)}% 0 0)`};
};
```

> `smashIn` 的 `transform` 在 p=1 时必须**精确**等于 `'scale(1) translateY(0px)'`——测试断言的是字符串。`Easing.out(Easing.back())` 在 p=1 时返回 1，`(1+0*0.35).toFixed(3)` 是 `'1.000'` 而不是 `'1'`。**实现时要么改 toFixed 逻辑让 p=1 输出干净的 `scale(1)`，要么把测试断言改成数值解析**——执行者二选一，报告说明。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/anim.test.ts`
Expected: 7 条全 PASS

- [ ] **Step 5: 提交**

```bash
git add remotion/src/motion/anim.ts tests/lib/video-production/anim.test.ts
git commit -m "feat(video): 动效抽成纯函数 —— 绕开绝对定位与栅格的冲突"
```

---

### Task 2: style 参数契约

**Files:**
- Modify: `src/lib/video-production/shot-plan.ts`
- Modify: `src/lib/video-production/film-plan-builder.ts`
- Create: `src/lib/video-production/card-controls.ts`
- Test: `tests/lib/video-production/shot-style.test.ts`

**Interfaces:**
- Produces:
  - `export const ACCENTS = ['default', 'blue', 'yellow', 'red'] as const;`
  - `export type ShotStyle = { speed?: number; accent?: typeof ACCENTS[number]; scale?: number }`
  - `export function stripPlanStyle(plan: FilmPlan): FilmPlan` —— 返回剥掉所有 style 的新 plan
  - `card-controls.ts`: `export type Control = {key,label,type:'range',min,max,step,unit?} | {key,label,type:'select',options:{label,value}[]}`；`export const SHOT_STYLE_CONTROLS: Control[]`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { ShotPlanSchema, FilmPlanSchema, stripPlanStyle, describeCardsForPrompt } from '@/lib/video-production/shot-plan';
import { SHOT_STYLE_CONTROLS } from '@/lib/video-production/card-controls';

const base = { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement' as const, slots: { text: '一句话' } };

describe('shot.style 契约', () => {
  it('不带 style 的历史 plan 照常解析', () => {
    expect(ShotPlanSchema.safeParse(base).success).toBe(true);
  });

  it('合法 style 通过', () => {
    const r = ShotPlanSchema.safeParse({ ...base, style: { speed: 1.5, accent: 'yellow', scale: 1.2 } });
    expect(r.success).toBe(true);
  });

  it('speed 越界被拒', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { speed: 9 } }).success).toBe(false);
  });

  it('accent 只认枚举内的值 —— 不给自由色盘', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { accent: '#ff0000' } }).success).toBe(false);
  });

  it('style 里的多余字段被 strict 拒绝', () => {
    expect(ShotPlanSchema.safeParse({ ...base, style: { offsetX: 10 } }).success).toBe(false);
  });
});

describe('模型不碰 style 的保证', () => {
  it('卡片说明里一个字都不提 style/speed/accent', () => {
    const text = describeCardsForPrompt();
    expect(text).not.toMatch(/style|speed|accent|强调色|动画速度/);
  });

  it('stripPlanStyle 剥掉模型意外产出的 style, 其余原样', () => {
    const plan = { shots: [{ ...base, style: { speed: 2 } }] } as never;
    const out = stripPlanStyle(plan);
    expect(out.shots[0]).not.toHaveProperty('style');
    expect(out.shots[0].slots).toEqual({ text: '一句话' });
    expect(FilmPlanSchema.safeParse(out).success).toBe(true);
  });
});

describe('参数控件声明', () => {
  it('三个控件: speed/accent/scale, 与 schema 的范围一致', () => {
    const keys = SHOT_STYLE_CONTROLS.map((c) => c.key);
    expect(keys).toEqual(['speed', 'accent', 'scale']);
    const speed = SHOT_STYLE_CONTROLS[0] as { min: number; max: number };
    expect([speed.min, speed.max]).toEqual([0.3, 3]);
    const scale = SHOT_STYLE_CONTROLS[2] as { min: number; max: number };
    expect([scale.min, scale.max]).toEqual([0.6, 1.6]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/shot-style.test.ts`
Expected: FAIL（`stripPlanStyle` / `card-controls` 不存在）

- [ ] **Step 3: 实现**

`shot-plan.ts` 里，在 `SHOT_BASE` 旁边加：

```ts
/** 强调色只认这几个主题 token —— 不给自由色盘, 保证不跑出设计系统。 */
export const ACCENTS = ['default', 'blue', 'yellow', 'red'] as const;

/**
 * 这一镜的样式覆盖(三十二期)。
 *
 * **模型不填这个字段**, 三重保证: ① describeCardsForPrompt 一个字不提;
 * ② buildFilmPlan 产出后 stripPlanStyle 剥掉(防意外); ③ optional, 不填即合法。
 * 只有剪辑台(用户)写它。
 *
 * 为什么存进 FilmPlan 而不是外挂 map: 本会话吃过三次「两份数据的失效条件
 * 不对称」(bundle 快照 / TTS manifest / timing.json)。plan 与 style 存一起,
 * 删一镜天然带走它的样式, 没有第二份东西需要同步。
 */
export const ShotStyleSchema = z.object({
  speed: z.number().min(0.3).max(3).optional(),
  accent: z.enum(ACCENTS).optional(),
  scale: z.number().min(0.6).max(1.6).optional(),
}).strict();
export type ShotStyle = z.infer<typeof ShotStyleSchema>;
```

`SHOT_BASE` 加一行 `style: ShotStyleSchema.optional(),`。

同文件末尾加：

```ts
/**
 * 剥掉 plan 里所有 style —— 模型产出后立刻调用。
 * 模型本不该填(提示词里没有), 但"不该"不等于"不会", 显式剥一遍才是保证。
 */
export function stripPlanStyle(plan: FilmPlan): FilmPlan {
  return {
    ...plan,
    shots: plan.shots.map((s) => {
      const { style: _drop, ...rest } = s as typeof s & { style?: unknown };
      return rest as typeof s;
    }),
  };
}
```

`film-plan-builder.ts` 的成功返回处改为 `return { plan: stripPlanStyle(parsed.data), rounds: round };`，注释说明。

`card-controls.ts`：

```ts
/**
 * 参数控件声明(三十二期), 抄自 overlay-studio 的 Control[] 形态: 面板遍历这份
 * 声明生成 UI, 加新参数不用改面板代码。
 *
 * **放主项目而不是 remotion/**: 参数面板是 Next 组件, 卡片组件在 remotion 子项目,
 * 两边不能互相 import(二十五期 Ruling-1)。这份是纯数据无 React, 放主项目侧;
 * remotion 侧只消费 style 的值, 不需要知道控件长什么样。
 * 范围值必须与 shot-plan.ts 的 ShotStyleSchema 一致 —— 有测试钉住。
 */
export type Control =
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { label: string; value: string }[] };

export const SHOT_STYLE_CONTROLS: Control[] = [
  { key: 'speed', label: '动画快慢', type: 'range', min: 0.3, max: 3, step: 0.1, unit: '×' },
  { key: 'accent', label: '强调色', type: 'select', options: [
    { label: '默认', value: 'default' }, { label: '蓝', value: 'blue' },
    { label: '黄', value: 'yellow' }, { label: '红', value: 'red' },
  ] },
  { key: 'scale', label: '卡片大小', type: 'range', min: 0.6, max: 1.6, step: 0.05, unit: '×' },
];
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/shot-style.test.ts && npx vitest run tests/lib/video-production/ && npm run typecheck:all`
Expected: 新测试全过；`video-production/` 目录既有测试无回归（尤其 `film-plan-builder.test.ts`）

- [ ] **Step 5: 提交**

```bash
git add src/lib/video-production/ tests/lib/video-production/shot-style.test.ts
git commit -m "feat(video): shot.style 参数契约 —— 用户可调, 模型不碰"
```

---

### Task 3: 卡片接动效 + 消费 style

**Files:**
- Modify: `remotion/src/cards/Statement.tsx` / `Stat.tsx` / `Contrast.tsx` / `ListCard.tsx`
- Modify: `remotion/src/Film.tsx`（透传 style；`FilmInput` 加字段）
- Modify: `src/lib/video-production/remotion-render.ts`（`FilmInput` 双侧同步）
- Test: `tests/lib/video-production/card-style-render.test.ts`

**Interfaces:**
- Consumes: `anim.ts` 的七个函数（Task 1）、`ShotStyle` 的形状（Task 2）
- Produces: 卡片组件签名统一加 `style?: ShotStyle`；`FilmInput.shots[].style?: {speed?: number; accent?: 'default'|'blue'|'yellow'|'red'; scale?: number}`（双侧逐字一致）

**style 三个参数怎么作用（统一规则，四张卡一致）：**
- `speed`：所有 anim 调用的 `atSec` 与内部时长同除以 speed —— 实现方式是卡片内定义 `const t = (sec: number) => sec / speed;` 然后 `smashIn(frame, fps, t(0.3))`。**speed 只影响动效节奏，不影响卡片显示时长**（时长由 shot 的 startMs/endMs 定，与动效无关）。
- `accent`：映射到 theme 的对应颜色——`default`→`theme.accent`，`blue`/`yellow`/`red` → 从 `motion/lib.tsx` 的 `C` 取对应色值。卡片里原本用 `theme.accent`/`theme.highlight` 的地方改读这个映射结果。
- `scale`：整张卡外层套一个 `transform: scale(N)` 的容器（`transformOrigin: 'center'`）。

- [ ] **Step 1: 写失败的测试（真渲染，像素级）**

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { renderShotStill } from '@/lib/video-production/remotion-render';

/*
 * style 是否真的作用到画面 —— 断言 JSX 没有意义(参数可能被读了却没用),
 * 只有真渲染出两张图、比像素才说明问题。手法照 remotion-source-video.test.ts。
 */
const shot = (style?: unknown) => ({
  shotId: 's1', startMs: 0, endMs: 4000, card: 'statement' as const,
  slots: { text: '强调色测试', sub: '副句' }, ...(style ? { style } : {}),
});

const renderAt = async (style: unknown, name: string) => {
  const out = path.join(os.tmpdir(), `style-${name}-${Date.now()}.png`);
  await renderShotStill({
    input: {
      shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
      sourceVideo: null, aspect: '16:9', visualStyle: 'card',
    },
    shotIndex: 0, atMs: 2000, outputPath: out,
  });
  return out;
};

describe('style 真的作用到画面', () => {
  it('accent 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 'default');
    const b = await renderAt({ accent: 'red' }, 'red');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('scale 不同 → 像素不同', async () => {
    const a = await renderAt(undefined, 's1');
    const b = await renderAt({ scale: 1.4 }, 's14');
    expect(fs.readFileSync(a).equals(fs.readFileSync(b))).toBe(false);
    fs.unlinkSync(a); fs.unlinkSync(b);
  }, 120_000);

  it('speed 不同 → 同一时刻的动效进度不同 → 像素不同', async () => {
    // atMs 取动效进行中的时刻(0.3s 起, 0.42s 时长 —— 500ms 处正在动)
    const out1 = path.join(os.tmpdir(), `sp1-${Date.now()}.png`);
    const out2 = path.join(os.tmpdir(), `sp2-${Date.now()}.png`);
    const mk = async (style: unknown, o: string) => renderShotStill({
      input: {
        shots: [shot(style)] as never, audioSrc: null, bgm: null, captions: [],
        sourceVideo: null, aspect: '16:9', visualStyle: 'card',
      }, shotIndex: 0, atMs: 500, outputPath: o,
    });
    await mk(undefined, out1);
    await mk({ speed: 3 }, out2);
    expect(fs.readFileSync(out1).equals(fs.readFileSync(out2))).toBe(false);
    fs.unlinkSync(out1); fs.unlinkSync(out2);
  }, 120_000);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/video-production/card-style-render.test.ts`
Expected: FAIL —— 三条都失败（style 还没接，两次渲染字节相同）

- [ ] **Step 3: 实现**

四张卡各自：接收 `style?: ShotStyle`，按上面的统一规则消费；把写死的进场改成 anim 函数（spec §3.2 的对应表）。`Film.tsx` 把 `s.style` 传给卡片，`FilmInput` 双侧加 `style?`。

**注意**：`Live` 组件（`motion/life.tsx`）目前接管了入场——它自己有 idle 抖动与"让位"生命周期。接 anim 之后**不要双重进场**：`Live` 的 `from` 参数设成动效结束的时刻，让 anim 管进场、`Live` 管进场之后的 idle。实现时对着预览确认没有二次抖动。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/video-production/card-style-render.test.ts && npm run typecheck:all`
Expected: 三条真渲染全过

- [ ] **Step 5: 全量回归 + 提交**

Run: `npx vitest run`
Expected: 既有真渲染测试（ambient-layer / remotion-source-video / still-check）全绿——动效改动不该破坏静止占比与体检判据

```bash
git add remotion/src/cards/ remotion/src/Film.tsx src/lib/video-production/remotion-render.ts tests/
git commit -m "feat(video): 四张卡接上动效并消费 style 参数"
```

---

### Task 4: 音频路由

**Files:**
- Create: `src/app/api/v1/cockpit/video-productions/[id]/audio/route.ts`
- Test: `tests/api/video-production-audio.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/cockpit/video-productions/[id]/audio` → `audio/wav`，支持 `Range`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = { videoProduction: { findUnique: vi.fn() } };
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: async () => ({ id: 'user1' }) }));

const { GET } = await import('@/app/api/v1/cockpit/video-productions/[id]/audio/route');

beforeEach(() => vi.clearAllMocks());

describe('GET .../audio', () => {
  it('任务不存在 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://t/a'), { params: { id: 'x' } });
    expect(res.status).toBe(404);
  });

  it('别人的任务 → 404(不泄漏存在性)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'other', productionRoot: '/tmp' });
    const res = await GET(new Request('http://t/a'), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });

  it('音频文件不存在(无声任务) → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', productionRoot: '/tmp/definitely-not-here-32',
    });
    const res = await GET(new Request('http://t/a'), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/video-production-audio.test.ts`
Expected: FAIL —— 路由不存在

- [ ] **Step 3: 实现**

照 `[id]/file` 路由的既有形状（**先读它**：鉴权、404 口径、流式响应怎么写的）。要点：
- 文件路径 `path.join(vp.productionRoot, 'tts-audio.wav')`
- **支持 Range**：读 `Range: bytes=start-end` 头，返回 206 + `Content-Range` + `Accept-Ranges: bytes`；无 Range 头返回 200 全量。Player 拖时间轴依赖这个。
- 无文件 404（无声任务的正常情形，不是错误）

- [ ] **Step 4: 跑测试确认通过 + 真机验证 Range**

Run: `npx vitest run tests/api/video-production-audio.test.ts`
Expected: 3 条全过

真机：`curl -s -D- -o /dev/null -H 'Range: bytes=0-1023' http://localhost:3000/api/v1/cockpit/video-productions/<有音频的id>/audio | head -5`
Expected: `HTTP/1.1 206`、`Content-Range: bytes 0-1023/<总长>`

- [ ] **Step 5: 提交**

```bash
git add src/app/api/v1/cockpit/video-productions/\[id\]/audio tests/api/video-production-audio.test.ts
git commit -m "feat(video): 音频静态路由(支持 Range) —— 整片预览要 seek"
```

---

### Task 5: 剪辑台接 Player 与参数面板

**Files:**
- Create: `src/components/films/plan-preview.tsx`
- Modify: `src/components/films/film-plan-workbench.tsx`
- Test: `tests/components/plan-preview.test.tsx`（扩 `film-plan-workbench.test.tsx`）

**Interfaces:**
- Consumes: Task 0 的 Player 集成方式、Task 2 的 `SHOT_STYLE_CONTROLS`、Task 4 的音频路由
- Produces: `<PlanPreview mode="shot"|"film" plan={...} selected={n} vpId={...} aspect visualStyle />`

- [ ] **Step 1: 写失败的测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanPreview } from '@/components/films/plan-preview';

// Player 在 jsdom 里跑不了真渲染, mock 掉只验 props 契约
const playerProps: Record<string, unknown>[] = [];
vi.mock('@remotion/player', () => ({
  Player: (p: Record<string, unknown>) => { playerProps.push(p); return <div data-testid="player" />; },
}));

const plan = { shots: [
  { shotId: 's1', startMs: 0, endMs: 3000, card: 'statement', slots: { text: '一' } },
  { shotId: 's2', startMs: 3000, endMs: 7000, card: 'statement', slots: { text: '二' } },
] };

describe('PlanPreview', () => {
  it('单镜模式只把选中镜交给 Player, 时长=该镜时长', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="shot" plan={plan as never} selected={1} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const p = playerProps.at(-1)!;
    expect((p.inputProps as { shots: unknown[] }).shots).toHaveLength(1);
    expect(p.durationInFrames).toBe(60); // 4000ms × 15fps / 1000
  });

  it('整片模式给全部镜 + 音频地址', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="film" plan={plan as never} selected={0} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const p = playerProps.at(-1)!;
    const input = p.inputProps as { shots: unknown[]; audioSrc: string | null };
    expect(input.shots).toHaveLength(2);
    expect(input.audioSrc).toContain('/api/v1/cockpit/video-productions/vp1/audio');
  });

  it('单镜模式的分镜时间轴归零 —— Player 从 0 开始播这一镜', () => {
    playerProps.length = 0;
    render(<PlanPreview mode="shot" plan={plan as never} selected={1} vpId="vp1" aspect="16:9" visualStyle="card" fps={15} />);
    const shots = (playerProps.at(-1)!.inputProps as { shots: {startMs: number; endMs: number}[] }).shots;
    expect(shots[0].startMs).toBe(0);
    expect(shots[0].endMs).toBe(4000);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/components/plan-preview.test.tsx`
Expected: FAIL —— 组件不存在

- [ ] **Step 3: 实现**

`plan-preview.tsx`：
- 两种模式的 inputProps 组装（**单镜要把时间轴归零**：`{...shot, startMs: 0, endMs: shot.endMs - shot.startMs}`，否则 Player 从 0 播而卡片在 3 秒后才出现）
- `durationInFrames = Math.ceil(总时长ms / 1000 * fps)`
- 降级：Player 渲染抛错时（React error boundary）回落到 `<img src={shot-still 接口}>` + 一行说明「实时预览不可用，显示静态卡面」

`film-plan-workbench.tsx`：
- 预览区换成 `<PlanPreview>`，加「单镜 / 整片」切换
- 编辑抽屉里加参数面板：遍历 `SHOT_STYLE_CONTROLS` 渲染 range/select，改动写进本地 `plan.shots[n].style`，Player 立即用新值重渲染（React props 变化）
- 保存走既有 PUT（style 已在 plan 里，无需改 API）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/components/ && npm run typecheck:all && npm run build`
Expected: 全过

- [ ] **Step 5: 提交**

```bash
git add src/components/films/ tests/components/
git commit -m "feat(video): 剪辑台接 Player 双模预览 + 参数面板"
```

---

### Task 6: 真机验收 + 文档

- [ ] **Step 1: 重启 dev 与 worker，造一条停在 plan_ready 的任务**

（改了 worker 无关，但 dev 必须重启以加载新依赖）

- [ ] **Step 2: 浏览器走一遍**

记录：单镜预览是否流畅循环、改参数是否即时生效（目测延迟）、整片预览是否有声且能拖时间轴、降级路径（临时把 Player import 改坏验一次）是否显示静态卡面。

- [ ] **Step 3: 保存 → 确认渲染 → 核对成片**

抽帧确认 style 在成片里生效（改过 accent 的那一镜颜色对得上）。**这是本期的验收硬门：预览里看到的与成片里的必须一致**（Player 与 renderMedia 共用同一份合成代码，理论上必然一致——但要实测一次才算数）。

- [ ] **Step 4: 文档**

README 加三十二期一节：动效纯函数、style 参数（用户可调/模型不碰）、Player 双模预览、参数面板声明式。spec §5.1 的 spike 结论回填（通了走哪条路 / 用了哪条退路）。

- [ ] **Step 5: 提交**

```bash
git add README.md docs/superpowers/specs/2026-09-05-workbench-live-preview-design.md
git commit -m "docs(video): 三十二期收尾 —— 剪辑台实时预览实测记录"
```

---

## Self-Review

**1. Spec 覆盖** —— §3.1 动效抽纯函数 → Task 1；§3.2 四卡接动效 → Task 3；§4.1/4.2 参数集合与存放 → Task 2；§4.3 模型不碰三重保证 → Task 2（前两重）+ Task 2 Step 3 的 builder 改动（第三重靠 schema optional 天然成立）；§4.4 声明式面板 → Task 2（声明）+ Task 5（渲染）；§5.1 spike → Task 0；§5.2 结构 → Task 5；§5.3 音频路由 → Task 4；§5.4 降级 → Task 5 Step 3；§6 测试 → 各 Task 自带 + Task 6 真机。

**2. 占位扫描** —— 无 TBD。Task 3 的四卡实现给的是「统一规则 + 对应表」而非逐卡代码：四张卡的排版各不相同、逐行写等于把实现塞进计划，而规则（speed 除法 / accent 映射 / scale 容器）是精确的，执行者照规则改四处。Task 0 的 inputProps 字段清单要求执行时以届时 `FilmInput` 为准——这是明知计划先于执行写就的显式核对动作，不是占位。

**3. 类型一致** —— `ShotStyle` 在 Task 2 定义、Task 3 消费、Task 5 的控件对应；`ACCENTS` 枚举值（default/blue/yellow/red）在 schema、controls、卡片映射三处一致；`SHOT_STYLE_CONTROLS` 的 min/max 与 `ShotStyleSchema` 的范围有测试钉住；`renderShotStill` 的参数名（input/shotIndex/atMs/outputPath）在 Task 3 测试里与三十一期既有实现一致。

**4. 已知风险** ——
- **Task 0 是硬门**：React 18/19 跨项目渲染没人验过。失败必须停下裁决，不许硬上——spec §5.1 备了三条退路。
- **`Live` 与 anim 的双重进场**：Task 3 Step 3 点名了，但「对着预览确认没有二次抖动」是目测判断，没有自动化断言。若真机发现抖动，属于实现期调参，不返工。
- **`smashIn` 的字符串断言**：p=1 时 `toFixed(3)` 产出 `scale(1.000)` 而非 `scale(1)`，Task 1 Step 3 已点名并给了二选一，执行者需报告选了哪个。
- **动效重写的观感回归**：anim.ts 是手法照抄、代码新写，出来的效果未必与原组件一致——这正是本期做实时预览的原因，实现时对着预览调。
