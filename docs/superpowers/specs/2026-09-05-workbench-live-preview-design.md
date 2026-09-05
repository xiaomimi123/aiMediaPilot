# 剪辑台升级：动效接线 + 参数面板 + Player 实时预览 · 设计

> 三十二期。范围：让闲置的动效资产真正上片、给每一镜一层用户可调的样式参数、把剪辑台的静态卡面升级成实时预览。参考 [overlay-studio](https://github.com/jeszhou/overlay-studio) 的编辑工作台形态。

## 一、为什么做

### 1.1 资产闲置（用户 2026-09-05 提出的问题）

`remotion/src/motion/` 整个目录**零引用**。二十五期从 video-talkcraft 搬进来（已获书面商用授权）的动效组件——`FlowerWord`(花字)、`SmashWord`(砸字)、`HighlightSweep`(荧光笔)、`NumberRoll`、`DrawPath`(描线)、`Chip`、`BeatHit`(节拍冲击)、`TypeCode`(打字机)、`CameraRig`(运镜)、`transitions`(转场)——一张卡都没用上。四张卡各自手写排版 + 简单 `interpolate`。

搬进来的东西没接线，等于没搬。

### 1.2 剪辑台只能改字

三十一期的剪辑台能换卡、改槽位文字、调时长，**改不了任何视觉**。用户看到一镜「颜色不对/太慢/太大」时无处可调，只能重新生成碰运气——这正是 overlay-studio README 里点名的那个问题：「你想要的是改一下，它给你的是重新抽一次」。

### 1.3 静态卡面看不出动效

三十一期的预览是 `renderStill` 抽一帧。动效是时间的函数，单帧看不出来——**调不了自己看不见的东西**。二十四期已经用惨痛代价证明过这条：「改一版 → 渲 7 分钟 → 抽帧读图」的循环下，动效根本调不出来，最后整条渲染管线换掉才解决。

### 1.4 参考项目的验证价值

overlay-studio 的核心理念与我们二十五期的填槽契约**同源**：动效提前做好、AI 只挑卡对时间、不再现场发挥。它比我们多出来的是**可编辑深度**——每张卡一份声明式参数表，内容/节奏/样式/落位四组全部用户可调。这是一个独立项目对同一条路线的印证，也指出了我们缺的那一半。

## 二、三个决定（用户 2026-09-05 拍板）

1. **动效与卡片的关系：卡片自带动效。** 每种版式配好一套调好的动效，模型选卡即选了动效；剪辑台里换卡、调参数，不单独选动效。与现有填槽契约一致，也是 overlay-studio 走的路。
2. **预览形态：单镜循环 + 整片播放两种都要。** 单镜用于调这一张卡，整片用于看节奏。
3. **本期范围：地基优先，不扩卡片库。** 四张现有卡接动效 + 参数 + 预览打通全链路；新卡片（圆环/翻牌/曲线/排名条/人物名牌）留三十三期。理由：新卡的每一张都要「动效 + 参数 schema + 面板控件 + 预览」四件套，地基没定型就批量加卡等于每张返工一次。

## 三、动效怎么接

### 3.1 绕开绝对定位的坑

`motion/components.tsx` 的动效组件**全是绝对定位**（`x`/`y` 必填 props），与卡片的栅格 + flex 布局冲突。二十五期写 `Stat.tsx` 时已经撞过一次，当时的处理是手抄手法、不用组件（见该文件注释）。四张卡都接动效，不能抄四遍。

**做法：抽成样式计算纯函数。** 新建 `remotion/src/motion/anim.ts`，每个动效的「时间 → 样式」写成纯函数：

```ts
smashIn(frame, fps, atSec)      → {opacity, transform}
sweepHighlight(frame, fps, at)  → {backgroundSize, backgroundPosition}
beatHit(frame, fps, atSec)      → {transform}
slideIn(frame, fps, at, dir)    → {opacity, transform}
staggerIn(frame, fps, at, i)    → {opacity, transform}
drawLine(frame, fps, at)        → {strokeDashoffset}
```

卡片写 `<div style={smashIn(frame, fps, 0.3)}>`，位置仍归 flex。

**为什么不改造原组件**：原文件是授权搬运物，保持原样最干净；且双模式（absolute/flow）分支代码更脏。`anim.ts` 顶部注明每个函数的手法出处（`components.tsx` 的哪个组件），授权标注照 `motion/README.md` 既有体例。

**收益**：动效变成可单测的纯函数——与本项目其它判据（freeze-check / still-check / 时间轴校验）同一个路子。

### 3.2 四张卡各接什么

| 卡 | 动效 |
| --- | --- |
| statement | 主文案砸字进场；副文案延迟淡入上移；关键词荧光笔扫亮 |
| stat | 保留现有数字滚动；数字定格时节拍脉冲；label 淡入 |
| contrast | 左右两组分别从两侧滑入；中间分隔件生长描线 |
| list | 条目逐条落位（第 n 条延迟 n×0.12s） |

具体时长/幅度在实现时对着实时预览调，不在 spec 里写死。

## 四、参数模型

### 4.1 参数集合（克制）

每镜三个参数，落在 `shot.style`：

| 参数 | 范围 | 说明 |
| --- | --- | --- |
| `speed` | 0.3–3× | 这一镜的动画快慢 |
| `accent` | 主题 token 枚举（`default`/`blue`/`yellow`/`red`） | 强调色。**不给自由色盘**——限定在主题 token 内，保证不跑出设计系统 |
| `scale` | 0.6–1.6× | 卡片整体大小 |

**不做**：落位偏移（我们的卡是栅格铺满的，不是浮在画面上的小卡）、全局参数（要统一改后期做「应用到所有镜」批量操作）。

### 4.2 存在 FilmPlan 里，不是外挂 map

`ShotPlanSchema` 的每个 variant 加 `style?: ShotStyle`（`.strict()` 内显式声明）。

**为什么不外挂**：本会话已经吃过三次「两份数据的失效条件不对称」——bundle 快照、TTS manifest、timing.json。plan 与 style 存一起，删一镜天然带走它的样式，没有第二份东西需要同步。

### 4.3 模型不碰的三重保证

1. `describeCardsForPrompt()` 一个字不提 style
2. `buildFilmPlan` 产出后**剥掉** style（防模型意外填），注释写明理由
3. schema 里 style 为 optional——不填即合法，历史 plan 直接兼容

「重新生成分镜」会连同 style 一起覆盖——这是该动作的既有语义（已有确认框写明「当前修改会被覆盖」）。

### 4.4 参数面板声明式生成

抄 overlay-studio 的 `Control[]`：每张卡带一份控件声明（`range`/`select`），面板遍历生成 UI，加新卡时面板自动就有。

**跨项目约束**：卡片组件在 `remotion/` 子项目、参数面板在主项目，不能互相 import（二十五期 Ruling-1）。所以 **controls 声明放主项目** `src/lib/video-production/card-controls.ts`（纯数据无 React），remotion 侧只消费 style 的值。双侧一致性照 `card-registry.test.ts` 的文本级交叉断言先例。

## 五、Player 集成

### 5.1 最大未知数：React 版本

主项目 **React 18.3.1 + Next 14.2**，`remotion/` 子项目 **React 19**。Player 要在主项目浏览器端渲染 `remotion/src/Film.tsx` 及其整棵依赖树，届时那些文件的 React 会解析到主项目的 18。**这条路没人验过。**

**本期第一步是 spike**（时间盒半天）：主项目装 `remotion` + `@remotion/player`（同 4.0.399），import Film 组件，验证：浏览器能否渲出一帧、`next build` 是否通过、与现有 Node 侧渲染（用子项目自己的 React 19）是否互不干扰。

**Spike 失败的退路**（按优先级）：
1. Player 跑在 iframe 里，由 `remotion/` 子项目起独立页面——隔离彻底，代价是多一个 dev server
2. 主项目升 React 19（Next 14.2 对 19 支持不完整，风险最大）
3. 放弃 Player，用 renderStill 渲一串关键帧循环播做「伪预览」——降级但一定 work

### 5.2 结构

```
剪辑台
 ├ 缩略图条（已有）
 ├ 预览窗 ── <Player> ── 单镜模式：shots=[选中镜]，循环播
 │              └────── 整片模式：shots=全部 + audioSrc
 ├ 参数面板（controls 声明式生成）→ 改 style → Player props 即时更新
 └ 保存 / 确认渲染（已有）
```

### 5.3 音频路由

新增 `GET /api/v1/cockpit/video-productions/[id]/audio` 返回 `tts-audio.wav`，**支持 Range 请求**（Player 拖时间轴要 seek）。无音频任务 404，整片预览无声播放并提示。

### 5.4 降级

Player 初始化失败 → 自动回落到已有的 renderStill 静态卡面 + 一行说明，剪辑台不白屏。

## 六、测试

- `anim.ts` 每个动效纯函数单测（at 之前/进行中/结束后三个边界）
- style schema 单测（越界拒绝、模型产出的 style 被剥掉、历史无 style 的 plan 兼容）
- 真渲染：同一镜带 `speed:2`/`accent:红` 与不带，抽帧断言像素不同
- 组件测试：改参数 → Player 收到的 props 变化
- 真机验收：剪辑台调参数 → 即时看到 → 保存 → 成片体现（用户亲手）

## 七、不做什么

- **不扩卡片库**（三十三期：圆环/翻牌/曲线/排名条/人物名牌）
- **不做常驻层**（三十四期：章节进度条/要点钉板——需要改 FilmPlan 结构，加独立于 shots 的 overlays 数组）
- **不做全局参数**、不做落位偏移（YAGNI）
- **不动填槽契约**：模型仍然只选卡 + 填文字
- **不抄 overlay-studio 的实现**：它的导出是 puppeteer 无头 Chrome 逐帧截图——正是本项目三十期刚成建制删除的架构。学的是工作台交互与参数模型，不是渲染路径

## 八、风险

- **React 18/19 跨项目渲染**（§5.1）——已列为前置 spike 与三条退路
- **动效重写的观感回归**：`anim.ts` 是手法照抄、代码新写，出来的动效未必与原组件一致。缓解：实时预览就是为此存在的，实现时对着预览调
- **参数组合的观感**：`speed:3` + `scale:1.6` 之类的极端组合可能难看。本期不做组合校验（用户自己调自己看），若真机发现问题再定是否加约束
