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

## 6. 实际实施结论（T1-T8 落地后回写，2026-08-13）

设计文档写于实施前，以下是与草稿假设有出入、或草稿未覆盖、需要落盘存档的实际决策，逐条对应 `.superpowers/sdd/2026-08-13-script-quality/progress.md` 里的账本条目：

**(a) 样本沉淀由「跳过」改为「覆盖更新」——用户裁决（T6 修复轮）**：草稿 §1 只说"定稿即样本"，未明确同一草稿改稿后再次定稿该怎么处理。T6 初版按幂等直觉实现为"同 `sourceScriptDraftId` 已有样本则直接跳过"，审查发现这会把样本冻结在**初稿**文本——用户走 refine 改稿后再定稿，样本永远不会更新到最新改稿版本。用户裁决改为**覆盖更新**已有样本的 `content`（`depositStyleSample` 返回值语义也从"本次是否新建"改为"本次是否写入"，`createdAt` 保留首次创建时间不变，语义上应理解为"最近一次定稿/改稿的产出"而非"首次生成"）。

**(b) douyin 放弃 `inspirationId`/`styleHints`，风格整体切给 `getStyleContext`（T4）**：草稿 §1「风格」一节只讲了 StyleProfile/StyleSample 路线，未明说是否与既有 `inspirationId → loadStyleHints → styleHints` 机制（xiaohongshu/gongzhonghao 仍在用）共存。实施时 `SCRIPT_WRITE_DOUYIN.buildUserMessage` 签名直接是 `{topic, durationSec, brief}`，不接受 `styleHints`；douyin 请求里的 `inspirationId` 参数仍会被解析但对 douyin 分支完全不生效，响应里也不再出现 `inspirationApplied` 字段。xiaohongshu/gongzhonghao 两个分支的 `inspirationId` 机制原样保留、代码字符级未改——两条风格来源自此在同一路由内并存但完全独立，不是 douyin 迁移到新机制后旧机制被废弃。

**(c) douyin 去掉二次保存，`CockpitContent.scriptDraftId` 不再被写入，picked 自动推进阶段对抽屉生成的 douyin 稿失效——中性权衡（T4→T7 闭环）**：草稿未预见这一层影响。T4 让 `/api/v1/scripts/generate` 的 douyin 分支自己 `prisma.scriptDraft.create` 并把 `scriptDraftId` 放进响应；T7 顺势把抽屉端（`src/lib/cockpit/generate-flow.ts`）对 douyin 也去掉了原本"generate → 二次 `POST /api/v1/scripts` 保存"的调用（该二次保存此前会带上 `cockpitContentId` 建立 `ScriptDraft ↔ CockpitContent` 关联，且旧的 `SCHEMA_BY_PLATFORM.douyin` 已经是过时的 `retentionBeats` 形状，继续调用会直接校验失败）。去掉二次保存避免了每次生成都产生一条孤儿 `ScriptDraft`，但代价是 `/api/v1/scripts/generate` 路由本身不接收也不处理 `cockpitContentId`，`CockpitContent.scriptDraftId` 对抽屉里生成的 douyin 稿永远是空——`PUT /api/v1/scripts/[id]/picked` 里「定稿推进 stage: script → recording」的自动推进逻辑按 `scriptDraftId` 反查 `CockpitContent` 静默查不到，用户选定 hook 候选后内容看板不会自动推进阶段，需要手动切换。判定为实现取舍的副作用而非新缺陷（二者是同一个权衡的一体两面），后果中性（手动推进仍可用），未在本期修复；若要修，需要在 `/api/v1/scripts/generate` 路由里比照旧 `route.ts` 的 best-effort cockpit linkage 逻辑接收并处理 `cockpitContentId`。

**(d) `refine` 无 DeepSeek key → 503，`generate` 同场景 → 500——两条路由口径不同、有意保留分歧（T5）**：草稿 §5 未细化到 HTTP 状态码。T5 简报字面明确要求 refine 路由无 key 走 503（参考 generate 路由的既有**文案**），但 `generate` 路由该场景实测/实读代码确认走的是 500——两者状态码不一致。T5 按简报字面执行 503，未回头统一改动 `generate` 路由；T8 复核确认这一差异在 T5 完成后一直保留至今，实测（`generate` 路由源码第 92-95 行）验证 500 仍是当前行为。如果这处不一致并非有意为之，需要产品侧确认统一口径，但截至本期收尾未收到改的指示，原样记录在案。

**(e) `SEARCH_DAYS=7` 沿雷达口径，`maxResults=5` 与简报字面一致（T3）**：草稿 §1 只写"Tavily 搜索 2 次"未给出具体天数/条数参数。`runResearch` 的 Tavily 调用固定 `{maxResults: 5, days: 7}`——`days` 沿用四期 `radar/run.ts` 的 `SEARCH_DAYS` 同一常量值（近一周），不是本期新定的口径；`getSearchProvider(tavilyKey).search()` 内部再把 `days` 换算成 Tavily 真实 API 的 `time_range` 分桶（四期 `search.ts` 已有的换算逻辑，本期未改动）。

**(f) 素材超长截断会静默丢弃「用户素材」——T8 真实 E2E 发现并修复的实现缺陷**：草稿 §1「深度素材」明确要求素材框内容要能进入简报（"两者都要"），但草稿未预见截断顺序会破坏这个承诺。`composeRawMaterials` 的截断策略是简单的 `slice(0, maxLen)`（保留头部丢弃尾部），而实施时 `runResearch` 组装素材池的顺序是「雷达种子 → Tavily 搜索结果 → 用户素材」——用户素材排在最后。真实调用验证：Tavily 两次搜索最多可返回 10 条结果，单条正文常有数千至近两万字，合计轻松突破 `MAX_RAW_MATERIALS_LEN=8000` 的上限；一旦总量超限，排在最后的「用户素材」整段被截断丢弃，**从未出现在喂给 DeepSeek 的 `rawMaterials` 里**，简报因此清一色只引用搜索来源的 URL，用户在素材框里明确填写的内容形同虚设。T8 复现（详见 `task-8-report.md` E2E ②）并修复：把素材池拆成 `curatedParts`（雷达种子 + 用户素材，两者都简短且是明确关联该选题的高信号内容）与 `searchParts`（Tavily 搜索正文，体积最大）两组，拼接顺序改为 `curatedParts` 在前、`searchParts` 在后，容量不足时被截断的是体积最大、优先级最低的搜索正文，而不是用户主动提供的内容。已补充回归测试（`tests/lib/script/research.test.ts`：搜索正文远超 8000 字上限时用户素材/雷达种子仍完整保留）并用真实 key 重新跑通验证简报能正确引用 `source: '用户素材'`。

**(g) 其余实际偏差（详见 `progress.md` 与各 Task report）**：
- `StyleProfile` 按 T1 简报字面执行为**不建** `User` 反向关系（与仓库里更晚出现的 `RadarConfig` 现状——已加 `user` relation——不一致），后续若需要 `user.styleProfile` 反查方式会拿不到，需直查 `prisma.styleProfile.findUnique({where:{userId}})`（T1）。
- `depositStyleSample`/`getStyleContext` 均不走 `user.xxx` 反向关系，统一直查（T1/T3）。
- `mapDouyin` 的 `sections` 分支与旧 `hooks[]`/`retentionBeats[]` 逻辑是二选一开关，不做逐字段级联回退——`sections` 非空数组即认为是新形态整体接管，不会出现新旧字段混用的稿子（T4）。
- `refine` 的「其余块原样返回」校验只比较 `text` 字段，不比较 `role`/`startSec`/`endSec`（T5，如需连秒段/角色也锁定需要另加校验）。
- `StyleSample.platform` 取自 `ScriptDraft.platform` 而非独立传参，保证样本平台标签与草稿来源平台恒一致（T3）。
- 真实 Tavily + 真实 DeepSeek 的全链路端到端，本期在收尾用已就绪的 key 当场跑通（四期收尾时因无可用真实 Tavily key 未跑通、验证责任曾转移给用户），过程中发现并修复了 (f) 项截断顺序缺陷，其余四项 E2E 断言（研究非空/含用户素材来源/分块与整稿改稿/定稿沉淀样本触发 few-shot）均一次性通过，详见 `task-8-report.md`。
