# Script Generate Mode Design Spec

**Status:** Draft 2026-06-17
**Owner:** MediaPilot (solo dev)
**Phase:** v4 — Sub-project E (拍摄那一半)

## 1. Goal & Scope

把 MediaPilot 从"评估已有视频" (evaluate mode) 拓展到 "为待拍视频出脚本" (generate mode), 闭合 选题 → 拍摄 → 优化 三段中的拍摄。 用户填 topic + niche, 一次 DeepSeek 调用产出 4 区块 (hooks / retention beats / titles / cover)。 默认 stateless, 用户点"保存"才入 ScriptDraft 表。

**In scope:**

- `ScriptDraft` 表 (新)
- `src/lib/llm/prompts/script-generate.ts` — 提示词 + zod schema (复用 niche persona)
- POST `/api/v1/scripts/generate` (stateless, 调 LLM)
- POST `/api/v1/scripts` / GET / GET[id] / DELETE[id] CRUD
- `/content/script/new` form
- `/content/script/[id]` 已保存详情
- `/content/script` 列表
- Dashboard h1 + Upload form 顶部 加入口 link
- 单测覆盖 generate (mock LLM) + crud (mock prisma)

**Out of scope (留 v2):**
- "用此脚本开分析" 一键 prefill draftTitle/Caption
- 重生成时 lock 部分候选
- 标签 / 收藏 / 分页
- 多语 (中文 only)
- 与已发布抖音视频反查关联

## 2. Architecture

```
[ /content/script/new ]  client form (topic + niche)
        ↓ POST /api/v1/scripts/generate (stateless)
   DeepSeekTextLLM.callStructured({
     systemPrompt: getExpertPersona(niche) + SCRIPT_GENERATE.systemPromptTail,
     userMessage: SCRIPT_GENERATE.buildUserMessage({ topic }),
     responseSchema: ScriptGenerateResponseSchema,
   })
        ↓ JSON response (不入库)
   client 渲染结果 + [复制] + [💾 保存] + [🔄 再生成]
        ↓ 用户点 保存
   POST /api/v1/scripts  body={topic, niche, output}
        ↓ prisma.scriptDraft.create
   返回 { id }
        ↓
   client redirect /content/script/<id>
```

## 3. Data Model

```prisma
model ScriptDraft {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  topic     String
  niche     String
  output    Json
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

`User` model 加反向关系: `scriptDrafts ScriptDraft[]`。

通过 `prisma db push` 同步。

## 4. LLM Prompt + Schema

`src/lib/llm/prompts/script-generate.ts`:

```typescript
import { z } from 'zod';
import { getExpertPersona } from './expert-persona';
import { JSON_STRICTNESS } from './base';
import type { ContentPart } from '@/lib/llm/vision';

export const ScriptGenerateResponseSchema = z.object({
  hooks: z.array(
    z.object({
      text: z.string().min(5).max(100),
      rationale: z.string().min(5).max(200),
    })
  ).length(3),
  retentionBeats: z.array(
    z.object({
      startSec: z.number().int().nonnegative(),
      endSec: z.number().int().positive(),
      beat: z.string().min(3).max(200),
    })
  ).min(3).max(10),
  titles: z.array(
    z.object({
      text: z.string().min(5).max(60),
      hookType: z.string().min(2).max(30),
    })
  ).length(3),
  cover: z.object({
    textOverlay: z.string().min(2).max(20),
    shotIdea: z.string().min(5).max(200),
    colorTone: z.string().min(2).max(50),
  }),
});

export type ScriptGenerateResponse = z.infer<typeof ScriptGenerateResponseSchema>;

export const SCRIPT_GENERATE = {
  buildSystemPrompt(niche: string): string {
    return `${getExpertPersona(niche)}

任务: 用户给你一个视频主题 (topic), 你为这个待拍视频生成 4 个区块:

1. hooks (3 个候选钩子, 0:00-0:03 开头用)
   - text: 实际口播文案 / 屏幕字幕, ≤ 30 字
   - rationale: 一句话说明为什么这个钩子能抓住 0-3s 注意力 (痛点/反差/数字/悬念 哪类)

2. retentionBeats (节奏拆段, 假设视频 30-60s 长)
   - 每段一行: startSec / endSec / beat (这段做什么)
   - 段数 3-10, 推荐 5-7 段
   - beat 要具体, 不要 "进入内容" 这种空话

3. titles (3 个候选标题, ≤ 25 字)
   - text: 标题
   - hookType: 钩子类型 (数字/反差/问题/承诺/悬念)

4. cover (单个封面方案)
   - textOverlay: 封面上的文字 (≤ 8 字)
   - shotIdea: 一句话描述镜头内容
   - colorTone: 配色基调 (例 "白底红字 / 深色高对比")

${JSON_STRICTNESS}`;
  },
  buildUserMessage(input: { topic: string }): ContentPart[] {
    return [
      {
        type: 'text',
        text: `主题: ${input.topic}\n\n按 schema 输出 4 个区块。`,
      },
    ];
  },
  responseSchema: ScriptGenerateResponseSchema,
};
```

## 5. API Contracts

### 5.1 `POST /api/v1/scripts/generate` (stateless)

**Body:**
```json
{ "topic": "如何用 ChatGPT 写周报", "niche": "ai-knowledge" }
```

**Validation:**
- `topic`: 3 ≤ len ≤ 500
- `niche`: 非空字符串 (任意值, KNOWN_NICHES 不强制)

**Response (200):**
```json
{
  "success": true,
  "data": <ScriptGenerateResponse>,
  "message": "ok"
}
```

**Error:**
- 400 invalid input
- 500 LLM error (含 zod 解析失败) — 友好 message

无 DB 写入。

### 5.2 `POST /api/v1/scripts` (save)

**Body:**
```json
{ "topic": "...", "niche": "...", "output": <ScriptGenerateResponse> }
```

校验 output 通过 `ScriptGenerateResponseSchema` (重防御一次)。

**Response (200):**
```json
{ "success": true, "data": { "id": "cuid..." }, "message": "ok" }
```

### 5.3 `GET /api/v1/scripts` (list)

返回 `{ items: Array<{id, topic, niche, createdAt}> }`,  user 范围, orderBy createdAt desc, take 20。 v1 不分页。

### 5.4 `GET /api/v1/scripts/[id]`

返回 full ScriptDraft (含 output)。 404 if other user / not exist。

### 5.5 `DELETE /api/v1/scripts/[id]`

返回 `{ deleted: true }`。 404 if other user / not exist。

## 6. UI

### 6.1 `/content/script/new` (client form)

```
✏️ AI 脚本生成

主题  [_______________________________]    例: 如何用 ChatGPT 写周报
垂类  [AI 知识 ▾]    (与 upload form 同 niche 选项)

[ 生成脚本 → ]   (~10s)
```

提交 → POST generate → loading → 跳到 `<ScriptResult inline>` (同页内联渲染) 或 临时把结果存到 useState,  按"保存"才 POST 入库。

### 6.2 ScriptResult component

```
✏️ 脚本: 如何用 ChatGPT 写周报          [💾 保存] [🔄 再生成]

🪝 钩子 (0:00-0:03)
1. "你每周写周报花多少时间? 我现在 3 分钟搞定"  [📋 复制]
   理由: 痛点 + 量化反差
2. ...
3. ...

⏱ 完播节奏
0:00-0:03  钩子: 痛点+承诺
0:03-0:10  说现状: 大多数人怎么做
0:10-0:30  展示方法: ChatGPT prompt
...

📝 标题候选 (3 个)
1. ChatGPT 写周报: 90% 的人不知道这个 prompt  [📋 复制]
   类型: 数字/反差
2. ...
3. ...

🖼 封面建议
文字: "周报 3 分钟"
镜头: 手指屏幕显示 GPT 输出
色调: 白底红字
```

**交互:**
- [📋 复制] 单个 hook/title 的 text 复制到剪贴板, 1s success 反馈
- [💾 保存] POST /api/v1/scripts → redirect /content/script/<id>
- [🔄 再生成] 重新 POST generate (LLM 自然随机产生不同输出)

### 6.3 `/content/script/[id]` (RSC saved view)

只读, 同 §6.2 渲染 + 多一个 [🗑 删除] 按钮 (DELETE → redirect /content/script)。

### 6.4 `/content/script` (RSC list)

```
📜 我的脚本                      [✏️ 写新脚本 →]

5 个保存

┌────────────────────────────────────────────────────┐
│ 主题                  | 垂类       | 时间          │
├────────────────────────────────────────────────────┤
│ ChatGPT 写周报        | AI 知识    | 2026-06-17 14:30 │ → 点跳详情
│ AI 工具排行 Top 10    | AI 知识    | 2026-06-15 09:00 │
│ ...                                                │
└────────────────────────────────────────────────────┘
```

### 6.5 Dashboard 入口

`<h1>` 区右侧, 当前 [抖音同步 →] 按钮旁边再加一个:

```tsx
<Link href="/content/script/new">
  <Button size="sm" variant="outline">✏️ 写脚本 →</Button>
</Link>
```

### 6.6 Upload form 顶部

```tsx
<p className="text-xs text-muted-foreground">
  没准备稿子? <Link href="/content/script/new" className="hover:text-primary underline-offset-2 hover:underline">让 AI 帮你写 →</Link>
</p>
```

放在最顶 `<Card>` 之前。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| topic 空 / < 3 字 / > 500 字 | generate API 400 |
| niche 空字符串 | generate API 400 (要求至少一个 niche key) |
| LLM 抛 (timeout / 网络) | 500 + msg, UI 红 banner "生成失败: ...请重试" |
| LLM 输出不通过 zod | 500 + log 完整输出供调试 |
| save POST 时 output schema 不合法 | 400 |
| GET [id] 跨用户 | 404 (不 leak existence) |
| DELETE [id] 跨用户 | 404 |
| 列表空 | "你还没保存过脚本。 [✏️ 写第一个 →]" |

## 8. Testing

### 8.1 `tests/api/scripts/generate.test.ts` (3 case)

- ✓ 正常 topic+niche → 200, data 通过 zod
- ✓ topic 空 → 400
- ✓ LLM 抛错 → 500

### 8.2 `tests/api/scripts/crud.test.ts` (4 case)

- ✓ POST save → 200 + prisma.scriptDraft.create 调用
- ✓ GET list → 数组, scope 到 userId
- ✓ GET [id] 自己的 → 200; 别人的 → 404
- ✓ DELETE 自己的 → 200; 别人的 → 404

### 8.3 不写单测
- UI components (E2E 覆盖)
- Prompt 内容 (黑盒, 不强测具体文案)

### 8.4 手动 E2E

1. 打开 `/content/script/new`, 填 "如何用 ChatGPT 写周报" + niche AI 知识 → 点生成 → 10s 后看到 4 区块结果
2. 复制某 hook → 粘贴到外部应用验证 clipboard work
3. 点保存 → 跳到 /content/script/<id>, 浏览器刷新仍可见
4. 点删除 → 跳回 /content/script, list 少 1 条
5. /content/script 列表显示已保存的
6. Dashboard 顶部 [✏️ 写脚本 →] 可点跳 /content/script/new
7. Upload form 顶部小字 link 可点跳 /content/script/new

## 9. 完成标志

- ✅ ScriptDraft 表 + 反向关系 push 成功
- ✅ generate (3 测) + crud (4 测) 单测 = 7 个新测全过
- ✅ /content/script/* 三页可访问
- ✅ Dashboard + Upload form 入口 link 工作
- ✅ typecheck 0 错, npm test 全绿 (≈ 220)

## 10. 工程量 1.5 天

prompt 调试可能占 0.5 天 (中文 schema 输出经验显示模型偏离 ratio 在 10-15% 区间, 需要 zod retry + 文案 tuning)。
