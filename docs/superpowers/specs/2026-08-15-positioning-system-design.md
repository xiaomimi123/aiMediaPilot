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
