# 人设定位驱动选题（cockpit 八期）

**日期:** 2026-08-14
**背景:** 用户明确产品理念：做个人化垂直而非全行业热点——「灵感库应该根据个人标签、想要获取什么样的粉丝和流量去选题」，长期匹配个人创作风格、打造人设，反对无锚点的垃圾内容。现状缺口：雷达评分/选题推荐/生成角度用的都是写死的泛化「AI 知识类创作者」视角，「我是谁、我要吸引谁」从未成为系统输入。本期建立人设档案并注入三处。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 建档方式 | AI 访谈式引导：4-5 个关键问题一次性表单（不建聊天 UI）→ DeepSeek 综合回答+风格档案+定稿样本+雷达活跃词起草 → 用户逐项改后保存 |
| 支柱约束强度 | 降权标注保留：未命中支柱热度 ×0.7 + 「偏离定位」标签仍展示（破圈自判）；命中 +8 加权 + 支柱名徽标。否决硬过滤（误杀跨界热点） |
| 回退语义 | 无档案时一切行为与现状完全一致（prompt 不注入、评分不调权、无徽标）——零迁移，档案是增强不是前置 |
| 优先级 | 八期先做本项；「平台差异化流水线」顺延为下期候选（用户裁决） |

## 1. 人设档案（PersonaProfile）

```prisma
model PersonaProfile {                  // userId 单行，学 StyleProfile 先例（无 User 反向关系）
  userId     String   @id
  audience   String   @default("")     // 目标受众画像
  targetFans String   @default("")     // 想吸引的粉丝与流量
  pillars    Json     @default("[]")   // 内容支柱 [{name(≤10字), description(≤60字)}] 3-5 个
  angle      String   @default("")     // 差异化角度
  avoid      String   @default("")     // 明确不做什么
  updatedAt  DateTime @updatedAt
}
```

「档案已建立」判定：`audience` 与 `pillars`（≥1 条）均非空——两者是注入的最小要素；其余字段可空。API：`GET/PUT /api/v1/persona/profile`（GET 无行返回全空默认；PUT 全量覆盖，pillars zod 校验 0-5 条）。

## 2. AI 访谈式建档

- 设置页新「人设定位」卡：五字段展示编辑（pillars 为可增删列表）+ 「AI 帮我起草」按钮。
- 点击展开访谈表单（5 问，一次性作答，可留空）：①你是谁/账号做什么 ②最想吸引什么样的人关注 ③你最擅长/最有信息差的内容 ④观众为什么选择看你而不是别人 ⑤绝对不想碰的内容或方向。
- 提交 → `POST /api/v1/persona/draft`：DeepSeek（resolveDeepSeekApiKey，无 key 503）输入 = 5 答 + StyleProfile.description + 最近 3 篇 StyleSample 摘要 + 雷达活跃关键词列表，输出（zod）= 完整五字段草稿（pillars 3-5 条）。
- 草稿只回填表单**不落库**，用户修改后点保存才走 PUT（重访谈只覆盖表单草稿，不动已存档案）。

## 3. 三处注入（共享 `buildPersonaSection(profile)` 纯函数）

统一实现：`src/lib/llm/prompts/persona-section.ts` 导出 `buildPersonaSection(profile: PersonaProfileData | null): string`——null 或未建立返回空串（现状 prompt 原样），已建立返回结构化中文段（受众/目标粉丝/支柱列表/差异化角度/忌讳）。各注入点把该段拼进既有 system prompt，**不改其余文案**。

1. **雷达评分（radar-read）**：system 拼 persona 段并把 relevance 语义句改为「对上述定位的价值」（无档案时保留原句——语义句二选一由 persona 段是否为空决定）；zod 输出新增 `pillarHit: string | null`（命中的支柱名，无档案时模型不会输出该字段——schema 设 optional 默认 null）。`composeHeat` 后处理：pillarHit 非 null → +8（clamp 100）；有档案但 pillarHit null → ×0.7；无档案 → 不动。heatFactors 记录 `personaAdjust` 字段；RadarItem 卡片：命中显示支柱名徽标，未命中显示「偏离定位」徽标（单色，无 emoji）。
2. **选题与灵感（topic-discovery + inspiration-insight）**：两个 prompt 的 system 拼 persona 段，推荐/洞察结果自然向支柱倾斜（不做输出 schema 改动——排序倾斜靠 prompt，YAGNI 打分字段）。
3. **生成角度（script-write-douyin + script-write-xhs）**：system 在 getExpertPersona 之后拼 persona 段——受众画像与差异化角度约束稿件切入点。gongzhonghao 不动。

## 4. 不做（YAGNI）

复盘数据反哺人设；多人设切换；支柱自动演化/加权学习；候选关键词按支柱自动生成；radar 历史条目回溯重打分（新扫描才生效）；聊天式多轮访谈。

## 5. 风险

| 风险 | 对策 |
|---|---|
| persona 段拉长 prompt 影响质量 | 档案字段各设长度上限（audience/targetFans/angle/avoid ≤300 字，pillar name≤10/desc≤60）；buildPersonaSection 输出可控 |
| pillarHit 幻觉（模型硬凑支柱名） | 后处理校验：pillarHit 必须严格等于档案中某支柱 name，否则视为 null（宽进严出） |
| ×0.7 降权过狠/过软 | 系数与 +8 常量集中导出（同 HEAT_WEIGHTS 先例），可调 |
| 老雷达条目无 pillarHit | 展示层缺字段不渲染徽标、不调权（零迁移） |
| 草稿覆盖已存档案 | draft 只回填表单不落库，保存才 PUT |
| 真实 E2E | 收尾：真实建档访谈一轮 + 真实雷达扫描验证徽标/调权 + 真实生成一篇验证角度注入（key 均已就绪） |
