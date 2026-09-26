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

## 9. 实施记录

11 个任务(T1-T10 + T10b 补缺 + T11 本收尾)全部完成,合并前全量 `npx vitest run`(151 文件 /
1833 用例)与 `npx tsc --noEmit` 全绿。

### 9.1 实际实现与设计的偏差

- **`filter_complex` 里 `?` 可选流标记的语义与预期不符**(T4, 片头/片尾重编码拼接):设计时
  假设每路视频写 `[i:a?][anull:a]amix=...` 能让缺音轨的流被静默跳过(套用 `-map` 里 `?` 的
  "可选映射, 缺失跳过"语义)。真实 ffmpeg 9.0.1 实测:`?` 在 filtergraph linklabel 里只对
  "未知/延迟绑定"生效, 流**确实不存在**时直接报错退出, 不是静默跳过。改为 `buildConcatWithReencodeArgs`
  新增可选入参 `hasAudioFlags?: boolean[]`, 由调用方 `attachIntroOutro` 用 `hasAudioStream`
  逐路探测后传入, 纯函数据此在"有音轨用 `[i:a:0]` 显式索引"与"无音轨直接用静音源当该路音轨"
  之间显式二选一。
- **`anullsrc` 兜底静音源的无限时长在"该路真正只有静音"分支会拖长整体输出**(T4, 同一处):
  修完上一条后, concat 的 `a=1` 段落要等所有参与流到达 EOF 才切下一段, 未裁剪的
  `anullsrc -t 3600` 会把整条输出拖到 3600 秒量级。改为再加一个可选入参
  `durationsSec?: number[]`, 用 `probeVideo` 探测真实时长后对静音源做 `atrim` 裁剪。两处修正
  都只加可选参数, 不改变原有纯函数单测的断言。
- **BGM 混音 filter 标签改用显式音轨索引**(T3 复审):`[0:a]/[1:a]` 与项目已确立的
  `0:a:0` 显式索引约定(源于十九期 iPhone `.mov` 多音轨踩坑)不一致——虽实测 ffmpeg 对歧义标签
  会静默取第一条流, 但不应依赖未文档化的默认行为, 改为 `[0:a:0]/[1:a:0]` 并补真实多音轨源
  集成测试固化。
- **图文口播模式的兜底字幕源从"分镜 `claim` 字段"改为解析 `vp.srt`**(T6):brief 原计划假设
  用 `direction.json` 里每个镜头的 `claim`(导演给的语义摘要)当字幕文本。协调者复核后裁决两个
  选项都不取——`claim` 是摘要不是台词, 烧成字幕会让屏幕出现观众没听到的抽象总结; 返回空数组
  又会让图文口播模式(全程无配音, 字幕是获取文字的唯一途径)配了 `captionStyle` 却什么都不出。
  改为新增纯函数 `captionEventsFromSrt`(`src/lib/video-production/ass-captions.ts`)解析
  `VideoProduction.srt`(六幕脚本→SRT 的既有产物, 时间轴天然对齐、粒度到句), worker 侧因此
  删掉了原计划要读 `direction.json` 的 `loadShotCaptionEvents` 辅助函数。
- **模板驱动出片(`produce` 路由 `script` 分支)落库 `ScriptDraft.output` 的形状曾短暂偏离
  又被审查纠正回设计**(T9 → 审查修复):T9 最初为了让 brief 给定的测试通过, 把 `output`
  写成扁平 `{acts, four_dims}` 并绕开了 `parseDraftOutput`(brief 顶层接口清单本就没列它)。
  审查发现 `video-production-worker.ts` 的三处消费点(真人出镜/插画配音/字幕加载)全部只认
  `parseDraftOutput` 的嵌套判别口径 `{script:{acts}, four_dims}`, 扁平形状会让模板页"粘贴
  新写"/"灵感出稿"两条来源建卡后, 在真人出镜/插画配音模式下直接抛错"需要先生成六幕脚本"。
  修复为写库改回嵌套形状、`contentId` 分支读取改用 `parseDraftOutput`, 与
  `cockpit/video-productions/route.ts`、worker 保持同一判别入口(测试夹具与新增跨路径一致性
  测试一并修正, 详见下文 9.2)。
- **出片向导「确认配音」步骤与「历史出片列表」两处功能缺口, T10 先做只读/临时降级, T10b 补齐
  后端契约后转正**:T10 实现前端时发现 `produce` 路由请求体不接受一次性音色覆盖、也没有按
  `templateId` 查历史出片的接口, 于是把「确认配音」做成只读展示+引导去编辑器改, 「历史出片
  列表」做成仅当次向导会话内的临时前端状态(刷新即丢)。T10b 补上这两处后端契约(`produce`
  请求体新增可选 `voiceOverride`, worker 侧音色优先级链改为纯函数 `resolveTtsVoiceSelection`
  消费; 新增 `GET /api/v1/video-templates/[id]/productions`, `select` 精简掉大字段)后,
  「确认配音」改为可编辑覆盖、「历史出片列表」改为持久化查询, T10 报告里记录的这两条"依据"
  已不再是当前行为, 以 T10b 为准。

### 9.2 审查抓到的真问题及修复

- **模板页 CSS 缺失结构性样式 + 6 个写操作(保存/文案生成/发起出片/复制/删除/素材上传)缺少
  错误处理**(review 后 `6c3a137`):`cockpit.css` 没有补 `template-*` 系列样式(卡片网格/
  步骤条/tab/素材网格), 组件挂载即错位; `handleSave`/`handleGenerateScript`/`handleProduce`/
  `handleDuplicate`/`handleDelete`/`handleAssetUpload` 六处网络失败时用户拿不到任何提示,
  其中复制/删除**不检查响应就假装刷新成功**(网络失败时 UI 显示"已删除"但记录其实还在)。
  修复:补齐 CSS(全部走既有设计变量, 不写死 px)+ 六处 catch 补用户可见错误提示 + 复制/删除
  改为先查响应再刷新; 新增 9 个边界用例(零模板空态/加载中/请求失败/上传失败等), 用"还原到
  审查前提交"的方式验证过先红(7 failed)后绿(14 passed)。
- **`ScriptDraft.output` 嵌套形状偏离**(见上文 9.1 最后一条),按真问题记录一次: 若不修复,
  模板页三种文案来源里的"粘贴新写"与"从灵感出稿"两条(唯一会真正新建 `ScriptDraft` 的路径)
  会在真人出镜与插画配音两种交付模式下 100% 失败。
- **`deliveryMode` 类型收窄**(`f988870`):`VideoTemplateConfig.deliveryMode` 最初复用
  `DeliveryMode`(含 `'manual'`), 但模板语义上不可能是 `manual`(模板一定驱动某条 AI 生成
  管线), zod schema 因此需要一层与 TS 类型不同步的"双重断言"。改为
  `TemplateDeliveryMode = Exclude<DeliveryMode, 'manual'>`, 类型与 schema 重新对齐。
- **worker 侧音色优先级链缺可回归测试**(T10b 审查修复):`resolveTtsVoiceSelection` 纯函数
  本身有单测, 但 worker 里"取哪个 `apiKey`/`voiceType`/`resourceId` 传给
  `synthesizeVolcTts`"这段接线最初只靠人工读 diff 确认。补了一个 mock `synthesizeVolcTts`
  的轻量 worker 级测试(`tests/jobs/video-production-worker.test.ts`), 并用"故意改回旧写法
  →确认真的变红→改回来"的方式验证测试有效(不是自我一致的摆设)。

### 9.3 遗留 minor(deferred)

以下均为审查判定"不影响正确性、留待后续", 摘自各任务收尾报告与 `progress.md`:

- `hexToAssColor` 不校验输入格式(当前唯一调用路径已过 zod 校验, 安全)。
- `bgmVolume` 纯函数层无边界校验(模板层 zod 已校验 0~1, 上游覆盖);无人声分支未像有人声
  分支那样断言音轨数恰为 1(覆盖不对称)。
- `hasAudioFlags`/`durationsSec` 做成可选参数, 生产路径永远传全, 存在两套隐含契约;
  `attachIntroOutro` 对有真实音轨的路也跑 `probeVideo`(atrim 边界舍入风险已评估可接受);
  集成测试未覆盖"只配片尾"组合。
- ~~`runPackaging` 不清理中间产物(`packaging-captions.mp4` 等), 留在 `workDir`。~~
  **已于 2026-08-24 合并后补上**: 包装全部成功后删除本函数自己产生的中间文件;
  `masterPath`(包装失败时的兜底交付物)与 `outputPath` 不动; 中途失败**不清理**——
  中间产物是排查"崩在哪一步"的现场证据; 删除失败静默忽略, 不让已成功的包装反过来失败。
- 包装段内 `refreshed` 重查 `videoProduction` 时 `rawTranscript`/`alignedActs` 与外层 `vp`
  等价, 可省一次 I/O(仅 `masterPath` 必须重查); `packaging-input.ts` 里
  `parsed.data as CaptionStyle` 断言可能可去掉; 模板存在但配置全空时仍会多一次
  `fs.copyFile` 生成 `packaged.mp4`。
- 同 `kind` 重复上传且扩展名变化时留孤儿文件(如先 `bgm.wav` 后 `bgm.mp3`);素材路由 5 处
  `findUnique`+归属校验+404 样板重复(抽象收益有限);`DELETE` 清理失败静默吞掉无日志。
- `buildTemplateSection` 参数用内联匿名类型而非引用 `VideoTemplateConfig['scriptPrompt']`
  (有意选择: 避免 prompt 层依赖 `video-template`/model)。
- 字幕颜色字段是纯文本输入无颜色选择器(无格式校验提示, 交给保存时后端 zod 报笼统错误)。
- 非 `illustration-tts` 模板传合法 `voiceOverride` 仍落库(无消费方读取), 功能上等价于"忽略"
  但不体现在是否落库; `produce/route.ts` 里 `voiceOverride ?? undefined` 写法略绕
  (沿用项目既有 `Json?` 字段惯用法)。

### 9.4 真实三模式 E2E:未执行,留待用户验收

本轮(T11)只做了不消耗外部 API 额度的本地走查(预设播种/幂等/编辑持久化/素材上传/复制悬空
防御/删除/出片向导步骤收缩/零迁移七项, 详见
`.superpowers/sdd/2026-08-23-video-template/task-11-report.md`), **没有真实调用 DeepSeek
写稿或火山引擎 TTS 走完任何一条模板出片流程**——会真实消耗用户的付费额度, 真人出镜那条还
需要用户本人的实拍素材, 均已明确划出本任务范围。

**走查手段的限制(重要)**: 走查期间浏览器自动化工具不稳定, 上述七项里多数是通过**直接调用
本地 API + 查库/查文件系统**核实的(路由与 UI 触发的完全相同), 出片向导步骤收缩靠读源码 +
既有 RTL 组件测试佐证, 零迁移靠 git diff 证明未触碰既有文件(当时库里没有既有内容卡可点)。
也就是说 **模板页至今没有被真人在浏览器里完整点过一遍**。本项目十四期的教训正是"dev 走查要
真点按钮而不是只 curl API"(StrictMode mountedRef 砖死 bug 即由此漏进终审), 因此
**用户首次在浏览器里走一遍模板页, 本身就是本期最关键的一道验收**: 请留意页面排版、按钮反馈、
刷新后状态是否符合预期, 而不只是关注出片结果。

**验收清单**(用户本人执行):

1. 三个预设模板(图文口播/真人出镜+B-roll/插画配音)各真实出一条片, 走完排队→预览就绪→
   确认导出。
2. 检查包装三件套是否实际生效: 成片带样式化字幕(非默认 `.srt` 观感)、BGM 可听见且音量
   与模板 `bgmVolume` 大致相符、片头/片尾若配置了则出现在成片首尾。
3. 真人出镜模式确认烧录的字幕样式来自模板 `captionStyle`(字体/字号/颜色), 而不是十九期
   遗留的默认 `.srt` 样式。
4. 插画模式确认配音音色用了模板 `voicePreset`(而不是设置页的全局火山 TTS 配置)——若出片
   向导「确认配音」步骤填了临时覆盖, 应以覆盖值为准。
