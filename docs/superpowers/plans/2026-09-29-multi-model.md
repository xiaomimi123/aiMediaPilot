# 多模型接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置页可添加任意模型（OpenAI 兼容 / Claude 原生），全局选一个当前使用；编导、写稿、拆解、复盘、找选题、发布文案、转写校对、每晚任务、`mp` 全部改用当前模型；「测试」判定能否当编导。

**Architecture:** `src/lib/llm/` 下新增：配置存取与迁移（`providers.ts`）、两种适配（`openai-compatible.ts`、`anthropic.ts`）、统一入口（`provider.ts` 的 `getActiveModel`）、报错翻译（`errors.ts`）、能力测试（`model-test.ts`）。对话循环 `runAgentTurn` 与工具不改，只换注入的 `ChatModel` / `StructuredLLM`。

**Tech Stack:** Prisma 5、`openai` v4（已有）、`@anthropic-ai/sdk`（新增）、zod、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-09-29-multi-model-design.md`

## Global Constraints

- 同一时间只有一条 `isActive`；删除当前模型后不自动换，变为"没有可用的模型"。
- key：界面只显示末 4 位（`…abcd`）；任何接口不回传完整 key；编辑时 key 留空表示不改。
- 迁移：表为空且 `.env` 有 `DEEPSEEK_API_KEY` → 建 `DeepSeek / openai / https://api.deepseek.com/v1 / deepseek-chat` 并设为当前；只做一次（表非空就不做）。
- 没有当前模型的统一文案：`还没有可用的模型：去设置页添加一个。`；`mp` 错误码 `no_model`。
- 测试判定：三项全过 → `able_agent`（能当编导）；工具不过但连通与结构化过 → `analysis_only`（只能做分析）；其余 → `unusable`（不可用）。
- OpenAI 兼容：没有工具时不传 `tools`；结构化输出用 JSON 模式 + zod 校验（`jsonModeFallback: true`）。
- Claude：`system` 单独传；工具结果作为 user 消息里的 `tool_result` 块；同角色相邻消息合并；首条非 system 消息必须是 user。
- 报错文案 = 模型名 + 中文原因 + 怎么办；不出现英文堆栈。
- 预设接口地址实施时逐个对照厂商文档核对，核对不了的在界面标"以厂商文档为准"。

## Review Focus

1. **对话历史以 assistant 开头**（`loadHistory` 取最近 20 条可能从 assistant 截断）：Claude 拒绝首条非 user → 必须补一条 user。→ Task 3 测试 `starts with a user message`。
2. **一轮里多个工具结果**：Claude 要求它们在同一条 user 消息里。→ Task 3 测试 `merges consecutive tool results`。
3. **模型返回的工具参数不是合法 JSON / 流里分块到达**：拼接后再解析；解析不了交给循环原有的"参数不对"处理。→ Task 3 测试 `accumulates streamed tool input`。
4. **编辑模型时 key 留空**：不能把已存的 key 清掉。→ Task 1 测试 `keeps the stored key when the edit leaves it blank`。
5. **本地 Ollama 不需要 key**：key 为空也要能建客户端（openai 库要求非空 key → 传占位）。→ Task 2 测试 `works without a key (ollama)`。

---

## 文件结构

```
prisma/schema.prisma                       + ModelProvider
src/lib/llm/providers.ts                   预设、配置存取、掩码、迁移
src/lib/llm/openai-compatible.ts           OpenAI 兼容对话 + 结构化
src/lib/llm/anthropic.ts                   Claude 消息转换 + 对话 + 结构化
src/lib/llm/provider.ts                    buildModel / getActiveModel / NO_MODEL_MESSAGE
src/lib/llm/errors.ts                      报错翻译
src/lib/llm/model-test.ts                  三项能力测试
src/lib/agent/chat-model.ts                ChatModel 加可选 label; createDeepSeekChatModel 移除
src/lib/agent/loop.ts                      连不上时的报错改用 errors.ts
调用点(12 处)                              改为 getActiveModel
src/lib/health/checks.ts                   "DeepSeek key" 项 → "当前模型"
src/app/api/settings/models/**             模型配置接口
src/components/settings/models-card.tsx    「模型」卡片(替换 deepseek-key.tsx)
删除: src/app/api/settings/deepseek, src/components/settings/deepseek-key.tsx, src/lib/settings/deepseek.ts 及其测试
```

---

### Task 1: 数据表、预设、配置存取与迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/llm/providers.ts`
- Test: `tests/lib/llm/providers.test.ts`

**Interfaces:**
- Produces：
  - `type ProviderKind = 'openai' | 'anthropic'`
  - `interface ModelConfig { id: string; name: string; kind: ProviderKind; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: ModelTestResult | null }`
  - `interface ModelTestResult { at: string; reachable: boolean; tools: boolean; json: boolean; grade: 'able_agent' | 'analysis_only' | 'unusable'; message: string }`
  - `PRESETS: { key: string; name: string; kind: ProviderKind; baseUrl: string; keyOptional?: boolean; note?: string }[]`
  - `maskKey(k: string): string`（空 → `（无）`；否则 `…` + 末 4 位）
  - `interface ModelView { id; name; kind; baseUrl; model; keyMasked; isActive; lastTest }`；`toModelView(c: ModelConfig): ModelView`
  - `ModelInputSchema`（zod：name 1–30 字、kind、baseUrl 为 http(s) URL、model 非空、apiKey 可选）
  - `listModels(db)`、`createModel(db, input)`、`updateModel(db, id, input)`（apiKey 为空/缺失不改）、`deleteModel(db, id)`、`activateModel(db, id)`（其余置 false）、`saveTestResult(db, id, r)`、`getActiveConfig(db): Promise<ModelConfig | null>`
  - `ensureMigrated(db, env: { DEEPSEEK_API_KEY?: string }): Promise<boolean>`（建了返回 true）

- [ ] **Step 1: schema**

`prisma/schema.prisma` 末尾追加：

```prisma
/// 大模型配置(多条, 同时只有一条 isActive)
model ModelProvider {
  id        String   @id @default(cuid())
  name      String
  /// openai | anthropic
  kind      String
  baseUrl   String
  apiKey    String   @default("")
  model     String
  isActive  Boolean  @default(false)
  /// ModelTestResult
  lastTest  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Run: `npx prisma db push && npm run typecheck`
Expected: in sync；0 错误。

- [ ] **Step 2: 写失败测试 `tests/lib/llm/providers.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ensureMigrated, maskKey, toModelView, updateModel, activateModel, ModelInputSchema, PRESETS } from '@/lib/llm/providers';

type Row = { id: string; name: string; kind: string; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: unknown };

function fakeDb(rows: Row[] = []) {
  let seq = 0;
  const db = {
    modelProvider: {
      count: async () => rows.length,
      findMany: async () => rows.map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      findFirst: async ({ where }: { where: { isActive: boolean } }) => rows.find((r) => r.isActive === where.isActive) ?? null,
      create: async ({ data }: { data: Omit<Row, 'id'> }) => {
        const r = { id: `m${++seq}`, lastTest: null, isActive: false, apiKey: '', ...data } as Row;
        rows.push(r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      updateMany: async ({ data }: { data: Partial<Row> }) => {
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaClient;
  return { db, rows };
}

const row = (o: Partial<Row>): Row => ({ id: 'a', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-1234567890abcd', model: 'deepseek-chat', isActive: false, lastTest: null, ...o });

describe('providers', () => {
  it('migrates the .env DeepSeek key once', async () => {
    const { db, rows } = fakeDb();
    expect(await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })).toBe(true);
    expect(rows[0]).toMatchObject({ name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-abc', isActive: true });
    expect(await ensureMigrated(db, { DEEPSEEK_API_KEY: 'sk-abc' })).toBe(false);
    expect(rows).toHaveLength(1);
  });
  it('does nothing without a .env key', async () => {
    const { db, rows } = fakeDb();
    expect(await ensureMigrated(db, {})).toBe(false);
    expect(rows).toHaveLength(0);
  });
  it('masks keys and never exposes them in views', () => {
    expect(maskKey('sk-1234567890abcd')).toBe('…abcd');
    expect(maskKey('')).toBe('（无）');
    const v = toModelView(row({}) as never);
    expect(JSON.stringify(v)).not.toContain('sk-1234567890abcd');
    expect(v.keyMasked).toBe('…abcd');
  });
  it('keeps the stored key when the edit leaves it blank', async () => {
    const { db, rows } = fakeDb([row({})]);
    await updateModel(db, 'a', { name: 'DS', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' });
    expect(rows[0]).toMatchObject({ name: 'DS', apiKey: 'sk-1234567890abcd' });
  });
  it('activates exactly one model', async () => {
    const { db, rows } = fakeDb([row({ id: 'a', isActive: true }), row({ id: 'b' })]);
    await activateModel(db, 'b');
    expect(rows.map((r) => r.isActive)).toEqual([false, true]);
  });
  it('validates input', () => {
    expect(ModelInputSchema.safeParse({ name: 'x', kind: 'openai', baseUrl: 'not a url', model: 'm' }).success).toBe(false);
    expect(ModelInputSchema.safeParse({ name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5' }).success).toBe(true);
  });
  it('has presets for every provider in the spec', () => {
    expect(PRESETS.map((p) => p.key)).toEqual(['deepseek', 'qwen', 'kimi', 'glm', 'doubao', 'openrouter', 'ollama', 'claude', 'custom']);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/llm/providers.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现 `src/lib/llm/providers.ts`**

```ts
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';

export type ProviderKind = 'openai' | 'anthropic';

export interface ModelTestResult {
  at: string;
  reachable: boolean;
  tools: boolean;
  json: boolean;
  grade: 'able_agent' | 'analysis_only' | 'unusable';
  message: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  model: string;
  isActive: boolean;
  lastTest: ModelTestResult | null;
}

/** 只预填接口地址与类型; 模型名由用户填(各家更新快, 不写死) */
export const PRESETS: { key: string; name: string; kind: ProviderKind; baseUrl: string; keyOptional?: boolean; note?: string }[] = [
  { key: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1' },
  { key: 'qwen', name: '通义千问', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { key: 'kimi', name: 'Kimi', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1' },
  { key: 'glm', name: '智谱 GLM', kind: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { key: 'doubao', name: '豆包（火山方舟）', kind: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', note: '模型名填方舟里的接入点 ID 或模型 ID' },
  { key: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  { key: 'ollama', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', keyOptional: true, note: '先在本机运行 Ollama 并拉取模型' },
  { key: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { key: 'custom', name: '自定义 / 中转站', kind: 'openai', baseUrl: '', note: '中转站若把 Claude 包装成 OpenAI 格式, 选 OpenAI 兼容即可' },
];

export const ModelInputSchema = z.object({
  name: z.string().trim().min(1, '起个名字').max(30, '名字太长了'),
  kind: z.enum(['openai', 'anthropic']),
  baseUrl: z.string().trim().url('接口地址要以 http:// 或 https:// 开头'),
  model: z.string().trim().min(1, '填模型名'),
  apiKey: z.string().trim().optional(),
});
export type ModelInput = z.infer<typeof ModelInputSchema>;

export function maskKey(k: string): string {
  return k ? `…${k.slice(-4)}` : '（无）';
}

export interface ModelView {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  keyMasked: string;
  isActive: boolean;
  lastTest: ModelTestResult | null;
}

export function toModelView(c: ModelConfig): ModelView {
  return { id: c.id, name: c.name, kind: c.kind, baseUrl: c.baseUrl, model: c.model, keyMasked: maskKey(c.apiKey), isActive: c.isActive, lastTest: c.lastTest };
}

type Row = { id: string; name: string; kind: string; baseUrl: string; apiKey: string; model: string; isActive: boolean; lastTest: unknown };
const toConfig = (r: Row): ModelConfig => ({ ...r, kind: r.kind === 'anthropic' ? 'anthropic' : 'openai', lastTest: (r.lastTest as ModelTestResult | null) ?? null });

export async function listModels(db: PrismaClient): Promise<ModelConfig[]> {
  return (await db.modelProvider.findMany({ orderBy: { createdAt: 'asc' } })).map(toConfig);
}

export async function getActiveConfig(db: PrismaClient): Promise<ModelConfig | null> {
  const r = await db.modelProvider.findFirst({ where: { isActive: true } });
  return r ? toConfig(r) : null;
}

export async function createModel(db: PrismaClient, input: ModelInput): Promise<ModelConfig> {
  const r = await db.modelProvider.create({ data: { name: input.name, kind: input.kind, baseUrl: input.baseUrl, model: input.model, apiKey: input.apiKey ?? '' } });
  return toConfig(r);
}

export async function updateModel(db: PrismaClient, id: string, input: ModelInput): Promise<ModelConfig> {
  const r = await db.modelProvider.update({
    where: { id },
    // key 留空 = 不改; 改了地址/模型要重新测试
    data: { name: input.name, kind: input.kind, baseUrl: input.baseUrl, model: input.model, ...(input.apiKey ? { apiKey: input.apiKey } : {}), lastTest: undefined },
  });
  return toConfig(r);
}

export async function deleteModel(db: PrismaClient, id: string): Promise<void> {
  await db.modelProvider.delete({ where: { id } });
}

export async function activateModel(db: PrismaClient, id: string): Promise<void> {
  await db.$transaction([db.modelProvider.updateMany({ data: { isActive: false } }), db.modelProvider.update({ where: { id }, data: { isActive: true } })]);
}

export async function saveTestResult(db: PrismaClient, id: string, r: ModelTestResult): Promise<void> {
  await db.modelProvider.update({ where: { id }, data: { lastTest: r as unknown as Prisma.InputJsonValue } });
}

/** 表为空且 .env 有 DeepSeek key → 建一条并设为当前; 只做一次 */
export async function ensureMigrated(db: PrismaClient, env: { DEEPSEEK_API_KEY?: string }): Promise<boolean> {
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key || (await db.modelProvider.count()) > 0) return false;
  await db.modelProvider.create({ data: { name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: key, isActive: true } });
  return true;
}
```

（`updateModel` 里 `lastTest: undefined` 不会清空；需求是"改了要重测"时在界面提示即可——若要清空改为 `lastTest: Prisma.DbNull` 并记 Ruling。）

- [ ] **Step 5: 运行确认通过、提交**

Run: `npx vitest run tests/lib/llm/providers.test.ts && npm run typecheck`
Expected: 全部 PASS；0 错误。

```bash
git add prisma/schema.prisma src/lib/llm/providers.ts tests/lib/llm/providers.test.ts
git commit -m "feat(llm): 模型配置表 + 预设 + 存取/掩码/当前模型 + 从 .env 迁移 DeepSeek

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: OpenAI 兼容适配与统一入口

**Files:**
- Create: `src/lib/llm/openai-compatible.ts`、`src/lib/llm/provider.ts`
- Modify: `src/lib/agent/chat-model.ts`（`ChatModel` 加 `label?: string`；删除 `createDeepSeekChatModel`，其实现移到 `openai-compatible.ts`）
- Test: `tests/lib/llm/provider.test.ts`

**Interfaces:**
- Consumes：`ModelConfig`、`getActiveConfig`、`ensureMigrated`（Task 1）
- Produces：
  - `createOpenAICompatibleChat(c: { baseUrl: string; apiKey: string; model: string; label: string }): ChatModel`
  - `createOpenAICompatibleLLM(c: {…}): StructuredLLM`（`new OpenAIVisionLLM({ apiKey: c.apiKey || 'none', baseURL: c.baseUrl, jsonModeFallback: true, defaultModel: c.model })`）
  - `interface ActiveModel { chat: ChatModel; llm: StructuredLLM; label: string; config: ModelConfig }`
  - `buildModel(c: ModelConfig): ActiveModel`（Task 3 前 anthropic 分支抛 `Error('Claude 适配还没做')`，Task 3 替换）
  - `getActiveModel(db: PrismaClient, env?: { DEEPSEEK_API_KEY?: string }): Promise<ActiveModel | null>`（先 `ensureMigrated`）
  - `NO_MODEL_MESSAGE = '还没有可用的模型：去设置页添加一个。'`

- [ ] **Step 1: 写失败测试 `tests/lib/llm/provider.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildModel, getActiveModel, NO_MODEL_MESSAGE } from '@/lib/llm/provider';
import type { ModelConfig } from '@/lib/llm/providers';

const cfg = (o: Partial<ModelConfig> = {}): ModelConfig => ({ id: 'm1', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-x', model: 'deepseek-chat', isActive: true, lastTest: null, ...o });

describe('provider', () => {
  it('labels the model with name and model id', () => {
    const m = buildModel(cfg());
    expect(m.label).toBe('DeepSeek（deepseek-chat）');
    expect(m.chat.label).toBe('DeepSeek（deepseek-chat）');
    expect(typeof m.llm.callStructured).toBe('function');
  });
  it('works without a key (ollama)', () => {
    expect(() => buildModel(cfg({ name: 'Ollama', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen2.5' }))).not.toThrow();
  });
  it('returns null when there is no active model and nothing to migrate', async () => {
    const db = { modelProvider: { count: async () => 0, findFirst: async () => null } } as unknown as PrismaClient;
    expect(await getActiveModel(db, {})).toBeNull();
    expect(NO_MODEL_MESSAGE).toBe('还没有可用的模型：去设置页添加一个。');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/llm/provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/lib/llm/openai-compatible.ts`：

```ts
import OpenAI from 'openai';
import type { ChatModel, ToolCall } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import { OpenAIVisionLLM } from './vision';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** 本地 Ollama 等不需要 key, 但 openai 库要求非空: 传占位 */
const keyOrPlaceholder = (k: string) => k || 'none';

export function createOpenAICompatibleChat(c: OpenAICompatibleConfig): ChatModel {
  const client = new OpenAI({ apiKey: keyOrPlaceholder(c.apiKey), baseURL: c.baseUrl });
  return {
    label: c.label,
    async streamTurn(messages, tools, onText) {
      const stream = await client.chat.completions.create({
        model: c.model,
        messages,
        stream: true,
        // 空数组会被部分厂商拒绝, 没有工具时不传
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      });
      let text = '';
      const calls: ToolCall[] = [];
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          text += delta.content;
          onText(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const slot = (calls[tc.index] ??= { id: '', name: '', arguments: '' });
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.arguments += tc.function.arguments;
        }
      }
      return { text, toolCalls: calls.filter(Boolean) };
    },
  };
}

export function createOpenAICompatibleLLM(c: OpenAICompatibleConfig): StructuredLLM {
  return new OpenAIVisionLLM({ apiKey: keyOrPlaceholder(c.apiKey), baseURL: c.baseUrl, jsonModeFallback: true, defaultModel: c.model });
}
```

`src/lib/agent/chat-model.ts`：`ChatModel` 接口加 `/** 显示名(报错时带上), 如 "DeepSeek（deepseek-chat）" */ label?: string;`；删除 `createDeepSeekChatModel` 与不再使用的 `OpenAI` 值导入（`AgentMessage` 仍用 `import type OpenAI`）。

`src/lib/llm/provider.ts`：

```ts
import type { PrismaClient } from '@prisma/client';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import { ensureMigrated, getActiveConfig, type ModelConfig } from './providers';
import { createOpenAICompatibleChat, createOpenAICompatibleLLM } from './openai-compatible';

export const NO_MODEL_MESSAGE = '还没有可用的模型：去设置页添加一个。';

export interface ActiveModel {
  chat: ChatModel;
  llm: StructuredLLM;
  label: string;
  config: ModelConfig;
}

export function buildModel(c: ModelConfig): ActiveModel {
  const label = `${c.name}（${c.model}）`;
  const base = { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model, label };
  if (c.kind === 'anthropic') throw new Error('Claude 适配还没做');
  return { chat: createOpenAICompatibleChat(base), llm: createOpenAICompatibleLLM(base), label, config: c };
}

/** 当前模型; 没有返回 null(调用方给 NO_MODEL_MESSAGE)。首次会从 .env 迁移 DeepSeek。 */
export async function getActiveModel(db: PrismaClient, env: { DEEPSEEK_API_KEY?: string } = { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }): Promise<ActiveModel | null> {
  await ensureMigrated(db, env);
  const c = await getActiveConfig(db);
  return c ? buildModel(c) : null;
}
```

（`src/lib/llm/deepseek.ts` 与 `createDeepSeekChatModel` 的调用点在 Task 5 改完；本任务若 typecheck 因删除 `createDeepSeekChatModel` 报调用点错误，先在 `chat-model.ts` 保留一个 `@deprecated` 的 `createDeepSeekChatModel(apiKey)` 转调 `createOpenAICompatibleChat`，Task 5 再删。）

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/llm src/lib/agent/chat-model.ts tests/lib/llm/provider.test.ts
git commit -m "feat(llm): OpenAI 兼容适配(可配地址/key/模型, 无 key 可用) + 统一入口 getActiveModel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Claude 原生适配

**Files:**
- Create: `src/lib/llm/anthropic.ts`
- Modify: `src/lib/llm/provider.ts`（anthropic 分支）、`package.json`（`npm install @anthropic-ai/sdk`）
- Test: `tests/lib/llm/anthropic.test.ts`

**Interfaces:**
- Consumes：`AgentMessage`、`ToolSpec`、`ToolCall`、`ChatModel`、`StructuredLLM`、`CallStructuredOpts`
- Produces：
  - `toAnthropicMessages(messages: AgentMessage[]): { system: string; messages: AnthropicMessage[] }`
  - `type AnthropicStreamFn = (params: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>`；`type AnthropicCreateFn = (params: Record<string, unknown>) => Promise<{ content: Record<string, unknown>[]; usage?: { input_tokens: number; output_tokens: number } }>`
  - `createAnthropicChat(c: { baseUrl; apiKey; model; label }, deps?: { stream?: AnthropicStreamFn }): ChatModel`
  - `createAnthropicLLM(c, deps?: { create?: AnthropicCreateFn }): StructuredLLM`

- [ ] **Step 1: 装依赖**

Run: `npm install @anthropic-ai/sdk && npm ls @anthropic-ai/sdk`
Expected: 装上一个版本号（记入 ledger）。

- [ ] **Step 2: 写失败测试 `tests/lib/llm/anthropic.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { toAnthropicMessages, createAnthropicChat, createAnthropicLLM } from '@/lib/llm/anthropic';
import type { AgentMessage } from '@/lib/agent/chat-model';

const cfg = { baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-x', model: 'claude-x', label: 'Claude（claude-x）' };

describe('toAnthropicMessages', () => {
  it('pulls out the system prompt and converts tool calls and results', () => {
    const msgs: AgentMessage[] = [
      { role: 'system', content: '你是编导' },
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: '好的', tool_calls: [{ id: 't1', type: 'function', function: { name: 'write_script', arguments: '{"direction":"x"}' } }] },
      { role: 'tool', tool_call_id: 't1', content: '{"ok":true}' },
    ];
    const r = toAnthropicMessages(msgs);
    expect(r.system).toBe('你是编导');
    expect(r.messages).toEqual([
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: [{ type: 'text', text: '好的' }, { type: 'tool_use', id: 't1', name: 'write_script', input: { direction: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] },
    ]);
  });
  it('merges consecutive tool results into one user message', () => {
    const r = toAnthropicMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{}' } }, { id: 'b', type: 'function', function: { name: 'g', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'a', content: '1' },
      { role: 'tool', tool_call_id: 'b', content: '2' },
    ]);
    expect(r.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '1' }, { type: 'tool_result', tool_use_id: 'b', content: '2' }] });
  });
  it('starts with a user message', () => {
    const r = toAnthropicMessages([{ role: 'system', content: 's' }, { role: 'assistant', content: '（已执行 write_script：写稿）' }, { role: 'user', content: '再短点' }]);
    expect(r.messages[0].role).toBe('user');
    expect(r.messages.at(-1)).toEqual({ role: 'user', content: '再短点' });
  });
  it('keeps unparseable tool arguments as raw text so the loop can report it', () => {
    const r = toAnthropicMessages([{ role: 'user', content: 'x' }, { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'f', arguments: '{bad' } }] }]);
    expect((r.messages[1].content as { input: unknown }[])[0].input).toEqual({ _raw: '{bad' });
  });
});

describe('createAnthropicChat', () => {
  it('streams text and accumulates streamed tool input', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '写' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好了' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu1', name: 'write_script', input: {} } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"direc' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'tion":"x"}' } },
      { type: 'message_stop' },
    ];
    const stream = vi.fn(async () => (async function* () { yield* events; })());
    const chat = createAnthropicChat(cfg, { stream });
    const deltas: string[] = [];
    const r = await chat.streamTurn([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], [{ name: 'write_script', description: 'd', parameters: { type: 'object', properties: {} } }], (d) => deltas.push(d));
    expect(deltas.join('')).toBe('写好了');
    expect(r).toEqual({ text: '写好了', toolCalls: [{ id: 'tu1', name: 'write_script', arguments: '{"direction":"x"}' }] });
    const params = stream.mock.calls[0][0] as { system: string; tools: unknown[]; model: string };
    expect(params).toMatchObject({ system: 's', model: 'claude-x' });
    expect(params.tools).toEqual([{ name: 'write_script', description: 'd', input_schema: { type: 'object', properties: {} } }]);
  });
  it('omits tools when there are none', async () => {
    const stream = vi.fn(async () => (async function* () {})());
    await createAnthropicChat(cfg, { stream }).streamTurn([{ role: 'user', content: 'u' }], [], () => {});
    expect((stream.mock.calls[0][0] as Record<string, unknown>).tools).toBeUndefined();
  });
});

describe('createAnthropicLLM', () => {
  it('forces a tool call and validates its input with the schema', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { city: '北京', country: '中国' } }], usage: { input_tokens: 10, output_tokens: 5 } }));
    const llm = createAnthropicLLM(cfg, { create });
    const { result } = await llm.callStructured({ systemPrompt: 's', userMessage: [{ type: 'text', text: 'u' }], responseSchema: z.object({ city: z.string(), country: z.string() }) });
    expect(result).toEqual({ city: '北京', country: '中国' });
    expect(create.mock.calls[0][0]).toMatchObject({ tool_choice: { type: 'tool', name: 'respond' }, system: 's' });
  });
  it('retries once then fails when the output does not match', async () => {
    const create = vi.fn(async () => ({ content: [{ type: 'tool_use', id: 'x', name: 'respond', input: { city: 1 } }] }));
    await expect(createAnthropicLLM(cfg, { create }).callStructured({ systemPrompt: 's', userMessage: [{ type: 'text', text: 'u' }], responseSchema: z.object({ city: z.string() }) })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/llm/anthropic.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现 `src/lib/llm/anthropic.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';
import type { AgentMessage, ChatModel, ToolCall } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import type { CallStructuredOpts, TokenUsage } from './vision';

type Block = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown } | { type: 'tool_result'; tool_use_id: string; content: string };
export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Block[];
}

export type AnthropicStreamFn = (params: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
export type AnthropicCreateFn = (params: Record<string, unknown>) => Promise<{ content: Record<string, unknown>[]; usage?: { input_tokens: number; output_tokens: number } }>;

interface Cfg {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

const MAX_TOKENS = 4096;

const asBlocks = (c: string | Block[]): Block[] => (typeof c === 'string' ? (c ? [{ type: 'text', text: c }] : []) : c);

function parseArgs(s: string): unknown {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return { _raw: s };
  }
}

/** OpenAI 格式的对话 → Claude 格式: system 单独; 工具结果放进 user; 同角色相邻合并; 首条必须是 user */
export function toAnthropicMessages(messages: AgentMessage[]): { system: string; messages: AnthropicMessage[] } {
  const system: string[] = [];
  const out: AnthropicMessage[] = [];
  const push = (m: AnthropicMessage) => {
    const last = out.at(-1);
    if (last && last.role === m.role) last.content = [...asBlocks(last.content), ...asBlocks(m.content)];
    else out.push(m);
  };
  for (const m of messages) {
    if (m.role === 'system') {
      system.push(typeof m.content === 'string' ? m.content : '');
    } else if (m.role === 'user') {
      push({ role: 'user', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
    } else if (m.role === 'assistant') {
      const text = typeof m.content === 'string' ? m.content : '';
      const calls = 'tool_calls' in m && m.tool_calls ? m.tool_calls : [];
      if (!calls.length) {
        if (text) push({ role: 'assistant', content: text });
        continue;
      }
      push({
        role: 'assistant',
        content: [...(text ? [{ type: 'text' as const, text }] : []), ...calls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }))],
      });
    } else if (m.role === 'tool') {
      push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
    }
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '（以下是之前的对话）' });
  return { system: system.join('\n\n'), messages: out };
}

function client(c: Cfg) {
  return new Anthropic({ apiKey: c.apiKey || 'none', baseURL: c.baseUrl });
}

export function createAnthropicChat(c: Cfg, deps: { stream?: AnthropicStreamFn } = {}): ChatModel {
  const stream: AnthropicStreamFn =
    deps.stream ?? (async (params) => (await client(c).messages.create({ ...(params as object), stream: true } as never)) as unknown as AsyncIterable<Record<string, unknown>>);
  return {
    label: c.label,
    async streamTurn(messages, tools, onText) {
      const { system, messages: msgs } = toAnthropicMessages(messages);
      const events = await stream({
        model: c.model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        messages: msgs,
        ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
      });
      let text = '';
      const calls = new Map<number, ToolCall>();
      for await (const ev of events) {
        const index = ev.index as number;
        if (ev.type === 'content_block_start') {
          const b = ev.content_block as { type: string; id?: string; name?: string };
          if (b.type === 'tool_use') calls.set(index, { id: b.id ?? '', name: b.name ?? '', arguments: '' });
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta as { type: string; text?: string; partial_json?: string };
          if (d.type === 'text_delta' && d.text) {
            text += d.text;
            onText(d.text);
          } else if (d.type === 'input_json_delta' && d.partial_json !== undefined) {
            const slot = calls.get(index);
            if (slot) slot.arguments += d.partial_json;
          }
        }
      }
      return { text, toolCalls: [...calls.values()].map((t) => ({ ...t, arguments: t.arguments || '{}' })) };
    },
  };
}

export function createAnthropicLLM(c: Cfg, deps: { create?: AnthropicCreateFn } = {}): StructuredLLM {
  const create: AnthropicCreateFn = deps.create ?? (async (params) => (await client(c).messages.create(params as never)) as never);
  return {
    async callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }> {
      const schema = zodToJsonSchema(opts.responseSchema as ZodSchema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<string, unknown>;
      delete schema.$schema;
      const text = opts.userMessage.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
      let lastError: unknown;
      // 结构化输出 = 强制调用一个参数即目标 schema 的工具; 校验不过重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await create({
          model: opts.model ?? c.model,
          max_tokens: opts.maxTokens ?? MAX_TOKENS,
          system: opts.systemPrompt,
          messages: [{ role: 'user', content: text }],
          tools: [{ name: 'respond', description: '按要求的格式交回结果', input_schema: schema }],
          tool_choice: { type: 'tool', name: 'respond' },
        });
        const block = r.content.find((b) => b.type === 'tool_use');
        const parsed = opts.responseSchema.safeParse(block?.input);
        if (parsed.success) {
          return { result: parsed.data, usage: { model: c.model, promptTokens: r.usage?.input_tokens ?? 0, completionTokens: r.usage?.output_tokens ?? 0, estCostUSD: 0 } };
        }
        lastError = parsed.error;
      }
      throw new Error(`${c.label} 没按格式交回结果：${lastError instanceof Error ? lastError.message.slice(0, 200) : String(lastError)}`);
    },
  };
}
```

`src/lib/llm/provider.ts` 的 anthropic 分支改为 `return { chat: createAnthropicChat(base), llm: createAnthropicLLM(base), label, config: c };`（import 两个函数）。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/llm package.json package-lock.json tests/lib/llm/anthropic.test.ts
git commit -m "feat(llm): Claude 原生适配(消息转换/流式文字与工具/强制工具的结构化输出)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 报错翻译与三项能力测试

**Files:**
- Create: `src/lib/llm/errors.ts`、`src/lib/llm/model-test.ts`
- Test: `tests/lib/llm/errors.test.ts`、`tests/lib/llm/model-test.test.ts`

**Interfaces:**
- Produces：
  - `explainModelError(e: unknown, label: string): string`
  - `runModelTest(m: { chat: ChatModel; llm: StructuredLLM; label: string }, now?: Date): Promise<ModelTestResult>`

- [ ] **Step 1: 写失败测试**

`tests/lib/llm/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { explainModelError } from '@/lib/llm/errors';

const L = 'Kimi（moonshot-v1-8k）';
const withStatus = (status: number, message = 'x') => Object.assign(new Error(message), { status });

describe('explainModelError', () => {
  it('maps common failures to Chinese with the model name', () => {
    expect(explainModelError(withStatus(401), L)).toBe('Kimi（moonshot-v1-8k）拒绝了请求：key 无效或没有权限，去设置页检查这个模型的 key。');
    expect(explainModelError(withStatus(402), L)).toContain('余额不足');
    expect(explainModelError(withStatus(429), L)).toContain('请求太频繁或额度用完');
    expect(explainModelError(withStatus(404), L)).toContain('模型名不对或接口地址不对');
    expect(explainModelError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }), 'Ollama（qwen2.5）')).toBe('连不上本地模型 Ollama（qwen2.5）：先运行 Ollama，再重试。');
    expect(explainModelError(new Error('getaddrinfo ENOTFOUND api.x.com'), L)).toContain('连不上 Kimi（moonshot-v1-8k）：检查网络和接口地址');
  });
  it('recognizes status text inside plain messages', () => {
    expect(explainModelError(new Error('401 Unauthorized'), L)).toContain('key 无效');
  });
  it('falls back to a short message', () => {
    expect(explainModelError(new Error('something odd'), L)).toBe('Kimi（moonshot-v1-8k）出错了：something odd');
  });
});
```

`tests/lib/llm/model-test.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { runModelTest } from '@/lib/llm/model-test';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-09-29T12:00:00Z');
const chat = (toolWorks: boolean): ChatModel => ({
  label: 'X',
  streamTurn: vi.fn(async (_m, tools) =>
    tools.length ? (toolWorks ? { text: '', toolCalls: [{ id: '1', name: 'get_weather', arguments: '{"city":"北京"}' }] } : { text: '北京晴', toolCalls: [] }) : { text: '好', toolCalls: [] },
  ),
});
const llm = (ok: boolean): StructuredLLM => ({ callStructured: vi.fn(async () => { if (!ok) throw new Error('bad json'); return { result: { city: '北京', country: '中国' }, usage: {} as never }; }) as never });

describe('runModelTest', () => {
  it('able_agent when all three pass', async () => {
    expect(await runModelTest({ chat: chat(true), llm: llm(true), label: 'X' }, now)).toEqual({ at: now.toISOString(), reachable: true, tools: true, json: true, grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。' });
  });
  it('analysis_only when tools fail', async () => {
    const r = await runModelTest({ chat: chat(false), llm: llm(true), label: 'X' }, now);
    expect(r).toMatchObject({ reachable: true, tools: false, json: true, grade: 'analysis_only' });
    expect(r.message).toBe('只能做分析：不会调用工具，编导写稿改稿用不了；拆解、复盘、发布文案可以用。');
  });
  it('unusable when it cannot connect', async () => {
    const down: ChatModel = { label: 'X', streamTurn: vi.fn(async () => { throw Object.assign(new Error('401'), { status: 401 }); }) };
    const r = await runModelTest({ chat: down, llm: llm(true), label: 'X' }, now);
    expect(r).toMatchObject({ reachable: false, grade: 'unusable' });
    expect(r.message).toContain('key 无效');
  });
  it('unusable when structured output fails', async () => {
    expect((await runModelTest({ chat: chat(true), llm: llm(false), label: 'X' }, now)).grade).toBe('unusable');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/llm/errors.test.ts tests/lib/llm/model-test.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/lib/llm/errors.ts`:

```ts
/** 各家 SDK 的报错 → 中文"原因 + 怎么办", 带模型名 */
export function explainModelError(e: unknown, label: string): string {
  const err = e as { status?: number; code?: string; message?: string };
  const msg = err?.message ?? String(e);
  const status = err?.status ?? Number(/\b(40[1-4]|429|5\d\d)\b/.exec(msg)?.[1] ?? 0);
  if (status === 401 || status === 403) return `${label}拒绝了请求：key 无效或没有权限，去设置页检查这个模型的 key。`;
  if (status === 402) return `${label}余额不足：去厂商后台充值后再试。`;
  if (status === 429) return `${label}请求太频繁或额度用完：等一会儿再试，或换一个模型。`;
  if (status === 404) return `${label}找不到：模型名不对或接口地址不对，去设置页核对。`;
  if (status >= 500) return `${label}服务端出错（${status}）：稍后再试。`;
  const local = /localhost|127\.0\.0\.1/.test(msg);
  if (err?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return local ? `连不上本地模型 ${label}：先运行 Ollama，再重试。` : `连不上 ${label}：检查网络和接口地址。`;
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed|timeout/i.test(msg)) return `连不上 ${label}：检查网络和接口地址。`;
  return `${label}出错了：${msg.slice(0, 120)}`;
}
```

`src/lib/llm/model-test.ts`:

```ts
import { z } from 'zod';
import type { ChatModel } from '@/lib/agent/chat-model';
import type { StructuredLLM } from '@/lib/script/write';
import type { ModelTestResult } from './providers';
import { explainModelError } from './errors';

const WEATHER_TOOL = { name: 'get_weather', description: '查询某个城市的天气', parameters: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] } };

/** 三项: 连通 / 工具调用(编导写稿改稿要用) / 结构化输出(拆解复盘要用) */
export async function runModelTest(m: { chat: ChatModel; llm: StructuredLLM; label: string }, now = new Date()): Promise<ModelTestResult> {
  const at = now.toISOString();
  try {
    const r = await m.chat.streamTurn([{ role: 'user', content: '只回复一个字：好' }], [], () => {});
    if (!r.text.trim()) return { at, reachable: false, tools: false, json: false, grade: 'unusable', message: `${m.label}没有回复内容。` };
  } catch (e) {
    return { at, reachable: false, tools: false, json: false, grade: 'unusable', message: explainModelError(e, m.label) };
  }
  let tools = false;
  try {
    const r = await m.chat.streamTurn(
      [
        { role: 'system', content: '需要查天气时调用 get_weather 工具。' },
        { role: 'user', content: '北京今天天气怎么样？请调用工具查询。' },
      ],
      [WEATHER_TOOL],
      () => {},
    );
    const call = r.toolCalls[0];
    tools = !!call && call.name === 'get_weather' && typeof (JSON.parse(call.arguments || '{}') as { city?: unknown }).city === 'string';
  } catch {
    tools = false;
  }
  let json = false;
  try {
    await m.llm.callStructured({ systemPrompt: '按要求输出 JSON。', userMessage: [{ type: 'text', text: '给出一个城市和它所在的国家。' }], responseSchema: z.object({ city: z.string(), country: z.string() }) });
    json = true;
  } catch {
    json = false;
  }
  if (tools && json) return { at, reachable: true, tools, json, grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。' };
  if (json) return { at, reachable: true, tools, json, grade: 'analysis_only', message: '只能做分析：不会调用工具，编导写稿改稿用不了；拆解、复盘、发布文案可以用。' };
  return { at, reachable: true, tools, json, grade: 'unusable', message: '不可用：不能按格式输出结果，拆解、复盘、发布文案都会失败。' };
}
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/llm tests/lib/llm
git commit -m "feat(llm): 报错翻译(带模型名) + 三项能力测试(能当编导/只能做分析/不可用)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 调用点改用当前模型

**Files:**
- Modify: `src/lib/agent/loop.ts`、`src/app/api/projects/[id]/chat/route.ts`、`src/app/api/projects/[id]/publish/kit/route.ts`、`src/app/api/topics/suggest/route.ts`、`src/lib/benchmark/deps.ts`、`src/lib/recording/deps.ts`、`src/lib/retro/generate.ts`、`src/lib/benchmark/analyze.ts`、`src/lib/cli/commands/{chat,read,write}.ts`、`src/lib/cli/registry.ts`（ErrorCode `no_deepseek_key` → `no_model`）、`src/lib/agent/chat-model.ts`（删掉 deprecated 函数）、`.claude/skills/mediapilot/SKILL.md`、`agents/hermes/mediapilot/SKILL.md`（如提到 no_deepseek_key）
- Test: 更新 `tests/lib/agent/loop.test.ts`、`tests/lib/cli/chat.test.ts`、`tests/lib/benchmark/analyze.test.ts`

**Interfaces:**
- Consumes：`getActiveModel`、`NO_MODEL_MESSAGE`、`explainModelError`
- Produces：`runAgentTurn` 连不上时的消息 = `编导这一轮没连上：${explainModelError(e, opts.model.label ?? '模型')}` （写库 + emit error）

- [ ] **Step 1: 改测试（先失败）**

`tests/lib/agent/loop.test.ts` 第 137 行附近的期望改为：

```ts
    expect(events).toEqual([{ type: 'error', message: '编导这一轮没连上：模型拒绝了请求：key 无效或没有权限，去设置页检查这个模型的 key。' }]);
```

（该用例的假模型抛 `new Error('401 Unauthorized')` 且无 label；若原用例抛的错误文本不同，按 `explainModelError` 规则推出期望值并记 Ruling。）

`tests/lib/cli/chat.test.ts`："needs a DeepSeek key" 用例改为 mock `getActiveModel` 返回 null：

```ts
vi.mock('@/lib/llm/provider', async (orig) => ({ ...(await orig<object>()), getActiveModel: vi.fn(async () => (globalThis as { __noModel?: boolean }).__noModel ? null : { chat: { streamTurn: vi.fn() }, llm: {}, label: 'X', config: {} }) }));
```

并把用例改为：设置 `(globalThis as { __noModel?: boolean }).__noModel = true` 后 `runChat` 抛 `{ code: 'no_model' }`；其余用例前置 `__noModel = false` 并去掉对 `process.env.DEEPSEEK_API_KEY` 的设置。

`tests/lib/benchmark/analyze.test.ts`："fails clearly without a DeepSeek key" 的期望从 `toContain('设置页')` 保持不变（文案改为 NO_MODEL_MESSAGE 仍含"设置页"）。

Run: `npx vitest run tests/lib/agent tests/lib/cli/chat.test.ts`
Expected: FAIL（loop 文案、no_model）。

- [ ] **Step 2: 改实现**

- `src/lib/agent/loop.ts`：catch 分支消息改为 `` `编导这一轮没连上：${explainModelError(e, opts.model.label ?? '模型')}` ``（import `explainModelError`）。
- `src/app/api/projects/[id]/chat/route.ts`：删掉 `getDeepSeekKey`；`const m = await getActiveModel(prisma); if (!m) return fail(NO_MODEL_MESSAGE, 400);`；`model: m.chat`、`toolCtx: { projectId, db: prisma, llm: m.llm }`。
- `…/publish/kit/route.ts`：同理，`makePublishKit(prisma, id, m.llm)`；DeepSeek 失败文案改为 `发布文案没写出来（${m.label} 没按格式回答），再点一次。`
- `src/app/api/topics/suggest/route.ts`：同理，`llm: m.llm`；失败文案 `编导这次没挑出来（${m.label} 没按格式回答），再点一次。`
- `src/lib/benchmark/deps.ts`：`llm: (await getActiveModel(db))?.llm ?? null`。
- `src/lib/recording/deps.ts`：`proofread` 里 `const m = await getActiveModel(prisma); if (!m) return { lines, status: 'skipped', changed: 0 }; return proofreadLines(m.llm, script, lines);`（该文件若无 db，import `prisma`）。
- `src/lib/retro/generate.ts`：`createRetroDeps` 改为 `async`？——保持同步签名，改为在 `load` 时取模型：`llm` 字段改成 getter 不便；将 `createRetroDeps(db)` 改为 `async createRetroDeps(db)` 返回带 `llm: (await getActiveModel(db))?.llm ?? null`，并把调用点（`runDueRetros`、`publish/retro` 路由、`mp retro run`）改为 `await createRetroDeps(db)`。`narrativeError` 无模型文案改为 `${NO_MODEL_MESSAGE.replace('。', '')}，然后点重试。`。
- `src/lib/benchmark/analyze.ts`：无模型文案改为 `还没有可用的模型：去设置页添加一个，然后点重试。`；"DeepSeek 这次没按格式交回拆解" 改为 "模型这次没按格式交回拆解"。
- `src/lib/cli/registry.ts`：`ErrorCode` 中 `no_deepseek_key` → `no_model`。
- `src/lib/cli/commands/{chat,read,write}.ts`：`llmOrThrow` / `runChat` 改为 `const m = await getActiveModel(ctx.db); if (!m) throw new CliError('no_model', NO_MODEL_MESSAGE);`，用 `m.llm` / `m.chat`。
- `src/lib/agent/chat-model.ts`：删除 deprecated `createDeepSeekChatModel`。
- 两份 skill：`no_deepseek_key` → `no_model`（如出现）。

- [ ] **Step 3: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck && grep -rn "getDeepSeekKey\|createDeepSeekChatModel\|new DeepSeekTextLLM" src scripts | grep -v "src/lib/llm/deepseek.ts\|src/lib/env.ts\|src/lib/settings\|src/app/api/settings\|src/app/settings\|src/lib/health"`
Expected: 全绿；grep 无输出（只剩 Task 6 要替换的设置页与体检）。

真机（重启 dev：改了 schema）：打开任一项目，让编导改一句 → 正常（迁移后的 DeepSeek 生效）；`npm run -s mp -- topics suggest` 正常或如实返回数据不足。

```bash
git add src tests .claude agents
git commit -m "refactor(llm): 编导/写稿/拆解/复盘/找选题/发布文案/校对/mp 全部改用当前模型; 报错带模型名

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 设置页「模型」卡片与体检

**Files:**
- Create: `src/app/api/settings/models/route.ts`、`src/app/api/settings/models/[id]/route.ts`、`src/app/api/settings/models/[id]/test/route.ts`、`src/app/api/settings/models/[id]/activate/route.ts`、`src/components/settings/models-card.tsx`
- Modify: `src/app/settings/page.tsx`、`src/lib/health/checks.ts`、`src/app/api/settings/health/route.ts`
- Delete: `src/app/api/settings/deepseek/route.ts`、`src/components/settings/deepseek-key.tsx`、`src/lib/settings/deepseek.ts`、`tests/lib/settings/deepseek.test.ts`
- Test: `tests/components/settings/models-card.test.tsx`、`tests/lib/health/checks.test.ts`（改）

**Interfaces:**
- HTTP：
  - `GET /api/settings/models` → `{ models: ModelView[]; presets: PRESETS }`（先 `ensureMigrated`）
  - `POST /api/settings/models` body `ModelInput` → `ModelView`
  - `PATCH /api/settings/models/[id]` body `ModelInput`（apiKey 空不改）→ `ModelView`；`DELETE` → `{ deleted: true }`
  - `POST /api/settings/models/[id]/test` → `ModelTestResult`（保存到 lastTest）
  - `POST /api/settings/models/[id]/activate` → `{ active: id }`
- `runHealthChecks` deps：去掉对 `env.DEEPSEEK_API_KEY` 的依赖，新增 `model: { label: string; grade: ModelTestResult['grade'] | null } | null`；体检项 `{ key: 'model', label: '当前模型' }`：null → fail "没有可用的模型，编导和写稿都用不了"，fix "在下方「模型」里添加一个"；grade 为 `able_agent` → ok；`analysis_only` → warn；`unusable` → fail；null grade → warn "还没测试过，在下方「模型」里点测试"。

- [ ] **Step 1: 写失败测试**

`tests/components/settings/models-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelsCard } from '@/components/settings/models-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const models = [
  { id: 'a', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyMasked: '…abcd', isActive: true, lastTest: { grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。', at: '', reachable: true, tools: true, json: true } },
  { id: 'b', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', keyMasked: '（无）', isActive: false, lastTest: { grade: 'analysis_only', message: '只能做分析：…', at: '', reachable: true, tools: false, json: true } },
];

function stub(extra: (url: string, init?: { method?: string }) => unknown = () => null) {
  const f = vi.fn(async (url: string, init?: { method?: string }) => ({ json: async () => extra(url, init) ?? { success: true, data: { models, presets: [{ key: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }] } } }));
  vi.stubGlobal('fetch', f);
  return f;
}

describe('ModelsCard', () => {
  it('lists models with masked keys, the active mark and test grade', async () => {
    stub();
    render(<ModelsCard />);
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy());
    expect(screen.getByText('当前使用')).toBeTruthy();
    expect(screen.getByText('能当编导')).toBeTruthy();
    expect(screen.getByText('只能做分析')).toBeTruthy();
    expect(screen.getByText(/…abcd/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('sk-');
  });
  it('asks before activating a model that cannot be the director', async () => {
    const f = stub();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<ModelsCard />);
    await waitFor(() => expect(screen.getByText('Ollama（本地）')).toBeTruthy());
    fireEvent.click(screen.getAllByText('设为当前')[0]);
    expect(confirm).toHaveBeenCalledWith('这个模型写稿改稿会失败（只能做分析），确定切换吗？');
    expect(f.mock.calls.some((c) => String(c[0]).includes('/activate'))).toBe(false);
  });
});
```

`tests/lib/health/checks.test.ts`：`deps()` 去掉 `env.DEEPSEEK_API_KEY` 依赖（env 只留 `PYTHON_BIN`），加 `model: { label: 'DeepSeek（deepseek-chat）', grade: 'able_agent' }`；"healthy machine" 期望中 `['deepseek', 'ok']` 改为 `['model', 'ok']`；"actionable fix" 用例传 `model: null` 并断言 `by.model` 为 `{ status: 'fail', fix: '在下方「模型」里添加一个' }`（去掉原 `by.deepseek` 断言）。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/settings/models-card.test.tsx tests/lib/health`
Expected: FAIL。

- [ ] **Step 3: 实现接口**

`src/app/api/settings/models/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createModel, ensureMigrated, listModels, ModelInputSchema, PRESETS, toModelView } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function GET() {
  await ensureMigrated(prisma, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY });
  return ok({ models: (await listModels(prisma)).map(toModelView), presets: PRESETS });
}

export async function POST(req: Request) {
  const p = ModelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fail(p.error.issues[0]?.message ?? '填写不完整', 400);
  if (p.data.kind === 'anthropic' && !p.data.apiKey) return fail('Claude 需要填 key', 400);
  return ok(toModelView(await createModel(prisma, p.data)));
}
```

`src/app/api/settings/models/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { deleteModel, ModelInputSchema, toModelView, updateModel } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const p = ModelInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return fail(p.error.issues[0]?.message ?? '填写不完整', 400);
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  return ok(toModelView(await updateModel(prisma, params.id, p.data)));
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  await deleteModel(prisma, params.id);
  return ok({ deleted: true });
}
```

`src/app/api/settings/models/[id]/test/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { listModels, saveTestResult } from '@/lib/llm/providers';
import { buildModel } from '@/lib/llm/provider';
import { runModelTest } from '@/lib/llm/model-test';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const c = (await listModels(prisma)).find((m) => m.id === params.id);
  if (!c) return fail('找不到这个模型', 404);
  const r = await runModelTest(buildModel(c));
  await saveTestResult(prisma, c.id, r);
  return ok(r);
}
```

`src/app/api/settings/models/[id]/activate/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { activateModel } from '@/lib/llm/providers';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await prisma.modelProvider.findUnique({ where: { id: params.id } }))) return fail('找不到这个模型', 404);
  await activateModel(prisma, params.id);
  return ok({ active: params.id });
}
```

- [ ] **Step 4: `src/components/settings/models-card.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ModelView, ModelTestResult } from '@/lib/llm/providers';

type Preset = { key: string; name: string; kind: 'openai' | 'anthropic'; baseUrl: string; keyOptional?: boolean; note?: string };
const GRADE: Record<ModelTestResult['grade'], { text: string; cls: string }> = {
  able_agent: { text: '能当编导', cls: 'text-[var(--success)]' },
  analysis_only: { text: '只能做分析', cls: 'text-[var(--warning)]' },
  unusable: { text: '不可用', cls: 'text-[var(--danger)]' },
};
const input = 'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm';

async function call(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

type Form = { id?: string; name: string; kind: 'openai' | 'anthropic'; baseUrl: string; model: string; apiKey: string; note?: string };

export function ModelsCard() {
  const [models, setModels] = useState<ModelView[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const j = await call('/api/settings/models');
    if (j.success) {
      setModels(j.data.models);
      setPresets(j.data.presets);
    } else setMsg({ ok: false, text: j.message });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, url: string, method: string, body?: unknown, done?: string) => {
    setBusy(key);
    setMsg(null);
    const j = await call(url, method, body);
    setBusy(null);
    setMsg(j.success ? (done ? { ok: true, text: done } : j.data?.message ? { ok: j.data.grade !== 'unusable', text: j.data.message } : null) : { ok: false, text: j.message });
    if (j.success) setForm(null);
    await load();
  };

  const activate = (m: ModelView) => {
    const g = m.lastTest?.grade;
    if (g !== 'able_agent' && !confirm(g ? `这个模型写稿改稿会失败（${GRADE[g].text}），确定切换吗？` : '这个模型还没测试过，编导可能用不了，确定切换吗？')) return;
    void act(`act-${m.id}`, `/api/settings/models/${m.id}/activate`, 'POST', undefined, `已切换到 ${m.name}。`);
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-1 flex items-center">
        <h3 className="text-sm font-medium">模型</h3>
        <div className="flex-1" />
        {!form && (
          <select className="rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-xs" value="" onChange={(e) => {
            const p = presets.find((x) => x.key === e.target.value);
            if (p) setForm({ name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: '', apiKey: '', note: p.note });
          }}>
            <option value="">＋ 添加模型…</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        )}
      </div>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">编导、写稿、拆解、复盘、找选题、发布文案都用"当前使用"的模型。key 只存在本机数据库里。</p>

      {form && (
        <div className="mb-4 space-y-2 rounded-md border border-[var(--border-subtle)] p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <input className={input} placeholder="显示名" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Form['kind'] })}>
              <option value="openai">OpenAI 兼容</option>
              <option value="anthropic">Claude 原生</option>
            </select>
            <input className={`${input} md:col-span-2`} placeholder="接口地址" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            <input className={input} placeholder="模型名（如 deepseek-chat）" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className={input} type="password" autoComplete="off" placeholder={form.id ? 'key（留空不改）' : 'key'} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          {form.note && <p className="text-xs text-[var(--text-tertiary)]">{form.note}</p>}
          <p className="text-xs text-[var(--text-tertiary)]">接口地址是预填的，以厂商文档为准。</p>
          <div className="flex gap-2 text-sm">
            <button className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--text-on-accent)]" disabled={busy !== null} onClick={() => {
              const body = { name: form.name, kind: form.kind, baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey };
              void act('save', form.id ? `/api/settings/models/${form.id}` : '/api/settings/models', form.id ? 'PATCH' : 'POST', body, '已保存，点「测试」看看能不能用。');
            }}>保存</button>
            <button className="text-[var(--text-tertiary)]" onClick={() => setForm(null)}>取消</button>
          </div>
        </div>
      )}

      {models === null ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : models.length === 0 ? (
        <p className="text-sm text-[var(--warning)]">还没有可用的模型：用右上角「添加模型」加一个。</p>
      ) : (
        <ul className="space-y-2">
          {models.map((m) => (
            <li key={m.id} className="rounded-md border border-[var(--border-subtle)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b>{m.name}</b>
                {m.isActive && <span className="rounded bg-[var(--accent-subtle)] px-1.5 text-xs text-[var(--accent)]">当前使用</span>}
                {m.lastTest ? <span className={`text-xs ${GRADE[m.lastTest.grade].cls}`}>{GRADE[m.lastTest.grade].text}</span> : <span className="text-xs text-[var(--text-tertiary)]">未测试</span>}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{`${m.kind === 'anthropic' ? 'Claude 原生' : 'OpenAI 兼容'} · ${m.model} · key ${m.keyMasked} · ${m.baseUrl}`}</div>
              {m.lastTest && <p className="mt-1 text-xs text-[var(--text-secondary)]">{m.lastTest.message}</p>}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => void act(`test-${m.id}`, `/api/settings/models/${m.id}/test`, 'POST')}>{busy === `test-${m.id}` ? '测试中（约 20 秒）…' : '测试'}</button>
                {!m.isActive && <button className="text-[var(--accent)]" disabled={busy !== null} onClick={() => activate(m)}>设为当前</button>}
                <button className="text-[var(--text-secondary)]" onClick={() => setForm({ id: m.id, name: m.name, kind: m.kind, baseUrl: m.baseUrl, model: m.model, apiKey: '' })}>编辑</button>
                <button className="text-[var(--danger)]" disabled={busy !== null} onClick={() => {
                  if (confirm(m.isActive ? `${m.name} 是当前使用的模型，删掉后编导会用不了，确定删除吗？` : `确定删除 ${m.name}？`)) void act(`del-${m.id}`, `/api/settings/models/${m.id}`, 'DELETE', undefined, '已删除。');
                }}>删除</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
```

`src/app/settings/page.tsx`：删掉 `DeepSeekKey`、`maskKey`、`getDeepSeekKey` 的 import 与使用，换成 `<ModelsCard />`（放在 `HealthPanel` 之后）。

删除 `src/app/api/settings/deepseek/route.ts`、`src/components/settings/deepseek-key.tsx`、`src/lib/settings/deepseek.ts`、`tests/lib/settings/deepseek.test.ts`。

- [ ] **Step 5: 体检**

`src/lib/health/checks.ts`：deps 加 `model: { label: string; grade: 'able_agent' | 'analysis_only' | 'unusable' | null } | null`；把原 DeepSeek key 那一项换成：

```ts
  const mdl = deps.model;
  items.push(
    !mdl
      ? { key: 'model', label: '当前模型', status: 'fail', detail: '没有可用的模型，编导和写稿都用不了', fix: '在下方「模型」里添加一个' }
      : mdl.grade === 'able_agent'
        ? { key: 'model', label: '当前模型', status: 'ok', detail: `${mdl.label}，能当编导` }
        : mdl.grade === 'analysis_only'
          ? { key: 'model', label: '当前模型', status: 'warn', detail: `${mdl.label} 只能做分析，编导写稿改稿用不了`, fix: '换一个能当编导的模型' }
          : mdl.grade === 'unusable'
            ? { key: 'model', label: '当前模型', status: 'fail', detail: `${mdl.label} 最近测试不可用`, fix: '在下方「模型」里重新测试或换一个' }
            : { key: 'model', label: '当前模型', status: 'warn', detail: `${mdl.label} 还没测试过`, fix: '在下方「模型」里点测试' },
  );
```

`src/app/api/settings/health/route.ts`：`const c = await (ensureMigrated(prisma, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY }).then(() => getActiveConfig(prisma)));` 传 `model: c ? { label: \`${c.name}（${c.model}）\`, grade: c.lastTest?.grade ?? null } : null`。

- [ ] **Step 6: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（重启 dev：新 API 目录）：设置页「模型」卡片显示迁移来的 DeepSeek（当前使用、未测试）→「测试」→ 三项全过显示"能当编导"；体检"当前模型"为绿；窄屏无横向溢出（量 scrollWidth）。

```bash
git add -A src tests
git commit -m "feat(settings): 「模型」卡片(添加/测试/设为当前/编辑/删除, key 只显示末 4 位) + 体检改为当前模型; 移除 DeepSeek key 卡片

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-29-multi-model-design.md`（追加实测）、`.claude/skills/mediapilot/SKILL.md`（如需）

- [ ] **Step 1: README**

- 「现在能做什么」里"设置"一条：把"更换 DeepSeek key（写入 .env）并测试连接"改为"「模型」：添加任意模型（OpenAI 兼容：DeepSeek / 千问 / Kimi / GLM / 豆包 / OpenRouter / Ollama / 中转站；Claude 原生），测试能否当编导，全局选一个当前使用"。
- 「环境变量」一节：`DEEPSEEK_API_KEY` 注明"仅首次启动时迁移为设置页里的 DeepSeek 模型，之后在设置页管理"。
- 目录一节加 `src/lib/llm/  模型层：配置、OpenAI 兼容 / Claude 适配、能力测试、报错翻译`。

- [ ] **Step 2: 预设地址核对**

对 `PRESETS` 的 9 个地址逐个查厂商官方文档（WebFetch / WebSearch）；与文档不符的改正；查不到的保留并确保界面提示"以厂商文档为准"。结果记入 spec 末尾。

- [ ] **Step 3: 真机验收**

1. 迁移：设置页出现 DeepSeek（当前使用）；项目页让编导改一句正常；`mp topics suggest` 正常。
2. 测试 DeepSeek：三项全过 → "能当编导"。
3. ⏸ 请用户提供 Claude key（或能用 Claude 的中转站地址与 key），添加 → 测试 → 设为当前 → 在一个项目让编导写一版 → 切回 DeepSeek。
4. 若本机有 Ollama：添加本地模型测试，看判定；没有则跳过并在 spec 注明。

- [ ] **Step 4: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-09-29-multi-model-design.md .claude
git commit -m "docs: README 补多模型, spec 记录预设核对与真机实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
