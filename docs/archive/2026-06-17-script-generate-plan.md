# Script Generate Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 generate mode — topic+niche → DeepSeek 单次结构化输出 4 区块 (hooks/beats/titles/cover) → stateless 返回 + opt-in 保存。

**Architecture:** ScriptDraft 表 (schema add) → SCRIPT_GENERATE prompt + zod → 1 个 stateless generate API + CRUD 4 个 API → ScriptForm/ScriptResult client 组件 + 3 个页面 + 2 个入口 link。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + DeepSeek + vitest

**Spec:** `docs/superpowers/specs/2026-06-17-script-generate-design.md`

**Scope** (不在本计划):
- "用此脚本开分析" prefill (v2)
- 重生成 lock 候选
- 分页 / 标签 / 收藏
- 多语

---

## File Structure

```
新建:
src/lib/llm/prompts/script-generate.ts                 # prompt + zod schema
src/app/api/v1/scripts/generate/route.ts               # POST stateless
src/app/api/v1/scripts/route.ts                        # POST save / GET list
src/app/api/v1/scripts/[id]/route.ts                   # GET / DELETE
src/components/content/script-form.tsx                 # client topic+niche form
src/components/content/script-result.tsx               # client 渲染 4 区 + 复制/保存/再生成
src/app/content/script/new/page.tsx                    # RSC wrapper
src/app/content/script/[id]/page.tsx                   # RSC saved view
src/app/content/script/page.tsx                        # RSC list
tests/api/scripts/generate.test.ts                     # 3 测
tests/api/scripts/crud.test.ts                         # 4 测

修改:
prisma/schema.prisma                                   # ScriptDraft model + User 反向关系
src/app/dashboard/page.tsx                             # h1 区加 写脚本 link
src/components/content/upload-form.tsx                 # 顶部 link
```

---

## Test Strategy

- **`generate.test.ts`** 3 case (mock LLM): 正常 / topic 空 / LLM 抛错
- **`crud.test.ts`** 4 case (mock prisma): POST save / GET list / GET[id] 跨用户 / DELETE
- **UI / Prompt** 不写单测 (E2E)

测试框架: vitest

---

## Git

每 task 末尾 commit。 前缀: `feat(script-generate): ...` / `chore(script-generate): ...`。

---

## Task 1: ScriptDraft schema + push

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1.1: 加 model + 反向关系**

打开 `prisma/schema.prisma`。 在 `model User { ... }` 的 relations 块 (现有 `contentAnalyses ContentAnalysis[]` 那行) 之后 追加一行:

```prisma
  scriptDrafts    ScriptDraft[]
```

在文件末尾追加 model:

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

- [ ] **Step 1.2: Push schema**

```bash
npx prisma db push
```

Expected: "Your database is now in sync with your Prisma schema." + Prisma Client regenerated.

- [ ] **Step 1.3: 验证 column**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "ScriptDraft"' | head -15
```

Expected: 表存在, 字段 id/userId/topic/niche/output/createdAt 都在。

- [ ] **Step 1.4: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 1.5: Commit**

```bash
git add prisma/schema.prisma
git commit -m "chore(script-generate): add ScriptDraft model"
```

---

## Task 2: Prompt + POST /generate (TDD)

**Files:**
- Create: `src/lib/llm/prompts/script-generate.ts`
- Create: `src/app/api/v1/scripts/generate/route.ts`
- Create: `tests/api/scripts/generate.test.ts`

- [ ] **Step 2.1: prompt + zod schema**

Write `src/lib/llm/prompts/script-generate.ts`:

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

- [ ] **Step 2.2: 写测试 (FAIL)**

Write `tests/api/scripts/generate.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

import { POST } from '@/app/api/v1/scripts/generate/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/scripts/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validResponse = {
  hooks: [
    { text: '钩子一', rationale: '痛点反差' },
    { text: '钩子二', rationale: '数字承诺' },
    { text: '钩子三', rationale: '悬念展开' },
  ],
  retentionBeats: [
    { startSec: 0, endSec: 3, beat: '钩子开场' },
    { startSec: 3, endSec: 15, beat: '展示问题' },
    { startSec: 15, endSec: 50, beat: '解决方案' },
    { startSec: 50, endSec: 60, beat: 'CTA' },
  ],
  titles: [
    { text: '标题候选一', hookType: '数字' },
    { text: '标题候选二', hookType: '反差' },
    { text: '标题候选三', hookType: '问题' },
  ],
  cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写', colorTone: '白底红字' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  llmMock.callStructured.mockResolvedValue({
    result: validResponse,
    usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
  });
});

describe('POST /api/v1/scripts/generate', () => {
  it('正常 topic+niche → 200, data 通过 zod', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.hooks).toHaveLength(3);
    expect(json.data.titles).toHaveLength(3);
    expect(json.data.cover).toBeDefined();
  });

  it('topic 空 → 400', async () => {
    const res = await POST(makeReq({ topic: '', niche: 'ai-knowledge' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/LLM down|生成失败/);
  });
});
```

- [ ] **Step 2.3: 跑测试 (FAIL)**

```bash
npm test -- scripts/generate
```

Expected: FAIL (module not found).

- [ ] **Step 2.4: 实现 POST**

Write `src/app/api/v1/scripts/generate/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { SCRIPT_GENERATE } from '@/lib/llm/prompts/script-generate';

export async function POST(req: Request) {
  let body: { topic?: unknown; niche?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';

  if (topic.length < 3 || topic.length > 500) {
    return fail('topic 必须是 3-500 字符', 400);
  }
  if (!niche) {
    return fail('niche 不能为空', 400);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return fail('DEEPSEEK_API_KEY 未配置', 500);
  }

  const llm = new DeepSeekTextLLM({ apiKey });
  try {
    const out = await llm.callStructured({
      systemPrompt: SCRIPT_GENERATE.buildSystemPrompt(niche),
      userMessage: SCRIPT_GENERATE.buildUserMessage({ topic }),
      responseSchema: SCRIPT_GENERATE.responseSchema,
    });
    return ok(out.result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/generate]', e);
    return fail(`生成失败: ${msg}`, 500);
  }
}
```

- [ ] **Step 2.5: 跑测试 (PASS)**

```bash
npm test -- scripts/generate
```

Expected: PASS (3 tests).

- [ ] **Step 2.6: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/llm/prompts/script-generate.ts src/app/api/v1/scripts/generate/route.ts tests/api/scripts/generate.test.ts
git commit -m "feat(script-generate): prompt + POST /generate stateless"
```

---

## Task 3: CRUD routes (TDD)

**Files:**
- Create: `src/app/api/v1/scripts/route.ts` (POST save / GET list)
- Create: `src/app/api/v1/scripts/[id]/route.ts` (GET / DELETE)
- Create: `tests/api/scripts/crud.test.ts`

- [ ] **Step 3.1: 写测试 (FAIL)**

Write `tests/api/scripts/crud.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST as savePOST, GET as listGET } from '@/app/api/v1/scripts/route';
import { GET as itemGET, DELETE as itemDELETE } from '@/app/api/v1/scripts/[id]/route';

const validOutput = {
  hooks: [
    { text: '一', rationale: '理一二' },
    { text: '二', rationale: '理二三' },
    { text: '三', rationale: '理三四' },
  ],
  retentionBeats: [
    { startSec: 0, endSec: 3, beat: '钩子' },
    { startSec: 3, endSec: 60, beat: '内容' },
    { startSec: 60, endSec: 65, beat: 'CTA' },
  ],
  titles: [
    { text: '标题一', hookType: '数字' },
    { text: '标题二', hookType: '反差' },
    { text: '标题三', hookType: '问题' },
  ],
  cover: { textOverlay: '3 分钟', shotIdea: '镜头', colorTone: '白底' },
};

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.create.mockResolvedValue({ id: 'draft1' });
  prismaMock.scriptDraft.findMany.mockResolvedValue([]);
  prismaMock.scriptDraft.findUnique.mockResolvedValue(null);
  prismaMock.scriptDraft.delete.mockResolvedValue({});
});

describe('Scripts CRUD', () => {
  it('POST save → 200 + prisma.create', async () => {
    const res = await savePOST(
      reqJSON('http://t/api/v1/scripts', 'POST', { topic: '主题一', niche: 'ai-knowledge', output: validOutput }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('draft1');
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          topic: '主题一',
          niche: 'ai-knowledge',
        }),
      }),
    );
  });

  it('GET list → 数组, scope userId', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      { id: 'a', topic: 't1', niche: 'ai-knowledge', createdAt: new Date() },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
      }),
    );
  });

  it('GET [id] 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'user1',
      topic: 't',
      niche: 'ai-knowledge',
      output: validOutput,
      createdAt: new Date(),
    });
    const res1 = await itemGET(new Request('http://t'), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res1.status).toBe(200);

    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'other-user',
      topic: 't',
      niche: 'ai-knowledge',
      output: validOutput,
      createdAt: new Date(),
    });
    const res2 = await itemGET(new Request('http://t'), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res2.status).toBe(404);
  });

  it('DELETE 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'user1',
    });
    const res1 = await itemDELETE(new Request('http://t', { method: 'DELETE' }), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res1.status).toBe(200);
    expect(prismaMock.scriptDraft.delete).toHaveBeenCalledWith({ where: { id: 'draft1' } });

    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'other' });
    const res2 = await itemDELETE(new Request('http://t', { method: 'DELETE' }), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res2.status).toBe(404);
  });
});
```

- [ ] **Step 3.2: 跑测试 (FAIL)**

```bash
npm test -- scripts/crud
```

Expected: FAIL.

- [ ] **Step 3.3: 实现 POST/GET (route.ts)**

Write `src/app/api/v1/scripts/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { ScriptGenerateResponseSchema } from '@/lib/llm/prompts/script-generate';

export async function POST(req: Request) {
  let body: { topic?: unknown; niche?: unknown; output?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  const niche = typeof body.niche === 'string' ? body.niche.trim() : '';
  if (!topic || !niche) return fail('topic 和 niche 必填', 400);

  const parsed = ScriptGenerateResponseSchema.safeParse(body.output);
  if (!parsed.success) return fail(`output schema 不合法: ${parsed.error.message}`, 400);

  const user = await getOrCreateDefaultUser();
  try {
    const draft = await prisma.scriptDraft.create({
      data: { userId: user.id, topic, niche, output: parsed.data as any },
      select: { id: true },
    });
    return ok({ id: draft.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, topic: true, niche: true, createdAt: true },
  });
  return ok({
    items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
  });
}
```

- [ ] **Step 3.4: 实现 [id]/route.ts (GET + DELETE)**

Write `src/app/api/v1/scripts/[id]/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  return ok({
    id: draft.id,
    topic: draft.topic,
    niche: draft.niche,
    output: draft.output,
    createdAt: draft.createdAt.toISOString(),
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { userId: true } });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  try {
    await prisma.scriptDraft.delete({ where: { id } });
    return ok({ deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`删除失败: ${msg}`, 500);
  }
}
```

- [ ] **Step 3.5: 跑测试 (PASS)**

```bash
npm test -- scripts/crud
```

Expected: PASS (4 tests).

- [ ] **Step 3.6: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 3.7: Commit**

```bash
git add src/app/api/v1/scripts/route.ts src/app/api/v1/scripts/[id]/route.ts tests/api/scripts/crud.test.ts
git commit -m "feat(script-generate): POST save + GET list + GET[id] + DELETE CRUD"
```

---

## Task 4: ScriptForm + ScriptResult client components

**Files:**
- Create: `src/components/content/script-form.tsx`
- Create: `src/components/content/script-result.tsx`

- [ ] **Step 4.1: ScriptForm**

Write `src/components/content/script-form.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { KNOWN_NICHES } from '@/lib/llm/prompts/expert-persona';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate';
import { ScriptResult } from './script-result';

export function ScriptForm() {
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<string>('ai-knowledge');
  const [customNiche, setCustomNiche] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScriptGenerateResponse | null>(null);

  const effectiveNiche = niche === '__custom' ? customNiche.trim() : niche;

  const handleGenerate = async () => {
    setError(null);
    if (topic.trim().length < 3) {
      setError('topic 至少 3 字');
      return;
    }
    if (!effectiveNiche) {
      setError('请选 niche');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/scripts/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic: topic.trim(), niche: effectiveNiche }),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.message);
      } else {
        setResult(json.data as ScriptGenerateResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="topic">主题</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例: 如何用 ChatGPT 写周报"
              disabled={loading}
            />
          </div>
          <div className="space-y-1">
            <Label>垂类</Label>
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="w-full rounded-md border border-border bg-background p-2 text-sm"
              disabled={loading}
            >
              {KNOWN_NICHES.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
              <option value="__custom">其他 (自填)</option>
            </select>
            {niche === '__custom' && (
              <Input
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                placeholder="e.g. 健身, 二次元"
                disabled={loading}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <Button onClick={handleGenerate} disabled={loading || topic.trim().length < 3} size="lg">
        {loading ? '生成中... (~10s)' : '生成脚本 →'}
      </Button>

      {result && (
        <ScriptResult
          result={result}
          topic={topic.trim()}
          niche={effectiveNiche}
          onRegenerate={handleGenerate}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4.2: ScriptResult**

Write `src/components/content/script-result.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate';

interface Props {
  result: ScriptGenerateResponse;
  topic: string;
  niche: string;
  onRegenerate?: () => void;
  readonly?: boolean;
  draftId?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1000);
      }}
      className="text-xs text-muted-foreground hover:text-primary"
    >
      {copied ? '✓ 已复制' : '📋 复制'}
    </button>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export function ScriptResult({ result, topic, niche, onRegenerate, readonly, draftId }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/v1/scripts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, niche, output: result }),
      });
      const json = await res.json();
      if (!json.success) {
        setSaveError(json.message);
      } else {
        router.push(`/content/script/${json.data.id}`);
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draftId) return;
    if (!confirm('确认删除该脚本?')) return;
    await fetch(`/api/v1/scripts/${draftId}`, { method: 'DELETE' });
    router.push('/content/script');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">✏️ 脚本: {topic}</h2>
        <div className="flex gap-2">
          {!readonly && (
            <>
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? '保存中...' : '💾 保存'}
              </Button>
              {onRegenerate && (
                <Button onClick={onRegenerate} variant="outline" size="sm">
                  🔄 再生成
                </Button>
              )}
            </>
          )}
          {readonly && draftId && (
            <Button onClick={handleDelete} variant="outline" size="sm">
              🗑 删除
            </Button>
          )}
        </div>
      </div>

      {saveError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">🪝 钩子 (0:00-0:03)</h3>
          <ol className="space-y-3 text-sm">
            {result.hooks.map((h, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{i + 1}. &ldquo;{h.text}&rdquo;</p>
                    <p className="mt-1 text-xs text-muted-foreground">理由: {h.rationale}</p>
                  </div>
                  <CopyButton text={h.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">⏱ 完播节奏</h3>
          <table className="w-full text-sm">
            <tbody>
              {result.retentionBeats.map((b, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 font-mono text-xs text-muted-foreground">
                    {pad(Math.floor(b.startSec / 60))}:{pad(b.startSec % 60)}-{pad(Math.floor(b.endSec / 60))}:{pad(b.endSec % 60)}
                  </td>
                  <td className="py-2">{b.beat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="font-semibold">📝 标题候选</h3>
          <ol className="space-y-3 text-sm">
            {result.titles.map((t, i) => (
              <li key={i} className="border-b pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <p className="font-medium">{i + 1}. {t.text}</p>
                    <p className="mt-1 text-xs text-muted-foreground">类型: {t.hookType}</p>
                  </div>
                  <CopyButton text={t.text} />
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <h3 className="font-semibold">🖼 封面建议</h3>
          <p className="text-sm">
            <span className="text-muted-foreground">文字: </span>
            <b>{result.cover.textOverlay}</b>
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">镜头: </span>
            {result.cover.shotIdea}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">色调: </span>
            {result.cover.colorTone}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4.3: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/components/content/script-form.tsx src/components/content/script-result.tsx
git commit -m "feat(script-generate): ScriptForm + ScriptResult client components"
```

---

## Task 5: 3 个页面

**Files:**
- Create: `src/app/content/script/new/page.tsx`
- Create: `src/app/content/script/[id]/page.tsx`
- Create: `src/app/content/script/page.tsx`

- [ ] **Step 5.1: /new (form wrapper)**

Write `src/app/content/script/new/page.tsx`:

```typescript
import { ScriptForm } from '@/components/content/script-form';

export default function NewScriptPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">✏️ AI 脚本生成</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          给定 topic + niche, 一次生成 4 区块: 钩子 / 完播节奏 / 标题 / 封面建议。
        </p>
      </div>
      <ScriptForm />
    </div>
  );
}
```

- [ ] **Step 5.2: /[id] (saved view)**

Write `src/app/content/script/[id]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { ScriptResult } from '@/components/content/script-result';
import type { ScriptGenerateResponse } from '@/lib/llm/prompts/script-generate';

export default async function ScriptDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id } });
  if (!draft || draft.userId !== user.id) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ScriptResult
        result={draft.output as unknown as ScriptGenerateResponse}
        topic={draft.topic}
        niche={draft.niche}
        readonly
        draftId={draft.id}
      />
    </div>
  );
}
```

- [ ] **Step 5.3: /script (list)**

Write `src/app/content/script/page.tsx`:

```typescript
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const NICHE_LABEL_MAP: Record<string, string> = {
  'ai-knowledge': 'AI 知识',
  'knowledge': '知识',
  'entertainment': '娱乐 / 体育 / 影视',
  'lifestyle': '生活',
  'food': '美食',
  'generic': '通用',
};

export default async function ScriptListPage() {
  const user = await getOrCreateDefaultUser();
  const items = await prisma.scriptDraft.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, topic: true, niche: true, createdAt: true },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">📜 我的脚本</h1>
        <Link href="/content/script/new">
          <Button size="sm">✏️ 写新脚本 →</Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-sm text-muted-foreground">你还没保存过脚本。</p>
            <Link href="/content/script/new">
              <Button size="sm" variant="outline">写第一个 →</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">主题</th>
                  <th className="py-2 text-left">垂类</th>
                  <th className="py-2 text-right">时间</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b">
                    <td className="py-2">
                      <Link href={`/content/script/${it.id}`} className="hover:text-primary">
                        {it.topic}
                      </Link>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {NICHE_LABEL_MAP[it.niche] ?? it.niche}
                    </td>
                    <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                      {new Date(it.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 5.4: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5.5: Commit**

```bash
git add src/app/content/script/new/page.tsx src/app/content/script/[id]/page.tsx src/app/content/script/page.tsx
git commit -m "feat(script-generate): 3 pages — /new form + /[id] saved view + / list"
```

---

## Task 6: 入口 links

**Files:**
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/content/upload-form.tsx`

- [ ] **Step 6.1: Dashboard h1 区**

打开 `src/app/dashboard/page.tsx`. 找到 `<Link href="/content/retro-sync">` 那个 Link, 在 **它之前** 加一个:

```tsx
<Link href="/content/script/new">
  <Button size="sm" variant="outline">✏️ 写脚本 →</Button>
</Link>
```

整段应该长这样:

```tsx
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">数据总览</h1>
        <div className="flex gap-2">
          <Link href="/content/script/new">
            <Button size="sm" variant="outline">✏️ 写脚本 →</Button>
          </Link>
          <Link href="/content/retro-sync">
            <Button size="sm" variant="outline">抖音同步 →</Button>
          </Link>
        </div>
      </div>
```

- [ ] **Step 6.2: Upload form 顶部**

打开 `src/components/content/upload-form.tsx`. 找到组件返回 JSX 的最外层 `<div className="space-y-4">`。 在第一个 `<Card>` 之前 加一行:

```tsx
      <p className="text-xs text-muted-foreground">
        没准备稿子? <Link href="/content/script/new" className="hover:text-primary underline-offset-2 hover:underline">让 AI 帮你写 →</Link>
      </p>
```

需要 `import Link from 'next/link';` 加到文件顶部 (与现有 imports 邻近):

```typescript
import Link from 'next/link';
```

- [ ] **Step 6.3: typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: 0 errors, all tests pass (213 + 3 + 4 = 220).

- [ ] **Step 6.4: Commit**

```bash
git add src/app/dashboard/page.tsx src/components/content/upload-form.tsx
git commit -m "feat(script-generate): dashboard + upload-form entry links"
```

---

## Task 7: 手动 E2E

**No code changes.**

### Step 7.1 — 重启 dev (Prisma client 刷新)

ScriptDraft 是新表, dev server 需要重新加载。

```bash
# kill dev PID + restart
```

### Step 7.2 — 生成 happy path

1. 打开 `http://localhost:3000/content/script/new`
2. 主题填: "如何用 ChatGPT 写周报"
3. 垂类: "AI 知识"
4. 点 "生成脚本 →"
5. 等 ~10s, 4 区块结果出现

预期看到:
- 3 个 hooks (含 text + rationale)
- 完播节奏 3-10 段, 按秒分
- 3 个标题候选 (含 hookType)
- 1 个 cover (textOverlay + shotIdea + colorTone)

### Step 7.3 — 复制 + 再生成

1. 点某个 hook 的 [📋 复制] → 应看到 "✓ 已复制" 1s
2. 切到外部应用 paste → 验证文本到位
3. 点 [🔄 再生成] → 应该重新发起请求, 等 ~10s, 输出不同 (LLM 随机性)

### Step 7.4 — 保存 + 跳详情

1. 点 [💾 保存]
2. 应跳到 `/content/script/<id>`
3. 看到只读视图 + [🗑 删除] 按钮
4. 浏览器刷新, 数据仍在

### Step 7.5 — 列表

1. 打开 `http://localhost:3000/content/script`
2. 看到刚保存的脚本, 1 行
3. 点行跳详情, 仍可访问

### Step 7.6 — 删除

1. 详情页点 [🗑 删除], 弹 confirm
2. 跳回 `/content/script`, 列表 0 条 (或减少)

### Step 7.7 — 入口

1. `/dashboard` 顶部 h1 右侧应看到 [✏️ 写脚本 →] 按钮 (与 [抖音同步 →] 并列)
2. `/content/preflight/new` 上方应看到小字 link "没准备稿子? 让 AI 帮你写 →"
3. 点击都能跳 `/content/script/new`

### Step 7.8 — 错误路径

1. /new 表单 topic 留空, 点生成 → 红 banner "topic 至少 3 字"
2. DeepSeek API 故意 set 错 key (临时改 .env), 重启 worker (dev 用), 试生成 → 红 banner "生成失败: ..."

### Step 7.9 — 跑全测试

```bash
npm run typecheck && npm test
```

Expected: 0 errors, 220 tests pass.

### Step 7.10 — Commit (如需要)

```bash
git status
# 如有清理 / 微调
git add -A && git commit -m "chore(script-generate): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1-6 commit 完整
- ✅ Task 7 E2E happy path 通过
- ✅ `npm run typecheck` 0 错, `npm test` 全绿 (≈ 220 测)
- ✅ /content/script/* 三页 + dashboard + upload 入口 link 工作

→ Sub-project E 完成。 拍摄那一半 ship。

---

## 自审记录

**Spec 覆盖**:
- §1 goal/scope → Task 1-6 全覆盖
- §2 architecture → Task 2 (LLM) + Task 3 (CRUD) + Task 4 (components) + Task 5 (pages)
- §3 data model → Task 1
- §4 prompt + schema → Task 2
- §5 API → Task 2 (generate) + Task 3 (CRUD)
- §6 UI → Task 4 + Task 5
- §7 错误处理 → Task 2/3 implement
- §8 testing → Task 2/3 (单测) + Task 7 (E2E)

**Placeholder scan**: 无 TBD/TODO。

**Type consistency**:
- `ScriptGenerateResponse` Task 2 export, Task 3 (zod re-validate) + Task 4 (UI) + Task 5 (page) 一致。
- `SCRIPT_GENERATE` prompt object Task 2, Task 2 API 调用一致。
- ScriptDraft model field names: id/userId/topic/niche/output/createdAt — Task 1 schema, Task 3 API, Task 5 page 一致。
