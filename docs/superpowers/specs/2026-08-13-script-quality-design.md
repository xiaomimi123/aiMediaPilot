# 创作质量深化 · 抖音口播逐字稿（cockpit 五期）

**日期:** 2026-08-13
**背景:** 四期后平台骨架已齐（选题→雷达→创作→分发→分析→复盘），用户确认当前生成链路距「能直接用」有四个痛点：缺完整口播逐字稿（现在只有节奏大纲）、内容深度不够（正确的废话）、不像本人风格、改稿只能整体重生成。本期正面解决全部四项，**只做抖音**。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 路线 | B：两阶段流水线（研究→写稿）。否决 A 单次大 prompt（长输出不稳、无分块改稿）与 C 多轮 Agent 自评（成本翻倍，B 跑顺后再议） |
| 逐字稿 | 阶段二输出完整口播逐字稿 `script.sections[]`（hook / main×2-4 / cta，每块带秒段），时长目标 30s/45s/60s 可选、默认 45s |
| 深度素材 | 两者都要：Tavily 自动研究打底（复用四期 SearchProvider）+ 抽屉可选素材框；雷达来源的选题直接复用 RadarItem 已读摘要（零成本） |
| 风格 | 无存量稿 → 「定稿即样本」积累路线：StyleProfile 手填风格说明兜底，StyleSample ≥2 篇后自动切换为最近 3 篇 few-shot（说明仍附带） |
| 改稿 | 两级：分块「换一版 + 一句话指令」（只重写该块）+ 全稿「整体指令」（重写全部 sections，titles/cover 不动） |
| 平台范围 | 本期仅抖音。研究层/风格层平台无关，小红书（图文笔记形态不同）下期接入自己的阶段二 prompt；公众号不动 |

## 1. 生成管线（两阶段）

```
点「生成」（抽屉内）
├─ 阶段一 research()
│   素材合并优先级：
│   a. 雷达来源选题 → RadarItem.aiSummary / aiAngle / url 直接带入
│   b. Tavily 搜索 2 次：主题原词 + 规则拼接补充查询（主题+「案例 数据」，零额外 AI 调用）
│   c. 素材框文本（可空）
│   → DeepSeek 提炼「素材简报」：3-6 条 {fact, source(URL|"用户素材"), usage(用法建议)}
│   → 存 ScriptDraft.output.research（改稿复用，不重搜）
│
└─ 阶段二 write()
    输入 = 专家人设 + 风格上下文 + 素材简报 + 主题 + 时长目标
    输出（zod）= script.sections[]（{role:'hook'|'main'|'cta', startSec, endSec, text 逐字口播}）
              + hooks×3 候选（hook 块可切换）+ titles×3 + cover（沿用现结构）
```

- **风格上下文切换**：`StyleSample(platform='douyin')` 计数 <2 → 用 StyleProfile.description；≥2 → 最近 3 篇样本 few-shot + 说明附带。切换逻辑为纯函数，单测覆盖边界（0/1/2/3+ 篇）。
- **改稿**：`refineSection(sectionIdx, instruction)` prompt 带全稿上下文、只重写目标块，其余块原样返回并校验未变；`refineAll(instruction)` 重写全部 sections。两者复用已存简报。
- **失败处理**：阶段一 Tavily/提炼失败**不阻断**——降级为无简报直写，界面提示「本篇未联网研究」；阶段二失败沿用现有 toast + 重试。

## 2. 数据模型（轻改，零迁移）

```prisma
model StyleProfile {                    // userId 单行，学 RadarConfig 先例
  userId      String   @id
  description String   @default("")    // 口吻/句式/口头禅/忌讳
  updatedAt   DateTime @updatedAt
}

model StyleSample {                     // 定稿沉淀
  id                  String   @id @default(cuid())
  userId              String
  platform            String            // 本期只有 'douyin'
  content             String            // 定稿逐字稿纯文本
  sourceScriptDraftId String?           // 溯源
  createdAt           DateTime @default(now())
  @@index([userId, platform, createdAt])
}
```

`ScriptDraft.output` Json 内新增 `research` 与 `script.sections[]` 两键，不改列。旧数据无这两键 → 抽屉按现状渲染，零迁移。StyleSample 写入幂等：同 `sourceScriptDraftId` 只存一次。

## 3. 交互（全部长在现有 content-drawer）

- 生成前：可折叠「素材（可选）」文本域 + 时长目标（30/45/60s）
- 生成中：两阶段状态文案（联网研究中… → 写稿中…），阶段一失败自动降级继续
- 生成后：素材简报折叠区（要点+来源链接）；逐字稿分块渲染（块头 `角色+秒段`，块右上「换一版」+ 一句话指令框）；页顶「整体指令」；hook 块 3 候选切换沿用 picked 机制
- 定稿：现有定稿按钮追加 StyleSample 沉淀动作，无新增用户操作
- 设置：新「风格档案」卡（编辑 StyleProfile.description + 样本列表只读/可删）
- UI 无彩色 emoji，沿用 `.panel` 体系与单色字形

## 4. 不做（YAGNI）

小红书/公众号接入（下期）；多轮 Agent 自评重写（路线 C）；风格样本自动聚类/加权（样本量不足）；素材简报人工编辑（先只读，复杂化前观察使用）；BGM/剪辑建议。

## 5. 成本与风险

| 项 | 说明 |
|---|---|
| 单篇成本 | 2 次 Tavily 搜索 + 2 次 DeepSeek 调用（研究提炼+写稿），几分钱级；改稿每次 1 次调用 |
| 长输出稳定性 | 逐字稿 45s ≈ 200-300 字/块×3-6 块，单次输出量可控；zod 校验失败走 callStructured 现有重试 |
| refineSection 越权改动 | prompt 明确「其余块原样返回」+ 服务端校验非目标块文本未变，变了则拒绝该轮 |
| 风格样本污染 | 定稿才入样本（用户已把关）；设置卡可删单条样本 |
| 真实 E2E | mock 全覆盖；真实 DeepSeek+Tavily 一轮在收尾用已就绪的 key 当场自验 |
