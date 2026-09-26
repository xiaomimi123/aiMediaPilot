# Cheat Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BullMQ cron 12h 自动跑 review.py list, fuzzy match 阈值 0.8 自动匹配 + 立即触发 retro。

**Architecture:** 纯函数 bigramDice (TDD) → orchestration `runAutoSync` (mock-prisma TDD) → BullMQ worker + repeat schedule → schema 加 User.lastAutoSyncAt → RSC 显示。

**Tech Stack:** Next.js 14 + TypeScript + Prisma + BullMQ + vitest

**Spec:** `docs/superpowers/specs/2026-06-16-auto-sync-design.md`

**Scope** (不在本计划):
- 启用 / 禁用开关 UI
- cron 频率可调
- 双阈值
- 通知

---

## File Structure

```
新建:
src/lib/douyin/fuzzy.ts                                # bigramDice + filenameBasename
src/lib/douyin/auto-sync.ts                            # runAutoSync orchestration
src/jobs/workers/auto-sync-worker.ts                   # BullMQ worker
tests/lib/douyin/fuzzy.test.ts                         # bigramDice TDD (6 case)
tests/lib/douyin/auto-sync.test.ts                     # runAutoSync TDD (4 case)

修改:
prisma/schema.prisma                                   # User.lastAutoSyncAt DateTime?
src/jobs/queue.ts                                      # AUTO_SYNC + autoSyncQueue
src/jobs/workers/index.ts                              # startAutoSyncWorker()
src/app/content/retro-sync/page.tsx                    # 显示 lastAutoSyncAt
```

---

## Test Strategy

- **`bigramDice`** 6 case (TDD)
- **`runAutoSync`** 4 case mock-prisma (TDD)
- **Worker / queue 注册** 不写单测 (集成层)
- **UI** 不写单测 (E2E)

测试框架: vitest

---

## Git

每 task 末尾 commit。 前缀: `feat(auto-sync): ...` / `chore(auto-sync): ...`。

---

## Task 1: `fuzzy.ts` 纯函数 (TDD)

**Files:**
- Create: `src/lib/douyin/fuzzy.ts`
- Create: `tests/lib/douyin/fuzzy.test.ts`

### Step 1.1 — Failing tests

Write `tests/lib/douyin/fuzzy.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { bigramDice, filenameBasename } from '@/lib/douyin/fuzzy';

describe('bigramDice', () => {
  it('相同字符串 → 1.0', () => {
    expect(bigramDice('hello world', 'hello world')).toBe(1);
  });
  it('完全不同 → 0.0', () => {
    expect(bigramDice('abcdef', 'xyzwvu')).toBe(0);
  });
  it('一边空 → 0.0', () => {
    expect(bigramDice('', 'something')).toBe(0);
    expect(bigramDice('something', '')).toBe(0);
  });
  it('单字符 → 0.0 (无法形成 bigram)', () => {
    expect(bigramDice('a', 'a')).toBe(0);
  });
  it('部分重叠中文 → 介于 0.5-0.9', () => {
    const score = bigramDice('ChatGPT 5 个隐藏技巧', 'ChatGPT 5 个不知道的技巧');
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(0.9);
  });
  it('大小写不敏感', () => {
    expect(bigramDice('ChatGPT', 'chatgpt')).toBe(1);
  });
});

describe('filenameBasename', () => {
  it('去 .mp4 后缀', () => {
    expect(filenameBasename('mock-1.mp4')).toBe('mock-1');
  });
  it('去 .MOV 后缀', () => {
    expect(filenameBasename('video.MOV')).toBe('video');
  });
  it('无后缀保持原样', () => {
    expect(filenameBasename('plainfile')).toBe('plainfile');
  });
  it('多 dot 只去最后', () => {
    expect(filenameBasename('my.test.video.mp4')).toBe('my.test.video');
  });
});
```

### Step 1.2 — Run test (FAIL)

```bash
npm test -- douyin/fuzzy
```

Expected: FAIL.

### Step 1.3 — Implement fuzzy.ts

Write `src/lib/douyin/fuzzy.ts`:

```typescript
function bigrams(s: string): Set<string> {
  const grams = new Set<string>();
  const t = s.trim().toLowerCase();
  for (let i = 0; i < t.length - 1; i++) grams.add(t.slice(i, i + 2));
  return grams;
}

export function bigramDice(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function filenameBasename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
```

### Step 1.4 — Run test (PASS)

```bash
npm test -- douyin/fuzzy
```

Expected: PASS (10 tests: 6 bigramDice + 4 filenameBasename).

### Step 1.5 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 1.6 — Commit

```bash
git add src/lib/douyin/fuzzy.ts tests/lib/douyin/fuzzy.test.ts
git commit -m "feat(auto-sync): bigramDice + filenameBasename pure functions"
```

---

## Task 2: Prisma schema — `User.lastAutoSyncAt`

**Files:**
- Modify: `prisma/schema.prisma`

### Step 2.1 — Add column

Open `prisma/schema.prisma`. Find the `model User { ... }` block. After the `baselinePlays BigInt?` line, add:

```prisma
  lastAutoSyncAt DateTime?
```

### Step 2.2 — Push schema

```bash
npx prisma db push
```

Expected: "Your database is now in sync with your Prisma schema." + Prisma Client regenerated.

### Step 2.3 — Verify column

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c '\d "User"' | grep -i lastAutoSync
```

Expected: line showing `lastAutoSyncAt | timestamp(3) without time zone | | |`.

### Step 2.4 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 2.5 — Commit

```bash
git add prisma/schema.prisma
git commit -m "chore(auto-sync): add User.lastAutoSyncAt for cron tick timestamp"
```

---

## Task 3: `runAutoSync` orchestration (mock-prisma TDD)

**Files:**
- Create: `src/lib/douyin/auto-sync.ts`
- Create: `tests/lib/douyin/auto-sync.test.ts`

### Step 3.1 — Failing tests

Write `tests/lib/douyin/auto-sync.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/douyin/list', () => ({
  runDouyinListAdapter: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: { update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({
  QUEUES: { ANALYZE: 'analyze', RETRO: 'retro', AUTO_SYNC: 'auto-sync' },
  retroQueue: queueMock,
}));

import { runAutoSync } from '@/lib/douyin/auto-sync';
import { runDouyinListAdapter } from '@/lib/douyin/list';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
  prismaMock.contentAnalysis.update.mockResolvedValue({});
  prismaMock.user.update.mockResolvedValue({});
  queueMock.add.mockResolvedValue({});
});

describe('runAutoSync', () => {
  it('高分匹配 → matchedCount=1 + prisma.update + retroQueue.add', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'AI 工具排行榜 Top 10' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'x.mp4', draftTitle: 'AI 工具排行榜 Top 10' },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(1);
    expect(stats.skippedAlreadyMatched).toBe(0);
    expect(stats.skippedLowConfidence).toBe(0);
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          douyinAwemeId: '7234567890',
          douyinUrl: 'https://www.douyin.com/video/7234567890',
          retroStatus: 'SCHEDULED',
        }),
      }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'retro',
      { analysisId: 'a1' },
      expect.objectContaining({ delay: 0 }),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user1' } }),
    );
  });

  it('低分跳过 → matchedCount=0, skippedLowConfidence=1', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7000000000', postedAt: '', plays: '0', desc: '完全不同的标题 abcdef' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'x.mp4', draftTitle: '原始 ChatGPT 教程' },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(0);
    expect(stats.skippedLowConfidence).toBe(1);
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
  });

  it('已匹配 aweme 全局 skip → skippedAlreadyMatched=1', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7000000000', postedAt: '', plays: '0', desc: '什么' },
    ]);
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({ id: 'existing' });
    const stats = await runAutoSync('user1');
    expect(stats.skippedAlreadyMatched).toBe(1);
    expect(stats.matchedCount).toBe(0);
  });

  it('draftTitle=null 走 videoFilename basename fallback', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890', postedAt: '', plays: '0', desc: 'mock-1' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'mock-1.mp4', draftTitle: null },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(1);
  });
});
```

### Step 3.2 — Run test (FAIL)

```bash
npm test -- douyin/auto-sync
```

Expected: FAIL (module not found).

### Step 3.3 — Implement auto-sync.ts

Write `src/lib/douyin/auto-sync.ts`:

```typescript
import { prisma } from '@/lib/prisma';
import { retroQueue } from '@/jobs/queue';
import { runDouyinListAdapter } from './list';
import { bigramDice, filenameBasename } from './fuzzy';

const MATCH_THRESHOLD = 0.8;

function parseLooseTime(input: string): Date | null {
  if (!input) return null;
  const iso = input.replace(' ', 'T') + ':00';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface AutoSyncStats {
  itemCount: number;
  matchedCount: number;
  skippedAlreadyMatched: number;
  skippedLowConfidence: number;
}

export async function runAutoSync(userId: string): Promise<AutoSyncStats> {
  const items = await runDouyinListAdapter();
  const stats: AutoSyncStats = {
    itemCount: items.length,
    matchedCount: 0,
    skippedAlreadyMatched: 0,
    skippedLowConfidence: 0,
  };

  if (items.length === 0) return stats;

  const unmatched = await prisma.contentAnalysis.findMany({
    where: { userId, status: 'COMPLETED', douyinAwemeId: null },
    select: { id: true, videoFilename: true, draftTitle: true },
  });

  for (const item of items) {
    const existing = await prisma.contentAnalysis.findFirst({
      where: { douyinAwemeId: item.awemeId },
      select: { id: true },
    });
    if (existing) {
      stats.skippedAlreadyMatched++;
      continue;
    }

    const scored = unmatched.map((a) => {
      const titleSrc = a.draftTitle ?? filenameBasename(a.videoFilename);
      return { analysisId: a.id, score: bigramDice(titleSrc, item.desc) };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best && best.score >= MATCH_THRESHOLD) {
      await prisma.contentAnalysis.update({
        where: { id: best.analysisId },
        data: {
          douyinAwemeId: item.awemeId,
          douyinUrl: `https://www.douyin.com/video/${item.awemeId}`,
          publishedAt: parseLooseTime(item.postedAt) ?? new Date(),
          retroStatus: 'SCHEDULED',
        },
      });
      await retroQueue.add(
        'retro',
        { analysisId: best.analysisId },
        {
          jobId: `retro-${best.analysisId}`,
          delay: 0,
          removeOnComplete: true,
          removeOnFail: { age: 7 * 24 * 3600, count: 100 },
        },
      );
      const idx = unmatched.findIndex((a) => a.id === best.analysisId);
      if (idx >= 0) unmatched.splice(idx, 1);
      stats.matchedCount++;
      console.log(
        `[auto-sync] matched aweme ${item.awemeId} → analysis ${best.analysisId} (score ${best.score.toFixed(2)})`,
      );
    } else {
      stats.skippedLowConfidence++;
      console.log(
        `[auto-sync] no match for aweme ${item.awemeId} (best score ${best?.score.toFixed(2) ?? 'N/A'})`,
      );
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: { lastAutoSyncAt: new Date() },
  });

  return stats;
}
```

### Step 3.4 — Run test (PASS)

```bash
npm test -- douyin/auto-sync
```

Expected: PASS (4 tests).

### Step 3.5 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 3.6 — Commit

```bash
git add src/lib/douyin/auto-sync.ts tests/lib/douyin/auto-sync.test.ts
git commit -m "feat(auto-sync): runAutoSync orchestration with 0.8 fuzzy match threshold"
```

---

## Task 4: Queue + Worker setup

**Files:**
- Modify: `src/jobs/queue.ts`
- Create: `src/jobs/workers/auto-sync-worker.ts`
- Modify: `src/jobs/workers/index.ts`

### Step 4.1 — Modify queue.ts

Open `src/jobs/queue.ts`. Find the `QUEUES` object:

```typescript
export const QUEUES = {
  BIND: 'bind',
  SYNC: 'sync',
  ANALYZE: 'analyze',
  RETRO: 'retro',
};
```

Add `AUTO_SYNC`:

```typescript
export const QUEUES = {
  BIND: 'bind',
  SYNC: 'sync',
  ANALYZE: 'analyze',
  RETRO: 'retro',
  AUTO_SYNC: 'auto-sync',
};
```

After the existing `retroQueue` line, add:

```typescript
export const autoSyncQueue = new Queue(QUEUES.AUTO_SYNC, { connection: redis });
```

### Step 4.2 — Create auto-sync-worker.ts

Write `src/jobs/workers/auto-sync-worker.ts`:

```typescript
import { Worker } from 'bullmq';
import { redis } from '@/lib/redis';
import { QUEUES, autoSyncQueue } from '@/jobs/queue';
import { getOrCreateDefaultUser } from '@/lib/user';
import { runAutoSync } from '@/lib/douyin/auto-sync';

const REPEAT_EVERY_MS = 12 * 60 * 60 * 1000; // 12h

export function startAutoSyncWorker() {
  const worker = new Worker(
    QUEUES.AUTO_SYNC,
    async () => {
      const user = await getOrCreateDefaultUser();
      try {
        const stats = await runAutoSync(user.id);
        console.log('[auto-sync-worker] tick', stats);
      } catch (err) {
        console.error('[auto-sync-worker] failed', err);
      }
    },
    { connection: redis },
  );

  autoSyncQueue.add('tick', {}, { repeat: { every: REPEAT_EVERY_MS }, removeOnComplete: true });
  autoSyncQueue.add('boot-tick', {}, { removeOnComplete: true });

  return worker;
}
```

### Step 4.3 — Wire up in workers/index.ts

Open `src/jobs/workers/index.ts`. Find where other workers are started (likely `startContentAnalyzeWorker()` + `startContentRetroWorker()` etc). Add:

```typescript
import { startAutoSyncWorker } from './auto-sync-worker';
```

And in the startup body (after the other `start*Worker()` calls):

```typescript
startAutoSyncWorker();
```

### Step 4.4 — Typecheck

```bash
npm run typecheck
```

Expected: 0 errors.

### Step 4.5 — Commit

```bash
git add src/jobs/queue.ts src/jobs/workers/auto-sync-worker.ts src/jobs/workers/index.ts
git commit -m "feat(auto-sync): BullMQ autoSyncQueue + worker + 12h repeating job"
```

---

## Task 5: `/content/retro-sync` 显示 lastAutoSyncAt

**Files:**
- Modify: `src/app/content/retro-sync/page.tsx`

### Step 5.1 — Modify page

Open `src/app/content/retro-sync/page.tsx`. Replace the existing `prisma.contentAnalysis.findMany` call with parallel fetch of both:

Find:

```typescript
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
```

Replace with:

```typescript
  const user = await getOrCreateDefaultUser();
  const [unmatched, freshUser] = await Promise.all([
    prisma.contentAnalysis.findMany({
      where: {
        userId: user.id,
        status: 'COMPLETED',
        OR: [{ douyinAwemeId: null }, { retroStatus: null }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, videoFilename: true, draftTitle: true, createdAt: true },
      take: 50,
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { lastAutoSyncAt: true },
    }),
  ]);
```

Then find the existing description `<p>` block:

```typescript
        <p className="mt-1 text-sm text-muted-foreground">
          把发布的抖音视频对应到 MediaPilot 分析, 立即跑复盘。
        </p>
```

Add a second `<p>` immediately after it (inside the same `<div>`):

```typescript
        <p className="mt-1 text-sm text-muted-foreground">
          把发布的抖音视频对应到 MediaPilot 分析, 立即跑复盘。
        </p>
        {freshUser?.lastAutoSyncAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            最后自动同步: {new Date(freshUser.lastAutoSyncAt).toLocaleString()}
          </p>
        )}
```

### Step 5.2 — Typecheck + tests

```bash
npm run typecheck && npm test
```

Expected: 0 errors, 199 + 10 fuzzy + 4 auto-sync = 213 tests pass.

### Step 5.3 — Commit

```bash
git add src/app/content/retro-sync/page.tsx
git commit -m "feat(auto-sync): retro-sync RSC shows lastAutoSyncAt"
```

---

## Task 6: 手动 E2E

**No code changes.**

### Step 6.1 — Restart worker to pick up new code

```bash
# 用户在 worker terminal 里 Ctrl+C, 然后 npm run worker:dev
# 或我帮 kill PID 让用户重启
```

Worker 启动后应该:
- `[auto-sync-worker] tick` log 出现 (boot-tick 立即跑)
- 因为账号无新视频或全已匹配, stats 应该是 `{itemCount: 0, matchedCount: 0, ...}` 或 `{itemCount: N, skippedAlreadyMatched: N, ...}`

### Step 6.2 — DB 验证 lastAutoSyncAt 写入

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot -c "
SELECT id, \"lastAutoSyncAt\" FROM \"User\" WHERE id = 'default-user';
"
```

Expected: `lastAutoSyncAt` 字段有值 (worker 跑完后)。

注意: 当 `items.length === 0` 时, runAutoSync 立即返回, 不会更新 lastAutoSyncAt。 所以若 review.py list 真返回 0 条, 这个值仍是 null。

### Step 6.3 — UI 验证

打开 `http://localhost:3000/content/retro-sync` → 如果 lastAutoSyncAt 非 null → 看到 "最后自动同步: 时间" 行。

### Step 6.4 — 手动触发 boot-tick 看 log

如果 lastAutoSyncAt 一直是 null (items empty), 可手动 SQL 注入一条 unmatched + 等下次 tick (或 redis-cli 删 repeat key 让 boot 再跳一次)。

简化跳过此步, 等真实数据到来再观察。

### Step 6.5 — 全测试

```bash
npm run typecheck && npm test
```

Expected: 0 errors, 213 tests pass.

### Step 6.6 — Commit (如需要)

```bash
git status
# 如有清理
git add -A && git commit -m "chore(auto-sync): E2E acceptance cleanup"
```

---

## 完成标志

- ✅ Task 1-5 commit 完整
- ✅ Task 6 worker boot tick log 验证
- ✅ `npm run typecheck` 0 错, `npm test` 全绿 (213 总数)

→ Sub-project D 完成。 v3 总体完结 (只做了 #4)。

---

## 自审记录

**Spec 覆盖**:
- §1 goal/scope → Task 1-5 全覆盖
- §2 architecture → Task 1 (fuzzy) + Task 3 (runAutoSync) + Task 4 (queue/worker)
- §3 data model → Task 2 (schema)
- §4 fuzzy 算法 → Task 1
- §5 orchestration → Task 3
- §6 worker → Task 4
- §7 UI → Task 5
- §8 错误处理 → Task 3 implement (try/catch already in worker handler from Task 4)
- §9 testing → Task 1 / 3 (单测) + Task 6 (E2E)

**Placeholder scan**: 无 TBD/TODO。

**Type consistency**:
- `AutoSyncStats` interface Task 3 定义, Task 4 worker 调用一致。
- `runAutoSync(userId): Promise<AutoSyncStats>` 签名一致。
- `bigramDice(a, b) → number` Task 1 定义, Task 3 调用一致。
- `User.lastAutoSyncAt` Task 2 加, Task 3 (auto-sync.ts) + Task 5 (page) 一致使用。
- `autoSyncQueue` Task 4 export, worker 内部使用一致。

**Potential blocker:** `src/jobs/workers/index.ts` 的 startup pattern 可能与 plan 假设不同。 implementer 需先读现有 index.ts 看现有 worker 启动方式 (是否在 IIFE 内 / async / 错误处理风格)。 跟随之确认是 `startAutoSyncWorker()` 单调用即可。
