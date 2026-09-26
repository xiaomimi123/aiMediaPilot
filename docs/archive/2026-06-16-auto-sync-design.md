# Cheat Auto-Sync Design Spec

**Status:** Draft 2026-06-16
**Owner:** MediaPilot (solo dev)
**Phase:** v3 — Sub-project D

## 1. Goal & Scope

把 v2 Sub-project C 的"半自动" (用户去 retro-sync 点刷新) 升级为 "自动" — BullMQ cron 每 12h 跑 `review.py list`, 用 bigram Dice 相似度 ≥ 0.8 自动匹配 ContentAnalysis + 立即触发 retro。

**In scope:**

- `src/lib/douyin/fuzzy.ts` — `bigramDice` 纯函数 (TDD)
- `src/lib/douyin/auto-sync.ts` — `runAutoSync(userId)` orchestration
- `src/jobs/workers/auto-sync-worker.ts` — BullMQ worker + repeating job
- `src/jobs/queue.ts` — `autoSyncQueue` + `QUEUES.AUTO_SYNC` 常量
- `src/jobs/workers/index.ts` — `startAutoSyncWorker()`
- `User.lastAutoSyncAt DateTime?` schema 加列
- `/content/retro-sync` 顶部加一行 "最后自动同步: ..."

**Out of scope (留 v4):**

- 自动同步启用 / 禁用开关 UI (默认 always on)
- cron 频率可调 (硬编码 12h)
- 双阈值 (低置信只推荐不自动) — 0.8 单档
- 通知 / 邮件提醒

## 2. Architecture

```
[ Server boot ]
   ↓
startAutoSyncWorker() — 注册 repeating job (every 12h) + 立即 fire 一次
   ↓
[ BullMQ autoSyncQueue ]
   ↓
auto-sync-worker handle()
   ↓
runAutoSync(userId):
  1. items = runDouyinListAdapter()              ← 复用 C 的 list.ts
  2. unmatched = prisma.contentAnalysis.findMany {
       userId, status: 'COMPLETED', douyinAwemeId: null
     }
  3. for each item in items:
       skip 若 prisma.findFirst { douyinAwemeId: item.awemeId } 已存在
       titleSrc = analysis.draftTitle ?? basename(videoFilename)
       计算 bigramDice(titleSrc, item.desc) — 找 unmatched 里得分最高的
       if 最高分 >= 0.8:
         prisma.update analysis: douyinAwemeId / douyinUrl / publishedAt / retroStatus=SCHEDULED
         retroQueue.add('retro', { analysisId }, { delay: 0 })
         从 unmatched in-memory 列表移除 (防同 tick 内重复 match)
         log("[auto-sync] matched aweme X → analysis Y (score 0.87)")
       else:
         log("[auto-sync] no match for aweme X (best score 0.4)")
  4. prisma.user.update lastAutoSyncAt = now
```

## 3. Data Model

```prisma
model User {
  // ...existing...
  lastAutoSyncAt DateTime?
}
```

通过 `prisma db push` 即时同步 (与 baselinePlays 一致)。

## 4. Fuzzy 算法

```typescript
// src/lib/douyin/fuzzy.ts
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

**校准锚点:**

| Source | Target | dice |
|---|---|---|
| `ChatGPT 5 个隐藏技巧` | `ChatGPT 5 个不知道的技巧` | ~0.72 |
| `AI 工具排行 Top 10` | `AI 工具排行榜 Top 10` | ~0.85 |
| `mock-1` (filename fallback) | `ChatGPT 介绍` | ~0.0 |

阈值 `0.8` → 第 2 行自动,第 1 行保守不自动。

## 5. Orchestration

```typescript
// src/lib/douyin/auto-sync.ts
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
        { jobId: `retro-${best.analysisId}`, delay: 0, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600, count: 100 } }
      );
      const idx = unmatched.findIndex((a) => a.id === best.analysisId);
      if (idx >= 0) unmatched.splice(idx, 1);
      stats.matchedCount++;
      console.log(
        `[auto-sync] matched aweme ${item.awemeId} → analysis ${best.analysisId} (score ${best.score.toFixed(2)})`
      );
    } else {
      stats.skippedLowConfidence++;
      console.log(
        `[auto-sync] no match for aweme ${item.awemeId} (best score ${best?.score.toFixed(2) ?? 'N/A'})`
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

## 6. Worker

```typescript
// src/jobs/workers/auto-sync-worker.ts
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
    { connection: redis }
  );

  // 设置 repeating job (idempotent — BullMQ 内部按 key 去重)
  autoSyncQueue.add('tick', {}, { repeat: { every: REPEAT_EVERY_MS }, removeOnComplete: true });

  // 启动时立即触发一次 (覆盖刚启动后第一次的 12h 等待)
  autoSyncQueue.add('boot-tick', {}, { removeOnComplete: true });

  return worker;
}
```

`src/jobs/queue.ts` 加:

```typescript
export const QUEUES = {
  // ...existing...
  AUTO_SYNC: 'auto-sync',
};
export const autoSyncQueue = new Queue(QUEUES.AUTO_SYNC, { connection: redis });
```

`src/jobs/workers/index.ts` 加:

```typescript
import { startAutoSyncWorker } from './auto-sync-worker';
// 在现有 startup 列表加:
startAutoSyncWorker();
```

## 7. UI

`/content/retro-sync/page.tsx` 改: 现有 RSC 加 1 个字段 `lastAutoSyncAt`:

```typescript
const [unmatched, freshUser] = await Promise.all([
  prisma.contentAnalysis.findMany({ ... }),
  prisma.user.findUnique({ where: { id: user.id }, select: { lastAutoSyncAt: true } }),
]);
```

在表标题下显示:

```tsx
{freshUser?.lastAutoSyncAt && (
  <p className="text-xs text-muted-foreground">
    最后自动同步: {new Date(freshUser.lastAutoSyncAt).toLocaleString()}
  </p>
)}
```

## 8. 错误处理

| 情况 | 行为 |
|---|---|
| review.py 退出码非 0 (cookie 失效) | `runDouyinListAdapter` throws → worker catch + console.error,`lastAutoSyncAt` 不更新 → 下次 cron 再试 |
| Adapter timeout 60s | 同上 |
| 无 unmatched analysis | runAutoSync 立即返回 stats (无活干) |
| 所有 score < 0.8 | log "no match", 不写库 |
| 同 aweme 二次 cron 检测 (上次低分) → `findFirst({douyinAwemeId})` 已写 → skipped |
| Retro queue add 抛错 | log error,数据库已更新 (analysis 已含 douyinAwemeId) → 用户从 retro-sync 状态可看到 SCHEDULED 但 retro 未跑 → 手动重 enqueue 留 v4 |
| User 不存在 (理论不可能) | runAutoSync 调用前 getOrCreateDefaultUser 兜底 |

## 9. Testing

### 9.1 `tests/lib/douyin/fuzzy.test.ts` — bigramDice (6 case)

- ✓ 相同字符串 → 1.0
- ✓ 完全不同 → 0.0
- ✓ 空字符串 → 0.0
- ✓ 缩写场景 "ChatGPT 5 个技巧" vs "ChatGPT 5 个不知道的技巧" → ~0.7
- ✓ filenameBasename helper: "mock-1.mp4" → "mock-1"
- ✓ 大小写不敏感 ("ChatGPT" vs "chatgpt") → 1.0

### 9.2 `tests/lib/douyin/auto-sync.test.ts` — runAutoSync (mock prisma + adapter)

- ✓ 高分匹配 → matchedCount=1, update + retroQueue.add 调用, unmatched 从 list 移除
- ✓ 低分跳过 → matchedCount=0, skippedLowConfidence=1
- ✓ 已匹配的 aweme 全局 skip → skippedAlreadyMatched=1
- ✓ draftTitle=null 时走 videoFilename basename fallback

### 9.3 手动 E2E

1. 服务器启动后立即 worker tick 一次 (boot-tick) — log "no match" / "matched X"
2. 设 `prisma.user.update {lastAutoSyncAt: null}` → 刷新 retro-sync → 提示行不出现
3. wait 一会 worker boot-tick 完成 → 刷新 retro-sync → 显示 "最后自动同步: 时间"
4. 手动触发 BullMQ 即时跳 (`autoSyncQueue.add('manual-test', {})`) → 看 log + 验证 lastAutoSyncAt 更新

## 10. 完成标志

- ✅ fuzzy 6 测 + auto-sync 4 测全过
- ✅ Worker 启动跑一次 boot-tick, log 输出
- ✅ User.lastAutoSyncAt 字段在 DB 中存在
- ✅ /content/retro-sync 显示 "最后自动同步" 一行
- ✅ typecheck 0 错, npm test 全绿
