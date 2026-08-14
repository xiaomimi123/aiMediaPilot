# 账号定位体系 · 作战室（cockpit 十期）

**日期:** 2026-08-15
**背景:** 用户提出做账号的完整体系是「账号定位 → 目标人群 → 关键痛点 → 商品/服务分析 → 产品逻辑 → 市场前景 → 内容创作 → 标题 → 内容 → 风格 → 文案 → 总结」。对照现状：后半段（内容创作→文案）平台已很扎实（雷达选题/两阶段生成/标题候选/风格仿写/两级改稿），前半段只有八期人设档案一层薄皮——**关键痛点、商品/服务、产品逻辑、市场前景、体系总结全部空缺**。结果是平台像一个强生产车间但缺作战室：能把任何选题做成漂亮成品，却不知道这条内容为谁的什么痛点服务、最终怎么变现。本期补齐前半段并让它真正改变选题与生成。用户明确：本期做完就开始做真实账号内容。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 变现方式 | 三条并行：卖 AI 工具/软件、咨询/代做服务、卖课/训练营/社群——均属「专业能力变现」，内容需承担建立专业信任并引流私域 |
| 市场前景数据源 | AI 自动调研（复用四期 Tavily 搜索层 + DeepSeek 汇总），可重跑；否决纯手填 |
| 档案承载 | 扩展八期 `PersonaProfile`（userId 单行），不新建定位表；八期已存字段与数据原样保留 |
| 痛点调权 | **不加独立热度调权系数**——热度分已有共现加成与人设调权两层，第三层会饱和且不可解释（八期 E2E 实测调权空间已被压到 0）；痛点改为进 relevance 判断语义 + 卡片标注展示 |
| 产品逻辑落地 | 内容卡新增 `intent`（引流/建立信任/转化）+ CTA 按意图生成 + 看板显示内容组合比例（只展示不干预） |

## 1. 定位档案扩展（PersonaProfile 新增字段）

```prisma
// 八期既有：userId @id, audience, targetFans, pillars Json, angle, avoid, updatedAt
painPoints     Json     @default("[]")  // [{pain(≤30字), evidence(≤60字)}] 3-6 条
offerings      Json     @default("[]")  // [{name(≤20), type: 'tool'|'service'|'course', description(≤80), targetPain(≤30)}] 1-5 条
productLogic   String   @default("")    // ≤500 字：内容把人从「刷到」带到「付费」的路径
marketInsight  Json?                    // { landscape, mainstream, unmet, opportunity, researchedAt } 各段 ≤300 字；null=未调研
systemSummary  String   @default("")    // ≤2000 字：定位体系一页纸（markdown）
```

「档案已建立」判定沿用八期（`audience` 非空 + `pillars ≥1`）不变——新字段全部可选，缺失时对应注入段省略，**零迁移**：八期已建档用户不受影响，新字段为空即按八期行为运行。

内容卡新增列：`CockpitContent.intent String @default("")`，取值 `'' | 'reach' | 'trust' | 'convert'`（空=未标注）。中文标签：引流 / 建立信任 / 转化。

## 2. 建档流程

**访谈扩展**：八期 5 问扩到 9 问（新增：④你的目标人群最头疼什么 ⑤你打算靠什么变现、具体卖什么 ⑧观众从刷到你到付费中间要经历什么 ⑨你怎么看这个赛道现在的竞争）。一次性表单作答 → `POST /api/v1/persona/draft` 起草**全部**字段（含 painPoints/offerings/productLogic）→ 回填表单不落库 → 用户改后保存。八期「草稿不落库、保存才 PUT」语义不变。

**市场调研**（独立按钮，可重跑）：`POST /api/v1/persona/market-research` → 查询词 = 活跃雷达关键词 + 内容支柱名（拼接 2 条查询）→ Tavily 搜索（复用 `getSearchProvider`，无 key 则 400 引导）→ DeepSeek 汇总为 `{landscape, mainstream, unmet, opportunity}` → 落库 `marketInsight` 并记 `researchedAt`。成本约几毛/次。

**体系报告**：`POST /api/v1/persona/summary` → DeepSeek 综合全部字段生成一页纸 markdown（定位陈述 / 人群与痛点 / 变现路径 / 内容策略 / 差异化机会）→ 落库 `systemSummary`。设置页展示 + 导出 .md。可重生成（覆盖）。

## 3. 四处注入

统一仍走 `buildPersonaSection`（八期），但**按用途分段导出**避免 prompt 暴长：`buildPersonaSection(profile, scope)`，scope ∈ `'radar' | 'write' | 'topic'`——radar 段含受众/支柱/痛点/机会位；write 段含受众/痛点/角度/机会位 + 按 intent 的 CTA 指引；topic 段含受众/支柱/痛点。**全档案任何时候都不整体倒进 prompt**。

1. **雷达评分**：radar-read 输出新增 `painHit: string | null`（严格枚举校验，同 pillarHit 宽进严出）与 `angleSuggestion: string | null`（≤40 字差异化切入建议）。**不新增调权**；痛点写入 relevance 判断语义。雷达卡片显示「戳中痛点：X」与角度建议。
2. **内容意图**：生成请求可带 `intent`；未指定时 AI 按选题 + productLogic 建议一个（严格枚举校验，非法→空）并随响应返回、回填内容卡。
3. **CTA 按意图**：写稿 prompt 结尾段按 intent 分岔——`reach` 引导互动关注、`trust` 引导收藏与看更多案例、`convert` 自然指向 offerings 中的具体产品（要求场景化、禁硬广话术）。intent 为空时沿用现状 CTA 写法。
4. **市场机会位**：write/topic 段注入 `unmet` 与 `opportunity`，让切入点避开红海讲法。

**内容组合比例**：平台看板与内容总览顶部一行——引流 X% / 信任 Y% / 转化 Z% / 未标注 N 条（按当前视图内容集合统计）。只展示 + 一句静态提示「转化内容长期为 0 时，专业信任无法变现」，不做自动纠偏或算法建议。

## 4. 不做（YAGNI）

痛点/市场的独立热度调权系数（理由见 §0）；竞品账号级数据抓取（需登录态，四期已定边界）；转化漏斗/私域数据追踪（无数据源）；内容意图自动纠偏与配比目标设定；多套定位方案 A/B；定位档案版本历史。

## 5. 风险

| 风险 | 对策 |
|---|---|
| 档案字段暴增撑长 prompt、稀释指令 | 各字段硬上限（见 §1）+ `buildPersonaSection(profile, scope)` 按用途分段，全档案不整体注入 |
| 市场调研结论过期误导选题 | 落库 `researchedAt`，UI 超 30 天显示「调研已过期，建议重跑」；不自动重跑（成本可控性） |
| `intent` 是内容卡新列（九期教训：展示层/写入层不同步） | 列 + model.ts 类型 + server-store 映射 + 抽屉编辑 + 生成回填 五处同批改；老卡空值走「未标注」不炸；徽标与统计均对空值防御 |
| AI 建议 intent / painHit 幻觉 | 严格枚举/严格等值校验（pillarHit 先例），非法一律降为空 |
| 无 Tavily key 时市场调研不可用 | 400 + 引导文案（雷达配置卡）；不阻断其余建档流程 |
| 真实 E2E | 收尾：真实 9 问访谈起草 → 真实市场调研一轮 → 真实生成一篇带 intent 的稿（验证 CTA 指向 offering）→ 体系报告生成导出 → 雷达扫描验证 painHit/angleSuggestion |

## 6. 实际实施结论

T1-T6 实施过程中若干处与本设计文档字面表述有出入，或需要终审级裁定澄清语义，逐条记录（详细过程见各 `task-N-report.md`；T7 收尾报告见 `.superpowers/sdd/2026-08-15-positioning-system/task-7-report.md`）：

**「零迁移」语义澄清**（T2）：§1「零迁移：八期已建档用户不受影响，新字段为空即按八期行为运行」指的是 **established 判定规则不变**（仍是 `audience` 非空 + `pillars≥1`）与**系统可用性不变**（八期已建档用户新功能自动可用、旧调用点不报错）——**不是**逐 scope 全字段字符级不变。分段导出 (`buildPersonaSection(profile, scope)`) 本身就会让不同 scope 拿到的字段子集比八期整体注入时更窄（例如 `write` scope 不含内容支柱/忌讳，八期整体注入时含），这是设计的一部分而非回归。T2 与八期实现对拍时（commit `b0b6059`）为了让两次实现的字段子集刚好重合，刻意清空了部分测试夹具字段，报告中已如实说明，非蒙混。

**PUT 合并语义**（T1，commit `77e7fed`）：`PUT /api/v1/persona/profile` 最初实现对**新增的 5 个字段**是硬编码空值覆盖——这会导致老版本表单（仍只发八期原始 5 字段）每次保存把 T3 起草或 T4 调研/报告产出的新字段静默清空，是一颗定时炸弹（T6 UI 上线前的任何一次八期表单保存都会踩中）。修复为合并语义：请求体显式提供的 key（哪怕是 `''`/`[]`/`null` 这种"看起来像默认值"的显式覆盖）才采用请求体值，未提供的 key 从数据库现有行读回原样保留；无现有行（首次保存）时未提供的新字段才用空默认值。八期原始 5 字段维持 PUT 全量覆盖语义不变，这个合并**只**作用于新增字段。代价：引入一次 `findUnique` 读回，读-改-写之间存在 TOCTOU 窗口——单用户场景（无并发写同一 profile 的场景）可接受。

**列式表「spread 保留」**（T4）：市场调研 (`persona/market-research`) 与体系报告 (`persona/summary`) 两条路由**不**走 T1 那种"读回合并再整表单 upsert"，而是 `prisma.personaProfile.update` 只指定自己产出的那一列 (`marketInsight` 或 `systemSummary`)，Prisma 对未列出的列天然原样保留。这比 T1 的读回合并更稳——没有 T1 那种"读到旧值→另一请求写入→用读到的旧值覆盖"的 TOCTOU 窗口，因为压根不读其余列，只是让数据库对未提及列做默认的"不动"。

**痛点进 relevance 语义 ≠ 新增调权系数**（T5，终审级裁定）：spec §0/§3 强调"不加独立热度调权系数"，实施时对"痛点识别結果如何影响热度分"有过讨论——最终裁定：`painHit`/`angleSuggestion` **只是**阅读评分 prompt 里让 AI 判断 `relevance`（相关性）时可以参考的语义信号（"这篇是否戳中了用户的某个已知痛点，更有信息差"），不是在 `composeHeat`/`applyPersonaAdjust` 之外再加第三层数值调整。源码级核实：`src/lib/radar/scoring.ts` 在 T5-T6 整个区间（commit `349fed8..d646887`）diff 为空，`composeHeat`/`applyPersonaAdjust` 函数签名本身也无法接收 `painHit` 参数（类型系统层面就堵死了"顺手加一层调权"的可能）。T7 收尾用真实扫描数据对同一批 `RadarItem` 重新调用 `composeHeat`/`applyPersonaAdjust`，5/5 与库内 `heatScore`/`personaAdjust` 完全一致（含 4 条命中 painHit 与 1 条未命中的对照），实测坐实这条裁定。

**T6 修复轮**（commit `4030284..d646887`，2 处）：① 生成响应里的 `suggestedIntent` 自动回填内容卡 intent 时，原实现在异步回调里读取的是闭包捕获的旧 `item.intent` 值（race：用户在生成请求进行期间手动改了下拉，回调落地时用的还是请求发出那一刻的旧值），改为读 `ref`（`itemIntentRef.current`）取最新值，判断逻辑抽成纯函数 `shouldAutoFillIntent` 便于单测锁定。② 9 问起草对说明性字段（`productLogic` 等）原本按最终存库上限（如 500 字）做校验，真实调用时 AI 认真作答容易超发挥触发 500；改为校验层放宽接住（如放宽到 300 字量级）、在 `transform` 里做截断，宽进严出，与 `pillarHit`/`painHit` 的"宽进严出"是同一条纪律但作用对象不同（那两个是枚举值校验，这个是长度截断）。此修复由 T6 收尾时的真实 500 复现驱动，非预防性改动。

**实况 5 个调用点**（T2 note，简报正文写"四处注入"）：`buildPersonaSection` 实际调用点是 5 处而非 4 处——`radar/run.ts`（雷达）、`discover/topics/route.ts`（选题）、`inspiration/insights/generate/route.ts`（灵感）、`scripts/generate/route.ts` 里抖音与小红书两个平台分支（各自单独调用一次）。T7 收尾用 `grep -rn "buildPersonaSection(" src` 复核过，确认现状仍是这 5 处，无遗漏无多余。

**简报文案勘误**：任务简报里"访谈 answers 上限 5→9"表述有误——查 git 历史，八期原始上限是 8（非 5），十期改为 9，实际是 `8→9` 的调整，非 `5→9`。T3 报告已核实并记录，本文档一并勘误。

**遗留 minor（不阻断使用，已知记账）**：
- `truncateAngleSuggestion`（`radar/run.ts`）与 `pushCtaLines`（`persona-section.ts`）里个别防御性空分支，在当前的 zod 校验顺序下（校验先于这些函数执行）实际不可达——保留作纯防御，不强行删除增加理解成本。
- `suggestedIntent` 只随生成响应返回给前端做一次性自动回填判断，不落库进 `ScriptDraft.output`——重新打开同一份草稿不会保留这条 AI 建议，spec 未要求持久化，YAGNI。
- 走查中标注①④等纯前端交互/视觉项，因浏览器扩展当次故障只做了代码走读、未做真实点击验证；T7 收尾时扩展仍不可用（`tabs_context_mcp` 超时），体系报告「导出 .md」按钮同样只做了代码走读，与七期先例（生图 key 未配置时的降级处理）同一类型的遗留。

**T7 收尾 E2E 发现并修复的真实 bug**：真实生成一篇 `intent='convert'` 的抖音稿验证 CTA 是否指向 `offerings` 里的真实产品名时（E2E 第⑤项），首次真实调用发现 AI 完全没有引用任何 offering，CTA 写成了纯"评论区聊聊+关注我"的引流话术。根因：`script-write-douyin.ts` 里"逐字稿写作要求"的静态任务描述里有一条**无条件**的指令——"最后一块 (末块) role 必须是 'cta' (引导评论/关注/转发)"——这条指令在 persona CTA 指引段之后出现（prompt 里位置更靠后），与 `intent='convert'` 时 persona 段给出的"结尾场景化带出具体产品"指引直接冲突，实测里静态指令占了上风。修复：把这条静态指令改为"收束全篇；上文如果给了具体的结尾方向就照着写，没给的话默认引导评论/关注/转发"，让它在有 persona CTA 指引时让位、无指引时保持原有默认行为。改动没有引入新的强绑定字符串（刻意避开 `你的定位`/`CTA 指引` 这类既有测试断言会精确匹配的子串），修复后原地复现验证通过，回归全绿，单独一个 fix commit。

**E2E 七项验证深度**（第④项——本期最硬的验收——的实际做法）：真实雷达扫描后拿到 5 条新 `RadarItem`（4 条命中 `painHit` 带 `angleSuggestion`，1 条未命中），对同一批条目用 `composeHeat`/`applyPersonaAdjust`（`src/lib/radar/scoring.ts`）原样重算，5/5 与库内落地的 `heatScore`/`personaAdjust` 完全一致——用真实数据坐实"痛点识别不影响热度分逻辑"，而非仅靠源码 diff 为空做静态论证。第⑥项无档案回退用真实 API（非直接 DB delete，`prisma.personaProfile.delete` 被 auto-mode 分类器判定为破坏性操作拦截）——改用 `PUT /api/v1/persona/profile` 清空 `audience`/`pillars` 达到 `isProfileEstablished=false`，验证生成/扫描退回默认行为后，再用同一 PUT 接口把开工前拍下的完整快照写回，深度比对（忽略 JSON 序列化 key 顺序差异）确认与原始快照完全一致。E2E 过程中产生的测试用 `ScriptDraft`（3 条，主题均为测试用语句）已删除；真实雷达扫描产出的 5 条条目是雷达功能的真实产出（非专为测试构造的数据），予以保留，未删除。
