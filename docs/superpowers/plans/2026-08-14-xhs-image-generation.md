# 小红书 AI 配图生成 (cockpit 七期) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小红书稿一键生成全套配图（出图计划→gpt-image-1 逐张生图→zip 发布包），实现「定稿即成品」。Spec: `docs/superpowers/specs/2026-08-14-xhs-image-generation-design.md`。

**Architecture:** ImageProvider 抽象 + GptImageProvider 单实现（直连 api.openai.com，b64_json）；出图计划走 DeepSeek 一次调用产出统一风格+逐张 prompt 存 `output.imagePlan`；逐张生图独立路由（隔离超时、单张重试），图片落 `public/generated/<draftId>/<idx>.png` + `output.images` 记录；六期懒加载天然恢复。

**Tech Stack:** 同前 + OpenAI Images API（无 SDK，直接 fetch）+ zip 库（jszip，纯 JS 无原生依赖——本项目首个功能性运行时新依赖，README 记录）。

## Global Constraints

- 生图客户端**硬编码** `https://api.openai.com/v1`，禁止读取 `process.env.OPENAI_BASE_URL`（那指向百炼）；key 走新 `resolveImageApiKey(userId)`（AIConfig provider='gpt-image' → decrypt → **无 env 回退，直接 null**）。
- key 纪律：AES 加密存储、API 掩码返回、生图客户端日志不得包含 key；prompt 可入日志。
- 单稿图数上限 10（封面 idx=0 + shotIdeas ≤9）；尺寸固定 `1024x1536`；quality 请求级参数 `'low'|'medium'|'high'` 默认 `'medium'`。
- plan 路由幂等：已有 `output.imagePlan` 直接返回既有计划，`?force=1` 才重新规划；封面 prompt 必须要求把 coverText 原文渲染为海报大字且「文字务必准确清晰」。
- 仅 xiaohongshu 稿可生图（非 xhs 或缺 intro/body/shotIdeas → 400）；douyin/gongzhonghao 路径零改动。
- 图片写盘覆盖旧文件；`output.images` 只加键不动 output 其余键（spread 保留，六期 refine 先例）。
- 无 gpt-image key：生图按钮禁用+引导文案（雷达无 Tavily key 先例）；API 侧 503。
- UI 无彩色 emoji；互斥矩阵纳入生图动作（生图中禁改稿/重生成文案）；竞态守卫沿 currentItemIdRef 模式。
- API house 约定 ok()/fail() + getOrCreateDefaultUser；每 Task 结束 `npm run typecheck && npm run test` 全绿再 commit；尾行 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>。

---

## Task 1: 生图基础层（Provider + key 解析 + 设置项）

**Files:** Create `src/lib/image/provider.ts`、`src/lib/llm/resolve-image-key.ts`；Modify `src/lib/constants.ts`（AI_PROVIDERS 加 `{ id: 'gpt-image', label: 'OpenAI 生图', defaultModel: 'gpt-image-1' }`）；Test `tests/lib/image/provider.test.ts`、`tests/lib/llm/resolve-image-key.test.ts`。
**Interfaces (Produces，T3 消费):**
```ts
// provider.ts
export interface ImageGenOpts { prompt: string; size: '1024x1536'; quality: 'low' | 'medium' | 'high' }
export interface ImageProvider { generate(opts: ImageGenOpts): Promise<Buffer> }  // 失败 throw Error(含 status 文案, 不含 key)
export class GptImageProvider implements ImageProvider {
  constructor(private apiKey: string) {}
  // POST https://api.openai.com/v1/images/generations
  // body { model: 'gpt-image-1', prompt, size, quality, n: 1 }  (gpt-image-1 默认返回 b64_json, 不传 response_format)
  // Authorization: Bearer <key>; AbortController 120s 超时; resp.data[0].b64_json → Buffer.from(b64, 'base64')
  // 防御 zod: { data: [{ b64_json: string }] } 窄化
}
export function getImageProvider(apiKey: string): ImageProvider  // new GptImageProvider(apiKey)
// resolve-image-key.ts —— 照 resolve-key.ts 结构, 但无 env 回退
export async function resolveImageApiKey(userId: string): Promise<string | null>
// AIConfig where {userId, provider:'gpt-image'} orderBy isDefault desc → decrypt(catch→继续) → null
```
**Test:** provider mock fetch（成功 b64→Buffer 往返、401 throw 文案不含 key、超时 abort、畸形响应 throw）；resolve-image-key（有行解密、解密失败→null 不 throw、无行→null、日志无 key 断言）。
- [ ] Step 1: TDD RED→GREEN；commit `feat(image): gpt-image provider + key 解析 + 设置项`

## Task 2: 出图计划（prompt + 路由）

**Files:** Create `src/lib/llm/prompts/image-plan.ts`；Modify `src/lib/llm/prompts/index.ts`；Create `src/app/api/v1/scripts/[id]/images/plan/route.ts`；Test `tests/lib/llm/prompts/image-plan.test.ts`、`tests/api/scripts/images-plan.test.ts`。
**Interfaces (Produces):**
```ts
// image-plan.ts
export const ImagePlanSchema = z.object({
  style: z.string().min(10).max(300),           // 全篇统一视觉风格英文 token
  images: z.array(z.object({ idx: z.number().int().min(0).max(9), prompt: z.string().min(20).max(800) })).min(1).max(10),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;
export const IMAGE_PLAN = { buildSystemPrompt(niche: string): string, buildUserMessage(input: { coverText: string; intro: string; body: string; shotIdeas: { idx: number; description: string }[] }): ContentPart[], responseSchema: ImagePlanSchema };
// system: 为小红书图文笔记规划全套配图; 输出统一视觉风格(style)+每张完整英文图像 prompt(已融合 style);
// idx=0 封面: prompt 必须包含「将中文文字 "<coverText>" 作为海报大字渲染, 文字务必准确清晰」; idx 1..N 对应 shotIdeas; 竖版 3:4 构图
```
plan 路由：读 ScriptDraft（归属/platform='xiaohongshu'/有 intro+body+shotIdeas 否则 400）→ 已有 `output.imagePlan` 且无 `?force=1` → 直接 ok(既有计划)（幂等，不调 LLM）→ 否则 resolveDeepSeekApiKey（无 key 503）→ callStructured(IMAGE_PLAN) → 校验 images 数 = 1+shotIdeas 数且 ≤10（LLM 输出不符则 502 重试文案）→ 存 `output.imagePlan`（spread 保留其余键）→ ok({ plan })。
**Test:** schema 边界；system 关键词（含「海报大字」「准确清晰」）；路由幂等/force/非 xhs 400/缺块 400/数量校验 502/spread 保留断言。
- [ ] Step 1: TDD；commit `feat(image): 出图计划 prompt + 路由 (幂等)`

## Task 3: 逐张生图路由

**Files:** Create `src/app/api/v1/scripts/[id]/images/route.ts`；Test `tests/api/scripts/images-generate.test.ts`。
**Interfaces:** Consumes T1 `resolveImageApiKey`/`getImageProvider`、T2 `output.imagePlan` 形状。`POST body { idx: number; quality?: 'low'|'medium'|'high' }`（默认 medium，非法 400）。流程：读稿（归属/xhs/imagePlan 存在否则 400；idx 越界 400）→ resolveImageApiKey 无 key 503（文案「OpenAI 生图 key 未配置」）→ getImageProvider(key).generate({prompt: plan.images[idx].prompt, size:'1024x1536', quality}) → `fs.mkdir(path.join(process.cwd(),'public','generated',draftId), {recursive:true})` → writeFile `<idx>.png` 覆盖 → `output.images = { ...旧 images, [idx]: { path: '/generated/<draftId>/<idx>.png', prompt, createdAt: new Date().toISOString() } }` spread 持久化 → ok({ idx, path })。provider throw → fail(502, 文案含「第 <idx+1> 张生成失败」)。
**Test:** house mock（fs/promises 模块 mock + provider mock）：成功写盘路径与 output.images 形状、单张覆盖不动其他 idx、无 plan 400、idx 越界 400、无 key 503、provider 异常 502 且不写库、quality 透传与默认值、output 其余键 spread 保留。
- [ ] Step 1: TDD；commit `feat(image): 逐张生图路由 (写盘 + output.images)`

## Task 4: zip 发布包

**Files:** `npm install jszip`（记 package.json；README 依赖段记录首个功能性运行时依赖及理由）；Create `src/app/api/v1/scripts/[id]/images/archive/route.ts`；Test `tests/api/scripts/images-archive.test.ts`。
**Interfaces:** `GET` → 读稿（归属/xhs/`output.images` 至少 1 张否则 400）→ jszip：每张 `output.images[idx].path` 对应磁盘文件读入 zip 为 `<idx>.png`（文件缺失单张跳过记 warnings，全缺 400）+ `note.txt`（内容：`titles[0].text + '\n\n' + intro + '\n\n' + body + '\n\n' + tags.map(t=>'#'+t).join(' ')`）→ `new Response(buffer, { headers: { 'Content-Type':'application/zip', 'Content-Disposition': 'attachment; filename*=UTF-8''<encodeURIComponent(topic)>-发布包.zip' } })`（非 ok() 包裹——二进制响应，house 约定例外，注释说明）。
**Test:** zip 内容断言（jszip 解包验证 png 条目+note.txt 文本）、单张缺文件跳过、全缺 400、非 xhs 400。
- [ ] Step 1: TDD；commit `feat(image): zip 发布包下载`

## Task 5: 抽屉生图 UI + 懒加载恢复

**Files:** Modify `src/components/cockpit/content-drawer.tsx`（XhsScriptPanel 增：「生成配图」按钮（无 key 时禁用+引导文案——key 状态从新增 `GET /api/v1/style/…`？不新增路由：直接尝试 plan 前置探测过重，**改为按钮常亮、点击后 503 时 notify 引导文案**，实施若发现体验太差可加轻量 `GET /api/v1/ai/config` 现有掩码接口判断 hasKey——以实际为准记报告）；点击流程：无 imagePlan 先调 plan → 并发 2 逐张 POST images → 缩略图网格（`<img src={path}>`）渐进渲染，单格失败显示「重试」；全部完成解除 pending；「打包下载」按钮 = `<a href=/api/v1/scripts/{id}/images/archive download>`（有图才显示）；互斥：生图 pending 纳入五组动作矩阵（imgGenerating 状态双向互斥）；竞态：await 后 currentItemIdRef 守卫，迟到响应丢弃）；Modify `src/lib/cockpit/draft-restore.ts`（parseDraftOutput xhs 分支补 `images` 键窄化解析 → 懒加载重开恢复缩略图与 imagePlan 存在性）；Test：draft-restore images 用例；dev 手工走查（生成配图全流程+重开恢复+打包下载）。
**Interfaces:** Consumes T2/T3/T4 路由。
- [ ] Step 1: TDD（纯函数部分）+ 实现 + dev 走查；commit `feat(cockpit): 抽屉生图交互 + 发布包下载`

## Task 6: 收尾 — 文档 + 真实 E2E

**Files:** README 七期段（功能/key 配置/成本/jszip 依赖记录）；spec 回写「## 6. 实际实施结论」。
**真实 E2E（用户 OpenAI key 已配置后；约 1 元内）:** ①设置卡保存 gpt-image key（掩码验证）②取一篇六期 xhs 稿（或新生成）→ plan 真实调用（imagePlan 落库、封面 prompt 含 coverText）③真实生成封面+第 1 张配图（2 张真图落盘、output.images 记录、抽屉缩略图渲染）④archive 下载解包验证 png+note.txt ⑤重开抽屉图恢复 ⑥typecheck+test+build 全绿。若用户 key 未配置：mock 全过 + 真实项标注待用户配 key 自验（DeepSeek 先例），不硬凑。
- [ ] Step 1: 文档；Step 2: E2E；Step 3: commit `docs(image): 七期收尾, README/spec 对齐`

---

## Self-Review 记录

- Spec 覆盖：§1 两步链路(T2/T3) ✓ §2 存储+zip(T3/T4) ✓ §3 设置/降级/resolveImageApiKey(T1/T5) ✓ §4 YAGNI 未越界 ✓ §5 风险→测试/单张重试/上限 10(T2 数量校验+T3) ✓。
- 类型一致性：ImageGenOpts T1=T3 ✓；ImagePlan T2 产出=T3 消费 `plan.images[idx].prompt` ✓；`output.images[idx].path` T3 写=T4 读=T5 渲染 ✓。
- 已知不确定点（实施核实记账本）：gpt-image-1 请求体是否需要 response_format 参数（T1 以官方文档为准，测试 mock 不受影响）；无 key 按钮引导的实现深度（T5 标注）；jszip 与 Next.js route handler 的 Buffer 兼容（T4 实施验证）。
