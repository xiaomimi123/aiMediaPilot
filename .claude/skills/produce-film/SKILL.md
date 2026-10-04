---
name: produce-film
description: 给 MediaPilot 项目出一条口播成片(竖版默认, 也可横版; Remotion, 风格 C 极客手账)。触发词:"给 X 项目出片"、"出片"、"改 X 项目的成片"、"重新出一版"。
---

# 出片

竖版(默认)画框: 1080×1920, 人物小窗右上角全程在, 底部字幕, 中间内容区(790×560, 位置见 `remotion/kit/tokens.ts` 的 `ZONE`)。你只创作内容区。上下与右侧会被抖音的频道栏、点赞列、作者文案挡住(`DOUYIN_OVERLAYS`), 内容区已避开它们, 所以内容区比画面窄: 竖版卡片按 790 宽设计, 字少一些、行数少一些。横版见下一节。设计依据: `docs/superpowers/specs/2026-09-28-film-production-design.md`。

## 横版

`data.json` 里 `orientation` 为 `landscape` 时是横版(1920×1080): 内容区 1360×765(正好 16:9), 右栏上面人物小窗、下面段落标题, 字幕在内容区下方; 遮挡区见 `remotion/kit/tokens.ts` 的 `LANDSCAPE_OVERLAYS`。
- 要横版时建片子用 `npm run -s mp -- film new <id> --landscape`(改横版的旧版本也一样)。
- 录屏和操作演示素材优先整块铺满内容区: `MediaIn` 传 `height={765}`、不套 `WindowFrame` 窗框(16:9 录屏等比铺满不裁); 卡片按 1360 宽设计, 可以横向并排、字可以多一些。
- 段落标题区只有 336 宽(在小窗下面), 标题要短。
- 不要改 `index.tsx`(版式由它决定, 改了 film check 不通过)。
- 被要求了版式时, 检查用 `npm run -s mp -- film check <片子目录> --expect landscape`。
- 其余流程与竖版相同(第 7 步看关键帧时按横版的内容区 1360×765 判断)。

## 流程(每一步都要做, 不许跳)

1. **找项目**: `npm run -s mp -- project list`(不熟悉命令时先 `npm run -s mp -- help`)。用户说的项目名对不上就问。
2. **读资料**: `npm run -s mp -- project export <id>`。读稿子、逐句转写、素材说明。
   - 视频素材: `mkdir -p /tmp/mp-film && ffmpeg -i <path> -vf fps=1/2,scale=480:-1 /tmp/mp-film/mat-<id>-%03d.jpg` 抽帧后逐张看; 图片直接看。
3. **建片子**: `npm run -s mp -- film new <id>` → 得到片子目录 `remotion/films/<id>-v<N>/`。
   - 修改旧版时: 建新版本后, 从旧版目录复制 `Film.tsx`、`copy.ts`、`shots.json` 过来再改, 旧版不动(同一版本不能重复登记)。
   - `film new` 提示"素材文件不在了, 已跳过"时, 告诉用户哪个素材丢了。
4. **排镜头表** `shots.json`: 按句子边界切成 2–8 秒的镜头(硬限制 1–12 秒), 首尾相接覆盖 0 到口播结束。每镜 `intent` 写这镜讲什么; 用素材时写 `material: { id, clipFromSec, clipToSec, speed }`。
   - 素材有说明 → 照说明放。没说明 → 看抽帧 + 转写自己判断放哪、截哪段。
   - 视频素材比镜头长: 先加速(≤2 倍), 还放不下就截最相关的一段; 比镜头短: 停在最后一帧或接一张卡。
5. **写画面**:
   - 画面上**所有文字和数字**写进 `copy.ts` 的 `COPY`; `Film.tsx` 里不写中文字面量和数字文本(film check 会查)。`copy.ts` 只放画面文字, 时间、编号等数据放 `Film.tsx`。
   - 镜头时间只来自 `shots.json`: `const at = fromShots(shots)`, 每镜写 `<Shot {...at.<镜头id>}>`, 不手写 `from`/`to` 秒数; 镜头表里每个镜头都要用到。
   - 只用 `remotion/kit` 的积木(Note、Kicker、Stat、StepList、Marker、Compare、Quote、Arrow、WindowFrame、MediaIn、Shot)与 `kit/motion/anim` 动效; 构图、节奏、积木搭配针对内容自己设计, 不要每镜同一种卡。
   - 数字只能用稿子或转写里出现过的; 没把握的不写数字。
   - 不替用户编经历、案例、效果数据。
   - `Frame` 的 `highlights` 放 1–3 个关键词(字幕荧光笔); `pipFocus` 按人脸位置调(默认 `'50% 20%'`)。
6. **检查**: `npm run -s mp -- film check <片子目录>`。有 ✗ 就改到通过。
7. **看关键帧**: `npm run -s mp -- film render <片子目录> --stills`, 用 Read 逐张看 `stills/*.png`:
   - 小窗里脸完整、没被裁歪; 内容不挤、不溢出、不被裁(竖版内容区只有 790×560, 横版 1360×765); 字能读清(手机上看); 中文字体正常;
   - 同一镜的积木对齐、留白舒服; 与上下镜的节奏有变化。
   - 有问题改完重跑第 6、7 步。
8. **渲染成片**: `npm run -s mp -- film render <片子目录>`(79 秒口播实测约 2 分钟; 卡片多时略久)。
9. **登记**: `npm run -s mp -- film register <片子目录> --summary "<这一版做了什么/改了什么>"`。
10. **告诉用户**: 成片版本号、时长、用了哪些素材放在哪、哪里做了取舍; 请用户在项目页「③ 成片」看片。

## 禁止

- 改 `remotion/kit` 来迁就一条片子(组件问题单独提出来, 用户同意后再改)。
- 在内容区之外放东西; 让素材带声音。
- 跳过第 6、7 步直接渲染成片。
