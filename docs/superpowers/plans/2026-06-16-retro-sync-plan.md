# Retro Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消用户手动粘抖音 URL — 加 `/content/retro-sync` 页, 一键刷新 + 一键匹配 + 立即跑 retro。

**Architecture:** 1 个 list adapter (复用现有 readAdapterEnv 模式) + 2 个新 API (GET list / POST match) + 1 个 RSC 页 + 1 个 client 表组件 + 1 处 Dashboard 入口。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + vitest + BullMQ + Python subprocess (existing pattern)

**Spec:** `docs/superpowers/specs/2026-06-16-retro-sync-design.md`

**Scope** (不在本计划):
- 自动定时拉取 (留 v3)
- draftTitle fuzzy auto-match (留 v3)
- 多账号 (默认 default-user)

---

## File Structure

```
新建:
src/lib/douyin/list.ts                                                  # parseListOutput + runDouyinListAdapter
src/app/api/v1/douyin/list/route.ts                                     # GET endpoint
src/app/api/v1/content/analyses/[id]/match-douyin/route.ts              # POST endpoint
src/app/content/retro-sync/page.tsx                                     # RSC: 列 unmatched analyses
src/components/content/retro-sync-table.tsx                             # client: 刷新 + 表 + dropdown 匹配
tests/lib/douyin/list-parser.test.ts                                    # parseListOutput TDD (6 tests)
tests/api/douyin/list.test.ts                                           # GET list (2 tests)
tests/api/match-douyin.test.ts                                          # POST match (5 tests)

修改:
src/app/dashboard/page.tsx                                              # 加 "抖音同步 →" Link 在 h1 右侧
```

---

## Test Strategy

- **纯函数 `parseListOutput`** 6 个 vitest case (TDD)
- **API GET list** 2 case (mock subprocess success + reject)
- **API POST match** 5 case (valid / 404 / 409 dup analysis / 400 bad awemeId / 409 dup awemeId across analyses)
- **UI** 不写单测, 走手动 E2E

---

## Git

每 task 末尾 commit。 前缀: `feat(retro-sync): ...` / `fix(retro-sync): ...`。

---

## Task 1: `parseListOutput` 纯函数 (TDD)

**Files:**
- Create: `src/lib/douyin/list.ts` (only parseListOutput in this task; adapter func added in Task 2)
- Create: `tests/lib/douyin/list-parser.test.ts`

- [ ] **Step 1.1: 写失败测试**

Write `tests/lib/douyin/list-parser.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseListOutput } from '@/lib/douyin/list';

describe('parseListOutput', () => {
  it('标准 3 行 → 3 items', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放8.5w  ChatGPT 5 个技巧
[1] 7234567890123456788  2026-06-09 12:15  播放3.2k  AI 工具排行
[2] 7234567890123456787  2026-06-08 09:00  播放123  hello world`;
    const items = parseListOutput(stdout);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      awemeId: '7234567890123456789',
      postedAt: '2026-06-10 14:30',
      plays: '8.5w',
      desc: 'ChatGPT 5 个技巧',
    });
    expect(items[2].plays).toBe('123');
  });

  it('空输出 → []', () => {
    expect(parseListOutput('')).toEqual([]);
  });

  it('异常行 (无 "播放" 字段) 跳过', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  desc-good
some random log line
[1] BROKEN no time field
[2] 7234567890123456788  2026-06-09 12:15  播放200  desc-good-2`;
    const items = parseListOutput(stdout);
    expect(items).toHaveLength(2);
    expect(items[0].awemeId).toBe('7234567890123456789');
    expect(items[1].awemeId).toBe('7234567890123456788');
  });

  it('desc 含 | 和 中文标点 保留', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放8.5w  视频 | 副标题: 你好,世界。`;
    const items = parseListOutput(stdout);
    expect(items[0].desc).toBe('视频 | 副标题: 你好,世界。');
  });

  it('aweme_id 19 位数字 (典型抖音长度)', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  x`;
    expect(parseListOutput(stdout)[0].awemeId).toBe('7234567890123456789');
  });

  it('desc 末尾空白被 trim', () => {
    const stdout = `[0] 7234567890123456789  2026-06-10 14:30  播放100  hello   \n`;
    expect(parseListOutput(stdout)[0].desc).toBe('hello');
  });
});
```

- [ ] **Step 1.2: 跑测试 (FAIL)**

```bash
npm test -- list-parser
```

Expected: FAIL (module not found).

- [ ] **Step 1.3: 实现 parseListOutput**

Write `src/lib/douyin/list.ts`:

```typescript
export interface DouyinListItem {
  awemeId: string;
  postedAt: string;
  plays: string;
  desc: string;
}

const LINE_RE = /^\[\d+\]\s+(\S+)\s+(\S+\s\S+)\s+播放(\S+)\s+(.*)$/;

export function parseListOutput(stdout: string): DouyinListItem[] {
  return stdout
    .split('\n')
    .map((line) => line.match(LINE_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({
      awemeId: m[1],
      postedAt: m[2],
      plays: m[3],
      desc: m[4].trim(),
    }));
}
```

- [ ] **Step 1.4: 跑测试 (PASS)**

```bash
npm test -- list-parser
```

Expected: PASS (6 tests).

- [ ] **Step 1.5: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/douyin/list.ts tests/lib/douyin/list-parser.test.ts
git commit -m "feat(retro-sync): parseListOutput pure function for review.py list output"
```

---

## Task 2: `runDouyinListAdapter` (Python 子进程包装)

**Files:**
- Modify: `src/lib/douyin/list.ts` (append `runDouyinListAdapter`)

- [ ] **Step 2.1: 修改 list.ts**

打开 `src/lib/douyin/list.ts`. 在文件顶部加 imports + 把 `readAdapterEnv` 内联(或从 adapter.ts 导出复用 — 此处选 inline 因 adapter.ts 没 export 它):

在文件顶部添加 imports:

```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

interface AdapterEnv {
  adapterPath: string;
  contentDir: string;
  pythonBin: string;
}

function readAdapterEnv(): AdapterEnv {
  const adapterPath = process.env.CHEAT_ADAPTER_PATH;
  const contentDir = process.env.CHEAT_CONTENT_PROJECT_DIR;
  if (!adapterPath || !contentDir) {
    throw new Error('CHEAT_ADAPTER_PATH 或 CHEAT_CONTENT_PROJECT_DIR 未配置');
  }
  return {
    adapterPath,
    contentDir,
    pythonBin: process.env.PYTHON_BIN || 'python3',
  };
}
```

在文件末尾 (parseListOutput 之后) 加 `runDouyinListAdapter`:

```typescript
export async function runDouyinListAdapter(): Promise<DouyinListItem[]> {
  const env = readAdapterEnv();
  const { stdout } = await execFileAsync(
    env.pythonBin,
    [path.join(env.adapterPath, 'review.py'), 'list'],
    {
      cwd: env.adapterPath,
      env: { ...process.env, PYTHONPATH: env.contentDir },
      timeout: 60_000,
    }
  );
  return parseListOutput(stdout);
}
```

- [ ] **Step 2.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/douyin/list.ts
git commit -m "feat(retro-sync): runDouyinListAdapter — Python subprocess wrapper for review.py list"
```

---

## Task 3: `GET /api/v1/douyin/list` endpoint

**Files:**
- Create: `src/app/api/v1/douyin/list/route.ts`
- Create: `tests/api/douyin/list.test.ts`

- [ ] **Step 3.1: 写失败测试**

Write `tests/api/douyin/list.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/douyin/list', () => ({
  runDouyinListAdapter: vi.fn(),
}));

import { GET } from '@/app/api/v1/douyin/list/route';
import { runDouyinListAdapter } from '@/lib/douyin/list';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/douyin/list', () => {
  it('成功 → 200 + items 数组', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890123456789', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'x' },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].awemeId).toBe('7234567890123456789');
  });

  it('adapter 抛错 → 500 + 友好 message', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('cookie expired'));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/cookie expired|抖音列表拉取失败|登录/);
  });
});
```

- [ ] **Step 3.2: 跑测试 (FAIL)**

```bash
npm test -- douyin/list
```

Expected: FAIL (module not found).

- [ ] **Step 3.3: 实现 route**

Write `src/app/api/v1/douyin/list/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { runDouyinListAdapter } from '@/lib/douyin/list';

export async function GET() {
  try {
    const items = await runDouyinListAdapter();
    return ok(items);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[GET douyin/list] failed', e);
    return fail(`抖音列表拉取失败: ${msg}. 请检查 cheat-on-content 是否登录。`, 500);
  }
}
```

- [ ] **Step 3.4: 跑测试 (PASS)**

```bash
npm test -- douyin/list
```

Expected: PASS (2 tests).

- [ ] **Step 3.5: Commit**

```bash
git add src/app/api/v1/douyin/list/route.ts tests/api/douyin/list.test.ts
git commit -m "feat(retro-sync): GET /api/v1/douyin/list — invoke adapter, return parsed items"
```

---

## Task 4: `POST /api/v1/content/analyses/[id]/match-douyin` endpoint

**Files:**
- Create: `src/app/api/v1/content/analyses/[id]/match-douyin/route.ts`
- Create: `tests/api/match-douyin.test.ts`

- [ ] **Step 4.1: 写失败测试**

Write `tests/api/match-douyin.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({
  QUEUES: { ANALYZE: 'analyze', RETRO: 'retro' },
  retroQueue: queueMock,
}));

import { POST } from '@/app/api/v1/content/analyses/[id]/match-douyin/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/content/analyses/abc/match-douyin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({
    id: 'abc',
    userId: 'user1',
    douyinAwemeId: null,
  });
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
  prismaMock.contentAnalysis.update.mockResolvedValue({});
  queueMock.add.mockResolvedValue({});
});

describe('POST match-douyin', () => {
  const ctx = { params: Promise.resolve({ id: 'abc' }) };

  it('valid match → 200, prisma.update 调用 + retroQueue.add 调用', async () => {
    const res = await POST(
      makeReq({ awemeId: '7234567890123456789', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'test' }),
      ctx,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.retroEnqueued).toBe(true);
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'abc' },
        data: expect.objectContaining({
          douyinAwemeId: '7234567890123456789',
          douyinUrl: 'https://www.douyin.com/video/7234567890123456789',
          retroStatus: 'SCHEDULED',
        }),
      }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'retro',
      { analysisId: 'abc' },
      expect.objectContaining({ delay: 0 }),
    );
  });

  it('analysis 不存在 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(404);
  });

  it('analysis 已有 douyinAwemeId → 409', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({
      id: 'abc',
      userId: 'user1',
      douyinAwemeId: '7000000000000000000',
    });
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(409);
  });

  it('awemeId 非法 (< 8 位) → 400', async () => {
    const res = await POST(makeReq({ awemeId: '123', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(400);
  });

  it('其他 analysis 已用此 awemeId → 409', async () => {
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({
      id: 'other-analysis',
    });
    const res = await POST(makeReq({ awemeId: '7234567890123456789', postedAt: '', plays: '0', desc: '' }), ctx);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 4.2: 跑测试 (FAIL)**

```bash
npm test -- match-douyin
```

Expected: FAIL.

- [ ] **Step 4.3: 检查 retroQueue export**

```bash
grep -n "retroQueue\|export const" src/jobs/queue.ts | head -10
```

Verify `retroQueue` is exported from `@/jobs/queue`. If not exported, this task BLOCKS — report and ask for plan adjustment. The test mocks it as if it's there.

- [ ] **Step 4.4: 实现 route**

Write `src/app/api/v1/content/analyses/[id]/match-douyin/route.ts`:

```typescript
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { retroQueue } from '@/jobs/queue';

const AWEME_RE = /^\d{8,30}$/;

function parseLooseTime(input: string): Date | null {
  if (!input) return null;
  // "2026-06-10 14:30" → "2026-06-10T14:30:00"
  const iso = input.replace(' ', 'T') + ':00';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: { awemeId?: unknown; postedAt?: unknown; plays?: unknown; desc?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const awemeId = typeof body.awemeId === 'string' ? body.awemeId.trim() : '';
  if (!AWEME_RE.test(awemeId)) {
    return fail('awemeId 必须是 8-30 位数字', 400);
  }

  const user = await getOrCreateDefaultUser();
  const analysis = await prisma.contentAnalysis.findUnique({
    where: { id },
    select: { id: true, userId: true, douyinAwemeId: true },
  });
  if (!analysis || analysis.userId !== user.id) {
    return fail('分析不存在', 404);
  }
  if (analysis.douyinAwemeId) {
    return fail('该分析已匹配过抖音视频', 409);
  }

  const existing = await prisma.contentAnalysis.findFirst({
    where: { userId: user.id, douyinAwemeId: awemeId },
    select: { id: true },
  });
  if (existing) {
    return fail(`该抖音视频已被另一分析匹配: ${existing.id}`, 409);
  }

  const postedAt = typeof body.postedAt === 'string' ? body.postedAt : '';
  const publishedAt = parseLooseTime(postedAt) ?? new Date();

  try {
    await prisma.contentAnalysis.update({
      where: { id },
      data: {
        douyinAwemeId: awemeId,
        douyinUrl: `https://www.douyin.com/video/${awemeId}`,
        publishedAt,
        retroStatus: 'SCHEDULED',
      },
    });
    await retroQueue.add(
      'retro',
      { analysisId: id },
      { jobId: `retro-${id}`, delay: 0, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600, count: 100 } },
    );
    return ok({ retroEnqueued: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST match-douyin]', e);
    return fail(`匹配失败: ${msg}`, 500);
  }
}
```

- [ ] **Step 4.5: 跑测试 (PASS)**

```bash
npm test -- match-douyin
```

Expected: PASS (5 tests).

- [ ] **Step 4.6: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4.7: Commit**

```bash
git add src/app/api/v1/content/analyses/[id]/match-douyin/route.ts tests/api/match-douyin.test.ts
git commit -m "feat(retro-sync): POST match-douyin — write awemeId + enqueue immediate retro"
```

---

## Task 5: `<RetroSyncTable>` client component

**Files:**
- Create: `src/components/content/retro-sync-table.tsx`

- [ ] **Step 5.1: 实现**

Write `src/components/content/retro-sync-table.tsx`:

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface DouyinListItem {
  awemeId: string;
  postedAt: string;
  plays: string;
  desc: string;
}

interface UnmatchedAnalysis {
  id: string;
  videoFilename: string;
  draftTitle: string | null;
  createdAt: string;
}

export function RetroSyncTable({ unmatched }: { unmatched: UnmatchedAnalysis[] }) {
  const router = useRouter();
  const [items, setItems] = useState<DouyinListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, { selectedAnalysisId: string; status: 'idle' | 'matching' | 'done' | 'error'; error?: string }>>({});

  const handleRefresh = async () => {
    setLoading(true);
    setBannerError(null);
    try {
      const res = await fetch('/api/v1/douyin/list');
      const json = await res.json();
      if (!json.success) {
        setBannerError(json.message);
      } else {
        setItems(json.data);
        setLastFetchAt(new Date().toLocaleString());
      }
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleMatch = async (awemeId: string, item: DouyinListItem) => {
    const state = rowState[awemeId];
    const analysisId = state?.selectedAnalysisId ?? unmatched[0]?.id;
    if (!analysisId) return;
    setRowState((s) => ({ ...s, [awemeId]: { selectedAnalysisId: analysisId, status: 'matching' } }));
    try {
      const res = await fetch(`/api/v1/content/analyses/${analysisId}/match-douyin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ awemeId, postedAt: item.postedAt, plays: item.plays, desc: item.desc }),
      });
      const json = await res.json();
      if (!json.success) {
        setRowState((s) => ({ ...s, [awemeId]: { selectedAnalysisId: analysisId, status: 'error', error: json.message } }));
      } else {
        setRowState((s) => ({ ...s, [awemeId]: { selectedAnalysisId: analysisId, status: 'done' } }));
        router.refresh();
      }
    } catch (e) {
      setRowState((s) => ({
        ...s,
        [awemeId]: {
          selectedAnalysisId: analysisId,
          status: 'error',
          error: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  };

  if (unmatched.length === 0 && !items) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm">无未匹配的分析。</p>
          <p className="text-xs text-muted-foreground">
            所有 COMPLETED 分析都已匹配抖音视频, 无需同步。 上传新分析后再来。
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button onClick={handleRefresh} disabled={loading}>
          {loading ? '加载中...' : '🔄 刷新抖音列表'}
        </Button>
        {lastFetchAt && (
          <div className="text-xs text-muted-foreground">
            最后刷新: {lastFetchAt} · {items?.length ?? 0} 条
          </div>
        )}
      </div>

      {bannerError && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          抖音列表拉取失败: {bannerError}
        </div>
      )}

      {items === null && !bannerError && (
        <p className="text-sm text-muted-foreground">点 &ldquo;刷新抖音列表&rdquo; 拉取近期 20 条视频。</p>
      )}

      {items?.length === 0 && (
        <p className="text-sm text-muted-foreground">无最近视频。</p>
      )}

      {items && items.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left">aweme</th>
                  <th className="py-2 text-left">发布</th>
                  <th className="py-2 text-right">播放</th>
                  <th className="py-2 text-left">描述</th>
                  <th className="py-2 text-left">匹配</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const state = rowState[item.awemeId] ?? { selectedAnalysisId: unmatched[0]?.id ?? '', status: 'idle' };
                  return (
                    <tr key={item.awemeId} className="border-b align-top">
                      <td className="py-2 font-mono text-xs">{item.awemeId.slice(0, 10)}...</td>
                      <td className="py-2 text-xs">{item.postedAt}</td>
                      <td className="py-2 text-right tabular-nums">{item.plays}</td>
                      <td className="py-2 max-w-xs truncate">{item.desc || '—'}</td>
                      <td className="py-2 space-y-1">
                        {state.status === 'done' ? (
                          <Link href={`/content/preflight/${state.selectedAnalysisId}`} className="text-xs text-green-700 hover:underline">
                            ✓ 已匹配并复盘中 →
                          </Link>
                        ) : unmatched.length === 0 ? (
                          <span className="text-xs text-muted-foreground">无未匹配分析</span>
                        ) : (
                          <>
                            <select
                              value={state.selectedAnalysisId}
                              onChange={(e) =>
                                setRowState((s) => ({
                                  ...s,
                                  [item.awemeId]: { ...state, selectedAnalysisId: e.target.value },
                                }))
                              }
                              className="w-full rounded border border-border bg-background p-1 text-xs"
                              disabled={state.status === 'matching'}
                            >
                              {unmatched.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.videoFilename}{a.draftTitle ? ` · ${a.draftTitle.slice(0, 20)}` : ''}
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              onClick={() => handleMatch(item.awemeId, item)}
                              disabled={state.status === 'matching'}
                              className="w-full"
                            >
                              {state.status === 'matching' ? '匹配中...' : '匹配并复盘 →'}
                            </Button>
                            {state.error && (
                              <p className={cn('text-xs', state.error.includes('已') ? 'text-amber-700' : 'text-destructive')}>
                                {state.error}
                              </p>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 5.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/content/retro-sync-table.tsx
git commit -m "feat(retro-sync): RetroSyncTable client component (refresh + match dropdown)"
```

---

## Task 6: `/content/retro-sync` RSC page

**Files:**
- Create: `src/app/content/retro-sync/page.tsx`

- [ ] **Step 6.1: 实现**

Write `src/app/content/retro-sync/page.tsx`:

```typescript
import { prisma } from '@/lib/prisma';
import { getOrCreateDefaultUser } from '@/lib/user';
import { RetroSyncTable } from '@/components/content/retro-sync-table';

export default async function RetroSyncPage() {
  const user = await getOrCreateDefaultUser();
  const unmatched = await prisma.contentAnalysis.findMany({
    where: {
      userId: user.id,
      status: 'COMPLETED',
      OR: [{ douyinAwemeId: null }, { retroStatus: null }],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, videoFilename: true, draftTitle: true, createdAt: true },
    take: 50,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">抖音同步</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          把发布的抖音视频对应到 MediaPilot 分析, 立即跑复盘。
        </p>
      </div>
      <RetroSyncTable
        unmatched={unmatched.map((a) => ({
          id: a.id,
          videoFilename: a.videoFilename,
          draftTitle: a.draftTitle,
          createdAt: a.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
```

- [ ] **Step 6.2: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/app/content/retro-sync/page.tsx
git commit -m "feat(retro-sync): /content/retro-sync RSC page"
```

---

## Task 7: Dashboard 加入口

**Files:**
- Modify: `src/app/dashboard/page.tsx`

- [ ] **Step 7.1: 修改**

打开 `src/app/dashboard/page.tsx`。 找到现有 `<h1 className="text-2xl font-semibold">数据总览</h1>` 行。

把这部分:

```typescript
      <h1 className="text-2xl font-semibold">数据总览</h1>
```

替换为(主流程那个,**不是** empty state 分支里的):

```typescript
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">数据总览</h1>
        <Link href="/content/retro-sync">
          <Button size="sm" variant="outline">抖音同步 →</Button>
        </Link>
      </div>
```

在文件顶部 imports 区添加(如果尚未有):

```typescript
import Link from 'next/link';
import { Button } from '@/components/ui/button';
```

- [ ] **Step 7.2: typecheck + tests**

```bash
npm run typecheck && npm test
```

Expected: 0 errors, all tests pass.

- [ ] **Step 7.3: Commit**

```bash
git add src/app/dashboard/page.tsx
git commit -m "feat(retro-sync): Dashboard 抖音同步 → entry button"
```

---

## Task 8: 手动 E2E

**No code changes.**

- [ ] **Step 8.1: 入口可见**

打开 `http://localhost:3000/dashboard`,顶部 h1 右侧出现 [抖音同步 →] 按钮。

- [ ] **Step 8.2: 页面渲染**

点 [抖音同步 →] 跳到 `/content/retro-sync`,看到:
- 标题 "抖音同步"
- 描述行
- "🔄 刷新抖音列表" 按钮
- 提示行 "点 '刷新抖音列表' 拉取近期 20 条视频。"

- [ ] **Step 8.3: 刷新成功路径** (前提: cheat-on-content 已登录)

点 [刷新抖音列表] → 等 5-30 秒 → 表格显示近期视频。 每行有 dropdown (列出所有 unmatched analysis,默认第 1 个) + [匹配并复盘 →] 按钮。

- [ ] **Step 8.4: 匹配验证**

选某行,选某 analysis,点 [匹配并复盘 →]:
- 按钮变 "匹配中..."
- 成功后变 "✓ 已匹配并复盘中 →"
- 点链接跳报告页, 应看到 retroStatus='SCHEDULED' 或 'RUNNING' 状态
- 等 30-90 秒, retroStatus 变 'COMPLETED', 报告页底出现 retro 内容

SQL 验:
```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
SELECT id, \"douyinAwemeId\", \"retroStatus\", \"retroCompletedAt\" FROM \"ContentAnalysis\" WHERE \"douyinAwemeId\" IS NOT NULL ORDER BY \"updatedAt\" DESC LIMIT 5;"
```

- [ ] **Step 8.5: Cookie 失效路径** (可选,需要先有效再删 .auth)

```bash
rm -rf /Users/lizhishaoniange/cheat-on-content/adapters/perf-data/douyin-session/.auth
```

回页面点 [刷新抖音列表] → 红色 banner 显示 "抖音列表拉取失败: ...请检查 cheat-on-content 是否登录"。

恢复:
```bash
# 用户在 cheat-on-content 项目目录跑:
# python adapters/perf-data/douyin-session/review.py login
```

- [ ] **Step 8.6: 重复匹配 (409)**

回到 `/content/retro-sync`, 点刷新, 选同一个 aweme 试图匹配第二次 (选另一个 analysis):
- 按钮变 "匹配中..." → 立即变红/黄色 error inline: "该抖音视频已被另一分析匹配: ..." 

- [ ] **Step 8.7: 跑全测试**

```bash
npm run typecheck && npm test
```

Expected: 0 errors, all tests pass (186 + 6 + 2 + 5 = 199 总数).

- [ ] **Step 8.8: Commit (如需要)**

```bash
git status
# 如有清理
git add -A && git commit -m "chore(retro-sync): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1-7 commit 完整
- ✅ Task 8 E2E 4 个核心场景通过
- ✅ `npm run typecheck` 0 错, `npm test` 全绿
- ✅ 浏览器 `/content/retro-sync` 渲染 + 刷新 + 匹配 + 立即跑 retro 端到端工作

→ Sub-project C 完成。 v2 (A + B + C) 全部 shipped。

---

## 自审记录

**Spec 覆盖**:
- §1 goal/scope → Task 1-7 全覆盖
- §2 architecture → 各 Task 实现对应层
- §3 data model (无 schema 变更) → 无需 task
- §4 list 输出解析 → Task 1 (parser TDD) + Task 2 (subprocess wrapper)
- §5 API → Task 3 (list GET) + Task 4 (match POST)
- §6 UI → Task 5 (client component) + Task 6 (RSC page) + Task 7 (entry point)
- §7 错误处理 → 各 task route implementation
- §8 testing → Task 1/3/4 (单测) + Task 8 (E2E)

**Placeholder scan**: 无 TBD/TODO。

**Type consistency**:
- `DouyinListItem` Task 1 定义, Task 2 (adapter) / Task 3 (API) / Task 5 (UI) 一致使用。
- `runDouyinListAdapter` Task 2 export, Task 3 import 一致。
- `parseListOutput` Task 1 export, Task 2 调用一致。
- `retroQueue` Task 4 假设已 export from `@/jobs/queue`. Task 4 Step 4.3 显式 verify; 若未 export 则 task BLOCKS。

**Potential blocker:** Task 4 假设 `@/jobs/queue` 已 export `retroQueue`. 需要 implementer verify。 如果只 export `analyzeQueue`, 需要在 Task 4 前补一个加 export 的 sub-task (~ 3 行)。
