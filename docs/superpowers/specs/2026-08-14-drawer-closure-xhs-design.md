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
