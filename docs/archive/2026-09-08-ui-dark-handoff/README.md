# MediaPilot UI 重做 — 设计交付

## 交付物

| 文件 | 用途 |
|---|---|
| `mediapilot-ui.html` | 可直接打开的高保真样板：14 个页面 + 设计系统页，左侧导航可切换 |
| `tokens.css` | 设计令牌（CSS 变量），可直接 `@import` 进 `globals.css` |
| Figma 文件 | `https://www.figma.com/design/fAiyRKInK5iHP53FyKYI5b` — Foundations / Components / Screens |

## 设计方向

Linear 风高密度工具界面。三条原则贯穿所有页面：

1. **每个数字都带口径和样本量。** 样本不足时直接写「说明不了任何规律」，不让人过度解读。
2. **空态解释原因 + 给下一步动作。** 「暂无数据」是没用的；「当前发布 0 条，所以还没有数据源」才有用。0 和「没数据」是两件事，用 `--text-disabled` 的 `—` 表示后者。
3. **状态双重编码。** 断链/积压/等待用颜色 + 文案同时表达，不只靠颜色。

## 状态色的语义（不要挪用）

| Token | 含义 | 页面里的例子 |
|---|---|---|
| `--success` | 链路通 / 已完成 / 满分 | 快回路运行中、时长偏差 10/10 |
| `--warning` | 等你处理 / 偏离预算 / 样本不足 | 分镜待确认、幕超时、雷达堆积 |
| `--danger` | 断链 / 失败 / 0 分 | worker 未运行、平台合规 0/4 |
| `--info` | 系统正在跑 | 排队中、渲染生成中 |
| `--soft` | 软指标（AI 判断出来的分） | 软指标未评分、书摘素材 |

`--accent`（靛蓝）只用于主操作和"当前位置"，不参与状态表达。

## 布局骨架

```
┌─ sidebar 224 ─┬─ topbar 58 ────────────────────────┐
│ 品牌          │ 标题 + 一句话说明        操作按钮  │
│ 总览          ├────────────────────────────────────┤
│ 工作区 ····   │ body: padding 18/24, gap 16        │
│ 生产   ····   │  banner → filters → 内容           │
│ 分析   ····   │  主栏 flex:1 + 右栏 360 固定       │
│ worker 状态   │                                    │
│ 设置          │                                    │
└───────────────┴────────────────────────────────────┘
```

写稿编辑器是唯一的三栏：`时长分配 236` + `幕编辑 flex:1` + `评分面板 340`。

## 接进 Next.js

1. 把 `tokens.css` 放进 `app/tokens.css`，在 `app/globals.css` 顶部 `@import "./tokens.css";`
2. `mediapilot-ui.html` 里的 `<style>` 段就是组件样式表，可整段搬进 `globals.css`，类名（`.card` `.btn` `.badge` `.track` `.metric` `.tabs`）保持不变。
3. 想走 Tailwind 的话，在 `tailwind.config.ts` 里映射：

```ts
theme: { extend: {
  colors: {
    bg:      { canvas:'var(--bg-canvas)', base:'var(--bg-base)', surface:'var(--bg-surface)',
               hover:'var(--bg-surface-hover)', elevated:'var(--bg-elevated)', inset:'var(--bg-inset)' },
    line:    { subtle:'var(--border-subtle)', DEFAULT:'var(--border-default)', strong:'var(--border-strong)' },
    fg:      { DEFAULT:'var(--text-primary)', 2:'var(--text-secondary)', 3:'var(--text-tertiary)', 4:'var(--text-disabled)' },
    accent:  { DEFAULT:'var(--accent)', hover:'var(--accent-hover)', subtle:'var(--accent-subtle)', line:'var(--accent-border)' },
    ok:      { DEFAULT:'var(--success)', subtle:'var(--success-subtle)' },
    warn:    { DEFAULT:'var(--warning)', subtle:'var(--warning-subtle)' },
    bad:     { DEFAULT:'var(--danger)',  subtle:'var(--danger-subtle)' },
    info:    { DEFAULT:'var(--info)',    subtle:'var(--info-subtle)' },
    soft:    { DEFAULT:'var(--soft)',    subtle:'var(--soft-subtle)' },
  },
  fontFamily: { sans:'var(--font)', mono:'var(--mono)' },
  borderRadius: { sm:'4px', md:'6px', lg:'8px', xl:'12px' },
}}
```

4. 字体：中文走系统字体（PingFang SC / 微软雅黑），不要引中文 webfont——一个 Noto Sans SC 全量包好几 MB。数字和 ID 走 JetBrains Mono，从 Google Fonts 引。

## Figma 与代码的对应

| Figma | 代码 |
|---|---|
| Tokens 变量集合 | `tokens.css` 的 `:root` |
| Text Styles（14 级） | `.t-display` … `.m-xs` |
| Button / Badge / Input / NavItem / MetricTile / ScoreBar | `.btn-*` / `.badge.*` / `.search` / `.nav` / `.metric` / `.track` |
| App Sidebar 组件 | `.sidebar` |

## 还没做的

- Figma 里只补齐了「总览 / 写稿编辑器 / 成片」三屏（免费版 MCP 调用次数用完了），其余 11 屏在 HTML 里是完整的，可以照着补。
- 浅色主题：这次按你选的方向只做了深色。要加的话，把 `tokens.css` 的 `:root` 复制一份到 `[data-theme="light"]` 覆盖即可，组件样式一行都不用改。
- 移动端：这套是桌面后台，断点还没做。
