# 人物志 + 个人经历库（cockpit 十二期）

**日期:** 2026-08-16
**背景:** 十/十一期建成的定位体系被用户实际使用后评价「差了点意思……只能是一个没有灵魂的博主，缺少真人的灵动性和个人魅力」。核查属实：`PersonaProfile` 的**每一个字段**（受众/粉丝/支柱/角度/忌讳/痛点/商品服务/产品逻辑/市场前景）都是商业策略维度——这是一份营销 brief，不是一个人。系统知道「对着想搞副业的人讲 AI 工具、语气口语化」，但不知道你是谁、你凭什么这么说。

更硬的缺口在素材层：五期研究层只会从 Tavily 搜**别人的**案例数据，系统里没有任何地方存「我自己做过什么」，所以 AI 写稿只能引用第三方资料或编造，稿子永远像资料播报员。真正有黏性的「我上周实测翻车三次才发现是这个参数」这类内容，AI 编不出来，只能来自用户。

**用户自述（本期最重要的设计输入）**：「我并不是资深的技术级极客也不是专业的编程人员。我是一个爱好知识、喜欢通过 AI 进行赋能自身、提高认知的人。会感染他人，自信。」——这句话在现有档案里**没有一个字段能安放**，且揭示其差异化不在技术深度而在**认知视角 + 感染力**：内容形态应是「过程与认知转变」而非「教程与结论」。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 经历库积累方式 | 两条并行：**随手记一笔**（定位页输入框，AI 自动打标签归类）+ **AI 访谈挖掘**（冷启动挖一批）。否决「定稿自动提取」与「写稿时反问补录」 |
| 承载 | 两张新表（`CreatorVoice` 单行 + `CreatorExperience` 多条目），**不再撑大** `PersonaProfile`（已 10 字段） |
| 职责边界 | 人物志**只管「你是谁」**；「怎么说话」完全归既有风格档案（`StyleProfile` + `StyleSample`）。原设计的 `languageFingerprint` 字段**砍掉**——两处都写会让 prompt 自相矛盾 |
| 检索 | 关键词交集匹配 → 匹配度+新鲜度排序 → top 3 全文注入。不做向量检索（库到几百条再议） |
| 雷达 | 本期不注入（避免再加一层评分/调权逻辑，YAGNI） |

## 1. 数据模型

```prisma
model CreatorVoice {                    // userId 单行，学 StyleProfile/PersonaProfile 先例
  userId      String   @id
  origin      String   @default("")    // ≤500 来路故事：为什么走上这条路、哪一刻转折
  identity    String   @default("")    // ≤200 具体身份（非品类标签）
  notIdentity String   @default("")    // ≤200 我不是什么 —— 防 AI 写成专家的护栏
  stances     Json     @default("[]")  // [{claim(≤50), reason(≤100)}] 0-5 条立场主张
  energy      String   @default("")    // ≤200 情绪基调（如「自信、有感染力」）
  updatedAt   DateTime @updatedAt
}

model CreatorExperience {
  id        String   @id @default(cuid())
  userId    String
  content   String                     // ≤500 原文（用户随手记的原话，不改写）
  topic     String   @default("")      // ≤20 AI 提炼主题标签
  kind      String   @default("")      // '' | 'practice' | 'failure' | 'insight' | 'result'
  keywords  Json     @default("[]")    // string[] 3-5 个检索关键词（AI 提取，可人工编辑）
  usedCount Int      @default(0)       // 被写稿命中引用次数
  createdAt DateTime @default(now())
  @@index([userId, createdAt])
}
```

「人物志已建立」判定：`identity` 非空（最小要素）。经历库无门槛，0 条即为空库。

## 2. 建档流程

**人物志访谈**（6 问，一次性表单，可留空）：①你怎么走上这条路的、哪件事让你决定开始做 ②你会怎么跟陌生人介绍自己（一句话） ③**你明确不是什么人**（例：不是技术极客/不是培训讲师） ④关于这个领域你有什么跟主流不一样的看法 ⑤你希望观众看完是什么感觉 ⑥你最近一次认知被刷新是什么时候（这一问同时喂经历库）。→ `POST /api/v1/voice/draft` 起草 `CreatorVoice` 全字段 + **附带 0-5 条经历候选**（从④⑥的回答里提取）→ 回填表单**不落库** → 用户改后保存。

**随手记一笔**：定位页输入框 → `POST /api/v1/experiences`（body `{content}`）→ DeepSeek 提炼 `{topic, kind, keywords}` → 落库。**用户不需要分类**。条目列表可编辑（含 keywords）与删除。

## 3. 检索与注入

**检索纯函数** `matchExperiences(topic, experiences, limit=3)`：主题分词与条目 `keywords`/`topic` 求交集 → 按「匹配关键词数降序、`createdAt` 新鲜度降序」排序 → 取 top `limit`。零 IO、可单测。

**注入点（两处，均在 `scope='write'` 通道）**：
1. **写稿 prompt**（`script-write-douyin` + `script-write-xhs`）：人物志段（身份/我不是什么/立场/情绪基调/来路精简）+ 命中的经历**全文**。prompt 明确：「这些是你的真实经历，优先用它们而不是外部案例；**但不相关就别用，不要硬凑**」——防止 AI 为了用上而硬塞，那比没有更糟。命中条目 `usedCount + 1`。
2. **研究层** `runResearch`：命中的经历进七期已有的 `curatedParts` 最高优先级通道（与用户素材同级，排在 Tavily 搜索正文之前），使素材简报里亲身经历优先于外部资料。

**体系报告**（`persona-summary`）prompt 同时吃人物志——否则那一页纸仍是营销 brief，不是「一页纸看懂这个人」。

`buildPersonaSection` 不动；人物志与经历走**新的独立拼装函数** `buildVoiceSection(voice, experiences)`，避免把两套档案的分段逻辑耦在一起。

## 4. UI

十一期建的「账号定位」视图改为五段，顺序按「先是人，再是生意」：
1. 体系报告（置顶，已有）
2. **人物志卡**（5 字段编辑 + 「AI 帮我起草」6 问访谈）
3. **经历库卡**（顶部「随手记一笔」输入框 + 条目列表：原文/标签/类型/关键词可编辑、可删、显示引用次数）
4. 人设定位卡（已有）
5. 风格档案卡（已有）

## 5. 不做（YAGNI）

向量检索；从定稿自动提取经历；写稿时反问补录；雷达经历标注与调权；经历版本历史；经历库全文搜索 UI；人物志多版本 A/B。

## 6. 风险

| 风险 | 对策 |
|---|---|
| 经历库为空 / 人物志未建 | 全链路降级为现状（`buildVoiceSection` 返回空串），**零迁移**：不影响既有生成行为 |
| 关键词匹配不准塞入不相关经历 | prompt 明确「不相关就别用，不要硬凑」；条目 keywords 可人工编辑修正；`limit=3` 上限 |
| 人物志与风格档案职责重叠导致 prompt 矛盾 | 设计层已切分：人物志只管「你是谁」，语言层完全归风格档案（见 §0） |
| prompt 变长稀释指令 | 人物志段字段少且各有上限；经历上限 3 条 ×500 字；沿用既有 scope 分段机制，不整体注入 |
| AI 提取关键词质量差导致检索失效 | 关键词在条目列表里可人工编辑；`matchExperiences` 是纯函数、可单测调参 |
| 真实 E2E | 收尾：真实 6 问访谈起草人物志 → 随手记 3-5 条真实经历 → 真实生成一篇稿验证**确实引用了自己的经历而非外部案例** → 体系报告含人物志 → 空库回退验证 |
