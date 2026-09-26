# 二十八期：Remotion 链配上人声与入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ppt-narration` 的 Remotion 链出**有人声、带字幕、带 BGM**的成片，并给 `renderer` 一个 UI 入口、新任务默认走 remotion。

**Architecture:** 音频与字幕都进合成（spec §3.2「音频是合成的一等公民」）：preview 阶段逐幕火山 TTS（沿用 `illustration-tts` 的既有先例）→ `ttsResultsToAlignedActs` 得到真实幕边界 → `actWindowsFromAligned` 产出真实时间窗喂给 FilmPlan → 渲染时把拼好的整条语音、逐句字幕事件、BGM 作为 `inputProps` 传进 Remotion。不再有 `muxAudioTrack` 后期混流。master 复用 preview 落库的 plan 与音频文件。

**Tech Stack:** Remotion `<Audio>` / `staticFile`、火山 TTS（`synthesizeVolcTts`）、Prisma、React（生成面板）

**Spec:** `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（§3.2 / §3.3）；路线图 `docs/superpowers/plans/2026-09-03-remotion-completion-roadmap.md`

## Global Constraints

- **先建后拆**：不改 `handlePptNarration` / `handleTalkingHeadBroll` / `handleIllustrationTts` 三条旧分支，不删旧渲染层文件（有测试断言在）。
- **`buildFactsSection` 第三参数在 Remotion 链一律显式 `'cards'`**（已有源码级测试钉住，别打破）。
- **面向模型的文本只放可执行指令**，论证进代码注释（Ruling-9，四次实测教训）。
- **`remotion/` 独立 tsconfig**，验证一律 `npm run typecheck:all`。
- **改 worker 必须重启**（`worker:dev` 无 watch）；**改 prisma schema 必须重启 dev 与 worker**（本计划不改 schema——`renderer` 字段已存在）。
- 喂回模型的错误信息属于契约；测试断言锚结构不锚关键词（Ruling-4）。
- 注释、文档、提交信息用中文，说清「为什么」。提交信息结尾带：
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BGwQ79peisvyNgZPXqw5Xz
  ```

## 关键设计决定

1. **TTS 未配置时无声降级，但必须出声**：旧 `ppt-narration` 本来就无人声（2026-09-03 侦察确认，SRT 只喂 Director）。新链改成默认配音后，没配火山 TTS 的任务**不报错**（否则老用户升级即翻车），走无声 + `targetSec` 估算窗口（即现状），worker 日志与 `vp.errorMessage` 之外的提示字段说明「未配置火山 TTS，本条为无声出片」。这是有意的降级，且必须显式出声——静默降级违反项目原则。
2. **字幕逐句而非整幕**：`captionEventsFromAlignedActs` 是整幕一块（太长），新写 `sentenceCaptionEvents(acts, aligned)` 在真实幕窗口内按句切分（算法与 `synthesizeSrtFromSixActScript` 的字符比例分配一致——两者共享同一个 `splitSentences`，别复制粘贴一份）。
3. **音频文件经 `remotion/public/render-assets/` 中转**：`staticFile` 只认 public 目录。`renderFilm` 负责拷入/渲染后清理，文件名带 vp id 防并发冲突。
4. **不接片头片尾**：包装段的 `attachIntroOutro` 本期仍不接，跳过日志保留（已是记录在案的范围限制）。

## 不做什么

- 不迁另外两条链（二十九期）；不做字级对齐（二十九期）；不删旧渲染层（三十期）；不做剪辑台（三十一期）。
- 不改 `FilmPlanSchema`、不动卡片库、不改 `describeCardsForPrompt` 文案。
- 不给 legacy 链加任何新能力。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/lib/video-production/film-plan-prompt.ts`（修改） | 新增 `actWindowsFromAligned(acts, aligned)`：真实幕边界 → ActWindow[]。 |
| `src/lib/video-production/srt-synthesis.ts`（修改） | 导出 `splitSentences`；新增 `sentenceCaptionEvents(acts, aligned): CaptionEvent[]`。 |
| `src/lib/video-production/remotion-render.ts`（修改） | `FilmInput` 加 `captions`/`bgm`；`renderFilm` 加 `audioFile`/`bgmFile` 参数与 public 中转。 |
| `remotion/src/Film.tsx`（修改） | 渲染 `<Audio>` 人声轨、BGM 轨（loop + volume）、字幕层（SAFE 底部安全区）。 |
| `remotion/src/Captions.tsx`（新建） | 字幕组件：当前句高亮显示，画幅自适应。 |
| `src/jobs/workers/video-production-worker.ts`（修改） | `handlePptNarrationRemotion`：TTS → aligned 窗口 → captions → renderFilm 带音频。 |
| `src/app/api/v1/cockpit/video-productions/route.ts` + `src/app/api/v1/video-templates/[id]/produce/route.ts`（修改） | 创建 VP 时 `ppt-narration` 默认 `renderer: 'remotion'`，接受显式 `renderer` 参数退回 legacy。 |
| 生成面板组件（`VideoProductionPanel`，执行时以 grep 定位）（修改） | 显示当前 renderer；任务可启动状态下提供 remotion/legacy 切换。 |

---

### Task 1: 真实幕窗口 + 逐句字幕事件（纯函数）

**Files:**
- Modify: `src/lib/video-production/film-plan-prompt.ts`
- Modify: `src/lib/video-production/srt-synthesis.ts`
- Test: `tests/lib/video-production/aligned-windows.test.ts`

**Interfaces:**
- Consumes: `AlignedAct`（`aligner-prompt.ts`：`{act, startMs, endMs}`）、`ScriptAct`、`CaptionEvent`（`ass-captions.ts`）
- Produces:
  - `export function actWindowsFromAligned(acts: ScriptAct[], aligned: AlignedAct[]): ActWindow[]` —— 时间来自 aligned，narration/title 来自 acts；aligned 里没有的幕跳过（零时长幕不该有画面）。
  - `export function splitSentences(text: string): string[]`（`srt-synthesis.ts`，把现有内部函数导出，不改实现）
  - `export function sentenceCaptionEvents(acts: ScriptAct[], aligned: AlignedAct[]): CaptionEvent[]` —— 每幕窗口内按句字符比例切分，算法与 `synthesizeSrtFromSixActScript` 一致。

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, it, expect } from 'vitest';
import { actWindowsFromAligned } from '@/lib/video-production/film-plan-prompt';
import { sentenceCaptionEvents, splitSentences } from '@/lib/video-production/srt-synthesis';
import type { ScriptAct } from '@/lib/script/six-act';
import type { AlignedAct } from '@/lib/video-production/aligner-prompt';

const acts = [
  { act: 'hook', title: '钩子', narration: '第一句。第二句更长一些。', targetSec: 9, facts: [] },
  { act: 'concept_a', title: '现实', narration: '只有一句。', targetSec: 11, facts: [] },
] as unknown as ScriptAct[];
// 真实 TTS 时长与 targetSec 故意不同 —— 这正是要用 aligned 的理由
const aligned: AlignedAct[] = [
  { act: 'hook', startMs: 0, endMs: 8400 },
  { act: 'concept_a', startMs: 8400, endMs: 21000 },
] as AlignedAct[];

describe('actWindowsFromAligned', () => {
  it('时间来自 aligned, 文字来自 acts', () => {
    const w = actWindowsFromAligned(acts, aligned);
    expect(w).toEqual([
      { act: 'hook', title: '钩子', startMs: 0, endMs: 8400, narration: '第一句。第二句更长一些。' },
      { act: 'concept_a', title: '现实', startMs: 8400, endMs: 21000, narration: '只有一句。' },
    ]);
  });
  it('aligned 里缺的幕不产窗口 —— 没配音的幕不该有画面', () => {
    const w = actWindowsFromAligned(acts, [aligned[0]]);
    expect(w).toHaveLength(1);
    expect(w[0].act).toBe('hook');
  });
});

describe('sentenceCaptionEvents', () => {
  it('幕窗口内按句字符比例切分, 首尾相接', () => {
    const ev = sentenceCaptionEvents(acts, aligned);
    // hook 两句: '第一句。'(4字) '第二句更长一些。'(8字), 8400ms 按 4:8 分
    expect(ev[0]).toEqual({ startMs: 0, endMs: 2800, text: '第一句。' });
    expect(ev[1].startMs).toBe(2800);
    expect(ev[1].endMs).toBe(8400);
    expect(ev[2]).toEqual({ startMs: 8400, endMs: 21000, text: '只有一句。' });
  });
  it('与 splitSentences 的切法一致 —— 共享同一实现, 不是复制品', () => {
    expect(splitSentences('第一句。第二句更长一些。')).toEqual(['第一句。', '第二句更长一些。']);
  });
});
```

> 若 `splitSentences` 的真实切分行为与上面预期不符（比如保留/丢弃句号的方式不同），**以现有实现为准修正测试期望**，不要改 `splitSentences` 本身——`synthesizeSrtFromSixActScript` 依赖它，改了会动旧链。

- [ ] **Step 2: 跑测试确认失败**（`actWindowsFromAligned`/`sentenceCaptionEvents` 不存在）
- [ ] **Step 3: 实现**（`sentenceCaptionEvents` 的比例分配代码抄 `synthesizeSrtFromSixActScript` 41-72 行的算法结构，共用 `splitSentences`；`actWindowsFromAligned` 注释写清「为什么时间不再用 targetSec：TTS 真实时长与估算可差数秒，估算窗口会让画面与人声错位」）
- [ ] **Step 4: 跑测试确认通过**，且 `npx vitest run tests/lib/video-production/` 全绿（确认没动坏旧函数）
- [ ] **Step 5: 提交** `feat(video): 真实幕窗口与逐句字幕事件 —— 画面时间轴跟 TTS 走`

---

### Task 2: Remotion 侧 —— 音轨、BGM、字幕层

**Files:**
- Create: `remotion/src/Captions.tsx`
- Modify: `remotion/src/Film.tsx`
- Modify: `src/lib/video-production/remotion-render.ts`（同步 `FilmInput` 双侧定义——Ruling-1/2：两侧各自定义、必须同改）
- Test: `tests/lib/video-production/remotion-audio-captions.test.ts`

**Interfaces:**
- Produces（`FilmInput` 双侧同步扩展）：
  ```ts
  export type CaptionItem = { text: string; startMs: number; endMs: number };
  export type FilmInput = {
    shots: ShotPlanLike[];
    audioSrc: string | null;          // 人声, staticFile 相对路径
    bgm: { src: string; volume: number } | null;  // BGM, loop 到片长
    captions: CaptionItem[];          // 逐句字幕
    aspect: '16:9' | '9:16';
  };
  ```

- [ ] **Step 1: `Captions.tsx`**

```tsx
import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {SAFE, safeBox, scaleFont} from './layout/grid';
import type {CaptionItem} from './Film';

/**
 * 字幕层(二十八期)。放在栅格的底部安全区之上 —— SAFE.bottomPct 的依据与
 * caption-safe-zone.ts 相同(避开平台 UI 遮挡带), 见 grid.ts 的注释。
 * 只显示当前句, 不做逐词卡拉OK(那要字级对齐, 二十九期)。
 */
export const Captions: React.FC<{items: CaptionItem[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const current = items.find((c) => nowMs >= c.startMs && nowMs < c.endMs);
  if (!current) return null;
  const box = safeBox(width, height);
  return (
    <div style={{
      position: 'absolute',
      left: box.x, width: box.w,
      // 字幕贴安全区底边: 底边之下是平台 UI 遮挡带, 之上是卡片内容区
      top: box.y + box.h - scaleFont(150, width, height),
      textAlign: 'center',
      fontSize: scaleFont(44, width, height),
      fontWeight: 700,
      color: 'rgba(20,24,32,0.92)',
      textShadow: '0 1px 2px rgba(255,255,255,0.8)',
      lineHeight: 1.4,
    }}>{current.text}</div>
  );
};
```

> `safeBox`/`scaleFont` 的真实签名以 `remotion/src/layout/grid.ts` 为准，执行时先读它；上面的调用方式如与实际不符，按实际改调用处，不改 grid.ts。

- [ ] **Step 2: `Film.tsx` 接三样**

```tsx
{audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
{bgm ? <Audio src={staticFile(bgm.src)} loop volume={bgm.volume} /> : null}
<Captions items={captions} />
```

`captions` 缺省 `[]`、`bgm` 缺省 `null`——旧调用（含测试）不传也能跑。

- [ ] **Step 3: `renderFilm` 的文件中转**

```ts
export async function renderFilm(opts: {
  input: FilmInput;
  outputPath: string;
  durationInFrames: number;
  fps: number;
  /** 人声与 BGM 的**绝对路径**。renderFilm 负责拷进 remotion/public 并在渲染后清理。 */
  audioFile?: string | null;
  bgmFile?: { path: string; volume: number } | null;
}): Promise<void>
```

实现要点（写在注释里）：
- 中转目录 `remotion/public/render-assets/`，文件名 `<basename(outputPath 去扩展名)>-voice.<ext>` / `-bgm.<ext>`——outputPath 里带 vp id，天然防并发冲突。
- `input.audioSrc` / `input.bgm.src` 由 renderFilm 填（调用方只给绝对路径，不需要知道 public 约定）。
- `finally` 里删除中转文件——渲染失败也不留垃圾。
- 拷贝失败**抛错**，不静默无声（一半有声一半无声的成片比报错更糟）。

- [ ] **Step 4: 测试**（真渲染太慢，这条测中转与清理 + Captions 纯逻辑）：
  - `renderFilm` 传入不存在的 `audioFile` 路径 → 抛错且 `render-assets/` 里无残留。
  - 用一条 2 秒 statement 卡真渲染一次，带一个 1 秒的 wav（`ffmpeg -f lavfi -i sine=frequency=440:duration=1` 生成），`ffprobe` 断言成片**有音频流**；渲染后断言中转文件已清理。（此条超时给足 120s，参照 `ambient-layer.test.ts` 的先例。）
- [ ] **Step 5: `npm run typecheck:all` + 相关测试绿，提交** `feat(video): Remotion 合成接人声/BGM/字幕层`

---

### Task 3: worker 接 TTS 与音频

**Files:**
- Modify: `src/jobs/workers/video-production-worker.ts`（`handlePptNarrationRemotion`）
- Test: `tests/jobs/video-production-remotion-audio-wiring.test.ts`（源码级，断言锚结构）

**行为约定（preview）：**
1. `loadActs` 后查 `prisma.volcTtsConfig.findUnique({ where: { userId } })`（先例：`handleIllustrationTts` 1024 行）。
2. **有配置**：逐幕 `synthesizeVolcTts(act.narration, path.join(vp.productionRoot, `tts-${act.act}.mp3`), {...})` → `ttsResultsToAlignedActs` → `concatAudioTracks` 拼成 `vp.productionRoot/tts-audio.wav`（先例：1162-1174 行，注意那段注释里 mp3 帧漂移的理由）→ 窗口用 `actWindowsFromAligned`，字幕用 `sentenceCaptionEvents`，`renderFilm` 传 `audioFile: tts-audio.wav 绝对路径`。
3. **无配置**：窗口用 `actWindows`（估算），字幕仍产（`sentenceCaptionEvents` 喂 targetSec 估算出的 aligned 形状——写一个 `alignedFromTargetSec(acts)` 小函数或直接复用 actWindows 的结果映射），`audioFile: null`，**并 `console.warn` 一行「未配置火山 TTS，本条为无声出片」**。
4. BGM：`template?.bgmPath` 存在则 `bgmFile: { path, volume: template.bgmVolume ?? 0.15 }`。
5. master：复用 preview 的 `tts-audio.wav`（存在才传）与落库 plan，**不重新调 TTS**（先例：1249-1265 行）。

**测试断言（锚结构）：**
- `/synthesizeVolcTts\(/` 在 Remotion 分支函数体内出现
- `/actWindowsFromAligned\(/` 与 `/sentenceCaptionEvents\(/` 出现
- `/未配置火山 TTS/` 出现（无声降级必须出声）
- 三条旧分支的函数体（用函数名切片）**不含** `actWindowsFromAligned`（旧链没被顺手改）

- [ ] Step 1 写测试 → Step 2 确认失败 → Step 3 实现 → Step 4 `npx vitest run` 全量 + `npm run typecheck:all` → Step 5 提交 `feat(video): Remotion 链接火山 TTS —— 画面时间轴跟真实语音走`

---

### Task 4: renderer 入口 —— API 默认值与面板切换

**Files:**
- Modify: `src/app/api/v1/cockpit/video-productions/route.ts`（58 行 `videoProduction.create` 处）
- Modify: `src/app/api/v1/video-templates/[id]/produce/route.ts`（160 行 create 处）
- Modify: 生成面板组件（执行时 `grep -rn 'needsUploadFirst\|开始制作' src/components` 定位，侦察记录里叫 `VideoProductionPanel`）
- Test: `tests/api/video-production-renderer-default.test.ts`

**行为约定：**
- 两个创建路由：body 接受可选 `renderer: 'remotion' | 'legacy'`（zod 校验）；缺省时 **`mode === 'ppt-narration'` → `'remotion'`**，其它 mode → `'legacy'`（另两条链还没迁）。**Prisma schema 的 `@default("legacy")` 不动**——默认值提级发生在路由层，这样万一新链出问题，回退只改路由一行。
- 面板：显示当前任务的 renderer（一个小徽标即可，措辞「新版渲染 (Remotion)」/「旧版渲染」）；任务处于可启动状态（`canStartProduction`）时提供切换（PATCH 或复用已有更新路由，执行时看现状）；已在处理中的任务不可切。
- **切换必须清掉 `filmPlan`**：legacy→remotion 或反向切换后，旧 plan 对新链无意义，残留会让 master 复用到错误的东西。

**测试：**路由层单测——不传 renderer 创建 ppt-narration → `'remotion'`；显式传 `'legacy'` → `'legacy'`；创建 `illustration-tts` 不传 → `'legacy'`。

- [ ] Step 1~5 同上模式；提交 `feat(video): renderer 入口 —— 新 ppt-narration 默认走 Remotion, 可退回`

---

### Task 5: 端到端真机验证 + 文档

- [ ] **Step 1: 重启 dev 与 worker**（改了 worker 和路由）
- [ ] **Step 2: 从 UI 正常路径新建一条 ppt-narration 生成任务**（不许改库！这次验的就是入口），确认它默认 remotion，触发预览。
- [ ] **Step 3: 记录**：TTS 每幕时长、FilmPlan 修复轮数与镜数、静止体检、成片时长/画幅。**成片时长应≈TTS 总时长**（真实窗口生效的直接证据——旧的估算窗口会差几秒）。
- [ ] **Step 4: 人工核对（抽帧+听）**：① 有人声且与字幕同步（抽中段一帧，字幕文字应是那一刻正在说的句子）；② 字幕在安全区内、不与卡片内容重叠；③ BGM 音量不压人声（模板配了 BGM 才验）；④ 数字逐位与 facts 一致。任何一条不过 = BLOCKED。
- [ ] **Step 5: 文档**：README 二十五期小节补「二十八期：人声/字幕/BGM 进合成、renderer 默认 remotion」；spec §五「不做什么」里字幕/音频相关条目更新为已做。
- [ ] **Step 6: 提交** `docs(video): 二十八期收尾 —— 有声成片实测记录`

---

## Self-Review

**1. Spec 覆盖**：§3.2 的 `inputProps` 形状（audioSrc/timing/template）→ Task 2/3；§3.3 `ppt-narration` 行「六幕稿 + TTS 音频」→ Task 3 让它成真（旧链其实无声，侦察修正过认知）；§3.5 字级对齐**不在本期**（路线图排在二十九期）。
**2. 占位扫描**：Task 2 Step 1 的 grid.ts 调用、Task 4 的面板文件名都标了「执行时以实际为准」——这不是 TBD，是明知计划先于执行写就、把核对动作显式交给实施者。
**3. 类型一致**：`CaptionItem` 双侧同名同形（Ruling-2 体例）；`actWindowsFromAligned` 返回 `ActWindow[]` 与 `buildFilmPlan({windows})` 参数类型一致；`CaptionEvent`（lib 侧）与 `CaptionItem`（remotion 侧）字段同形不同名——worker 里做一次显式映射，不跨项目 import（Ruling-1）。
**4. 已知风险**：
- TTS 逐幕合成的幕间无停顿（`concatAudioTracks` 直拼），听感可能偏赶。若真机验证觉得赶，加每幕尾 300ms 静音属于二十九期的调优，本期如实记录不返工。
- 无声降级路径的窗口仍是估算值，字幕与（不存在的）人声无从错位，但**成片时长与 targetSec 总和一致**这点要在 Task 5 里顺带确认。
- `render-assets/` 中转对**并发渲染**的保护靠文件名唯一性；同一条 vp 并发触发 preview 是上游队列语义该挡的（jobId 幂等），本期不加锁。
