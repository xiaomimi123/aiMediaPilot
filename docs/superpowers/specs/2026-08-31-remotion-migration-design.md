# 出片管线迁移到 Remotion · 设计

> 二十五期。范围：三条交付链的渲染层全部换成 Remotion，并引入 video-talkcraft 的运动系统、组件库与字级对齐能力。原自建管线在新链路验收通过后成建制删除。

## 一、为什么迁

### 1.1 自建管线的结构性缺陷

现状是 HTML + GSAP 暂停态时间线 + Playwright 逐帧 `page.screenshot()` + ffmpeg 拼接。它有三个改不动的问题：

**合成发生在画面之外。** 画面与视频是两套东西，最后靠 ffmpeg 拼（`compositeCutawayVideo` 挖空替换 + ASS 烧字幕）。二十三、二十四期踩的一串坑根子都在这里：`handleRecompose` 与包装段绕过静止复检、预览里没有字幕所以画面永远缺一块、字幕 `marginV` 安全区要单独算一套。Remotion 里视频是合成的一等公民，这一整类问题消失。

**没有组合模型。** 我们的"时间线"是一条裸的 GSAP timeline，没有 track / clip / lane 的概念，所以轨道冲突、片段重叠这类结构问题**既查不出也描述不了**。

**调试循环不可用。** 改一版要"改代码 → 渲 7 分钟 → 抽帧读图"。反复调动效在这个循环下做不了。

### 1.2 实测数据

同一条 64 秒内容、同一份 TTS 配音，验货结果：

| | 自建管线 | Remotion + video-talkcraft |
| --- | --- | --- |
| 渲染耗时 | ~7 分钟（60 秒片） | **48.6 秒**（64 秒片 / 1918 帧，451% CPU 自动并行） |
| 音频 | ffmpeg 后期混流 | 合成里的一等公民 |
| 竖屏 | 需单独处理 | **同一份代码只改画幅参数即可**（运动系统全部用 `useVideoConfig`，无写死宽高） |
| 外部依赖 | Playwright + 一堆 | **只有 `react` + `remotion`** |
| 字级时间戳 | **没有** | 有（`timestamps_cpu.py`，64 秒音频 24 秒对齐完，16 句 15 句 `match=1.00`，低分句自动标出待人工核） |

### 1.3 一个曾被误用的数据点（记下来避免重犯）

曾以「Builder 写 HTML+GSAP 7/7 镜跑通」论证模型写代码可靠。**那个数据点无效**：那次出片 `templateId` 在 worker 读取时为 null，而画面体检的开关是 `vp.templateId ? shotDir(...) : undefined` —— **体检整关没跑**。离线补跑：7 镜仅 2 镜过四关（其中遮挡关还有误报）。引用"跑通"之前必须先确认检查真的执行了。

## 二、核心设计决定：Builder 不再写代码，改为填槽

**这是本期最重要的决定，它决定了其余所有设计。**

### 2.1 决定

Builder 的产出从"一个自包含的 HTML 文件"变成**一份受 schema 约束的结构化数据**：为每一镜选一个**卡片类型**，并填它的**槽位**。画面由我们预先写好的 Remotion 组件渲染，模型不接触坐标、不接触样式、不接触动效参数。

```ts
// 导演/Builder 产出的每一镜（替代现在的自由 HTML）
type ShotPlan = {
  shotId: string;
  startMs: number;
  endMs: number;
  card: CardType;                 // 从枚举里选，不是自由发挥
  slots: Record<string, SlotValue>; // 每种卡片有固定槽位与类型
  emphasis?: { at: number; slot: string }[]; // 强调时刻，受全片配额约束
};
```

### 2.2 为什么（三条实测证据，缺一不可）

1. **规则本身写的就是 PPT。** 二十四期实测确认：版面骨架下发了、模型也照做了，产出仍是幻灯片——因为骨架用的是幻灯片语汇。**只要画面由模型的审美决定，画质上限就是模型的审美。** 填槽把画质上限交给我们写的组件。

2. **零件库不会自己正确，模型更不会。** 验货时我**亲手**填坐标，仍然撞出元素重叠；`NumberRoll` 把 `1850%` 渲成 `+1,850%`（千分位写死）。这两个都不是模型的错——**版面约束和格式化必须由系统兜住**。让模型填坐标只会把这类错误变成常态。

3. **模型写 TSX 的可靠性是未知数，而我们不需要赌它。** 现在没有任何数据支持"模型能稳定写 Remotion 组件"。填槽把模型的职责压缩到它确实擅长的部分：**理解内容、选择表达形式、填文字**。

### 2.3 代价（明确接受）

- **画面形态被卡片库封顶。** 库里没有的构图，模型造不出来。缓解：卡片库可增长，且 video-talkcraft 自带 78 张卡作为起点。
- **导演要多做一步判断**（选卡片类型），提示词要教会它每种卡片用在什么时候。

## 三、架构

### 3.1 目录与边界

```
remotion/                      # 新增：Remotion 项目，与 Next.js app 同仓
  src/
    Root.tsx                   # 注册 composition（横屏/竖屏两个）
    Film.tsx                   # 顶层合成：读 inputProps 渲染整片
    cards/                     # 卡片组件库（画面的唯一来源）
      index.ts                 # CardType → 组件 的注册表
      <CardType>.tsx           # 每种卡片一个文件，槽位即 props
    motion/                    # 来自 video-talkcraft（授权已获），原样保留 LICENSE
      camera.tsx env.tsx life.tsx transitions.tsx Subtitles.tsx components.tsx lib.tsx …
    layout/                    # 我们写的版面约束层（见 §3.4）
```

`src/lib/video-production/` 保留导演/Builder 提示词与事实护栏；`shot-renderer.ts`、`ambient-rig.ts`、`shot-chrome.ts`、`frame-*.ts` 这些属于旧渲染架构，验收通过后删除。

### 3.2 渲染怎么被调用

worker 用 **`@remotion/renderer` 的 Node API**（不是 CLI），把整条片子的数据作为 `inputProps` 传进去：

```ts
await renderMedia({
  composition,                    // 'landscape' | 'portrait'，按模板 aspect 选
  serveUrl: bundleLocation,       // 预先 bundle 一次，复用
  outputLocation: previewPath,
  inputProps: {
    shots: ShotPlan[],
    timing: CharStamp[][],        // 字级对齐结果
    audioSrc, sourceVideoSrc?,    // 配音 / 出镜素材
    template: { aspect, captionStyle, brollEnabled, … },
  },
});
```

**一条片子一次渲染，不再有"分镜各渲各的再拼"这一步** —— 转场、字幕、音频、出镜素材全部在同一个合成里，`compositeCutawayVideo` 与 ASS 烧字幕整条路退役。

### 3.3 三条交付链在新架构下的区别

链路差异收敛成 `inputProps` 的差异，不再是三套渲染代码：

| 链 | 输入 | 合成里的表现 |
| --- | --- | --- |
| `ppt-narration` | 六幕稿 + TTS 音频 | 全部由卡片渲染 |
| `illustration-tts` | 同上 + `visualStyle: illustration` | 卡片库里的插画系卡片 |
| `talking-head-broll` | 上述 + 出镜视频 | 出镜视频作为一层 `<OffthreadVideo>`，卡片按 `ShotPlan` 的时间窗覆盖其上；**这就是"挖空替换"的原生实现** |

### 3.4 版面约束层（我们写，不外包给模型）

卡片组件内部使用**栅格 + 具名区域**，不接受任意坐标。安全区（字幕带、平台 UI 遮挡区）作为栅格的一部分声明，卡片不能越界。

`caption-safe-zone.ts` 现有的结论并非原样沿用：legacy 按画幅分流（横屏固定 100px，竖屏才用
`height × 350/1920`），而 `grid.ts` 的 `safeBox` 图简单，两种画幅一律用 `bottomPct = 350/1920`——
1080p 横屏算下来约 197px，比 legacy 的 100px 保守近一倍，代价是横屏卡片可用高度少约 97px。
这是有意选择的从严（安全的一侧），不是照抄；差异与代价见 `remotion/src/layout/grid.ts` 注释。

### 3.5 字级对齐进管线

新增一步，在 TTS 完成之后、导演之前：

```
TTS 出音频 → timestamps_cpu.py 做字级对齐 → timing.json → 存进 productionRoot
```

- 后端用 `faster-whisper small`（首跑下 460MB 模型，之后本地缓存），跑在项目自己的 venv 里，不污染系统 Python。
- **口播稿里的阿拉伯数字必须先转成汉字读法**（对齐按读音锚定，"1850" 对不上"一千八百五十"的读音）。这一步做成确定性函数，不交给模型。
- 工具对 `match < 0.90` 的句子会标"待人工核"。**这个信号要落库并上界面**，不能吞掉——它和"画面活跃度"是同一类东西：机器不确定的地方要让人看见。

## 四、体检层怎么变

现有五关全部基于 DOM 探针（Playwright 打开 HTML、读 `getBoundingClientRect`），Remotion 下这套探针不存在。逐条处置：

| 现有关 | 处置 | 理由 |
| --- | --- | --- |
| 整片静止（`freeze-check.ts`） | **保留，零改动** | 它读的是成片 mp4，与渲染器无关 |
| 空屏 / 空壳色块（`frame-density` / `frame-detail`） | **改为 `renderStill` 抽帧 + 现有像素判据** | 判据本身有效，只是取帧方式换了 |
| 版面 / 文字被裁 / 元素遮挡 | **大部分退役** | 这些是"模型自由排版"的产物；填槽架构下版面由组件保证，剩余风险由组件自己的单测覆盖 |
| — | **新增：字级对齐质量关** | `match < 0.90` 的句子计数与位置，只报不拦 |
| — | **新增：音效轨能量验证**（video-talkcraft 三重验收之一） | 本期可选，排在后面 |

**不新增"变化频率"体检** —— 二十四期用三种度量都无法把我们和参考片分开，参考片甚至有一段 15.4 秒不变。那是个会通过但没用的指标。

## 五、不做什么

- **不做"生成前剪辑台"**（用户已确认排在迁移之后）。
- **`handlePptNarrationRemotion` 分支不接文案叠加层（二十三期）与成片包装段（二十期，BGM
  混音/片头片尾/包装后静止复检）** —— 渲完直接 `return`，是明确的范围限制而非遗漏。目前没有
  任何 UI/API 路径能把 `VideoProduction.renderer` 置成 `'remotion'`，因此是休眠风险；worker
  在这条分支的 `return` 之前打一条 `console.warn`（模板开了 `textOverlayEnabled` 时会在日志里
  点出来），保证这个缺口一旦被触发就能被看见，而不是静默丢功能。接上这两段是后续计划的量。
- **不搬 HyperFrames 的规则库** —— 那是 GSAP 配方，Remotion 下要重写；video-talkcraft 提供的是 Remotion 原生同类能力。HyperFrames 保留为概念参考。
- **不在本期删除旧管线** —— 见 §六。
- **不动色调策略** —— 四条参考片帧均亮度 213/119/113/105，"亮底深字"不是通例，样本不支持定这条规矩。

## 六、迁移与删除的顺序

**先建后拆，不可颠倒。** 新链路跑通并经用户验收之前，旧管线一行不删。

1. Remotion 项目落地 + 一条链（`ppt-narration`）端到端跑通
2. 用户验收画面质量
3. 其余两条链迁移
4. **验收通过后**，一次性成建制删除旧渲染层（`shot-renderer.ts` / `ambient-rig.ts` / `shot-chrome.ts` / `frame-density|detail|layout|overlap.ts` / `preview-html.ts` / ffmpeg 的 `compositeCutawayVideo`、`concatClips` 出片路径、ASS 烧字幕）

删除必须是一次干净的删除，不是边建边拆——中途出问题时要能立刻退回旧链路出片。

## 六又二分之一、接线时必须做的一件事（二十六期留给下一份计划——已接线）

`buildFactsSection(acts, brief, mode)` 的第三个参数**默认是 `'freeform'`（旧链语义）**。
把 Builder 接成产 `FilmPlan` 时，**必须显式传 `'cards'`**，否则模型会同时收到
「条目数不少于 8 条」（旧链的自由排版密度建议）和 `list` 卡 `items` 上限 8 的 schema——
二十六期实测证实这组自相矛盾的指令正是 `list` 注水的根因（电池稿 6 条里 4 条编造）。
忘了传这个参数不会报任何错，只会安静地退回注水行为。

**现状（二十八期）：已接线。** `src/jobs/workers/video-production-worker.ts` 的
`handlePptNarrationRemotion` 分支调用 `buildFactsSection(acts, research, 'cards')`，
显式传了第三个参数，不再依赖默认值。这条约定已经被钉住，不再只靠注释提醒：
`tests/jobs/video-production-film-plan-wiring.test.ts` 里的
`'buildFactsSection 必须显式传 cards —— 默认的 freeform 会让 list 凑数'` 直接断言
生产分支源码里出现 `buildFactsSection([^)]*'cards')` 这个模式，传错、漏传都会让这条测试
变红。真机端到端跑通（见 `.superpowers/sdd/2026-08-31-builder-film-plan/task-5-report.md`）
也验证了这条接线在真实调用路径上确实生效。

## 六又四分之三、`contrast` 连接符——一条被推翻的原设计（二十八期）

原设计（`docs/superpowers/plans/2026-08-30-shot-composition-language.md` §「relation」）
写的是：「左区 + 中间连接符 + 右区。**连接符不能省** —— 它才是把两组东西连成一个论断
的东西；少了它就只是两张卡并排摆着。」据此，`contrast` 卡的 `connector` 槽位曾经是必填的
`'arrow' | 'versus' | 'plus'` 三选一，由 Builder 判断左右两组内容之间是哪种关系。

**二十八期用三轮真机实测推翻了这条原设计。** 3 条真实六幕稿 × 3 遍，每轮约 20 处
`contrast`：

| 轮次 | 总正确率 | arrow | versus | plus |
|---|---|---|---|---|
| 第四轮 | 64.7% | 33% | 90% | 0 次被选 |
| 第五轮 | 70% | 75% | 89% | 43% |
| 第六轮 | 61.1% | 40% | 56% | 100% |

三个总正确率在 n≈20 上彼此都落在噪声区间内，看不出谁比谁更准；更关键的是每一轮现象
一致：**只要收紧判定规程让某个取值变准，错误就整批迁移到另一个取值上**（比如第五轮把
`arrow` 从 33% 提到 75%，同一轮 `plus` 应声跌到 43%）——这是**零和搬运**，不是模型判断力
在变强。二十六、二十七期已经把"加例子"和"给可判定的判定规程"两条能想到的提示词改法都
用过，规程越写越细，正确率仍在同一区间摆动，说明这道判定题超出了当前可以靠提示词工程
解决的范围。

原设计的理由是"连接符不可省，否则不构成论断"——但**选错连接符本身就是在做一个原文没有
的关系断言**（"变成了" / "二选一" / "同时成立" 三选一，选错就是编了一个不存在的因果或
取舍）。这个项目的事实纪律一贯要求"素材里没有明确关系的，不许做成断言式图形"；一个
1/3 概率错的断言，比"不断言具体关系"更违反这条纪律。所以拍板推翻原设计：**`contrast`
去掉 `connector` 这道选择，改为渲染一个不表态的中性分隔件**——画面仍是"左右两组 +
中间有东西连着"，构图上仍然是一个整体，但不再断言具体是哪种关系。等将来有能实测到
85% 以上正确率的做法，再考虑把三个取值放回来。

改动落地在：`src/lib/video-production/shot-plan.ts`（`SLOTS.contrast` 去掉 `connector`
字段，`describeCardsForPrompt()` 对应说明改写；加了 `z.preprocess` 兜底历史落库数据里的
`connector` 字段）与 `remotion/src/cards/Contrast.tsx`（渲染层不再读 `connector`，画一条
左右对称、无方向性的线+点分隔件）。

## 七、风险

- **卡片库的覆盖面。** 起步阶段卡片种类不足时，导演会被迫把内容硬塞进不合适的卡片。缓解：先只迁一条链，用真实内容摸清缺哪些卡片再补。
- **video-talkcraft 的零件有缺陷。** 已实测发现：`NumberRoll` 的千分位写死（`1850%` 渲成 `+1,850%`）。搬进来的每个零件都要过一遍我们自己的单测，不能假定它正确。授权允许我们修改。
- **两套设计语言。** `motion-systems/theme.ts`（深空色系）与 `components/lib.tsx`（纸白/墨蓝/黄红）是两条不同路线，混用会串味。本期**只选一套**，另一套留待卡片库扩展时再评估。
- **竖屏的位移单位。** 相机 `x` 位移是 px，横屏调好的量到竖屏偏大，需要按画幅缩放。已知，不是硬伤。
- **bundle 成本。** Remotion 需要先 `bundle()` 再渲染。要确认 bundle 能复用而不是每条片子重来一次，否则会吃掉渲染速度的优势。**这一条在实施第一步就要量。**
- **Remotion 侧「环境运动层」缺口——二十六期已补上。** 端到端出片曾实测**静止占比 71%
  （9.9s / 14.06s）**：`Film.tsx` 当时只有 `AbsoluteFill + Sequence×Card + Audio`，没有接
  相机层也没有接环境层；唯一带运动的是 `motion/life.tsx` 的 `Live`，纯 yoyo、且只作用于单个文字
  元素，覆盖不到整个画面。搬进来的 `motion/camera.tsx`（`CameraRig`）与 `motion/env.tsx`
  （`Environment`）当时零引用。二十六期**没有照搬 `ambient-rig.ts` 的参数，也没有直接参数化
  `Environment`**（它的 `ACTS`/`EXPOSURE_HITS` 等是 video-talkcraft 那条片子自己的戏剧节拍，
  硬套会把别人片子的节奏叠到我们的内容上）：新写了一个不含内容相关节拍的 `motion/ambient.tsx`
  （`Ambient` 组件：呼吸 vignette + 对角扫光），并在 `Film.tsx` 里给每一镜套一层 `CameraRig`
  单调推近。参数由新框架里的真实 A/B 实测定出（不是沿用旧数字）——关键发现：决定成败的是**频率**
  而不是"单调 vs yoyo"的分类本身，8s/2.6s 这类慢周期的呼吸会在正弦折返点留静止段，把周期提到
  1.7s 就不会（折返点"导数趋零"的窗口本身撑不满 `freezedetect` 0.8s 的判定下限）；仍然叠加了
  单调扫光与逐镜的相机推近作为双保险，防止真实 `filmPlan`（镜长动态）撞上呼吸相位盲区。最终把
  这条 14 秒三镜样片的静止占比压到 **0%**。完整 A/B 表格、参数取舍与观感判断见
  `.superpowers/sdd/2026-08-31-remotion-foundation/ambient-layer-report.md`；回归测试见
  `tests/lib/video-production/ambient-layer.test.ts`（真渲染 + 真跑 `freezedetect`）。
