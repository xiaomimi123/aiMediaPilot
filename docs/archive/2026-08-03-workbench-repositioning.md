# 自媒体工作台重定位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 MediaPilot 从「小白向导智能体」改成「自用自媒体工作台」：新首页 = 今日驾驶舱 + 六列内容管线看板，新增选题池 (TopicIdea) 与分发登记 (Distribution)。

**Architecture:** 内容主线 = 现有 `ScriptDraft`，管线阶段**不落库、按数据派生**（纯函数 `deriveStage`）。新增 TopicIdea / Distribution 两个 Prisma 模型；分发平台用代码注册表（非 DB enum）。UI 层新增 `/` 工作台页（驾驶舱 + 看板），sidebar 重组。视频分析 / L1 / retro 管线全部不动。

**Tech Stack:** Next.js 14 App Router + Prisma (Postgres) + vitest (mock prisma) + Tailwind。

**Spec:** `docs/superpowers/specs/2026-08-03-workbench-repositioning-design.md`

## Global Constraints

- API route 约定：`ok`/`fail` 来自 `@/lib/api`，用户来自 `getOrCreateDefaultUser()`（`@/lib/user`），prisma 来自 `@/lib/prisma`。所有查询 scope `userId`，别人数据返回 404。
- 测试约定：vitest + `vi.hoisted` prisma mock（模板见 `tests/api/scripts/crud.test.ts`）。UI 手动 E2E，不写 UI 单测。
- 阶段派生唯一入口是 `deriveStage`，任何 UI/API 不得内联复制判定规则。
- 分发平台 key 一律小写字符串；未知 key UI 原样显示不崩。
- retro 触发时点是发布后 3 天（见 `src/app/api/v1/content/analyses/[id]/publish/route.ts:45` 的 `3 * 86400000`），倒计时同源用 3 天。
- deprecated 模型（Content / PublishTask / PublishTarget / Competitor / CompetitorNote）不碰。
- Sidebar 保留 `/accounts` 入口（`src/components/layout/sidebar.tsx:18` 注释记录过"入口消失"事故），所以导航是 6 项而非 spec 写的 5 项——这是有意偏离。
- 文案跟随项目全中文。commit message 末尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

## Phase A: 数据层

### Task 1: Prisma schema — TopicIdea + Distribution + archivedAt

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `prisma.topicIdea`、`prisma.distribution` client API；`ScriptDraft.archivedAt`、`ScriptDraft.distributions` 关系。后续所有任务依赖 `npx prisma generate` 产出的类型。

- [ ] **Step 1: 在 schema.prisma 追加两个模型**

在 `ScriptDraft` 模型之后添加：

```prisma
// 工作台: 选题池 (spec §2.2)
model TopicIdea {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  title         String
  note          String?
  source        String   // 'discover' | 'inspiration' | 'manual'
  status        String   @default("POOL") // 'POOL' | 'ADOPTED' | 'DISCARDED'
  scriptDraftId String? // 采纳后链到草稿
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([userId, status, createdAt])
}

// 工作台: 分发登记 (spec §2.3)。抖音主阵地发布仍走 ContentAnalysis.douyinUrl,
// 这里管其他平台搬运登记; platform 是代码注册表 key (src/lib/pipeline/platforms.ts), 非 enum。
model Distribution {
  id            String      @id @default(cuid())
  scriptDraftId String
  scriptDraft   ScriptDraft @relation(fields: [scriptDraftId], references: [id], onDelete: Cascade)
  platform      String
  url           String
  publishedAt   DateTime    @default(now())
  note          String?
  createdAt     DateTime    @default(now())

  @@index([scriptDraftId])
}
```

- [ ] **Step 2: 给 ScriptDraft 加 archivedAt + distributions，给 User 加 topicIdeas**

`ScriptDraft` 模型内（`createdAt` 行后）加：

```prisma
  archivedAt DateTime? // 放弃的内容移出看板, 不删数据

  distributions Distribution[]
```

`User` 模型 relations 区（`inspirationInsights` 行后）加：

```prisma
  topicIdeas          TopicIdea[]
```

- [ ] **Step 3: 校验并同步 schema**

```bash
npx prisma validate
docker compose up -d postgres
npx prisma db push
npx prisma generate
```

Expected: validate 无错；db push 输出包含 `TopicIdea`、`Distribution` 创建。

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(workbench): schema 加 TopicIdea + Distribution + ScriptDraft.archivedAt"
```

---

### Task 2: deriveStage 纯函数

**Files:**
- Create: `src/lib/pipeline/stage.ts`
- Test: `tests/lib/pipeline/stage.test.ts`

**Interfaces:**
- Produces（Task 6/8 依赖）：

```ts
export type PipelineStage = 'DRAFTING' | 'READY' | 'SHOT' | 'PUBLISHED' | 'RETROED';
export interface StageInput {
  picked: unknown;
  analysis: { publishedAt: Date | string | null; retroStatus: string | null } | null;
  distributionCount: number;
}
export function deriveStage(input: StageInput): PipelineStage;
export const STAGE_LABEL: Record<PipelineStage, string>;
```

- [ ] **Step 1: 写失败测试**

`tests/lib/pipeline/stage.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { deriveStage } from '@/lib/pipeline/stage';

describe('deriveStage', () => {
  it('全空 → DRAFTING', () => {
    expect(deriveStage({ picked: null, analysis: null, distributionCount: 0 })).toBe('DRAFTING');
  });

  it('picked 非空、无 analysis → READY (定稿待拍)', () => {
    expect(deriveStage({ picked: { titleIdx: 0 }, analysis: null, distributionCount: 0 })).toBe('READY');
  });

  it('有 analysis 未发布 → SHOT, 即使 picked 为 null (数据异常也不抛错)', () => {
    const analysis = { publishedAt: null, retroStatus: null };
    expect(deriveStage({ picked: null, analysis, distributionCount: 0 })).toBe('SHOT');
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('SHOT');
  });

  it('analysis.publishedAt 非空 → PUBLISHED', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'SCHEDULED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('PUBLISHED');
  });

  it('无 analysis 但有分发记录 → PUBLISHED (双通道发布, spec §2.1)', () => {
    expect(deriveStage({ picked: {}, analysis: null, distributionCount: 2 })).toBe('PUBLISHED');
  });

  it('retroStatus COMPLETED → RETROED, 优先级最高', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'COMPLETED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 3 })).toBe('RETROED');
  });

  it('retro FAILED 仍算 PUBLISHED, 不算 RETROED', () => {
    const analysis = { publishedAt: new Date('2026-08-01'), retroStatus: 'FAILED' };
    expect(deriveStage({ picked: {}, analysis, distributionCount: 0 })).toBe('PUBLISHED');
  });

  it('悬空 analysisId (analysis 传 null) + picked → 降级 READY', () => {
    expect(deriveStage({ picked: { hookIdx: 1 }, analysis: null, distributionCount: 0 })).toBe('READY');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/pipeline/stage.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/lib/pipeline/stage.ts`：

```ts
/**
 * 内容管线阶段 — 全部按现有数据派生, 不落库 (spec §2.1)。
 * 判定唯一入口; UI / API 不得内联复制规则。
 * 缺失数据 (analysis 被删导致悬空) 一律降级到更早阶段, 不抛错。
 */
export type PipelineStage = 'DRAFTING' | 'READY' | 'SHOT' | 'PUBLISHED' | 'RETROED';

export interface StageInput {
  /** ScriptDraft.picked — null = 未定稿 */
  picked: unknown;
  /** 关联 ContentAnalysis 摘要; analysisId 悬空或无 analysis 时传 null */
  analysis: { publishedAt: Date | string | null; retroStatus: string | null } | null;
  /** Distribution 记录数 */
  distributionCount: number;
}

export function deriveStage(input: StageInput): PipelineStage {
  const { picked, analysis, distributionCount } = input;
  if (analysis?.retroStatus === 'COMPLETED') return 'RETROED';
  if (analysis?.publishedAt != null || distributionCount > 0) return 'PUBLISHED';
  if (analysis != null) return 'SHOT';
  if (picked != null) return 'READY';
  return 'DRAFTING';
}

export const STAGE_LABEL: Record<PipelineStage, string> = {
  DRAFTING: '草稿',
  READY: '定稿待拍',
  SHOT: '已拍待发',
  PUBLISHED: '已发布',
  RETROED: '已复盘',
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/pipeline/stage.test.ts`
Expected: 8 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/stage.ts tests/lib/pipeline/stage.test.ts
git commit -m "feat(workbench): deriveStage 管线阶段派生纯函数"
```

---

### Task 3: 分发平台注册表

**Files:**
- Create: `src/lib/pipeline/platforms.ts`
- Test: `tests/lib/pipeline/platforms.test.ts`

**Interfaces:**
- Produces（Task 5/8/11 依赖）：

```ts
export interface DistributionPlatformMeta { key: string; label: string; badgeClass: string }
export const DISTRIBUTION_PLATFORMS: readonly DistributionPlatformMeta[];
export function distributionPlatformMeta(key: string): DistributionPlatformMeta; // 未知 key fallback 原样显示
```

- [ ] **Step 1: 写失败测试**

`tests/lib/pipeline/platforms.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { DISTRIBUTION_PLATFORMS, distributionPlatformMeta } from '@/lib/pipeline/platforms';

describe('distribution platforms registry', () => {
  it('注册表非空, key 全小写且唯一', () => {
    expect(DISTRIBUTION_PLATFORMS.length).toBeGreaterThanOrEqual(8);
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toBe(k.toLowerCase());
  });

  it('已知 key → 中文 label', () => {
    expect(distributionPlatformMeta('bilibili').label).toBe('B站');
    expect(distributionPlatformMeta('youtube').label).toBe('YouTube');
  });

  it('未知 key → 原样显示不崩 (spec §2.4)', () => {
    const meta = distributionPlatformMeta('tiktok');
    expect(meta.key).toBe('tiktok');
    expect(meta.label).toBe('tiktok');
    expect(meta.badgeClass).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/lib/pipeline/platforms.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`src/lib/pipeline/platforms.ts`：

```ts
/**
 * 分发登记平台注册表 (spec §2.4)。加新平台 = 加一行, 不改 DB。
 * 与 src/lib/platform.ts 的两套命名空间独立:
 * 这里是"内容搬运到了哪", 不是采集端 Platform enum, 也不是创作端 ContentPlatform。
 */
export interface DistributionPlatformMeta {
  key: string;
  label: string;
  badgeClass: string;
}

export const DISTRIBUTION_PLATFORMS: readonly DistributionPlatformMeta[] = [
  { key: 'douyin', label: '抖音', badgeClass: 'bg-slate-900 text-white' },
  { key: 'bilibili', label: 'B站', badgeClass: 'bg-sky-100 text-sky-900' },
  { key: 'youtube', label: 'YouTube', badgeClass: 'bg-red-100 text-red-900' },
  { key: 'twitter', label: 'X/推特', badgeClass: 'bg-neutral-200 text-neutral-900' },
  { key: 'xiaohongshu', label: '小红书', badgeClass: 'bg-rose-100 text-rose-900' },
  { key: 'gongzhonghao', label: '公众号', badgeClass: 'bg-emerald-100 text-emerald-900' },
  { key: 'kuaishou', label: '快手', badgeClass: 'bg-orange-100 text-orange-900' },
  { key: 'weibo', label: '微博', badgeClass: 'bg-amber-100 text-amber-900' },
];

export function distributionPlatformMeta(key: string): DistributionPlatformMeta {
  return (
    DISTRIBUTION_PLATFORMS.find((p) => p.key === key) ?? {
      key,
      label: key,
      badgeClass: 'bg-muted text-muted-foreground',
    }
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/lib/pipeline/platforms.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline/platforms.ts tests/lib/pipeline/platforms.test.ts
git commit -m "feat(workbench): 分发平台代码注册表"
```

---

### Task 4: TopicIdea CRUD API

**Files:**
- Create: `src/app/api/v1/topics/route.ts`
- Create: `src/app/api/v1/topics/[id]/route.ts`
- Test: `tests/api/topics/crud.test.ts`

**Interfaces:**
- Produces（Task 6/9/10 依赖）：
  - `POST /api/v1/topics` body `{ title: string; note?: string; source?: 'discover'|'inspiration'|'manual' }` → `{ id }`；同 title 已在 POOL → 409。
  - `GET /api/v1/topics?status=POOL` → `{ items: [{ id, title, note, source, status, scriptDraftId, createdAt }] }`。
  - `PATCH /api/v1/topics/[id]` body `{ status?: 'POOL'|'ADOPTED'|'DISCARDED'; scriptDraftId?: string; note?: string }` → `{ id }`；非本人 404。

- [ ] **Step 1: 写失败测试**

`tests/api/topics/crud.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  topicIdea: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST, GET } from '@/app/api/v1/topics/route';
import { PATCH } from '@/app/api/v1/topics/[id]/route';

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.topicIdea.create.mockResolvedValue({ id: 'idea1' });
  prismaMock.topicIdea.findMany.mockResolvedValue([]);
  prismaMock.topicIdea.findFirst.mockResolvedValue(null);
  prismaMock.topicIdea.findUnique.mockResolvedValue(null);
  prismaMock.topicIdea.update.mockResolvedValue({ id: 'idea1' });
});

describe('TopicIdea CRUD', () => {
  it('POST 入池 → 200, source 默认 manual', async () => {
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: 'AI 提效 10 招' }));
    expect(res.status).toBe(200);
    expect(prismaMock.topicIdea.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user1', title: 'AI 提效 10 招', source: 'manual' }),
      }),
    );
  });

  it('POST 空 title → 400', async () => {
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: '  ' }));
    expect(res.status).toBe(400);
  });

  it('POST 同 title 已在 POOL → 409 不重复创建 (spec §6)', async () => {
    prismaMock.topicIdea.findFirst.mockResolvedValueOnce({ id: 'existing' });
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: '重复选题' }));
    expect(res.status).toBe(409);
    expect(prismaMock.topicIdea.create).not.toHaveBeenCalled();
  });

  it('GET 默认只回 POOL, scope userId', async () => {
    const res = await GET(new Request('http://t/api/v1/topics'));
    expect(res.status).toBe(200);
    expect(prismaMock.topicIdea.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user1', status: 'POOL' } }),
    );
  });

  it('PATCH 采纳: status + scriptDraftId; 别人的 → 404', async () => {
    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'user1' });
    const res1 = await PATCH(
      reqJSON('http://t', 'PATCH', { status: 'ADOPTED', scriptDraftId: 'draft9' }),
      { params: Promise.resolve({ id: 'idea1' }) },
    );
    expect(res1.status).toBe(200);
    expect(prismaMock.topicIdea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea1' },
        data: expect.objectContaining({ status: 'ADOPTED', scriptDraftId: 'draft9' }),
      }),
    );

    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'other' });
    const res2 = await PATCH(reqJSON('http://t', 'PATCH', { status: 'DISCARDED' }), {
      params: Promise.resolve({ id: 'idea1' }),
    });
    expect(res2.status).toBe(404);
  });

  it('PATCH 非法 status → 400', async () => {
    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'user1' });
    const res = await PATCH(reqJSON('http://t', 'PATCH', { status: 'WHATEVER' }), {
      params: Promise.resolve({ id: 'idea1' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/topics/crud.test.ts`
Expected: FAIL — route 模块不存在。

- [ ] **Step 3: 实现 route.ts**

`src/app/api/v1/topics/route.ts`：

```ts
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const SOURCES = ['discover', 'inspiration', 'manual'] as const;
const STATUSES = ['POOL', 'ADOPTED', 'DISCARDED'] as const;

export async function POST(req: Request) {
  let body: { title?: unknown; note?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return fail('title 必填', 400);
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;
  const source = SOURCES.includes(body.source as (typeof SOURCES)[number])
    ? (body.source as string)
    : 'manual';

  const user = await getOrCreateDefaultUser();
  const dup = await prisma.topicIdea.findFirst({
    where: { userId: user.id, status: 'POOL', title },
    select: { id: true },
  });
  if (dup) return fail('该选题已在池中', 409);

  try {
    const idea = await prisma.topicIdea.create({
      data: { userId: user.id, title, note, source },
      select: { id: true },
    });
    return ok({ id: idea.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST topics]', e);
    return fail(`保存失败: ${msg}`, 500);
  }
}

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status') ?? 'POOL';
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return fail('status 不合法', 400);

  const user = await getOrCreateDefaultUser();
  const items = await prisma.topicIdea.findMany({
    where: { userId: user.id, status },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true, title: true, note: true, source: true,
      status: true, scriptDraftId: true, createdAt: true,
    },
  });
  return ok({ items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })) });
}
```

- [ ] **Step 4: 实现 [id]/route.ts**

`src/app/api/v1/topics/[id]/route.ts`：

```ts
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const STATUSES = ['POOL', 'ADOPTED', 'DISCARDED'] as const;

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { status?: unknown; scriptDraftId?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const data: { status?: string; scriptDraftId?: string; note?: string } = {};
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as (typeof STATUSES)[number])) return fail('status 不合法', 400);
    data.status = body.status as string;
  }
  if (typeof body.scriptDraftId === 'string' && body.scriptDraftId) data.scriptDraftId = body.scriptDraftId;
  if (typeof body.note === 'string') data.note = body.note.trim();
  if (Object.keys(data).length === 0) return fail('无可更新字段', 400);

  const user = await getOrCreateDefaultUser();
  const idea = await prisma.topicIdea.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!idea || idea.userId !== user.id) return fail('选题不存在', 404);

  await prisma.topicIdea.update({ where: { id }, data });
  return ok({ id });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/api/topics/crud.test.ts`
Expected: 6 passed。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/topics tests/api/topics
git commit -m "feat(workbench): TopicIdea 选题池 CRUD API"
```

---

### Task 5: Distribution 登记 API

**Files:**
- Create: `src/app/api/v1/scripts/[id]/distributions/route.ts`
- Create: `src/app/api/v1/distributions/[id]/route.ts`
- Test: `tests/api/distributions/crud.test.ts`

**Interfaces:**
- Produces（Task 8/11 依赖）：
  - `POST /api/v1/scripts/[id]/distributions` body `{ platform: string; url: string; publishedAt?: string; note?: string }` → `{ id }`；url 必须 `http(s)://` 开头；draft 非本人 404。
  - `GET /api/v1/scripts/[id]/distributions` → `{ items: [{ id, platform, url, publishedAt, note }] }`。
  - `DELETE /api/v1/distributions/[id]` → `{ id }`（误登记删除）；非本人 404。

- [ ] **Step 1: 写失败测试**

`tests/api/distributions/crud.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findUnique: vi.fn() },
  distribution: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST, GET } from '@/app/api/v1/scripts/[id]/distributions/route';
import { DELETE } from '@/app/api/v1/distributions/[id]/route';

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'draft1', userId: 'user1' });
  prismaMock.distribution.create.mockResolvedValue({ id: 'dist1' });
  prismaMock.distribution.findMany.mockResolvedValue([]);
  prismaMock.distribution.findUnique.mockResolvedValue(null);
  prismaMock.distribution.delete.mockResolvedValue({});
});

describe('Distribution CRUD', () => {
  it('POST 登记 → 200', async () => {
    const res = await POST(
      reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1' }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.distribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scriptDraftId: 'draft1', platform: 'bilibili' }),
      }),
    );
  });

  it('POST url 非 http(s) → 400 (spec §6: 只做基本格式校验)', async () => {
    const res = await POST(reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'BV1xxx' }), ctx);
    expect(res.status).toBe(400);
    expect(prismaMock.distribution.create).not.toHaveBeenCalled();
  });

  it('POST 别人的 draft → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'other' });
    const res = await POST(
      reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'https://b23.tv/x' }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('GET 列表 scope 到该 draft', async () => {
    prismaMock.distribution.findMany.mockResolvedValueOnce([
      { id: 'd1', platform: 'youtube', url: 'https://youtu.be/x', publishedAt: new Date(), note: null },
    ]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(prismaMock.distribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scriptDraftId: 'draft1' } }),
    );
  });

  it('DELETE 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.distribution.findUnique.mockResolvedValueOnce({
      id: 'dist1',
      scriptDraft: { userId: 'user1' },
    });
    const res1 = await DELETE(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'dist1' }),
    });
    expect(res1.status).toBe(200);
    expect(prismaMock.distribution.delete).toHaveBeenCalledWith({ where: { id: 'dist1' } });

    prismaMock.distribution.findUnique.mockResolvedValueOnce({
      id: 'dist1',
      scriptDraft: { userId: 'other' },
    });
    const res2 = await DELETE(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'dist1' }),
    });
    expect(res2.status).toBe(404);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/distributions/crud.test.ts`
Expected: FAIL — route 模块不存在。

- [ ] **Step 3: 实现 scripts/[id]/distributions/route.ts**

```ts
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

async function ownDraft(id: string) {
  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!draft || draft.userId !== user.id) return null;
  return draft;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { platform?: unknown; url?: unknown; publishedAt?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!platform) return fail('platform 必填', 400);
  if (!/^https?:\/\//.test(url)) return fail('url 必须以 http(s):// 开头', 400);

  const publishedAt =
    typeof body.publishedAt === 'string' && !Number.isNaN(Date.parse(body.publishedAt))
      ? new Date(body.publishedAt)
      : new Date();
  const note = typeof body.note === 'string' ? body.note.trim() || null : null;

  if (!(await ownDraft(id))) return fail('内容不存在', 404);

  try {
    const dist = await prisma.distribution.create({
      data: { scriptDraftId: id, platform, url, publishedAt, note },
      select: { id: true },
    });
    return ok({ id: dist.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST distributions]', e);
    return fail(`登记失败: ${msg}`, 500);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!(await ownDraft(id))) return fail('内容不存在', 404);

  const items = await prisma.distribution.findMany({
    where: { scriptDraftId: id },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, platform: true, url: true, publishedAt: true, note: true },
  });
  return ok({ items: items.map((i) => ({ ...i, publishedAt: i.publishedAt.toISOString() })) });
}
```

- [ ] **Step 4: 实现 distributions/[id]/route.ts**

```ts
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await getOrCreateDefaultUser();
  const dist = await prisma.distribution.findUnique({
    where: { id },
    select: { id: true, scriptDraft: { select: { userId: true } } },
  });
  if (!dist || dist.scriptDraft.userId !== user.id) return fail('分发记录不存在', 404);

  await prisma.distribution.delete({ where: { id } });
  return ok({ id });
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/api/distributions/crud.test.ts`
Expected: 5 passed。

- [ ] **Step 6: Commit**

```bash
git add src/app/api/v1/scripts/\[id\]/distributions src/app/api/v1/distributions tests/api/distributions
git commit -m "feat(workbench): Distribution 分发登记 API"
```

---

### Task 6: 看板聚合 API `/api/v1/workbench`

**Files:**
- Create: `src/lib/pipeline/types.ts`
- Create: `src/app/api/v1/workbench/route.ts`
- Test: `tests/api/workbench/summary.test.ts`

**Interfaces:**
- Consumes: `deriveStage`（Task 2）。
- Produces（Task 7/8 依赖）——`GET /api/v1/workbench` 返回 `WorkbenchData`：

```ts
// src/lib/pipeline/types.ts
import type { PipelineStage } from './stage';

export interface TopicCard {
  id: string; title: string; note: string | null; source: string; createdAt: string;
}
export interface ContentCard {
  id: string;
  kind: 'script' | 'analysis'; // analysis = 孤儿 ContentAnalysis (没链 script 的老数据)
  title: string;
  platform: string;            // script.platform; 孤儿 analysis 固定 'douyin'
  stage: PipelineStage;
  stageSince: string;          // 该阶段起点 ISO (卡片"停留天数"用)
  distributionCount: number;
  distributionPlatforms: string[];
  retroCountdownDays: number | null; // 仅 PUBLISHED: max(0, 3 - 已发天数) 取整; 其他 null
  detailUrl: string;           // script → /content/script/{id}; analysis → /content/preflight/{id}
}
export interface WorkbenchData {
  counts: { pool: number; drafting: number; ready: number; shot: number; published: number; retroed: number };
  topicPool: TopicCard[];
  columns: {
    drafting: ContentCard[]; ready: ContentCard[]; shot: ContentCard[];
    published: ContentCard[]; retroed: ContentCard[];
  };
}
```

- [ ] **Step 1: 写失败测试**

`tests/api/workbench/summary.test.ts`：

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findMany: vi.fn() },
  contentAnalysis: { findMany: vi.fn() },
  topicIdea: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/workbench/route';

const NOW = new Date('2026-08-03T12:00:00Z');

function draft(over: Record<string, unknown>) {
  return {
    id: 'd1', topic: '主题', platform: 'douyin', picked: null, analysisId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'), analysis: null, distributions: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prismaMock.scriptDraft.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.topicIdea.findMany.mockResolvedValue([]);
});

describe('GET /api/v1/workbench', () => {
  it('空数据 → 全零 counts + 空列', async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.counts).toEqual({ pool: 0, drafting: 0, ready: 0, shot: 0, published: 0, retroed: 0 });
    expect(json.data.columns.drafting).toEqual([]);
  });

  it('draft 按 deriveStage 分列, archived 被 where 排除', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({ id: 'a' }),                                            // DRAFTING
      draft({ id: 'b', picked: { titleIdx: 0 } }),                   // READY
      draft({
        id: 'c', picked: {}, analysisId: 'an1',
        analysis: { id: 'an1', publishedAt: null, retroStatus: null, createdAt: new Date('2026-08-02T00:00:00Z') },
      }),                                                            // SHOT
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.counts).toMatchObject({ drafting: 1, ready: 1, shot: 1 });
    expect(json.data.columns.shot[0].detailUrl).toBe('/content/script/c');
    // archivedAt: null 必须在 where 里 (spec §2.1 归档不显示)
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user1', archivedAt: null }),
      }),
    );
  });

  it('PUBLISHED 卡带 retro 倒计时: T+3, 已发 1 天 → 2', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({
        id: 'p', picked: {}, analysisId: 'an2',
        analysis: {
          id: 'an2', publishedAt: new Date('2026-08-02T12:00:00Z'),
          retroStatus: 'SCHEDULED', createdAt: new Date('2026-08-01T00:00:00Z'),
        },
      }),
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.columns.published[0].retroCountdownDays).toBe(2);
  });

  it('孤儿 analysis (没链 script) 也进看板, kind=analysis', async () => {
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      {
        id: 'an3', draftTitle: null, videoFilename: 'v.mp4',
        publishedAt: null, retroStatus: null, createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.counts.shot).toBe(1);
    expect(json.data.columns.shot[0]).toMatchObject({
      kind: 'analysis', title: 'v.mp4', detailUrl: '/content/preflight/an3',
    });
    // 孤儿过滤必须用 fromScripts: { none: {} }
    expect(prismaMock.contentAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user1', fromScripts: { none: {} } }),
      }),
    );
  });

  it('分发记录参与 stage + 徽标字段', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({
        id: 'x', picked: {},
        distributions: [
          { platform: 'bilibili', publishedAt: new Date('2026-08-02T00:00:00Z') },
          { platform: 'youtube', publishedAt: new Date('2026-08-03T00:00:00Z') },
        ],
      }),
    ]);
    const res = await GET();
    const json = await res.json();
    const card = json.data.columns.published[0];
    expect(card.distributionCount).toBe(2);
    expect(card.distributionPlatforms).toEqual(['bilibili', 'youtube']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/workbench/summary.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写 types.ts**

`src/lib/pipeline/types.ts` 按上方 Interfaces 块的内容原样创建。

- [ ] **Step 4: 实现 route.ts**

`src/app/api/v1/workbench/route.ts`：

```ts
import { ok } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { deriveStage, type PipelineStage } from '@/lib/pipeline/stage';
import type { ContentCard, WorkbenchData } from '@/lib/pipeline/types';

/** retro 触发点 = 发布后 3 天, 与 analyses/[id]/publish/route.ts 的 3 * 86400000 同源 */
const RETRO_TARGET_DAYS = 3;
const DAY_MS = 86400000;
const RETROED_TAKE = 10;

function retroCountdown(publishedAt: Date | null): number | null {
  if (!publishedAt) return null;
  const elapsed = (Date.now() - publishedAt.getTime()) / DAY_MS;
  return Math.max(0, Math.ceil(RETRO_TARGET_DAYS - elapsed));
}

export async function GET() {
  const user = await getOrCreateDefaultUser();

  // 一次拼装, 三条查询, 无 per-card 二次查询 (spec §6 N+1 教训)
  const [drafts, orphanAnalyses, pool] = await Promise.all([
    prisma.scriptDraft.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, topic: true, platform: true, picked: true, createdAt: true,
        analysis: {
          select: { id: true, publishedAt: true, retroStatus: true, createdAt: true },
        },
        distributions: { select: { platform: true, publishedAt: true } },
      },
    }),
    prisma.contentAnalysis.findMany({
      where: { userId: user.id, fromScripts: { none: {} } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, draftTitle: true, videoFilename: true,
        publishedAt: true, retroStatus: true, createdAt: true,
      },
    }),
    prisma.topicIdea.findMany({
      where: { userId: user.id, status: 'POOL' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, note: true, source: true, createdAt: true },
    }),
  ]);

  const cards: ContentCard[] = [];

  for (const d of drafts) {
    const analysis = d.analysis
      ? { publishedAt: d.analysis.publishedAt, retroStatus: d.analysis.retroStatus }
      : null;
    const stage = deriveStage({ picked: d.picked, analysis, distributionCount: d.distributions.length });
    const latestDist = d.distributions.reduce<Date | null>(
      (acc, x) => (acc && acc > x.publishedAt ? acc : x.publishedAt),
      null,
    );
    const publishedAt = d.analysis?.publishedAt ?? latestDist;
    const stageSince =
      stage === 'PUBLISHED' || stage === 'RETROED'
        ? publishedAt ?? d.createdAt
        : stage === 'SHOT'
          ? d.analysis?.createdAt ?? d.createdAt
          : d.createdAt;
    cards.push({
      id: d.id,
      kind: 'script',
      title: d.topic,
      platform: d.platform,
      stage,
      stageSince: stageSince.toISOString(),
      distributionCount: d.distributions.length,
      distributionPlatforms: [...new Set(d.distributions.map((x) => x.platform))],
      retroCountdownDays: stage === 'PUBLISHED' ? retroCountdown(publishedAt) : null,
      detailUrl: `/content/script/${d.id}`,
    });
  }

  for (const a of orphanAnalyses) {
    const stage = deriveStage({
      picked: null,
      analysis: { publishedAt: a.publishedAt, retroStatus: a.retroStatus },
      distributionCount: 0,
    });
    cards.push({
      id: a.id,
      kind: 'analysis',
      title: a.draftTitle ?? a.videoFilename,
      platform: 'douyin',
      stage,
      stageSince: (stage === 'PUBLISHED' || stage === 'RETROED' ? a.publishedAt ?? a.createdAt : a.createdAt).toISOString(),
      distributionCount: 0,
      distributionPlatforms: [],
      retroCountdownDays: stage === 'PUBLISHED' ? retroCountdown(a.publishedAt) : null,
      detailUrl: `/content/preflight/${a.id}`,
    });
  }

  const byStage = (s: PipelineStage) => cards.filter((c) => c.stage === s);
  const retroedAll = byStage('RETROED');

  const data: WorkbenchData = {
    counts: {
      pool: pool.length,
      drafting: byStage('DRAFTING').length,
      ready: byStage('READY').length,
      shot: byStage('SHOT').length,
      published: byStage('PUBLISHED').length,
      retroed: retroedAll.length,
    },
    topicPool: pool.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
    columns: {
      drafting: byStage('DRAFTING'),
      ready: byStage('READY'),
      shot: byStage('SHOT'),
      published: byStage('PUBLISHED'),
      retroed: retroedAll.slice(0, RETROED_TAKE), // 只显示最近若干条 (spec §3.2)
    },
  };
  return ok(data);
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/api/workbench/summary.test.ts`
Expected: 5 passed。

- [ ] **Step 6: 全量回归 + Commit**

```bash
npx vitest run
git add src/lib/pipeline/types.ts src/app/api/v1/workbench tests/api/workbench
git commit -m "feat(workbench): 看板聚合 API — 3 查询拼装 + deriveStage 分列"
```

---

## Phase B: 工作台首页 + IA

### Task 7: `/` 工作台页 + 驾驶舱 + sidebar 重组

**Files:**
- Modify: `src/app/page.tsx`（现在是 `redirect('/dashboard')`，整个替换）
- Create: `src/components/workbench/cockpit.tsx`
- Modify: `src/components/layout/sidebar.tsx:21-27`（NAV 数组）、`sidebar.tsx:64`（副标）
- Test: 手动 E2E（项目约定 UI 不写单测）

**Interfaces:**
- Consumes: `GET /api/v1/workbench`（Task 6 的 `WorkbenchData`）、`GET /api/v1/dashboard/summary`（现有，`DashboardSummary.stats.last7dCount` / `stats.retroedCount`，类型在 `src/lib/dashboard/types.ts`）。
- Produces: `/` 页面骨架，含 `<Kanban data={...} onChanged={...} />` 挂载点（Task 8 实现 Kanban；本任务先渲染占位 `<div />`）。`Cockpit` 组件签名：`function Cockpit({ data, summary }: { data: WorkbenchData; summary: DashboardSummary | null })`。

- [ ] **Step 1: sidebar NAV 重组**

`src/components/layout/sidebar.tsx` 的 NAV 改为（`Home` 从 lucide-react 引入；保留 `/accounts`，见 Global Constraints）：

```ts
import { Home, Wand2, Library, BarChart3, Settings, Sparkles, X, Plus, UserCircle } from 'lucide-react';

const NAV = [
  { href: '/', label: '工作台', icon: Home },
  { href: '/agent', label: '创作', icon: Wand2 },
  { href: '/content', label: '内容库', icon: Library },
  { href: '/dashboard', label: '数据', icon: BarChart3 },
  { href: '/accounts', label: '账号', icon: UserCircle },
  { href: '/settings', label: '设置', icon: Settings },
];
```

active 判定改成（避免 `/` 匹配一切）：

```ts
const active = href === '/' ? pathname === '/' : pathname === href || pathname?.startsWith(href + '/');
```

副标 `单用户 MVP` 改为 `自媒体工作台`。

- [ ] **Step 2: 写 Cockpit 组件**

`src/components/workbench/cockpit.tsx`（复用 `next-steps.tsx` 的 Tile 视觉模式）：

```tsx
'use client';

import Link from 'next/link';
import { Lightbulb, FileText, CheckCircle2, Clapperboard, Send, RotateCw, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkbenchData } from '@/lib/pipeline/types';
import type { DashboardSummary } from '@/lib/dashboard/types';

const TILES: { key: keyof WorkbenchData['counts']; label: string; icon: LucideIcon; anchor: string; cls: string }[] = [
  { key: 'pool', label: '选题池', icon: Lightbulb, anchor: '#col-pool', cls: 'bg-yellow-50 border-yellow-200 text-yellow-900' },
  { key: 'drafting', label: '草稿', icon: FileText, anchor: '#col-drafting', cls: 'bg-purple-50 border-purple-200 text-purple-900' },
  { key: 'ready', label: '定稿待拍', icon: CheckCircle2, anchor: '#col-ready', cls: 'bg-green-50 border-green-200 text-green-900' },
  { key: 'shot', label: '已拍待发', icon: Clapperboard, anchor: '#col-shot', cls: 'bg-amber-50 border-amber-200 text-amber-900' },
  { key: 'published', label: '待复盘', icon: Send, anchor: '#col-published', cls: 'bg-blue-50 border-blue-200 text-blue-900' },
  { key: 'retroed', label: '已复盘', icon: RotateCw, anchor: '#col-retroed', cls: 'bg-slate-50 border-slate-200 text-slate-900' },
];

export function Cockpit({ data, summary }: { data: WorkbenchData; summary: DashboardSummary | null }) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">🎛️ 今日驾驶舱</h2>
          <Link
            href="/agent/discover"
            className="flex items-center gap-1.5 rounded-lg bg-brand-gradient px-3 py-1.5 text-sm font-medium text-white shadow-sm"
          >
            <Sparkles className="h-4 w-4" /> 抓灵感
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          {TILES.map(({ key, label, icon: Icon, anchor, cls }) => (
            <a key={key} href={anchor} className={cn('rounded-lg border p-3 transition-colors hover:opacity-80', cls)}>
              <Icon className="h-4 w-4 opacity-70" />
              <div className="mt-1 text-2xl font-bold tabular-nums">{data.counts[key]}</div>
              <div className="text-xs opacity-75">{label}</div>
            </a>
          ))}
        </div>
        {summary && (
          <p className="text-sm text-muted-foreground">
            近 7 天分析 {summary.stats.last7dCount} 条 · 累计复盘 {summary.stats.retroedCount} 条 ·{' '}
            <Link href="/dashboard" className="underline">看完整数据 →</Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: 替换 `/` 页面**

`src/app/page.tsx`：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cockpit } from '@/components/workbench/cockpit';
import type { WorkbenchData } from '@/lib/pipeline/types';
import type { DashboardSummary } from '@/lib/dashboard/types';

export default function WorkbenchPage() {
  const [data, setData] = useState<WorkbenchData | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch('/api/v1/workbench')
      .then((r) => r.json())
      .then((j) => (j.success ? setData(j.data) : setError(j.error ?? '加载失败')))
      .catch(() => setError('加载失败'));
  }, []);

  useEffect(() => {
    reload();
    fetch('/api/v1/dashboard/summary')
      .then((r) => r.json())
      .then((j) => j.success && setSummary(j.data))
      .catch(() => {}); // 摘要失败不阻塞工作台
  }, [reload]);

  if (error) return <p className="p-6 text-sm text-destructive">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">加载中…</p>;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Cockpit data={data} summary={summary} />
      {/* Task 8 在这里挂 <Kanban data={data} onChanged={reload} /> */}
      <div />
    </div>
  );
}
```

注意：现有 `/dashboard/summary` 响应如果不是 `{ success, data }` 包装（先读 `src/app/api/v1/dashboard/summary/route.ts` 确认），按实际结构取值。

- [ ] **Step 4: 手动验证 + build**

```bash
npm run build
```

Expected: build 通过。再 `npm run dev` 打开 `http://localhost:3000/`：驾驶舱六格计数渲染、sidebar 六项、「工作台」高亮、其他页面导航正常。

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/components/workbench/cockpit.tsx src/components/layout/sidebar.tsx
git commit -m "feat(workbench): 工作台首页驾驶舱 + sidebar IA 重组"
```

---

### Task 8: 内容管线看板组件

**Files:**
- Create: `src/components/workbench/kanban.tsx`
- Create: `src/components/workbench/content-card.tsx`
- Modify: `src/app/page.tsx`（挂载 Kanban）
- Test: 手动 E2E

**Interfaces:**
- Consumes: `WorkbenchData` / `ContentCard` / `TopicCard`（Task 6）、`STAGE_LABEL`（Task 2）、`distributionPlatformMeta`（Task 3）。
- Produces: `function Kanban({ data, onChanged }: { data: WorkbenchData; onChanged: () => void })`。选题池列内含 quick-add 输入与「开写/丢弃」操作（Task 9/10 复用 onChanged 刷新）。

- [ ] **Step 1: 写 ContentCardView**

`src/components/workbench/content-card.tsx`：

```tsx
import Link from 'next/link';
import type { ContentCard } from '@/lib/pipeline/types';
import { distributionPlatformMeta } from '@/lib/pipeline/platforms';
import { cn } from '@/lib/utils';

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function ContentCardView({ card }: { card: ContentCard }) {
  const days = daysSince(card.stageSince);
  return (
    <Link
      href={card.detailUrl}
      className="block rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="line-clamp-2 font-medium">{card.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{distributionPlatformMeta(card.platform).label}</span>
        {card.kind === 'analysis' && <span className="rounded bg-muted px-1">视频分析</span>}
        {days > 0 && <span>停留 {days} 天</span>}
        {card.retroCountdownDays != null && (
          <span className="rounded bg-blue-100 px-1 text-blue-900">
            {card.retroCountdownDays === 0 ? '复盘就绪' : `T-${card.retroCountdownDays}d 复盘`}
          </span>
        )}
      </div>
      {card.distributionCount > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.distributionPlatforms.map((p) => {
            const meta = distributionPlatformMeta(p);
            return (
              <span key={p} className={cn('rounded px-1.5 py-0.5 text-[10px]', meta.badgeClass)}>
                {meta.label}
              </span>
            );
          })}
        </div>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: 写 Kanban（六列 + 选题池列）**

`src/components/workbench/kanban.tsx`：

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WorkbenchData, TopicCard } from '@/lib/pipeline/types';
import { ContentCardView } from './content-card';

const COLUMNS = [
  { id: 'col-drafting', key: 'drafting', title: '📝 草稿' },
  { id: 'col-ready', key: 'ready', title: '✅ 定稿待拍' },
  { id: 'col-shot', key: 'shot', title: '🎬 已拍待发' },
  { id: 'col-published', key: 'published', title: '🚀 已发布' },
  { id: 'col-retroed', key: 'retroed', title: '📊 已复盘' },
] as const;

export function Kanban({ data, onChanged }: { data: WorkbenchData; onChanged: () => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      <TopicPoolColumn topics={data.topicPool} onChanged={onChanged} />
      {COLUMNS.map(({ id, key, title }) => (
        <section key={id} id={id} className="w-64 shrink-0 space-y-2">
          <h3 className="text-sm font-semibold">
            {title} <span className="text-muted-foreground">{data.columns[key].length}</span>
          </h3>
          {data.columns[key].length === 0 && (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">空</p>
          )}
          {data.columns[key].map((c) => (
            <ContentCardView key={`${c.kind}-${c.id}`} card={c} />
          ))}
        </section>
      ))}
    </div>
  );
}

function TopicPoolColumn({ topics, onChanged }: { topics: TopicCard[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await fetch('/api/v1/topics', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), source: 'manual' }),
      });
      setTitle('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const discard = async (id: string) => {
    await fetch(`/api/v1/topics/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'DISCARDED' }),
    });
    onChanged();
  };

  return (
    <section id="col-pool" className="w-64 shrink-0 space-y-2">
      <h3 className="text-sm font-semibold">
        💡 选题池 <span className="text-muted-foreground">{topics.length}</span>
      </h3>
      <div className="flex gap-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="快速添加选题…"
          className="w-full rounded-lg border bg-background px-2 py-1.5 text-xs"
        />
        <button onClick={add} disabled={busy} className="rounded-lg border px-2 text-xs">
          +
        </button>
      </div>
      {topics.map((t) => (
        <div key={t.id} className="rounded-lg border bg-card p-3 text-sm shadow-sm">
          <div className="line-clamp-2 font-medium">{t.title}</div>
          {t.note && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.note}</p>}
          <div className="mt-2 flex gap-2 text-xs">
            <Link
              href={`/agent?topic=${encodeURIComponent(t.title)}&ideaId=${t.id}`}
              className="rounded bg-brand-gradient px-2 py-0.5 text-white"
            >
              开写
            </Link>
            <button onClick={() => discard(t.id)} className="text-muted-foreground hover:text-destructive">
              丢弃
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: 挂到首页**

`src/app/page.tsx` 把 Task 7 留的 `<div />` 占位换成：

```tsx
import { Kanban } from '@/components/workbench/kanban';
// ...
<Kanban data={data} onChanged={reload} />
```

- [ ] **Step 4: 手动验证 + build**

```bash
npm run build
```

Expected: 通过。`npm run dev` 验证：六列渲染、驾驶舱格子点击锚点滚到对应列、快速添加选题即时出现、丢弃后消失、卡片点击进详情页。

- [ ] **Step 5: Commit**

```bash
git add src/components/workbench/kanban.tsx src/components/workbench/content-card.tsx src/app/page.tsx
git commit -m "feat(workbench): 六列内容管线看板 + 选题池列"
```

---

## Phase C: 交互流

### Task 9: discover / 灵感推荐「+ 入选题池」

**Files:**
- Modify: `src/app/agent/discover/page.tsx`（每个 topic 卡片加按钮）
- Modify: `src/app/agent/page.tsx:161-174`（灵感推荐 topic 行加按钮）
- Test: 手动 E2E

**Interfaces:**
- Consumes: `POST /api/v1/topics`（Task 4）。409 视为已在池中，按钮置为「已入池」。

- [ ] **Step 1: discover 页 topic 卡加按钮**

在 `src/app/agent/discover/page.tsx` 渲染 `DiscoveredTopic` 卡片的位置（result.topics.map 内）加入池按钮。组件内加状态与处理函数：

```tsx
const [pooled, setPooled] = useState<Record<string, 'done' | 'busy'>>({});

const addToPool = async (t: DiscoveredTopic) => {
  if (pooled[t.title]) return;
  setPooled((s) => ({ ...s, [t.title]: 'busy' }));
  const res = await fetch('/api/v1/topics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: t.title, note: `${t.hookLine}\n${t.rationale}`, source: 'discover' }),
  }).catch(() => null);
  // 409 = 已在池中, 同样标记完成
  setPooled((s) => ({ ...s, [t.title]: res && (res.ok || res.status === 409) ? 'done' : undefined as never }));
};
```

卡片 action 区加：

```tsx
<Button variant="outline" size="sm" onClick={() => addToPool(t)} disabled={!!pooled[t.title]}>
  {pooled[t.title] === 'done' ? '✓ 已入池' : '+ 入选题池'}
</Button>
```

（保留现有「用这个生成」按钮不动。）

- [ ] **Step 2: agent 首页灵感推荐行加同款按钮**

`src/app/agent/page.tsx` 的「💡 最近灵感推荐的 topic」列表项（161-174 行区域）是 server component 还是 client 先确认：若是 server component，把该推荐区块抽成小 client 组件 `src/components/workbench/pool-button.tsx`：

```tsx
'use client';

import { useState } from 'react';

export function PoolButton({ title, source }: { title: string; source: 'discover' | 'inspiration' }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const add = async () => {
    if (state !== 'idle') return;
    setState('busy');
    const res = await fetch('/api/v1/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, source }),
    }).catch(() => null);
    setState(res && (res.ok || res.status === 409) ? 'done' : 'idle');
  };
  return (
    <button onClick={add} disabled={state !== 'idle'} className="text-xs text-muted-foreground underline hover:text-foreground">
      {state === 'done' ? '✓ 已入池' : '+ 入池'}
    </button>
  );
}
```

discover 页也可直接复用此组件（note 参数可选扩展），两处 UI 一致。

- [ ] **Step 3: 手动验证 + Commit**

`npm run dev`：discover 生成选题 → 点入池 → 回 `/` 看板选题池列出现；重复点同一选题 → 显示已入池不重复。

```bash
git add src/app/agent/discover/page.tsx src/app/agent/page.tsx src/components/workbench/pool-button.tsx
git commit -m "feat(workbench): discover/灵感推荐一键入选题池"
```

---

### Task 10: 选题「开写」→ 生成 → 自动 ADOPTED

**Files:**
- Modify: `src/components/content/script-form.tsx`（读 `?ideaId=`，传给 ScriptResult）
- Modify: `src/components/content/script-result.tsx:357-375`（handleSave 成功后 PATCH 选题）
- Test: 手动 E2E

**Interfaces:**
- Consumes: `PATCH /api/v1/topics/[id]`（Task 4）；看板「开写」链接 `/agent?topic=X&ideaId=Y`（Task 8 已产出）。
- Produces: `ScriptResult` Props 新增 `ideaId?: string`。

- [ ] **Step 1: script-form 读 ideaId 并透传**

`src/components/content/script-form.tsx`：prefill useEffect 区（55-62 行附近）已读 `searchParams`，加：

```ts
const ideaId = searchParams.get('ideaId') ?? undefined;
```

渲染 `<ScriptResult ... />`（268 行附近）加 `ideaId={ideaId}`。

- [ ] **Step 2: script-result 保存成功后标记采纳**

`src/components/content/script-result.tsx`：Props 加 `ideaId?: string`；`handleSave`（362 行）成功分支、`router.push` 之前加：

```ts
if (ideaId) {
  // 选题采纳登记失败不阻塞保存流程
  await fetch(`/api/v1/topics/${ideaId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'ADOPTED', scriptDraftId: json.data.id }),
  }).catch(() => {});
}
```

- [ ] **Step 3: 手动验证 + Commit**

`npm run dev`：看板选题「开写」→ agent 页 topic 已预填 → 生成 → 保存 → 回 `/`：该选题从选题池列消失，草稿列出现新卡。

```bash
git add src/components/content/script-form.tsx src/components/content/script-result.tsx
git commit -m "feat(workbench): 选题开写闭环 — 保存脚本自动标记 ADOPTED"
```

---

### Task 11: 分发登记弹窗 + 详情页入口

**Files:**
- Create: `src/components/workbench/distribution-modal.tsx`
- Modify: `src/components/workbench/content-card.tsx`（kind='script' 且 stage 为 SHOT/PUBLISHED/RETROED 的卡加「+ 分发」按钮）
- Modify: `src/app/content/script/[id]/page.tsx`（详情页加分发区块：列表 + 登记 + 删除）
- Test: 手动 E2E

**Interfaces:**
- Consumes: `POST/GET /api/v1/scripts/[id]/distributions`、`DELETE /api/v1/distributions/[id]`（Task 5）、`DISTRIBUTION_PLATFORMS`（Task 3）。
- Produces: `function DistributionModal({ scriptId, onDone, onClose }: { scriptId: string; onDone: () => void; onClose: () => void })`。

- [ ] **Step 1: 写 DistributionModal**

`src/components/workbench/distribution-modal.tsx`：

```tsx
'use client';

import { useState } from 'react';
import { DISTRIBUTION_PLATFORMS } from '@/lib/pipeline/platforms';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DistributionModal({
  scriptId, onDone, onClose,
}: { scriptId: string; onDone: () => void; onClose: () => void }) {
  const [platform, setPlatform] = useState(DISTRIBUTION_PLATFORMS[1].key); // 默认 bilibili
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!/^https?:\/\//.test(url.trim())) {
      setError('链接必须以 http(s):// 开头');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/scripts/${scriptId}/distributions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, url: url.trim() }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      onDone();
      onClose();
    } else {
      const j = await res?.json().catch(() => null);
      setError(j?.error ?? '登记失败');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">登记分发</h3>
        <div className="flex flex-wrap gap-2">
          {DISTRIBUTION_PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatform(p.key)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm',
                platform === p.key ? 'border-transparent bg-brand-gradient text-white' : 'hover:bg-accent',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="粘贴发布链接 https://…"
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button variant="brand" size="sm" onClick={submit} disabled={busy}>登记</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 看板卡加「+ 分发」**

`content-card.tsx` 改为 client 组件（文件头加 `'use client'`），Props 扩为 `{ card, onChanged }: { card: ContentCard; onChanged?: () => void }`（Kanban 调用处传 `onChanged`）。卡片底部加（仅 `card.kind === 'script'` 且 `['SHOT','PUBLISHED','RETROED'].includes(card.stage)`）：

```tsx
const [modalOpen, setModalOpen] = useState(false);
// Link 外层改 div, 标题区保留 Link 跳详情; action 行:
<button
  onClick={() => setModalOpen(true)}
  className="mt-1.5 text-xs text-muted-foreground underline hover:text-foreground"
>
  + 登记分发
</button>
{modalOpen && (
  <DistributionModal scriptId={card.id} onDone={() => onChanged?.()} onClose={() => setModalOpen(false)} />
)}
```

注意：原来整卡是 `<Link>`，按钮嵌套在 Link 内会触发跳转——把外层换成 `<div>`，标题单独包 `<Link href={card.detailUrl}>`。

- [ ] **Step 3: script 详情页分发区块**

先读 `src/app/content/script/[id]/page.tsx` 现有结构。若是 server component 包 client 组件，则在 client 部分（`ScriptResult` readonly 模式渲染处）追加一个分发区块组件 `src/components/workbench/distribution-section.tsx`：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { distributionPlatformMeta } from '@/lib/pipeline/platforms';
import { DistributionModal } from './distribution-modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Item { id: string; platform: string; url: string; publishedAt: string; note: string | null }

export function DistributionSection({ scriptId }: { scriptId: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  const reload = useCallback(() => {
    fetch(`/api/v1/scripts/${scriptId}/distributions`)
      .then((r) => r.json())
      .then((j) => j.success && setItems(j.data.items))
      .catch(() => {});
  }, [scriptId]);

  useEffect(reload, [reload]);

  const remove = async (id: string) => {
    await fetch(`/api/v1/distributions/${id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">📤 分发记录 ({items.length})</h3>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>+ 登记分发</Button>
      </div>
      {items.length === 0 && <p className="text-sm text-muted-foreground">还没登记分发。发到其他平台后把链接记在这里。</p>}
      {items.map((i) => {
        const meta = distributionPlatformMeta(i.platform);
        return (
          <div key={i.id} className="flex items-center gap-2 text-sm">
            <span className={cn('rounded px-1.5 py-0.5 text-xs', meta.badgeClass)}>{meta.label}</span>
            <a href={i.url} target="_blank" rel="noreferrer" className="flex-1 truncate underline">{i.url}</a>
            <span className="text-xs text-muted-foreground">{new Date(i.publishedAt).toLocaleDateString('zh-CN')}</span>
            <button onClick={() => remove(i.id)} className="text-xs text-muted-foreground hover:text-destructive">删除</button>
          </div>
        );
      })}
      {open && <DistributionModal scriptId={scriptId} onDone={reload} onClose={() => setOpen(false)} />}
    </section>
  );
}
```

挂到 script 详情页面主内容下方。

- [ ] **Step 4: 手动验证 + Commit**

`npm run dev`：详情页登记 B站 链接 → 区块出现记录；回 `/` 该卡进已发布列并带 B站 徽标；删除记录 → 卡退回原列。

```bash
git add src/components/workbench/distribution-modal.tsx src/components/workbench/distribution-section.tsx src/components/workbench/content-card.tsx src/components/workbench/kanban.tsx src/app/content/script/\[id\]/page.tsx
git commit -m "feat(workbench): 分发登记弹窗 + 详情页分发区块 + 卡片徽标"
```

---

## Phase D: 收尾

### Task 12: 引导压缩 + 文档更新

**Files:**
- Modify: `src/app/agent/page.tsx`（面向小白的教学引导压缩成一行说明；灵感推荐区保留）
- Modify: `README.md`（定位、IA、新模型、工作台说明）
- Test: `npm run build` + 手动过一遍主流程

- [ ] **Step 1: agent 页引导压缩**

`src/app/agent/page.tsx` 顶部「选平台 → 选垂类 → 输 topic...」三步教学卡（75-95 行区域）压缩为单行副标题（自用工作台不需要教学）；`has_seen_discover` cookie 逻辑与「第一次来」引导若仍存在，一并移除。

- [ ] **Step 2: README 更新**

- 顶部简介改为工作台定位（自用 + 保留扩展），链接 spec。
- 「新 IA 提案」章节改为「当前 IA」：6 项 sidebar + `/` 工作台说明。
- 数据模型段落加 TopicIdea / Distribution / archivedAt、阶段派生规则表（从 spec §2.1 复制）。
- Roadmap 已完成部分打勾。

- [ ] **Step 3: 全量回归 + Commit**

```bash
npx vitest run
npm run build
git add src/app/agent/page.tsx README.md
git commit -m "docs(workbench): README 对齐工作台定位 + agent 页引导压缩"
```

---

## Self-Review 记录

- Spec 覆盖：§2.1→Task 1/2/6，§2.2→Task 1/4，§2.3→Task 1/5，§2.4→Task 3，§3.1→Task 7，§3.2→Task 7/8，§4.1→Task 8/9/10，§4.2→Task 11，§4.3→Task 6/8（倒计时），§5→Phase A-D 对应，§6→各 API 校验 + workbench 3 查询，§7→Task 2/3/4/5/6 测试。
- 已知偏离：sidebar 6 项（多保留 /accounts），原因见 Global Constraints。
- 类型一致性：`deriveStage`/`StageInput`/`PipelineStage`（Task 2）与 Task 6 route、Task 8 组件引用一致；`WorkbenchData`/`ContentCard`（Task 6）与 Task 7/8/11 一致；`distributionPlatformMeta`（Task 3）与 Task 8/11 一致。
- 执行注意：Task 7 Step 3 与 Task 11 Step 3 各有一处「先读现有文件确认结构再动」的显式指令，不是占位符，是防止对没读过的文件下手。
