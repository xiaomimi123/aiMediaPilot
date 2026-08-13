# 抽屉改稿闭环 + 小红书两阶段接入（cockpit 六期）

**日期:** 2026-08-14
**背景:** 五期交付抖音两阶段生成后留下两个已知限制（spec 五期 §6(c)：抽屉关闭后改稿 UI 不可恢复；picked 自动推进阶段失效），同时小红书作为第二主力平台仍在旧单阶段生成。六期一次补齐：A 抽屉闭环修复 + B 小红书两阶段接入（用户选定「整稿指令」粒度）。

## 0. 已确认决策

| 决策点 | 结论 |
|---|---|
| 范围 | A+B 一期干完（用户选定）；公众号不动 |
| XHS 改稿粒度 | 整稿一句话指令重写 intro+body；不做分块 sections 化（笔记正文短，分块价值低，YAGNI） |
| XHS 输出结构 | 保持现有 6 区块 schema（titles/coverText/intro/body/tags/shotIdeas）字段与边界不变，只换 system prompt 为两阶段写法 |
| XHS emoji | 标题/正文 emoji 是平台惯例与 vendor 既有设计，保留；UI 禁 emoji 规则只约束界面字形 |
| 风格样本 | StyleSample.platform='xiaohongshu' 独立积累；样本文本 = intro + '\n' + body；覆盖更新语义同抖音（五期用户裁决） |
| styleHints 退役范围 | xiaohongshu 分支退役 inspirationId/styleHints（同五期抖音先例）；gongzhonghao 保留原状 |

## 1. A — 抽屉改稿闭环（抖音路径修复）

1. **关联回写**：`POST /api/v1/scripts/generate` 请求体新增可选 `cockpitContentId?: string`。douyin/xiaohongshu 分支生成成功后 best-effort 回写 `CockpitContent.scriptDraftId = 新 ScriptDraft.id`（照旧 `POST /api/v1/scripts` 路由的既有关联逻辑：校验归属、失败仅 console.warn 不阻断生成响应）。抽屉 generate-flow 把当前内容卡 id 透传。
2. **懒加载拉回**：抽屉 script 页在「本地无生成态（douyin 看 sections、xiaohongshu 看 research/intro 状态）且 item.scriptDraftId 非空」时调 `GET /api/v1/scripts/[id]`（既有路由）拉回 output，恢复素材简报区/分块改稿/hook 候选/整稿指令 UI；拉回失败静默降级为现状渲染（骨架文本本来就在）。旧形态稿（无 script.sections 键）按现状渲染。竞态守卫沿用五期 currentItemIdRef 模式。
3. **定稿推进复活**：关联补上后 `PUT /api/v1/scripts/[id]/picked` 里 script→recording 自动推进的既有逻辑自然恢复，验证并补一条集成测试断言。

注意：`CockpitContent.scriptDraftId` 是服务端字段（server-store 明确不随 workspace PUT 写入），回写它不触碰 cockpit rev 机制、不扩大 409 面。

## 2. B — 小红书两阶段接入

```
xiaohongshu 分支（generate 路由）：
runResearch(userId, {topic, niche, userMaterials})   ← 五期库原样复用，平台无关
→ getStyleContext(userId, 'xiaohongshu')             ← 样本 <2 用 StyleProfile.description，≥2 最近 3 篇
→ callStructured(SCRIPT_WRITE_XHS)                   ← 新 prompt，输出 schema 与现有 XHSScriptResponseSchema 完全一致
→ ScriptDraft.output = { research, titles, coverText, intro, body, tags, shotIdeas }
→ 响应 data 加 research / researchDegraded / scriptDraftId（同抖音）
```

- **SCRIPT_WRITE_XHS prompt**（新文件 script-write-xhs.ts）：吃 `{topic, brief, style}`；system 要求简报 fact 引进正文、小红书语感（情感化短段落、加粗关键句）、samples 模式嵌入用户最近定稿的 intro+body 仿写；schema 逐字沿用 XHSScriptResponseSchema（字段/min/max 不变）。
- **请求参数**：materials 对 xiaohongshu 开放；durationSec 对 xiaohongshu 不接收（传了忽略）。
- **整稿改稿**：`POST /api/v1/scripts/[id]/refine` 支持 platform='xiaohongshu'：`scope:'all'` 用新 refine prompt 重写 intro+body（titles/coverText/tags/shotIdeas 原样保留，服务端校验这四键未被改动，违者 502 同抖音守卫先例）；`scope:'section'` 对 xiaohongshu 返回 400（明确文案）。
- **定稿沉淀**：picked 路由对 platform='xiaohongshu' 的稿子沉淀 `intro + '\n' + body` 到 StyleSample（depositStyleSample 需扩展为按平台取不同文本源）。
- **抽屉**：小红书生成后展示素材简报折叠区 + intro/body/tags/配图建议渲染 + 整稿指令框；素材框开放；懒加载同 A-2 机制。

## 3. 不做（YAGNI）

小红书分块改稿；公众号任何改动；两平台 refine schema 合并（platform 分支判别、各自独立）；封面图生成；老稿迁移（零迁移原则延续）。

## 4. 风险

| 风险 | 对策 |
|---|---|
| 懒加载拉回旧形态/畸形 output | 防御解析（沿 mapDouyin 窄化风格），无 sections 键即不渲染改稿 UI，静默降级 |
| XHS 整稿改稿越权改标题/标签 | 服务端校验 titles/coverText/tags/shotIdeas 四键未变，违者 502 不写库 |
| 两平台样本互串 | getStyleContext/depositStyleSample 均按 platform 过滤，五期已有边界测试，扩展用例到 xiaohongshu |
| cockpitContentId 回写失败 | best-effort：console.warn 不阻断，生成结果照常返回（关联缺失只是回到五期现状，不更坏） |
| 真实 E2E | 收尾用真实 key 跑：抖音懒加载恢复改稿、picked 自动推进、小红书两阶段生成+整稿改稿+样本沉淀 |

## 5. 实际实施结论（T1-T6 落地后回写，2026-08-14）

设计文档写于实施前，以下是与草稿假设有出入、或草稿未覆盖、需要落盘存档的实际决策，逐条对应 `.superpowers/sdd/2026-08-14-drawer-closure-xhs/task-*-report.md` 里的记录：

**(a) xiaohongshu 二次保存孤儿 ScriptDraft——T4 交接、T6 修复的真实 bug**：草稿 §1「关联回写」只讲了 douyin 的落库+关联，未预见 T4 把 xiaohongshu 也改成落库后会在前端复现五期修过的同一个坑。`src/lib/cockpit/generate-flow.ts` 的「生成成功后是否二次 `POST /api/v1/scripts` 保存」分支在 T6 之前只判断 `platform === 'douyin'`——T4 report 明确交接：xiaohongshu 的 `/api/v1/scripts/generate` 已经 `prisma.scriptDraft.create` 一条草稿 A（且带 `cockpitContentId` 时已把 `CockpitContent.scriptDraftId` 指向 A），但 `generate-flow.ts` 没跟着改，仍会对同一次生成结果再 `POST /api/v1/scripts` 产生第二条草稿 B，并把 `CockpitContent.scriptDraftId` 覆盖指向 B——A 变成永久孤儿记录，且前端此后所有 refine/改稿请求都对着 B 走。T6 把分支条件扩到 `platform === 'douyin' || platform === 'xiaohongshu'`，`gongzhonghao` 的生成路由仍不落库、继续走二次保存路径不变。真实 E2E（见下方 (e)）验证修复后同一次生成只产生 1 条 `ScriptDraft`。

**(b) parseDraftOutput 按形状嗅探而非按 platform 参数区分——用户裁决 + 向后兼容优先**：简报 §1 items 明确把这个决定权交给实施（"按 platform 或按形状嗅探——你定，报告说明"）。T6 选择**形状嗅探**、不改动 `parseDraftOutput(output: unknown)` 的现有签名（不新增 `platform` 参数）：先尝试解析 douyin 形态（`output.script.sections` 非空数组），失败再尝试 xiaohongshu 形态（顶层 `intro`+`body` 都是非空字符串）。理由：(1) 两种形态在结构上天然互斥（一个有 `script` 包裹层、一个没有），嗅探不会有歧义；(2) 判别口径直接照抄 `refine/route.ts` 里 `XhsOutputReadSchema` 对 xhs 的最小校验（intro/body 双非空字符串），两处口径保持一致；(3) 不改函数签名对 T2 已交付的 10 个既有单测零影响，新增的 4 个 xhs 形态单测独立于原有用例，`ParsedDraftOutput` 只是新增了几个可选字段，douyin 分支返回值结构字符不变。调用方 (`content-drawer.tsx` 懒加载 effect) 按 `parsed.sections` 是否存在分流到对应的恢复分支，两条分支互斥、不会同时触发。

**(c) 素材简报折叠区的「复用五期组件」落地为提取公共子组件，而非复制粘贴**：简报字面用词是「复用」。`ScriptSectionsPanel`（五期 douyin 分块面板）里渲染素材简报的 JSX 原本内联在组件顶部，T6 把它抽成独立的 `ResearchBriefDetails({ research, researchDegraded })` 子组件，`ScriptSectionsPanel` 与新增的 `XhsScriptPanel`（六期小红书面板）都调用同一个子组件——不是两处各写一份视觉相同的 JSX，改一处两处生效，符合「复用」的字面要求且降低后续维护成本。

**(d) 素材（可选）折叠框对 xiaohongshu 开放，用一个新 CSS 修饰类而非改动共享布局**：`.script-generate-options` 原本是两列 grid（素材 + 时长下拉），专为 douyin 设计。xiaohongshu 没有时长下拉（`durationSec` 服务端不消费该分支），若直接复用两列布局会在右侧留一块空白。T6 新增 `.script-generate-options.single { grid-template-columns: 1fr }` 修饰类，xiaohongshu 分支渲染时只挂一个 `<details className="script-materials-details">`（不含时长 `<label>`）并套用 `single` 类，douyin 分支渲染逻辑字符未改。

**(e) 真实 E2E 验证方式：curl 建 CockpitContent + 命中真实 API，浏览器走查补验 UI 渲染路径**：简报要求「curl + DB 查询」。用户的开发数据库在生成前只有 3 条真实 douyin 内容、无 `stage='script'` 的内容可直接拿来测——T6 用 `GET/PUT /api/v1/cockpit/workspace`（真实 API，非绕过）新增 2 条 `stage='script'` 的测试内容（1 条 douyin、1 条 xiaohongshu），跑完全部五项 curl 断言后**删除了这 2 条测试内容及其派生的 `ScriptDraft`/`StyleSample`/`CockpitStageEvent`**，把数据库还原到测试前的 3 条真实内容——因为 `depositStyleSample` 会把测试生成的样本计入该平台「最近 3 篇」few-shot 池，不清理会让用户后续真实生成的小红书稿子被测试数据污染文风参照。curl 验证之外，额外用 `claude-in-chrome` 走查了一遍真实浏览器交互（点击「用 AI 写脚本」→ 面板渲染 → 页顶整稿指令 → 关抽屉重开(不刷新)恢复），确认：curl 直接调用 `/api/v1/scripts/generate` 能验证草稿落库/研究简报/6 区块合规，但**不会**触发 `mergeScript` 回填六字段骨架（`headline`/`hook`/`conclusion`/`body`/`example`/`ending`）——`mergeScript` 只在 `generate-flow.ts` 的浏览器端调用链里发生，纯 curl 生成的草稿六字段骨架仍是空文本框，这不是 bug，是 curl 测试方法本身绕过了前端这一层，浏览器走查确认走 UI 点击「用 AI 写脚本」按钮时六个字段全部正确回填（含 `mapXiaohongshu` 的 titles→headline/intro→hook/coverText→conclusion/body→body/shotIdeas→example/tags→ending 六个映射逐一核对），整稿指令成功后只有 `hook`/`body` 两个字段更新、其余四个字段原样不变，与设计一致。详见 `task-6-report.md`。

**(f) 其余实际偏差（详见各 Task report）**：
- `GET /api/v1/scripts/[id]` 路由在六期开工前已存在（Phase 5 交付), T1/T2 均确认未新建，简报自评的「已知不确定点」之一就此澄清（T1 report 明确记录）。
- `depositStyleSample`/`getStyleContext` 对 xiaohongshu 的支持在 T4 就已完整交付（防御性读取 `intro`/`body`，按 platform 过滤 few-shot 池），T6 的 `PUT /api/v1/scripts/[id]/picked` 定稿路由本身零改动即可对小红书生效——「④xhs 定稿 → StyleSample 落库」这一项 E2E 因此不需要新增任何抽屉 UI（没有独立的「定稿」按钮），直接复用已有的 `picked` 接口语义（douyin 靠选 hook 候选触发，xiaohongshu 目前没有等价的 UI 触发点，六期收尾用 curl 直接命中该接口验证服务端行为；若后续要在小红书面板加一个显式「定稿」按钮留待下期，本期未做，YAGNI）。
- `mapXiaohongshu`（`script-mapping.ts`）在 T4/T6 全程**零改动**——T4 report 已验证响应新形状对它零影响，T6 复用它处理整稿指令的局部回填（只传 `{intro, body}` 两键）时同样验证了未出现的键不会在返回对象里产出对应字段，不会误覆盖骨架里 `headline`/`conclusion`/`example`/`ending` 已有的用户内容。
