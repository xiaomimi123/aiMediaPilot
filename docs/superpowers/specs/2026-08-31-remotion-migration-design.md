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

`caption-safe-zone.ts` 现有的结论（按画幅把 `marginV` 抬到 `height × 350/1920` 以上，只抬不降）**保留**，改为栅格里的一条约束。

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

## 七、风险

- **卡片库的覆盖面。** 起步阶段卡片种类不足时，导演会被迫把内容硬塞进不合适的卡片。缓解：先只迁一条链，用真实内容摸清缺哪些卡片再补。
- **video-talkcraft 的零件有缺陷。** 已实测发现：`NumberRoll` 的千分位写死（`1850%` 渲成 `+1,850%`）。搬进来的每个零件都要过一遍我们自己的单测，不能假定它正确。授权允许我们修改。
- **两套设计语言。** `motion-systems/theme.ts`（深空色系）与 `components/lib.tsx`（纸白/墨蓝/黄红）是两条不同路线，混用会串味。本期**只选一套**，另一套留待卡片库扩展时再评估。
- **竖屏的位移单位。** 相机 `x` 位移是 px，横屏调好的量到竖屏偏大，需要按画幅缩放。已知，不是硬伤。
- **bundle 成本。** Remotion 需要先 `bundle()` 再渲染。要确认 bundle 能复用而不是每条片子重来一次，否则会吃掉渲染速度的优势。**这一条在实施第一步就要量。**
