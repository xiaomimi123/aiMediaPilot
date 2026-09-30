> 2026-09-28 迁入 `remotion/kit/motion/`，只保留 `anim.ts`（时间 → 样式纯函数）；下文提到的 components.tsx、lib.tsx、cards/ 等文件未迁入，留在 git tag `v1-final`。

# 本目录代码来自 video-talkcraft

来源：https://github.com/Vincentwei1021/video-talkcraft
许可：PolyForm Noncommercial 1.0.0（见 `LICENSE-video-talkcraft`）
商用授权：本项目已取得作者书面授权函，覆盖将 `template/` 代码用于商业产品。

**本目录的文件可以修改**（授权允许），但每次修改要在文件内注明改了什么、为什么，
以便日后与上游对照。已知修改见各文件内的「本项目修改」注释，此处汇总一份索引：

- `components.tsx`（`NumberRoll` 的 `grouping` 默认关闭）—— 上游写死
  `toLocaleString('en-US')`，实测把 `1850%` 渲成 `+1,850%`；百分比、年份、编号
  加逗号都是错的，而这几类比金额更常见。
- `components.tsx`（`NumberRoll`）+ `lib.tsx`（`roundToSourceDecimals`）+
  `cards/Stat.tsx` —— 上游末帧定格值一律 `Math.round(to)`，实测把 facts 台账里
  `32.2%` 这类非整数 `stat.value` 渲成整数 `32%`。这个项目的事实护栏要求画面
  数字必须与出处逐位一致，取整取到整数就静默改写了台账里的值，属于同一类
  「上游对数字呈现做了想当然的假设」——现在取整精度跟随 `to`/`value` 自身的
  小数位数，末帧定格值与源值完全相等。

**设计语言只用 `lib.tsx` 那一套**（纸白 / 墨蓝 / 黄红）。`theme.ts` 是另一套深空色系，
两套混用会串味；本期不用它，保留仅为将来评估。

**`pencil.tsx` 本轮有意未搬（不是漏了）。** 上游这个文件依赖 `@remotion/paths`
（`getLength` / `getPointAtLength`）做手绘描线效果。`@remotion/paths` 本身不是陌生的
第三方包——它是 Remotion 官方子包，同 scope 同版本线——但本轮四张卡片
（`statement` / `stat` / `contrast` / `list`）都不需要手绘描线，装了这个依赖也换不来
任何东西（YAGNI）。同时，「本项目依赖只有 react + remotion」这句话是这次技术选型的
理由之一，多一个包就要多一句解释。所以本轮**不复制 `pencil.tsx`，也不安装
`@remotion/paths`**。将来真要做手绘效果时，把 `pencil.tsx` 和 `@remotion/paths`
一起加进来——那时是睁着眼加的，不是搬运时顺手带进来的。

## 精简记录（复审后第二轮裁定）

代码审查发现：搬进来的 12 个文件里约 60% 本期用不上，且三个问题（`tsc` 报错、
`theme.ts` 被违规 import、`Subtitles` 同目录同名重复）全部出自那 60%。裁定是把
搬运集合缩到本期四张卡（`statement` / `stat` / `contrast` / `list`）真正需要的部分。

**保留：**
- `lib.tsx` —— 调色板 `C`、`FONT_CN`/`FONT_MONO`、缓动与工具函数，四张卡的地基。
- `components.tsx` —— 动效零件（`NumberRoll`、`FlowerWord`、`SmashWord`、
  `HighlightSweep`、`Chip`、`DrawPath`、`BeatHit`、`Subtitles` 等），卡片内容直接用。
- `camera.tsx` —— 相机层（`CameraRig` / `Plane`）。
- `life.tsx` —— 让位生命周期（`Live` / `Defocus`）。
- `env.tsx` —— 环境层（`Environment` / `GridField`）。
- `transitions.tsx` —— 转场（`ShotFade` / `Overexpose` / `Shatter` / `ParticleDrift` 等）。
- `theme.ts` —— 按上面「设计语言只用 lib.tsx」的既有约定保留供将来评估，
  **不允许有任何 importer**（已用 grep 复核，见 task-2-report.md）。

**有意删除（不是遗漏，上游 `~/Desktop/remotion-spike/video-talkcraft` 随时能补回）：**
- `timing.ts` —— `import timingData from './timing.json'`，但 `timing.json` 从未搬进来，
  导致 `tsc` 报 `TS2307`。这条时间基本期没有消费者。
- `shots.ts` —— 唯一用途是 `import {timing} from './timing'`，随 `timing.ts` 一起断链，
  且四张卡不需要它的镜头脚本抽象。
- `Subtitles.tsx`（motion 目录下这个，区别于 `components.tsx` 里同名的那个）——
  深空配色 + 依赖 ASR 逐字数据，和 `components.tsx` 的 `Subtitles`（纸白配色，
  我们要用的那个）同目录同名不同实现，是明显的踩坑点。且它 `import {C, FONT}
  from './theme'`，违反「theme.ts 不许被 import」的约束。
- `ui.tsx` —— `import {C, FONT} from './theme'`，是 `theme.ts` 的违规 importer 之一，
  且四张卡的 UI 需求已由 `components.tsx` 覆盖。
- `Counter.tsx` / `hooks.ts` —— `Counter` 与 `components.tsx` 里的 `NumberRoll` 功能重叠
  （都是数字滚动展示），四张卡用 `NumberRoll` 即可；`hooks.ts` 的 `useSceneSec` 只有
  `Counter.tsx` 一个消费者，一并删除。
- `mascot.tsx` —— 吉祥物形变角色，四张卡（statement/stat/contrast/list）都是纯文字/
  数据卡片，不需要角色动画。
- `time.ts` —— 提供 `useAbs`/`useToLocal` 两个时间基收敛工具，但当前保留的文件里
  没有任何一处使用它（原本是配合 `timing.ts` 的镜头级时间基使用）；删掉。
