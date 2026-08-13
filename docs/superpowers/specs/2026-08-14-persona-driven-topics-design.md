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

## 6. 实际实施结论 (T6 收尾)

**实施期间产生的技术决策（Task 1-5 已知不确定点回收）：**

- **`vision.ts` `CallStructuredOpts<T>` 泛型放宽**：`responseSchema` 类型从 `z.ZodType<T>` 改为 `z.ZodType<T, z.ZodTypeDef, any>`（Input 显式设为 `any`）。原因：`radar-read.ts` 的 `pillarHit` 字段用了 `.nullable().optional().default(null)`，此时 zod schema 的 Input 类型（`string | null | undefined`）与 Output 类型（`string | null`）不一致，若 `CallStructuredOpts<T>` 仍要求 Input === Output 会在其余不带 `.default()` 的调用点报 "not assignable"。放宽只影响类型层，不影响运行时行为；验证过其余调用点（script-write-douyin/xhs、topic-discovery 等）类型推断未被弱化。
- **niche 硬编码 `'ai-knowledge'`**：`persona/draft/route.ts` 的 `DEFAULT_NICHE` 常量沿用 `radar-read.ts` 先例——产品当前只服务单一 AI 知识赛道，5 问访谈本身也不收集 niche，没有别的来源可取。多赛道场景需要改造（不在本期范围）。
- **`refine` 改稿路由不注入 persona——系已知边界**：spec §3 明确只列三处注入（雷达评分/选题灵感/写稿角度），`src/app/api/v1/scripts/[id]/refine/route.ts` 未纳入。改稿是针对已有稿件的局部调整（用户给具体修改指令），角度已经在首次生成时由 persona 段定过，改稿场景重复注入意义不大且会拉长 prompt；`gongzhonghao` 平台生成同样不注入（spec §3 明确写明"gongzhonghao 不动"）。两处都是设计边界，不是遗漏。
- **`heatScore` 与 `heatFactors` 的分层语义**：`RadarItem.heatScore`（入库/排序用的最终分）已经过 `composeHeat`（四维加权 + 共现加成）**和** `applyPersonaAdjust`（命中 +8 / 未命中 ×0.7）两层处理，是"最终展示分"。而 `heatFactors.relevance/freshness/discussion/feasibility` 是 `RADAR_READ` 阅读评分的**原始四维分**（未经任何调整），`heatFactors.cooccurrenceSources`/`personaAdjust`/`pillarHit` 是过程量（共现来源数 / 人设调权增量 / 命中的支柱名）。换句话说：`heatScore` 是"结果"，`heatFactors` 是"结果是怎么算出来的"审计轨迹——人设调权只体现在 `heatScore` 与 `heatFactors.personaAdjust` 两处，不会回写四维原始分。

**真实 E2E 实测结果与偏差（真实 DeepSeek + Tavily key，非 mock）：**

1. **①访谈建档**：5 问真实作答（AI 知识类抖音博主 / 想吸引想用 AI 提效搞副业的普通人 / 擅长工具实测），`POST /api/v1/persona/draft` 返回 5 条具体支柱（翻车实测/效率革命/行业内幕/赚钱案例/技术祛魅，均能直接派生选题方向，非"分享干货"类空泛表述）；`PUT` 保存后 `GET` 返回 `established: true`。符合预期，无偏差。
2. **②真实雷达扫描**：首次触发命中 24h 滚动读预算已耗尽（`errors: [{stage: 'budget', message: '今日阅读额度已用完'}]`，`read: 0`）——临时 `PUT /api/v1/radar/config { dailyLimit: 200 }` 重扫后暴露了**一个真实的环境类问题（非产品代码 bug）**：常驻的 `radar-worker`（`npm run worker:dev`，`tsx` 长驻进程，无热重载）启动时间早于本期全部 5 个 persona 提交，扫描出的 `RadarItem.heatFactors` 完全没有 `pillarHit`/`personaAdjust` 键——worker 进程在导入时固化了旧版 `run.ts`（无人设注入逻辑），此后仓库代码怎么改它都不知道。重启 worker 进程后重新扫描，`heatFactors` 正确带上 `pillarHit: "行业内幕"`（7/7 命中同一支柱，因搜索结果都是 AI 模型资讯类新闻）与 `personaAdjust`（多数为 0——因共现加成已让 `composeHeat` 基础分逼近 100 上限，`applyPersonaAdjust` 的 `clamp(heat+8, 0, 100)` 空间有限）。**这与 README 已有的"dev server 长时间运行持旧 Prisma Client 会 500"是同一类问题（长驻进程 + 无热重载 + 代码变更），本期把它记录为通用开发提示（见 §6 下方"新增开发提示"），不需要代码修复。** 雷达页徽标渲染走 `pickPersonaBadge` 纯函数，用真实 `heatFactors` 数据复现验证（`pillarHit` 非空 → `{type:'pillar', name}` → 渲染支柱名徽标），未做浏览器像素级走查（同 T5 先例，API 级复现替代）。
3. **③真实生成一篇抖音稿**：主题「实测一款新出的 AI 写作工具能不能替代人工写公众号文章」，`POST /api/v1/scripts/generate`（platform=douyin）成功返回完整逐字稿。system prompt 注入证据：临时在 `scripts/generate/route.ts` 里加了一行 `console.log('personaSection.length =', personaSection.length)`，日志确认 `personaSection.length = 727`（非 0，内容含真实档案的受众/支柱段落），验证后已从代码中移除（`git diff` 确认无残留，未进入任何 commit）。稿件内容角度体现受众定位：hook/main 段落围绕"实测""翻车""AI 有边界"展开，与档案 `angle` 字段「真实是最大差异化：所有结论来自亲自测试，不吹不黑，翻车也照说」高度吻合，CTA 段呼应 pillar「翻车实测」（"下次实测AI写文案，告诉你哪些能信、哪些纯瞎扯"）。
4. **④无档案回退**：临时 `PUT` 清空 `audience` 字段（`established` 变为 `false`）后：生成一篇稿件复现 `personaSection.length = 0`（同法用临时 `console.log` 验证后移除）；雷达扫描（新增临时关键词避开 URL 去重，确保读到新内容）复现 `heatFactors` 中 `pillarHit: null`、`personaAdjust: 0` 对全部 7 条命中结果一致成立——行为与"无档案"现状完全一致。验证完毕后已用①保存的完整档案内容 `PUT` 恢复 `PersonaProfile`（`established` 恢复 `true`），并把临时调高的 `radar.dailyLimit` 恢复为 20，删除本轮回退验证专用的临时关键词与产生的雷达条目/测试稿件（`PersonaProfile` 本身作为①的真实成果保留不删）。
5. **⑤typecheck + test + build**：全绿（详见 task-6-report.md 命令输出）。

**新增开发提示（记入 README 技术债 / 本地开发章节）：**`radar-worker`（`npm run worker:dev`）是 `tsx` 常驻进程，不像 Next dev server 那样对 API route 改动热重载——**改了 `src/lib/radar/` 或其任何依赖后必须手动重启 worker 进程**，否则会在旧代码上跑，且不会报错（只是悄悄少算/漏算新逻辑），排查成本高。与「dev server 长时间运行持旧 Prisma Client 会 500」同属"长驻进程 + 代码变更不同步"这一类问题，重启即可解决。
