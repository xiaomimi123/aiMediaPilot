# 抖音视频制作三模式（十九期）

**日期:** 2026-08-22
**背景:** 十五期已经做出"AI 自动生成无人出镜成片"功能（Director/Builder/无头渲染/拼接四段流水线，DeepSeek 驱动），但只有这一种交付方式。用户实际使用场景需要三种更具体的视频类型可选，其中两种（真人出镜+B-roll、插画+TTS）此前明确列为"不做"的 YAGNI（十五期 spec §5 原文："不做 talking-head 模式的 ASR 对齐、不接 erduo-broll-loop-engineering 或任何视频渲染引擎"）。本期把这两块补上，并把十五期的产物纳入统一的三选项结构。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 交付方式结构 | 「手动拍剪」保留；「AI 自动生成无人出镜」拆成 3 个更具体的选项，用户选题确定后从 4 个里选一个 |
| 选项① PPT 读稿形式 | 就是十五期已做好的无人出镜功能，**原样复用**（Director/Builder/渲染/拼接四段代码零改动），只改交付方式的 UI 标签和内部枚举值命名。**已知限制**：当前实现产出静音视频，本期不新增配音（不在范围内，只是记录现状，未来如需可另立项） |
| 选项② 口播视频配字幕特效 | 真人出镜 + AI B-roll 切探画面 + 动画字幕烧录。画面关系是"切探"：讲到知识点/数据时画面切到 AI 生成的图表/动画，讲完切回出镜画面，声音全程不断（脑暴阶段用可视化 mockup 确认过） |
| 选项③ 插画动画形式 | 全 AI 生成 + TTS 配音的插画风格视频，同一条 Director/Builder/渲染流水线，只是 Builder 阶段换"插画风格"提示词，声音来自 TTS 而非用户录音 |
| ②的视频来源 | 用户上传已经录好的视频文件（不做网页内摄像头录制） |
| ②的录制方式 | 看六幕脚本要点自由发挥，语序不必和稿子一致——真实语音对回六幕边界不能用逐字/字面匹配，要用语义匹配 |
| ③的 TTS 服务 | 接入火山引擎（Volcengine）语音合成 API（云端调用，不做本地开源模型部署——脑暴阶段对比过 CosyVoice/ChatTTS/edge-tts，CosyVoice 在 M1 芯片上是否能顺利跑通没有把握，改为直接接云端服务规避这个不确定性） |
| 优先级 | 三个选项一起做，不分批 |

## 1. 交付方式类型收敛

`ContentItem.deliveryMode` 现在散落在 `model.ts`/`platform-stages.ts` 里以字面量联合类型 `'manual' | 'ai-faceless'` 重复出现 7 处（`platform-stages.ts` 6 处 + `model.ts` 1 处）。本期新增两个值的同时，顺手收敛成一个具名导出类型：

```ts
// src/lib/cockpit/model.ts 新增导出
export type DeliveryMode = 'manual' | 'ppt-narration' | 'talking-head-broll' | 'illustration-tts';
```

`platform-stages.ts` 的 6 处签名、`model.ts` 的 `ContentItem.deliveryMode?` 字段、`content-detail.tsx`/`stage-stepper.tsx` 里散落的 `deliveryMode?: 'manual' | 'ai-faceless'` 全部改成 `import type { DeliveryMode } from ...` 引用同一个类型，不再各写各的字面量联合。**旧值 `'ai-faceless'` 直接改名为 `'ppt-narration'`**（十五期上线以来数据库里只有本次会话自己测试产生的少量记录，且均已清理，零迁移成本；`prisma/schema.prisma` 里 `deliveryMode` 字段本身是 `String @default("manual")`，不需要改表结构，只需应用层字面量值变化）。

`stageFlowFor` 分岔逻辑：

```ts
export function stageFlowFor(platform: string, deliveryMode?: DeliveryMode): WorkStage[] {
  if (deliveryMode === 'ppt-narration' || deliveryMode === 'illustration-tts') {
    return ['inbox', 'topic', 'script', 'editing', 'publishing', 'review']; // 跳过录制, 剪辑→生成成片
  }
  if (deliveryMode === 'talking-head-broll') {
    return ['inbox', 'topic', 'script', 'recording', 'editing', 'publishing', 'review']; // 保留录制(上传出镜视频), 剪辑→生成成片
  }
  return PLATFORM_STAGE_FLOW[platform] ?? DEFAULT_STAGE_FLOW;
}
```

**为什么②保留"录制"阶段而①③不保留**：①③是纯 AI 生成，用户没有任何"拍"的动作；②用户真的要去录一段出镜视频，"录制"阶段仍然对应一个真实的人类任务（去拍视频），只是这个阶段的内容区渲染从"备注框+打勾清单"换成"上传出镜视频"控件；上传完成后才能进入"剪辑"（此时显示为"生成成片"）阶段触发 AI 流水线。

## 2. 选项①：PPT 读稿形式（零新开发）

`VideoProductionPanel`/`video-production-worker.ts`/`director-prompt.ts`/`builder-prompt.ts`/`shot-renderer.ts`/`srt-synthesis.ts` 全部原样保留，触发条件从 `deliveryMode === 'ai-faceless'` 改成 `deliveryMode === 'ppt-narration'`。UI 上"AI 自动生成无人出镜成片"按钮文案改成"PPT 读稿形式"。

## 3. 选项②：口播视频配字幕特效

### 3.1 新增字段（VideoProduction 表）

```prisma
model VideoProduction {
  // ...现有字段不变...
  mode              String   @default("ppt-narration") // ppt-narration|talking-head-broll|illustration-tts
  sourceVideoPath    String?  // talking-head-broll: 用户上传的出镜视频本地路径
  alignedActs        Json?    // talking-head-broll: 对齐阶段产出的真实六幕边界(每幕 startMs/endMs)
  rawTranscript      Json?    // talking-head-broll: ASR 原始 segments(真实原话, 供字幕烧录用, 与六幕脚本文本无关)
}
```

（`mode` 字段区分三种模式，决定 worker 走哪条分支；`srt`/`previewPath`/`masterPath`/`status` 等既有字段三种模式通用。）

### 3.2 上传入口

新增 API 路由 `POST /api/v1/cockpit/video-productions/[id]/upload-source`：复用 `content/analyses/route.ts` 的 multipart 上传写法（500MB 上限、`ALLOWED_VIDEO_MIME` 白名单、`safeExt` 防路径穿越），把视频存到 `productionRoot/source.mp4`，写回 `sourceVideoPath`，状态推进到 `source_uploaded`。前端"录制"阶段的内容区渲染一个上传控件（复用 `content/analyses` 上传组件的交互模式，不是重新设计一套）。

### 3.3 对齐阶段（新增 AI 调用）

新文件 `src/lib/video-production/aligner-prompt.ts`（与 `director-prompt.ts`/`builder-prompt.ts` 同一种模块形状：`buildSystemPrompt`/`buildUserMessage`/`responseSchema`）：

- 输入：ASR 转写出的 `TranscriptSegment[]`（真实时间戳+真实原话）+ 六幕脚本的 `acts[]`（每幕的 `act`/`narration`/`beats`/`targetSec`，仅供语义参照，不要求逐字匹配）
- 输出 schema：`{ acts: [{ act: ActKey, startMs: number, endMs: number }] }`（六个，顺序固定，边界之间首尾相接、覆盖整段真实音频时长，用 DeepSeek `deepseek-reasoner` 完成——这类"结构化语义判断"任务已在十五期 Director 阶段验证过 DeepSeek 可行）
- 允许边界误差，不追求逐词精确对齐；如果 DeepSeek 判断某一幕在真实录音里完全没讲到，允许该幕 `startMs===endMs`（零时长，后续 Director 阶段据此跳过该幕的 B-roll 生成）

### 3.4 真实 SRT 合成

新函数 `buildSrtFromAlignedActs(acts: AlignedAct[], narrations: Record<ActKey,string>): string`（`src/lib/video-production/srt-synthesis.ts` 里新增导出，与既有的 `synthesizeSrtFromSixActScript` 并列，不改后者），用真实的 `startMs/endMs` 而不是按字数比例估算的假时间轴。

### 3.5 Director/Builder/渲染：原样复用

`director-prompt.ts`/`builder-prompt.ts`/`shot-renderer.ts` 零改动。Director 消费的 SRT 换成 3.4 产出的真实版本；产出的"分镜"在这个模式下语义是"切探时间点"而不是"整条视频"。

### 3.6 合成阶段（新增：挖空替换，不是简单拼接）

新函数 `compositeCutawayVideo(opts: { sourceVideoPath, shots: {startMs,endMs,clipPath}[], outputPath })`（`src/lib/video/ffmpeg.ts` 新增导出）：

- 用 ffmpeg `filter_complex` 按时间顺序把 `sourceVideoPath` 的视频流切成"原始片段"和"B-roll 替换片段"交替的序列（原始片段用 `trim`，B-roll 片段直接用对应 `clipPath` 的画面），`concat` 视频流
- 音频流：整段直接用 `sourceVideoPath` 的原始音轨（不切）、`amerge`/覆盖到最终视频，保证声音连续不断
- 具体 filter_complex 写法（trim+setpts+concat 组合 vs 多输入 concat demuxer）留给实施阶段验证，这里只定契约：入参是"原视频路径+若干替换区间+每个区间对应的替换画面文件"，出参是一个完整视频文件，音轨来自原视频、画面按区间切换

### 3.7 字幕烧录（新增）

新函数 `burnCaptions(opts: { videoPath, transcript: TranscriptSegment[], outputPath })`：用 3.6 产出的合成视频 + 3.3 用到的原始 ASR transcript（真实原话，不是脚本文本）生成 SRT 字幕文件，用 ffmpeg `subtitles` filter 或 `ass` 字幕（要动画效果——逐字弹出/高亮——大概率需要 `.ass` 格式而不是普通 `.srt`，实施阶段确认 ffmpeg 版本对 libass 的支持）烧录进画面。这是流水线最后一步，产出最终 `previewPath`/`masterPath`。

## 4. 选项③：插画动画形式

### 4.1 TTS 集成

新增小表（仿 `ImageGenConfig` 的模式，不塞进 `AIConfig.apiKey` 单字符串形状，因为火山 TTS 鉴权是 appid+access_token 两个值）：

```prisma
model VolcTtsConfig {
  id           String  @id @default(cuid())
  userId       String
  appId        String
  accessToken  String  // 加密存储 (复用 src/lib/crypto.ts)
  voiceType    String  @default("") // 音色 ID, 留空用火山默认音色
  createdAt    DateTime @default(now())
  user         User    @relation(fields: [userId], references: [id])
  @@unique([userId])
}
```

新文件 `src/lib/tts/volcengine.ts`：`synthesize(text: string, opts: {appId, accessToken, voiceType}): Promise<{audioPath: string; durationMs: number}>` —— 调用火山引擎语音合成 API（具体请求/响应格式、鉴权方式、音频编码格式实施阶段查官方文档核实，此处不假设）。设置页新增一张"火山 TTS 配置"卡片（复用 `settings-cards/` 现有卡片模式，填 appid+token）。

### 4.2 真实 SRT 合成（TTS 驱动）

对六幕脚本每一幕的 `narration` 逐句调 `synthesize()`，拼接音频片段、记录每句真实时长，得到跟 3.4 同构的 `AlignedAct[]`（这次的"对齐"不需要 AI 语义判断，因为 TTS 是顺序合成的，时长直接从 TTS 输出读，比②的对齐简单）。同样喂进 `buildSrtFromAlignedActs`。

### 4.3 Director/Builder：插画风格

Director 阶段提示词不变。Builder 阶段新增一个 `visualStyle: 'card' | 'illustration'` 参数（`builder-prompt.ts` 的 `buildSystemPrompt(palette, visualStyle)` 签名扩展一个参数，默认 `'card'` 保持①现状不变），`'illustration'` 时替换提示词里"文字卡片+简单几何图形"那一句为插画风格描述（具体提示词措辞实施阶段撰写并验证）。

### 4.4 拼接 + 配音混流

复用现有 `concatClips`（画面按顺序拼接，跟①一样），额外新增音频混流：`muxAudioTrack(opts: {videoPath, audioPath, outputPath})`（`ffmpeg.ts` 新增导出，`-i video -i audio -c:v copy -c:a aac -shortest` 这类简单封装），把 4.2 产出的 TTS 语音轨道混进 4.3/拼接产出的画面轨道。

## 5. YAGNI（不做）

- 不做网页内摄像头录制（②固定走文件上传）
- 不做真正的声音克隆/情感控制（火山 TTS 用默认/用户手选音色，不做"模仿本人声音"这类高阶功能）
- 不做①的配音补齐（已知限制，本期不处理）
- 不做逐字精确对齐（②的对齐阶段允许合理误差，不追求帧级精确）
- 不做批量并发生成（沿用现有单条内容单次生成的模式）
- 不做 TTS 音色克隆/多角色对话
- 不改动手动拍剪模式的任何现有逻辑

## 6. 风险

| 风险 | 对策 |
|---|---|
| ffmpeg 挖空替换（§3.6）比简单拼接复杂得多，filter_complex 语法容易写错导致音画不同步 | 实施阶段先写一个只有 1-2 个替换区间的最小可行测试用例验证音画同步，再扩展到真实多分镜场景；参考现有 `shot-renderer.test.ts` 的"真实系统测试"模式（不 mock ffmpeg，跑真实二进制断言产出文件） |
| 对齐阶段（§3.3）DeepSeek 判断可能出错（把某句话分到错误的幕），用户自由发挥导致语义边界本身模糊 | 允许合理误差（风险接受，脑暴阶段已确认不追求逐字精确）；渲染前如有余力可加一个"预览对齐结果，允许手动微调时间轴"的确认步骤（本期不做，YAGNI，后续可加） |
| 火山引擎 TTS 具体 API 契约（鉴权/请求格式/返回音频编码）现在没有查证，实施阶段可能发现跟本文档假设的接口形状不一致 | 实施第一个任务专门做技术验证：真实调通一次火山 TTS API，产出一段音频文件，确认鉴权和响应格式，再动手写正式集成代码（同十五期对 DeepSeek Director/Builder 能力的验证方式） |
| `.ass` 动画字幕烧录（§3.7）对 ffmpeg 版本/libass 支持有要求 | 实施阶段先确认本机 ffmpeg 版本支持情况，若不支持退回普通静态 `.srt` 字幕烧录（仍能满足"有字幕"的基本需求，只是没有逐字动画效果），作为可接受的降级方案 |
| 三种模式共享同一套 Director/Builder/渲染代码，改动其中一处（如 Builder 新增 `visualStyle` 参数）有牵连①现有已上线功能的风险 | Builder 签名扩展参数必须带默认值保持①行为不变，实施阶段①的现有测试全部重跑确认零回归 |
