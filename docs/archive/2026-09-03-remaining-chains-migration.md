# 二十九期：另外两条链迁到 Remotion + 字级对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **执行前提**：二十八期已完成并验收（人声/字幕/BGM 进合成、renderer 入口就绪）。本计划写作时间早于执行，**开工前必须按届时代码重跑冲突扫描**，行号与接口以届时为准。

**Goal:** `illustration-tts` 与 `talking-head-broll` 两条链迁到 Remotion（各自出一条真片验收），字级对齐进管线并让字幕升级成逐词高亮。

**Architecture:** 链路差异收敛为 `inputProps` 差异（spec §3.3）：`illustration-tts` = 二十八期 ppt-narration 链 + `visualStyle: 'illustration'` 的卡面风格分支；`talking-head-broll` = 出镜视频作为 `<OffthreadVideo>` 底层 + 卡片按 `ShotPlan` 时间窗覆盖其上（cutaway 整幅替换 / pip 画中画缩角），这就是「挖空替换」的原生实现，`compositeCutawayVideo` 那条 ffmpeg 路自然退役（但本期不删，三十期删）。字级对齐用 video-talkcraft 的 `timestamps_cpu.py`（faster-whisper small，项目 venv），产物 `timing.json` 落 `productionRoot`，字幕组件按词高亮。

**Tech Stack:** Remotion `<OffthreadVideo>`、faster-whisper（Python venv）、既有 ALIGNER / whisper ASR

**Spec:** `docs/superpowers/specs/2026-08-31-remotion-migration-design.md`（§3.3 / §3.5 / §四）；路线图同目录。

## Global Constraints

（与二十八期完全相同的七条，执行时从路线图抄——先建后拆 / `'cards'` 参数 / 指令-论证分离 / `typecheck:all` / worker 重启 / 错误信息即契约 / 中文注释说为什么。）

## 关键设计决定

1. **`illustration-tts` 不新建卡片库**：本期用同一套四卡 + 卡面风格分支（`FilmInput.visualStyle: 'card' | 'illustration'`，illustration 走暖纸底/手写感标题的另一组 theme token，具体色板执行时从 `remotion/src/motion/lib.tsx` 的纸白系派生）。**AI 插画图片生成不迁**——旧链的插画是 Builder HTML 里的风格化排版，不是真的生成图片（执行前先侦察确认这一点，若旧链真有图片生成步骤，本决定作废并升级为 Ruling）。
2. **`talking-head-broll` 的 Builder 仍走填槽**：出镜链的 B-roll 画面也由卡片渲染，`FilmPlan.shots` 的时间窗就是挖空窗口；窗口之外显示出镜原片。`clampShotsToSource` 保留使用（分镜超出素材时长的事故先例）。
3. **pip 与 cutaway 都迁**：pip = 卡片全幅 + 出镜视频缩角（`template.pipPosition/pipScale/pipMargin` 直接映射成一个 `<OffthreadVideo>` 的定位样式）。不迁 pip 就删不掉 ffmpeg 合成路，三十期会被卡住。
4. **字级对齐只增强、不阻塞**：`timing.json` 生成失败或 venv 缺失时，字幕退回二十八期的逐句模式并出声——对齐是增强件不是依赖件。`match < 0.90` 的句子计数落库（`vp` 上已有 JSON 字段可放的执行时确认，没有就报上来裁决，不擅自加 schema 字段）。
5. **数字转汉字读法**（spec §3.5）：对齐前把口播稿里的阿拉伯数字确定性转换（`1850` → 「一千八百五十」），做成纯函数 + 单测，不交给模型。

## 不做什么

- 不删旧渲染层与 ffmpeg 合成路（三十期）。
- 不做逐词卡拉OK之外的字幕动效（发光/弹跳等留给后续卡片库扩展）。
- 不动三条旧分支。
- 两条新链的 renderer 默认值**本期仍为 legacy**——迁完、用户验收后才在路由层把默认切过来（验收即本计划的最后任务，切默认值放在验收通过之后的同一提交）。

## Task 概要（执行时逐个展开为完整 brief）

### Task 1: 卡面风格分支（illustration）
- `remotion/src/theme.ts` 抽出 `card`/`illustration` 两组 token（背景/标题字体感/强调色）；四张卡读 token 不读写死色值；`FilmInput.visualStyle` 双侧同步。
- 测试：两种风格各渲一帧（renderStill 或整段短渲），断言背景像素色值不同（真渲染，不断言 JSX）。

### Task 2: `handleIllustrationTtsRemotion` 分支
- 复制二十八期 ppt-narration Remotion 分支的骨架：TTS（该链本来就强制火山 TTS，未配置**保持旧链行为直接报错**，不降级——这是两链的既有差异，别抹平）→ aligned 窗口 → FilmPlan → `renderFilm(visualStyle: 'illustration')`。
- worker 选路条件 `renderer === 'remotion' && mode === 'illustration-tts'`。
- 端到端：真机出一条，静止体检 + 人工核对四条（同二十八期口径）。

### Task 3: `<OffthreadVideo>` 出镜层 + 挖空/画中画
- `FilmInput` 加 `sourceVideo: { src: string; layout: 'cutaway' | 'pip'; pip?: {position, scale, margin} } | null`；`Film.tsx`：cutaway = shots 窗口内卡片全幅、窗口外出镜全幅；pip = 卡片全幅 + 出镜角标常驻。
- `renderFilm` 的文件中转扩展到视频文件（出镜视频可能数百 MB——**先量拷贝耗时**，超过 ~2s 就改用 symlink 进 public，实测定，量完记录进报告）。
- 测试：4 秒样例视频 + 1 镜卡片真渲染，抽窗口内/外各一帧断言画面来源不同。

### Task 4: `handleTalkingHeadBrollRemotion` 分支
- ASR → ALIGNER → `actWindowsFromAligned`（真实录音幕边界）→ FilmPlan（**窗口必须 `clampShotsToSource` 裁回素材时长**）→ renderFilm 带 `sourceVideo` 与 ASR 逐句字幕（`captionEventsFromTranscript` 先例）。
- 音频：出镜原声直通（`<OffthreadVideo>` 自带音轨，确认 muted 与否的行为——**执行时先在 spike 里验 OffthreadVideo 音轨是否进成片**，这是本计划最大的技术未知数，Task 3 动手前先花半小时验掉）。
- 端到端：真机出一条（库里有现成出镜素材的 VP 记录），核对：挖空窗口切换准确、人声连续不断、字幕跟 ASR。

### Task 5: 字级对齐进管线
- `scripts/` 下落 `timestamps_cpu.py`（从 video-talkcraft 搬，LICENSE 标注体例照 `remotion/src/motion/README.md`）+ `setup-align-venv.sh`（venv + faster-whisper small，模型首跑下载 460MB 的提示写清）。
- 数字→汉字读法纯函数 `src/lib/tts/number-to-hanzi.ts` + 单测（覆盖：整数/小数/百分比/区间「300-500」/年份）。
- worker：TTS 完成后调对齐（child_process，超时 120s），产 `timing.json` 落 `productionRoot`；失败出声降级。
- `Captions.tsx` 支持 `words?: {word, startMs, endMs}[]`：有词级数据时当前词加重/变色，无则整句（二十八期行为）。
- 质量关：`match < 0.90` 句子数落库/日志（执行时定落点），只报不拦。

### Task 6: 验收 + 默认值切换 + 文档
- 两条链各一条真片给用户过目（**用户验收是硬门**，不是我看帧）。
- 验收通过后：两个创建路由的默认 renderer 对这两 mode 也切 `'remotion'`；README/spec 更新。

## Self-Review 要点（执行时复核）
- OffthreadVideo 音轨行为是最大未知数——Task 3 前置 spike，验完才许写 Task 3/4 的 brief。
- `talking-head` 的 FilmPlan 提示词要不要素材指派（`assetIds`）？**本期不要**——素材机制整体没接 Remotion（侦察第 7 点），属于剪辑台之后的工作，写进「不做什么」。
- 三条链并存期间 worker 选路矩阵（mode × renderer = 6 格）要有一张源码级测试表逐格断言走哪个 handler——这是本计划的「先建后拆」保险。
