# 横版成片设计（一条片子一种版式，开始时选）

- 日期：2026-10-04
- 状态：待用户审阅
- 前置：系统内出片（`docs/superpowers/specs/2026-10-03-film-in-app-design.md`）、抖音竖屏安全区（`remotion/kit/tokens.ts` 的 `ZONE` / `DOUYIN_OVERLAYS`）

## 1. 目标

有些内容适合横版（便于展示素材和操作），竖版更适合口播。出片时可以选横版：画面 1920×1080，素材与录屏尽量大，不被播放平台的界面挡住；出片流程（镜头表 → 检查 → 关键帧 → 渲染 → 登记）与竖版一致。

## 2. 已确认的决策

| 问题 | 决定 |
|---|---|
| 横竖关系 | 按内容选版式；一条片子只出一种，不同时出横竖两版 |
| 人物 | 小窗常驻（同竖版） |
| 投放平台 | 未定，先按通用 16:9 安全区，定了再调数值 |
| 方案 | A：版式是片子目录的属性，开始出片时选；kit 按版式取画框与区块；不复制 kit、不做竖转横 |
| 真机验收 | 用「U盘干到品类第一（验收）」 |

## 3. 横版布局（1920×1080）

```
┌────────────────────────────────────────────────────────────┐ 0
│            （顶部 120：平台标题栏 / 暂停浮层）                │
├──────────────────────────────────────────┬──────────┬──────┤ 120
│                                          │ 人物小窗  │      │
│   内容区 1360×765（正好 16:9）             │ 336×448  │      │
│                                          ├──────────┤      │ 568
│                                          │ 段落标题  │      │
├──────────────────────────────────────────┤ 336×317  │      │ 885
│ 字幕 1360×100                             │          │      │
└──────────────────────────────────────────┴──────────┴──────┘ 1005
  左右各留 96；底部 75 留给平台进度条 / 控件
```

| 区块 | left | top | width | height |
|---|---|---|---|---|
| 内容区 content | 96 | 120 | 1360 | 765 |
| 人物小窗 pip | 1488 | 120 | 336 | 448 |
| 段落标题 title | 1488 | 568 | 336 | 317 |
| 字幕 captions | 96 | 905 | 1360 | 100 |

- 内容区正好 16:9：任何分辨率的全屏录屏等比缩放即可铺满，不裁。
- 通用遮挡区 `LANDSCAPE_OVERLAYS`：顶部 0–120、底部 1005–1080、左右各 96。所有区块不得与之相交。
- 竖版数值（`ZONE`、`DOUYIN_OVERLAYS`、画框 1080×1920）完全不变。

## 4. 实现

### 4.1 kit（`remotion/kit`）

- `tokens.ts`：新增 `Orientation = 'portrait' | 'landscape'` 与 `LAYOUT: Record<Orientation, { W; H; ZONE; OVERLAYS }>`。`portrait` 用现有数值；`W`、`H`、`ZONE`、`DOUYIN_OVERLAYS` 保留为竖版的名字（旧片子与测试不改）。
- 版式通过 React context 传递：`OrientationProvider` / `useLayout()`。`Frame` 与 `Captions` 用 `useLayout()` 取区块与字幕宽度；没有 provider 时为竖版。
- 字幕排版沿用 `captionLayout(text, zoneWidth)`，宽度取当前版式的字幕区宽。

### 4.2 片子目录

- `data.json` 增加 `orientation`（`portrait` | `landscape`）；缺省 = 竖版。
- `index.tsx`（脚本生成、出片时不改）：按 `data.orientation` 取 `LAYOUT` 的 W/H 设 Composition 尺寸，并用 `OrientationProvider` 包住 `Film`。`Film.tsx` 不需要也不应该关心版式。
- 旧片子（v1–v3）的 `index.tsx` 不改，仍是竖版。

### 4.3 命令行

- `mp film new <项目> [--landscape]`：带 `--landscape` 时写 `orientation: "landscape"` 并生成横版 `index.tsx`；不带时与现在完全一致。
- `mp film check <片子目录> [--expect landscape|portrait]`：输出里打印版式；`orientation` 不是这两个值 → 不通过；带 `--expect` 且与目录版式不符 → 不通过（"要横版，但这个片子目录是竖版：用 film new --landscape 重建"）。

### 4.4 出片助手（网页）

- 空闲状态：「出一版」旁加 竖版 / 横版 选择（默认竖版）。
- 「改这一版」沿用所选基础版本的版式（读该版本登记时记下的版式，没有记 = 竖版）。
- 接口：`start` 增加 `orientation`；`FilmSession` 增加 `orientation` 字段（默认 `portrait`）。
- 首轮消息（横版）："给项目 <id>（<标题>）出一版**横版**成片（画面 1920×1080）。用 `npm run -s mp -- film new <id> --landscape` 建片子目录，检查时用 `film check <目录> --expect landscape`。<要求>"；改片同理加上"横版"与这两条命令。竖版消息不变。
- 白名单不变（`film new:*`、`film check:*` 已覆盖带参数的形式）。

### 4.5 produce-film skill

加「横版」一节：看 `data.json` 的 `orientation`；横版内容区 1360×765；录屏和操作演示素材优先整块铺满内容区；卡片可以横向并排、字多一些；其余流程不变；检查时带 `--expect`（若开始时被要求了版式）。

### 4.6 登记与展示

- `film register`：从片子目录 `data.json` 读 `orientation` 写进版本元数据（`meta.orientation`）。
- `FilmView` 增加 `orientation`（没有 = 竖版）；成片列表里横版标「横版」，视频全宽播放；竖版不变。

## 5. 出错处理

| 场景 | 行为 |
|---|---|
| `data.json` 无 `orientation` | 按竖版 |
| `orientation` 值不认识 | `film check` 不通过 |
| 要横版但建成竖版（忘了 `--landscape`） | `film check --expect landscape` 不通过，它会重建 |
| 改片基础版本没记版式 | 按竖版 |

## 6. 测试与验收

- 单元：横版各区块不与 `LANDSCAPE_OVERLAYS` 相交、左右留 96、内容区正好 1360×765；竖版数值不变（现有测试不动）；横版长字幕每行不超 1360；`film new --landscape` 写 orientation 与 1920×1080 的 `index.tsx`，不带参数时输出与现在一致；`film check` 打印版式、不认识的值与 `--expect` 不符都不通过；登记记下版式、旧版本显示为竖版；出片助手的版式选择、改片沿用基础版本、横版首轮消息；成片列表的「横版」标记。
- 本地渲染：用骨架片子出一张横版关键帧，叠上遮挡区检查四个区块都在外面。
- 真机（会用订阅额度）：「U盘干到品类第一（验收）」选横版「出一版」→ 停在镜头表 →「可以，继续」→ 停在成片 → 叠遮挡区检查 → 用户决定是否登记。

## 7. 不做

同一条内容同时出横竖两版；竖版成片自动转横版；针对具体平台（B站 / YouTube / 视频号）的遮挡区——平台定了再按截图调数值；小窗可开关。
