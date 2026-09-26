# 三十期：体检层 renderStill 化 + 成建制删除旧渲染层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **执行前提（硬门）**：二十九期完成且**用户对三条链各验收过至少一条真片**。用户已拍板（2026-09-03）：两链迁完即删，不再观察期。开工前按届时代码重跑冲突扫描。

**Goal:** 画面体检从 DOM 探针改为 `renderStill` 抽帧；然后一次性成建制删除旧渲染层，让仓库里只剩一条渲染路。

**Spec:** `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（§四体检处置表 / §六删除顺序）。

## 关键设计决定

1. **删除是一次干净的删除**（spec §六原文），一个 commit 完成主删除，前后各一个 commit 做迁移与收尾——不边建边拆。
2. **体检层按 spec §四的处置表执行**：整片静止保留零改动（已验证）；空屏/空壳色块判据保留、取帧方式换 `renderStill`；版面/裁切/遮挡三关**退役**（填槽架构下版面由组件单测保证）；「变化频率」**不新增**（二十四期三种度量都无法区分好坏片，负结果记录在案）。
3. **删除前先写「谁还引用」清单**：每个待删文件 `grep -rn` 引用方，引用方全部处理完才动手。测试里那条「旧文件都还在」的断言**反向改写**成「旧文件都已不在」——删除本身也要有测试钉住，防止某次 revert 把半套旧链带回来。

## Task 概要

### Task 1: `renderStill` 体检
- `src/lib/video-production/remotion-render.ts` 加 `renderShotStill({input, shotIndex, atMs, outputPath})`（`@remotion/renderer` 的 renderStill，复用 bundle 缓存）。
- 把 `frame-density.ts` / `frame-detail.ts` 的**像素判据函数**（判据与取帧解耦的部分）移到新家 `src/lib/video-production/still-check.ts`，worker 在 Remotion 链渲染后对每镜中点抽一帧过判据，只报不拦（与静止体检同策略）。
- 测试：一张故意全白的 statement 卡（空槽位预检会拦，所以用「一个字的卡」制造低密度）跑判据，断言报出来。

### Task 2: 删除前清点
- 产出 `.superpowers/sdd/<本计划>/teardown-inventory.md`：待删文件逐个列「引用方 → 处置」。基础清单（spec §六 + 侦察修正）：
  - `shot-renderer.ts` / `ambient-rig.ts` / `shot-chrome.ts` / `preview-html.ts` / `shot-html-guard.ts` / `style-guard.ts` / `attempt-score.ts`
  - `frame-density.ts` / `frame-detail.ts` / `frame-layout.ts` / `frame-overlap.ts`（判据已迁 Task 1 的部分除外）
  - `builder-prompt.ts`（HTML Builder 提示词）；`director-prompt.ts` **只删 DIRECTOR 对象**，`clampShotsToSource` 与 `Shot` 类型若仍被新链引用则留下并挪文件（执行时以引用图为准）
  - `ffmpeg.ts` 里的 `compositeCutawayVideo` / `concatClips` 出片路径 / `burnCaptions` 的 ASS 烧录路（`extractAudio`/`muxAudioTrack`/`concatAudioTracks` 若新链仍用则留）
  - `packaging.ts` / `packaging-input.ts` / `ass-captions.ts`（`captionEventsFrom*` 若新链仍用则挪不删）/ `caption-safe-zone.ts`（结论已内化进 grid.ts，删文件留一行指路注释在 grid.ts）
  - worker 三条旧 handler + 相关测试
- **每一行都要有「为什么能删」**：要么无引用，要么引用方同批删，要么功能已被新链等价物覆盖（写明等价物）。

### Task 3: 执行删除
- 按清单删；`npx vitest run` 全量 + `npm run typecheck:all` + `npm run build`（**这次必须跑 build**——Next.js 静态分析对删文件最敏感，单测和 tsc 都盖不住动态 import）。
- 反向断言测试：上列文件均不存在；worker 源码里无 `handlePptNarration\b`（非 Remotion 后缀）等旧符号。
- prisma：`renderer` 字段与 `'legacy'` 默认值**保留不动**（历史数据里有 legacy 记录；字段清理是未来的事，删数据语义不属于「删代码」）。

### Task 4: 回归 + 文档
- 三条链各真机出一条（renderer 已默认 remotion），静止体检 + renderStill 体检日志各贴一行。
- README 大扫除：删掉旧渲染层相关章节，二十五~三十期收拢成一节「Remotion 渲染层」；spec §六标记完成。
- 更新记忆文件里的旧结论（ambient-rig 等文件名将失效——`Measure the Rendered Page via DOM` 那条记忆里的手段整体过时，标注）。

## Self-Review 要点
- 最大风险是**清单漏项**：某个旧文件被看似无关的模块引用（比如模板编辑器读 builder-prompt 的类型）。Task 2 的引用图必须 grep 全仓（含 `src/app`），不是只查 `src/lib`。
- `git revert` 单 commit 可整体恢复旧链——这是「一次干净删除」的另一半价值，写进删除 commit 的信息里。
