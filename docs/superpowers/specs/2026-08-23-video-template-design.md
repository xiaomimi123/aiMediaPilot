# 二十期 · 视频模板板块设计

日期:2026-08-23
状态:已与用户逐节确认(数据模型 / 包装管线 / 模板页流程 / 测试策略)

## 1. 目的

用户日常要剪的口播视频类型固定(对应现有三种 AI 交付模式),但每次生成都要重新配交付模式、画面风格、配音、字幕、包装等参数。本期新增侧栏「模板」板块:把这些参数固化为可复用、可迭代的**视频模板**,出片流程收敛为「选模板 → 定文案 → 自动出片」,并一次性补齐管线缺失的包装能力(样式化字幕 / BGM / 片头片尾)。

用户已确认的关键决策:

- 模板固化四类内容:交付模式+视觉风格、配音音色预设(生成时可临时改)、写稿提示、字幕/包装样式。
- 首次进入模板页自动播种 3 个预设模板(按三种交付模式各一),播种后与普通模板一样可改/可复制/可删/可新增。
- 模板驱动的生成流程**只在模板页发起**;内容详情页现有生成入口保持现状不动。
- 文案三种来源:已定稿六幕稿 / 现场粘贴新写 / 从灵感选题直接出稿。
- 包装三件套(字幕样式可配、BGM、片头片尾)本期一次做完,素材全部用户自己上传。

## 2. 数据模型

### 2.1 新表 `VideoTemplate`

沿用现有表约定(string id、userId 级联删除、ISO 字符串时间戳):

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` / `userId` | String | 主键 / 归属用户(onDelete: Cascade) |
| `name` | String | 模板名 |
| `description` | String? | 备注 |
| `deliveryMode` | String | `ppt-narration` \| `talking-head-broll` \| `illustration-tts`(与 `DeliveryMode` 一致) |
| `visualStyle` | String | `card` \| `illustration`(对应 builder-prompt 现有参数) |
| `palette` | Json? | 配色数组,缺省用管线默认 |
| `voicePreset` | Json? | 火山 TTS 默认参数 `{ voiceType, resourceId? }`,生成时可临时覆盖;仅 illustration-tts 消费 |
| `scriptPrompt` | Json? | 写稿提示 `{ tone?, targetDurationSec?, hookHint?, extraGuidance? }`,注入六幕写稿 prompt |
| `captionStyle` | Json? | `{ fontFamily, fontSize, primaryColor, outlineColor, outlineWidth, marginV }`;null = 不烧字幕 |
| `bgmPath` | String? | BGM 音频文件路径(服务端) |
| `bgmVolume` | Float | BGM 相对音量(0~1,默认 0.15) |
| `introPath` / `outroPath` | String? | 片头/片尾视频路径(服务端) |
| `isPreset` | Boolean | 内置预设标记(仅用于 UI 徽标,不限制编辑/删除) |
| `createdAt` / `updatedAt` | String | ISO 时间戳 |

索引:`@@index([userId])`。

### 2.2 `VideoProduction` 扩展

- 新增 `templateId String?`:记录任务由哪个模板发起;为 null 表示旧入口(内容详情页)任务,包装段自动跳过——零迁移。
- `status` 枚举新增 `packaging`(位于 master 渲染完成之后、`done` 之前)。

### 2.3 素材存储

- 模板素材根目录:`process.env.VIDEO_TEMPLATE_ROOT || './video-templates'`,每模板一目录 `<root>/<templateId>/`(与 `VIDEO_PRODUCTION_ROOT` 同一范式)。
- 上传校验复用 `upload-source` 路由的既有手法:MIME 白名单(BGM: `audio/mpeg|wav|x-m4a|mp4`;片头片尾: 视频白名单同现有)、大小上限(BGM 50MB、片头片尾 200MB)、`safeExt` 扩展名防路径穿越。
- 删除模板时连同素材目录一并清理。

### 2.4 预设播种

`GET /api/v1/video-templates` 发现该用户 0 条模板时,原子播种 3 条(图文口播 / 真人出镜+B-roll / 插画 TTS 各一,`isPreset=true`,字幕样式给合理默认、无 BGM/片头片尾)。播种幂等:仅在 count=0 时发生。

### 2.5 内容归属决策

`VideoProduction.contentId` 保持必填。模板页三种文案来源统一收敛:**发起生成前必先落一张 `CockpitContent`**——

- 选已定稿六幕稿:直接用该内容卡。
- 粘贴新写 / 灵感出稿:AI 产出六幕稿、用户确认后自动建内容卡(平台=douyin,写入六幕 `ScriptDraft` 并关联),再发起生成。

由此模板产物天然进入内容总览与复盘闭环,不另造平行体系。

## 3. 包装管线(worker 尾部统一段)

### 3.1 位置与触发

- 仅 **master 渲染完成后**执行;preview 保持现状不包装(预览审内容,省一遍渲染成本)。
- 仅任务带 `templateId` 且模板配了对应项时执行;三步各自独立可缺省。
- 执行顺序:**样式化字幕 → BGM 混音 → 片头/片尾拼接**。拼接放最后,使字幕与 BGM 不渗入自带声画的片头片尾。
- 任一步骤失败:任务进 `failed`,但保留已产出的未包装 master 路径(不白跑整条管线);`errorMessage` 记明失败在哪一步。

### 3.2 样式化字幕(.ass)

- 以 `.ass` 替代现在真人出镜模式的默认 `.srt` 烧录:libass 原生支持字体/字号/颜色/描边/底部边距,ffmpeg subtitles filter 现成消费,不引新依赖。
- 三种模式的时间轴来源:
  - talking-head-broll:已有 ASR 原话 `rawTranscript`;
  - illustration-tts:已有逐幕 TTS 时长(`alignedActs`);
  - ppt-narration(无配音):按分镜时长把该幕文案铺排。
- 颜色写 ASS 的 `&HAABBGGRR` 格式,由 captionStyle 的 `#RRGGBB` 转换。
- 字体收敛为 macOS 自带中文字体白名单(苹方 PingFang SC 等),不做字体上传(风险预记:`.ass` 指定字体依赖系统已装)。
- 路径转义沿用本期刚修复的 `escapeSubtitlesFilterPath` 两级转义。
- **去重规则**:带 `templateId` 且模板配了 `captionStyle` 的真人出镜任务,worker 跳过原有的默认 `.srt` 烧录(由包装段统一烧 `.ass`),避免双层字幕;无模板任务行为不变。

### 3.3 BGM 混音

- BGM 以 `-stream_loop -1` 循环补齐,`trim`/`-shortest` 对齐正片时长;`volume=<bgmVolume>` 压低后与人声 `amix=duration=first`。
- ppt-narration 无人声:BGM 即唯一音轨(直接 mux,复用 `buildMuxAudioArgs` 范式)。
- v1 固定音量、不做 sidechain 闪避(效果可预期;闪避列为后续可选)。

### 3.4 片头/片尾拼接

- 拼接前 probe 正片尺寸,片头片尾 `scale+pad` 对齐(复用十九期竖屏兼容做法)。
- 统一重编码(视频 libx264 / 音频 aac),**不走 `-c copy`**(十九期实测过 copy 拼接漂移坑);片段无声则以 `anullsrc` 补静音轨,保证 concat 各段流结构一致。

### 3.5 代码落点

- `src/lib/video/ffmpeg.ts`:新增纯参数构造函数(BGM 混音、重编码拼接、静音轨补齐),维持"纯函数单测 + 真实 ffmpeg 集成测试"双层模式。
- `src/lib/video-production/packaging.ts`(新):`.ass` 生成器(样式映射 + 三种时间轴转换)与包装编排(三步串接、逐步落中间产物)。
- `src/jobs/workers/video-production-worker.ts`:master 完成后按 `templateId` 进入 packaging 分支,只做调度不含 ffmpeg 细节。

## 4. API

| 路由 | 说明 |
|---|---|
| `GET/POST /api/v1/video-templates` | 列表(含首访播种)/ 新建 |
| `GET/PUT/DELETE /api/v1/video-templates/[id]` | 详情 / 更新 / 删除(连素材目录) |
| `POST /api/v1/video-templates/[id]/duplicate` | 复制模板;素材**复制文件本体**到新模板目录(只复制引用会在删除原模板时悬空) |
| `POST /api/v1/video-templates/[id]/assets` | 上传素材,`kind=bgm\|intro\|outro`,校验后落 `<root>/<templateId>/` 并回写对应字段 |
| `POST /api/v1/video-templates/[id]/script` | 文案生成:`source=paste\|inspiration` + 正文/灵感 id → 注入 `scriptPrompt` 调六幕写稿管线 → 返回六幕稿预览(不落库) |
| `POST /api/v1/video-templates/[id]/produce` | 发起出片:`contentId`(已定稿)或确认后的六幕稿(自动建卡)+ 可选 voice 覆盖 → 创建带 `templateId` 的 `VideoProduction`(真人出镜模式沿用"等上传再入队"的现有节奏) |

写稿注入点:`src/lib/llm/prompts/script-write-douyin.ts` 现有六幕 prompt 增加可选的模板提示段(tone/时长/钩子),无模板时输出与现状完全一致。

## 5. 模板页流程与 UI

侧栏新增「模板」项(位置在「创作组」之后)。页面三块:

1. **模板列表**:卡片陈列(名称、交付模式徽标、风格/音色/包装摘要),操作=用它出片 / 编辑 / 复制 / 删除;首访自动播种 3 预设。
2. **模板编辑器**:分区表单(基本信息 / 交付模式与画面 / 配音预设 / 写稿提示 / 字幕样式 / BGM 上传 / 片头片尾上传),素材上传即存服务端。
3. **出片向导**(步骤随模板动态收缩):
   1. 定文案:三 tab——选已定稿 / 粘贴新写 / 从灵感出稿;后两种先展示六幕稿预览,确认时自动落内容卡,可退回重写。
   2. 传素材:仅真人出镜模板出现(复用现有上传控件与校验)。
   3. 确认配音:仅插画 TTS 模板出现,默认带出 `voicePreset` 可临时改;其余模式自动跳过。
   4. 生成与审片:创建任务 → 进度面板复用十九期现成组件(排队→合成→预览就绪→审预览→确认→master+包装→下载)。

页面底部:**本模板的历史出片列表**(状态/成片下载),支撑"对同一模板不断调整"的迭代用法。

## 6. 测试与验收

- **单元层**:ffmpeg 新参数构造器全部纯函数单测;`.ass` 生成器重点测样式字段映射(`#RRGGBB`→`&HAABBGGRR`、位置/边距)与三种时间轴转换;模板 CRUD、播种幂等(跑两次不重复)、素材上传校验、复制含素材文件各覆盖 API 测试。
- **真实 ffmpeg 集成层**:沿用 lavfi 纯色素材 + 抽帧验色手法——BGM 混音后验音轨存在与总时长不变;片头片尾拼接后在片头/正片/片尾时间点抽帧验色、验总时长;`.ass` 中文样式字幕真实烧录跑通。
- **E2E 走查**(合并前,十九期惯例):三个预设模板各真实出一条片(真人出镜用真实素材、插画走真实火山 TTS),验证包装三件套实际生效;粘贴文案与灵感出稿两条路各走一遍,确认内容卡正确落库。

## 7. 范围外(明确不做)

- sidechain BGM 自动闪避;字体文件上传;`.ass` 动画字幕特效。
- 内容详情页生成入口接模板(保持现状)。
- 预设 BGM 素材库(版权由用户上传自担)。
- 预览(preview)阶段的包装渲染。

## 8. 风险

| 风险 | 处置 |
|---|---|
| `.ass` 字体依赖系统已装 | 字体白名单收敛为 macOS 自带中文字体;E2E 真实验证渲染效果 |
| 包装三步串接的中间产物膨胀 | 每步落 `productionRoot` 内命名中间文件,`done` 后按需清理(保留最终成片与未包装 master) |
| 外部 API/ffmpeg 契约假设 | 十九期教训:一切 ffmpeg 组合先真实集成测试再定实现;不信任 `-c copy` 拼接 |
| 粘贴/灵感出稿的自动建卡与现有看板语义冲突 | 建卡走现有创建路径(与 CreateContentModal 同一服务端逻辑),不绕过 bumpCockpitRev |
