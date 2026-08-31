# 本目录代码来自 video-talkcraft

来源：https://github.com/Vincentwei1021/video-talkcraft
许可：PolyForm Noncommercial 1.0.0（见 `LICENSE-video-talkcraft`）
商用授权：本项目已取得作者书面授权函，覆盖将 `template/` 代码用于商业产品。

**本目录的文件可以修改**（授权允许），但每次修改要在文件内注明改了什么、为什么，
以便日后与上游对照。已知修改见各文件内的「本项目修改」注释。

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
