# Remotion 迁移收尾 · 总路线图（二十八期~三十一期）

> 本文件不是可执行计划，是四份计划的顺序与边界。每份计划各自有完整的任务文档，执行前须按届时代码重跑冲突扫描（后三份写作时间早于执行时间，行号与接口以届时为准）。

**用户已拍板的四个决定（2026-09-03）：**
1. 剪辑台调的对象 = **FilmPlan 分镜方案**（不含素材挂载，那是后续）。
2. 剪辑台预览 = **renderStill 静态卡面**（架构上留逐镜动态渲染的位置，本期不做）。
3. 旧渲染层 = **两链迁完并验收即成建制删除**（spec §六原案）。
4. 新建 `ppt-narration` 任务**默认 `renderer='remotion'`**，界面可退回 legacy。

**侦察结论（2026-09-03，写计划的依据）：**
- 旧 `ppt-narration` **全程无人声**（SRT 只喂 Director，包装段只有 BGM）。三链中只有 `illustration-tts` 有 TTS（逐幕 `synthesizeVolcTts` → `ttsResultsToAlignedActs` → `concatAudioTracks` → `muxAudioTrack`）。
- Remotion 分支目前无字幕、`audioSrc` 恒为 null；`staticFile` 要求文件在 `remotion/public/` 下。
- `runPackaging`（字幕烧录/BGM/片头片尾）只在旧链 master 后跑；字幕安全区逻辑在 `ass-captions.ts` + `caption-safe-zone.ts`。
- 素材机制（`ContentAsset` / `copyAssetsInto` / `asset-manifest.ts`）只接在旧 HTML 链。

| 期 | 计划文件 | 一句话 | 验收门 |
| --- | --- | --- | --- |
| 二十八 | `2026-09-03-remotion-voice-and-entry.md` | `ppt-narration` 新链配上人声 + 字幕 + BGM 进合成；renderer 有 UI 入口且默认 remotion | 一条有声带字幕的真片经用户过目 |
| 二十九 | `2026-09-03-remaining-chains-migration.md` | `illustration-tts` 与 `talking-head-broll` 迁到 Remotion（含 pip/cutaway 两种出镜版式）；字级对齐进管线 | 两条链各出一条真片经用户过目 |
| 三十 | `2026-09-03-healthcheck-and-teardown.md` | 体检层改 `renderStill` 抽帧；**成建制删除旧渲染层** | 全量测试绿 + 三链回归各一条片 |
| 三十一 | `2026-09-03-film-plan-workbench.md` | 生成前剪辑台：FilmPlan 可视化编辑 + renderStill 卡面预览 + 改完重渲 | 用户在界面上改一镜文字并重渲成功 |

**跨计划硬约束（每份计划的 Global Constraints 都要抄）：**
- 先建后拆：三十期之前不删旧渲染层任何文件。
- `buildFactsSection` 第三参数在 Remotion 链一律显式 `'cards'`。
- 喂回模型的错误信息属于契约；面向模型的文本只放可执行指令，论证进代码注释。
- `remotion/` 独立 tsconfig，验证一律 `npm run typecheck:all`。
- 改 worker 必须重启（无 watch）；改 prisma schema 必须重启 dev 与 worker。
- 面向模型/面向用户的文案一个措辞都可能改行为——改动过 A/B 或至少真机验证后才算数。
