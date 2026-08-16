# 抖音逐字稿六幕改造（cockpit 十三期 / 路线 A）

**日期:** 2026-08-16
**背景:** 用户实际使用后提出核心批评「这个写功能只是给我建议，并没有实实在在帮助我完成任务」。诊断确认三个具体断点（抖音无任何交付物、剪辑阶段是空壳、入口语义骗人），根因是产品按「数据结构」组织而非按「用户任务」组织。已定路线 **A（本期，六幕改造）→ B（主流程+交付物）→ C（成片接入）**——B/C 的产物格式都由 A 决定，先做 B 会返工。

用户手上有 `srt2slides`（口播录像+逐字稿 → 自动出成片 mp4，源码在 `/Users/lizhishaoniange/Desktop/杂货铺/自媒体工程文件/srt2slides/`），它自带一套成熟的口播创作规格 `script_spec.md` 与硬检查 `lint.py`。本期把 MediaPilot 的抖音写稿向它对齐，为 C 期的 `align`（录音精确对回六幕边界）铺路，同时立刻提升稿子本身的章法。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 结构 | 三段式（hook/main×N/cta）→ **六幕**（hook / concept_a / concept_b / trivia / synthesis / punchline），向 srt2slides `script_spec.md` 对齐 |
| 对齐深度 | **六幕 + 事实核查**：产出 `align.py` 实际消费的 6 个字段 + `four_dims` + `facts`；**不做 5 层剪辑时间线**（srt2slides 自己从字幕分页生成页面，再产一份是重复劳动且无人消费） |
| lint | 移植核心硬检查，生成后**服务端自动跑**，结果随响应返回、抽屉展示，**不阻断保存**（多数 error 需人工判断，如某数字究竟有无来源） |
| 时长 | 新增 90 秒并设为**六幕默认**——规格本身是为 ~90 秒科普口播设计的（srt2slides `script --duration` 默认 90），六幕塞进 45 秒每幕仅 4-11 秒，概念讲不透。30/45/60 保留，选中 <60 秒时 UI 提示「六幕结构在 60 秒以下会很挤」 |
| 旧稿 | **零迁移**：按 `output.script` 形状分岔（`sections` = 旧三段式 / `acts` = 新六幕），旧稿保持旧渲染可看可改，不写迁移脚本 |

**`align.py` 实际消费的字段（已读源码核实，非 README 推断）**：`acts[].act / title / narration / visual / note / beats[].keyword`（+可选 `code`）。`facts` 与 5 层时间线它**不读**——前者供 lint 与人工核查，后者本期不做。

## 1. 新的抖音稿结构

```ts
// ScriptDraft.output.script.acts —— 固定 6 项、固定顺序
acts: [{
  act: 'hook' | 'concept_a' | 'concept_b' | 'trivia' | 'synthesis' | 'punchline',
  title: string,        // ≤20 这一幕的小标题（align 用作幻灯片标题）
  narration: string,    // 逐字稿, 直接可念; 口语短句
  visual: string,       // ≤80 配图建议, 具体到可执行（禁"相关图片"这类）
  note: string,         // ≤120 创作备注: 为什么这么写/录时注意什么
  targetSec: number,    // 建议时长（不给绝对 startSec/endSec —— 实际时长由录制决定）
  beats: [{ keyword: string }],   // 3-5 个关键词, align 用作幻灯片要点
  facts: [{ claim: string, value: string, source: string, confidence: 'high'|'medium'|'low' }],
}]
four_dims: { gain: string, surprise: string, clarity: string, appeal: string }  // 获得感/惊喜感/表达力/感染力
```

保留现有的 `titles×3` / `cover` / `suggestedIntent`（发布物料，与六幕无关）。

**时长分配**：占比取 `script_spec` 区间中值并归一化——hook 10% / concept_a 22.5% / concept_b 22.5% / trivia 15% / synthesis 22.5% / punchline 7.5%。`targetSec = round(durationSec × 占比)`；prompt 内按中文口播 **4-5 字/秒**换算成各幕字数目标。

## 2. lint 硬检查（移植自 `lint.py`）

纯函数 `lintSixActScript(script) → LintIssue[]`，零 IO、可单测。

| 级别 | 规则 |
|---|---|
| error | 六幕缺失或顺序错误；`four_dims` 任一项为空；每幕 narration/visual/title 为空；**台词出现数字但 `facts` 无对应条目**；`facts` 条目未标 `source`；开场出现寒暄（大家好/欢迎来到/今天我们来聊聊/我是XX） |
| warn | 空洞形容词（非常/极其/震撼/颠覆）；单句超 30 字；句首悬空指代（这个/那个）；`punchline` 与 `hook` 无共同词（未回扣钩子） |

「台词有数字必须在 facts 里有条目且标来源」是这套规格最值钱的一条——**靠 prompt 约束是碰运气，靠检查才是必然**。

## 3. 六处牵连改动（本期真实工作量所在）

| 处 | 文件 | 改动 |
|---|---|---|
| 写稿 prompt | `script-write-douyin.ts` | schema 换六幕；`script_spec` 的创作原则（科普严谨性 6 条 / 禁止事项 / 各幕职责与占比）吸收进 system prompt |
| 生成路由 | `scripts/generate/route.ts` | douyin 分支落库新形状 + 生成后自动 lint，`lintIssues` 随响应返回 |
| 抽屉渲染 | `content-drawer.tsx` | 六幕卡片（台词/配图/备注/关键词/事实核查）+ lint 结果标记；旧稿走旧渲染 |
| 两级改稿 | `scripts/[id]/refine/route.ts` | `scope:'section'` 的 `sectionIdx` → `scope:'act'` 的 `actKey`；整稿改稿保留；旧稿仍走 sectionIdx |
| 定稿沉淀 | `src/lib/script/style.ts` | `sections.map(text)` → 六幕稿取 `acts.map(narration)` |
| 骨架回填 | `script-mapping.ts` | hook 幕 → `hook` 字段；六幕汇总 → `body`（旧逻辑保留） |
| 深度脚本页 | `content/script/[id]` 的 `DouyinView` | 再加一层六幕分岔（十一期刚为两阶段稿修过一次，同款处理） |

十二期的**人物志/经历注入**照常生效——`buildVoiceSection` 与写稿 prompt 解耦，六幕改造不影响它。

## 4. 不做（YAGNI）

5 层剪辑时间线（footage/caption/keyword/bgm/sfx）；旧稿迁移脚本；小红书结构改动（图文笔记与六幕无关）；公众号任何改动；lint 阻断保存；`code` 字段（代码高亮，我们不是技术教学号）；srt2slides 实际调用（C 期）。

## 5. 风险

| 风险 | 对策 |
|---|---|
| 六幕 schema 更大更复杂，LLM 一次产出失败率上升 | 说明性字段沿十期「宽进严出」纪律（宽收 + transform 截断）；主键性字段（act 枚举、title）严格拒绝；`callStructured` 既有重试兜底 |
| prompt 暴长稀释指令 | `script_spec` 只吸收创作原则与各幕职责，不整篇塞入；人物志/经历段维持既有上限 |
| 旧稿在六处任一处漏了分岔 → 打不开 | 每处都写「旧稿走旧路径」的显式测试；收尾 E2E 用真实旧稿逐处走查 |
| lint 误报（如年份被当作需核查的数字） | error 不阻断保存，仅提示；规则移植时保留 `lint.py` 的数字识别口径并单测边界 |
| 六幕塞进短时长导致每幕过薄 | 默认 90 秒；<60 秒时 UI 提示；prompt 按 targetSec 给字数目标而非硬凑六幕 |
| 真实 E2E | 收尾：真实生成一篇 90 秒六幕稿（验证六幕齐全/facts 标源/lint 通过）→ 按幕改稿一次 → 定稿沉淀取 narration → 打开一篇旧三段式稿确认不炸 |

## 6. 实际实施结论

T1-T6 按本文档 §1-§3 落地，与设计基本一致，`ACT_KEYS`/`ACT_RATIOS`/lint 规则表/六处消费点分岔
均按原计划实现，§4 YAGNI 边界未越界（无迁移脚本、无 code 字段、lint 不阻断）。以下记录实际
实施与设计的出入。

**偏差 1 — §5「六幕塞进短时长」对策里的「<60 秒 UI 提示」在 T3/T6 落地时漏做**：generate
路由确实把 douyin 默认 `durationSec` 改成了 90（T3 按计划完成），但 T6 抽屉时长下拉
(`content-drawer.tsx`) 既没有把默认值同步改成 90，下拉选项也仍然停留在 30/45/60（没有 90
这个选项），且每次生成请求都显式携带 `durationSec` —— 意味着通过抽屉这个实际使用入口生成
的六幕稿，事实上从未真正拿到过 90 秒默认值，一直在用 45 秒（三段式时代遗留的默认值）；spec
里要求的「<60 秒时 UI 提示」文案也完全没有实现。T7 真实 E2E 走查（见 README「收尾真实
E2E」小节 ④ 之后的 bug 记录）发现后补齐：默认值改 90、下拉加 90 选项（标注「六幕默认」）、
<60 秒时展示提示文案「六幕结构在 60 秒以下会很挤，建议 90 秒」。深度写稿页
(`/content/script/new`) 本身没有独立的时长选择 UI（沿用请求方传参），不受此偏差影响。

**偏差 2 — 抽屉懒加载重开完全没有六幕稿判据（T6 遗漏，非 spec 本身缺失）**：`§3` 计划的六处
消费点里，抽屉(T6)覆盖的是「生成响应到手后就地渲染」与「改稿」两条路径，但遗漏了第三条已有
路径——`src/lib/cockpit/draft-restore.ts` 的 `parseDraftOutput`（关闭抽屉再打开同一条内容时,
组件整体重挂载, 靠 `GET /api/v1/scripts/{id}` + 这个纯函数懒加载恢复改稿 UI）。该函数在
T1-T6 全程只认 `sections`（旧稿）与 `intro`+`body`（小红书）两种形状, 对新的 `acts`+
`four_dims` 形状完全没有判据——生成一篇六幕稿后关闭抽屉再打开, `SixActPanel` 会整体消失
（不崩溃, 但改稿功能不可用, 相当于「刚生成好的六幕稿改不了」）。这不属于 §3 文字本身遗漏
（§3 没有单独列出「懒加载恢复」这一条, 是把它默认归入了「抽屉(T6)」笼统描述里）, 而是 T6
实现时没有意识到懒加载恢复是独立于「生成后就地渲染」的第三条路径, 两条路径分别读两套不同
的解析函数（`content-drawer.tsx` 里内联解析 vs `draft-restore.ts` 的 `parseDraftOutput`）。
T7 真实 E2E 走查 ④ 时用真实生成的六幕稿手动模拟懒加载路径复现并修复：`parseDraftOutput`
补上六幕稿判据（复用 `isSixActScript`, 与其余消费点判别顺序一致）, 顺带发现同文件
`VALID_DURATIONS` 白名单没跟 T3 的 `durationSec` 选项扩展同步（仍是 `[30,45,60]`, 90 会被
直接判非法丢弃）一并修掉。修复补了聚焦单测（`tests/lib/cockpit/draft-restore.test.ts` 新增
3 条用例）, 不影响旧稿 `sections`/`intro+body` 两条既有路径（回归测试全绿）。

**真实 E2E 结论**：本文档 §5「真实 E2E」列出的四项检查（90 秒六幕稿完整性/按幕改稿隔离/定稿
沉淀/旧稿不炸）以及计划里追加的 lint 不阻断检查全部真实验证通过，证据与产出的两个真实 bug
详见 README「抖音逐字稿六幕改造（十三期新增）」小节末尾「收尾真实 E2E」与
`.superpowers/sdd/2026-08-16-six-act-script/task-7-report.md`。`typecheck`/`test`(1566
通过)/`build` 三者全绿。
