# 发布与复盘实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每晚回采补上每条作品的完整指标与 30 天内每日快照；项目页生成发布文案、确认作品关联；发布第 3/7 天自动出复盘（规则算分段诊断 + 编导解读），用户采纳的写法经验进入编导的写稿上下文。

**Architecture:** 解析 / 配对 / 诊断 / 匹配打分 / 经验格式化都是 `src/lib/retro/` 下的纯函数，单测覆盖；数据读写走薄的 Prisma 函数；复盘生成用依赖注入（数据加载、模型、保存）以便测试失败路径。回采新步骤在浏览器里只做"裁剪"（不解析大数字 id），配对在 Node 里做。

**Tech Stack:** Next.js 14 App Router、Prisma 5（`db push`）、zod、vitest + testing-library、ego-browser、DeepSeek。

**Spec:** `docs/superpowers/specs/2026-09-29-publish-retro-design.md`

## Global Constraints

- 抖音访问只读，走 ego lite 默认配置；新接口 `work_list` 每页 12 条、页间 1 秒、最多 15 页。
- `work_list.items[i].id` 不可用（精度丢失）：只按下标与同页 `aweme_list[i]` 配对取 `aweme_id`，`create_time` 不一致则跳过并计数。
- 指标字段是字符串（如 `"0.093687"`）；缺失 / 非数字一律存 `null`，不补 0。
- 快照只写"公开且发布 ≤ 30 天"的作品，按 `(workId, day)` 覆盖，`day` 为 Asia/Shanghai 的 `YYYY-MM-DD`。
- 作品只在用户点「确认」或贴链接时关联到项目；「不是」→ `matchDismissed = true`，不再提示。
- 项目阶段只前进：`draft → scripted → recorded → final → published`。
- 平时基准 = 最近 10 条（不含本条）公开且有指标作品的中位数；不足 3 条不比较。好/差阈值 ±20%，跳出率方向相反。
- 诊断由规则算；编导解读只能引用诊断里的数；解读失败不影响诊断。
- 写法经验只有用户采纳后才生效；编导上下文最多取最近确认的 10 条，证据仅 1 条作品的标"证据少"。
- 界面不出现内部 id、英文状态码、原始报错；失败文案 = 原因 + 怎么办。
- 改 schema / 新增 API 目录后重启 dev。

## Review Focus

1. **作品还没有指标**（刚发布几小时，`view_count` 为 0 或指标全空）：不生成复盘，显示"数据还没出来"。→ Task 5 测试 `waits when metrics are not out yet`。
2. **没有转写的项目**（直接上传成片、没走口播转写）：中段诊断只给秒数，不报错。→ Task 4 测试 `gives seconds only without a transcript`。
3. **同一天回采跑两次**：快照覆盖不重复，关联候选不重复出现。→ Task 1 测试 `overwrites the same day snapshot`。
4. **用户点过「不是」的作品**：不再被推荐给同一项目或其他项目。→ Task 3 测试 `never suggests a dismissed work`。
5. **DeepSeek 返回的经验引用了诊断里没有的数 / 超过 3 条**：只保留前 3 条、stage 不合法的丢弃。→ Task 5 测试 `keeps at most 3 valid lessons`。

---

## 文件结构

```
prisma/schema.prisma                      + PublishedWork 指标列/matchDismissed, WorkMetricSnapshot, Retro, WritingLesson, Project.publishKit
src/lib/retro/work-list.ts                work_list 裁剪页 → 配对行(纯) + 浏览器脚本
src/lib/retro/metrics-store.ts            写最新指标 + 快照
src/lib/retro/match.ts                    作品-项目匹配打分(纯) + 候选查询 + 关联/驳回
src/lib/retro/publish-kit.ts              发布文案生成
src/lib/retro/diagnose.ts                 平时基准 + 分段诊断(纯)
src/lib/retro/generate.ts                 复盘生成(依赖注入) + 到期复盘
src/lib/retro/lessons.ts                  经验格式化(纯) + 读取生效经验
scripts/collect-douyin.ts                 + 作品指标 / 到期复盘两步
src/lib/agent/context.ts, src/lib/script/write.ts, src/lib/tools/write-script.ts   + 【写法经验】
src/app/api/projects/[id]/publish/...     发布状态/文案/关联/驳回/复盘
src/app/api/lessons/...                   经验列表/采纳/停用/编辑
src/app/api/retro/route.ts                复盘列表
src/components/project/publish-pane.tsx   ④ 发布与复盘
src/app/retro/page.tsx, src/components/retro/*.tsx
src/components/project/project-workspace.tsx, src/app/layout.tsx, src/app/page.tsx
tests/fixtures/douyin/work-list.json      (已存在: 真实返回裁剪, 含大数字 id)
```

---

### Task 1: 数据表、work_list 配对、指标与快照

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/retro/work-list.ts`、`src/lib/retro/metrics-store.ts`
- Test: `tests/lib/retro/work-list.test.ts`、`tests/lib/retro/metrics-store.test.ts`

**Interfaces:**
- Produces（`work-list.ts`）：
  - `interface WorkMetrics { viewCount: number | null; likeCount: number | null; commentCount: number | null; shareCount: number | null; favoriteCount: number | null; subscribeCount: number | null; homepageVisitCount: number | null; completionRate: number | null; completionRate5s: number | null; bounceRate2s: number | null; avgViewSec: number | null; avgViewProportion: number | null; fanViewProportion: number | null; metricsUpdatedAt: Date | null }`
  - `interface WorkMetricRow { awemeId: string; createTime: number; metrics: WorkMetrics }`
  - `pairWorkListPage(page: unknown): { rows: WorkMetricRow[]; skipped: number; hasMore: boolean; maxCursor: number }`
  - `WORK_LIST_SCRIPT: string`（浏览器里翻页并裁剪，输出 `@@RESULT@@` + 裁剪页数组）
  - `WORK_LIST_MAX_PAGES = 15`
- Produces（`metrics-store.ts`）：
  - `SNAPSHOT_DAYS = 30`；`localDay(d: Date): string`
  - `saveWorkMetrics(db: PrismaClient, rows: WorkMetricRow[], now: Date): Promise<{ updated: number; snapshots: number }>`

- [ ] **Step 1: schema**

`PublishedWork` 模型在 `analyticsFetchedAt` 之后加：

```prisma
  /// 以下来自创作者中心 work_list(2026-09-29 起, 覆盖老作品); 缺失为 null
  viewCount          Int?
  likeCount          Int?
  commentCount       Int?
  shareCount         Int?
  favoriteCount      Int?
  subscribeCount     Int?
  homepageVisitCount Int?
  completionRate     Float?
  bounceRate2sWl     Float?
  completionRate5sWl Float?
  avgViewSec         Float?
  avgViewProportion  Float?
  fanViewProportion  Float?
  metricsUpdatedAt   DateTime?
  /// 用户点过"不是我发的"的关联候选, 不再提示
  matchDismissed     Boolean   @default(false)
  snapshots          WorkMetricSnapshot[]
```

（`completionRate5s`/`bounceRate2s` 列名已被投稿分析占用，work_list 的两列加 `Wl` 后缀；界面与诊断统一读 `Wl` 列，缺失时回退旧列。）

`Project` 模型在 `benchmarkVideoId` 之后加：

```prisma
  /// 发布文案 { titles, hashtags, coverText }
  publishKit     Json?
  retro          Retro?
```

文件末尾追加：

```prisma
/// 作品每日指标快照(发布 30 天内的公开作品)
model WorkMetricSnapshot {
  id                String        @id @default(cuid())
  workId            String
  work              PublishedWork @relation(fields: [workId], references: [id], onDelete: Cascade)
  /// Asia/Shanghai 本地日期 YYYY-MM-DD
  day               String
  viewCount         Int?
  likeCount         Int?
  commentCount      Int?
  shareCount        Int?
  favoriteCount     Int?
  subscribeCount    Int?
  completionRate    Float?
  completionRate5s  Float?
  bounceRate2s      Float?
  avgViewSec        Float?
  avgViewProportion Float?
  metricsUpdatedAt  DateTime?
  takenAt           DateTime      @default(now())

  @@unique([workId, day])
}

/// 复盘报告(一个项目一份)
model Retro {
  id             String   @id @default(cuid())
  projectId      String   @unique
  project        Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  workId         String
  /// 发布后第几天生成
  dayN           Int
  diagnosis      Json
  narrative      String?  @db.Text
  narrativeError String?
  dataAsOf       DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

/// 写法经验(编导的经验本)
model WritingLesson {
  id          String    @id @default(cuid())
  text        String
  /// topic | hook | opening | middle | ending | interaction | title
  stage       String
  /// [{ projectId, workId, metric, value, baseline }]
  evidence    Json      @default("[]")
  /// candidate | active | retired | rejected
  status      String    @default("candidate")
  retroId     String?
  /// 最近一次复盘点名"没应验"
  contradicted Boolean  @default(false)
  createdAt   DateTime  @default(now())
  confirmedAt DateTime?

  @@index([status, confirmedAt])
}
```

Run: `npx prisma db push && npm run typecheck`
Expected: in sync；0 错误。

- [ ] **Step 2: 写失败测试**

`tests/lib/retro/work-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { pairWorkListPage } from '@/lib/retro/work-list';

// 用 JSON.parse 读: 与浏览器里一样, items[].id 这个大数字会丢精度
const page = JSON.parse(fs.readFileSync('tests/fixtures/douyin/work-list.json', 'utf8'));

describe('pairWorkListPage', () => {
  it('pairs items with aweme_list by index and ignores the broken numeric id', () => {
    const r = pairWorkListPage(page);
    expect(r.skipped).toBe(0);
    expect(r.hasMore).toBe(true);
    expect(r.rows[0].awemeId).toBe('7537605160290684170');
    expect(r.rows[0].metrics).toMatchObject({ viewCount: 2908, likeCount: 66, completionRate: 0.093687, completionRate5s: 0.502216, bounceRate2s: 0.265879, avgViewSec: 10.378139 });
    expect(r.rows[0].metrics.metricsUpdatedAt?.toISOString()).toBe('2025-11-09T16:00:00.000Z');
  });
  it('skips rows whose create_time does not match', () => {
    const broken = { ...page, items: page.items.map((it: { create_time: number }, i: number) => (i === 1 ? { ...it, create_time: 1 } : it)) };
    const r = pairWorkListPage(broken);
    expect(r.skipped).toBe(1);
    expect(r.rows.map((x) => x.awemeId)).not.toContain('7678813842822871926');
  });
  it('stores null (not 0) for missing or non-numeric metrics', () => {
    const p = { ...page, items: [{ ...page.items[0], metrics: { view_count: '-', like_count: '' } }], aweme_list: [page.aweme_list[0]] };
    expect(pairWorkListPage(p).rows[0].metrics).toMatchObject({ viewCount: null, likeCount: null, completionRate: null });
  });
});
```

`tests/lib/retro/metrics-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { saveWorkMetrics, localDay } from '@/lib/retro/metrics-store';
import type { WorkMetricRow } from '@/lib/retro/work-list';

const now = new Date('2026-09-29T12:00:00Z');
const m = (view: number) => ({ viewCount: view, likeCount: 1, commentCount: 0, shareCount: 0, favoriteCount: 0, subscribeCount: 0, homepageVisitCount: 0, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.2, avgViewSec: 9, avgViewProportion: 0.3, fanViewProportion: 0, metricsUpdatedAt: null });

function fakeDb(works: { id: string; externalId: string; isPrivate: boolean; publishedAt: Date }[]) {
  const updates: string[] = [];
  const snaps = new Map<string, unknown>();
  const db = {
    publishedWork: {
      findMany: async () => works,
      update: async ({ where }: { where: { id: string } }) => {
        updates.push(where.id);
      },
    },
    workMetricSnapshot: {
      upsert: async ({ where, create }: { where: { workId_day: { workId: string; day: string } }; create: unknown }) => {
        snaps.set(`${where.workId_day.workId}:${where.workId_day.day}`, create);
      },
    },
  } as unknown as PrismaClient;
  return { db, updates, snaps };
}

const rows: WorkMetricRow[] = [
  { awemeId: 'recent', createTime: 0, metrics: m(100) },
  { awemeId: 'old', createTime: 0, metrics: m(200) },
  { awemeId: 'private', createTime: 0, metrics: m(0) },
  { awemeId: 'unknown', createTime: 0, metrics: m(5) },
];
const works = [
  { id: 'w1', externalId: 'recent', isPrivate: false, publishedAt: new Date('2026-09-25T00:00:00Z') },
  { id: 'w2', externalId: 'old', isPrivate: false, publishedAt: new Date('2026-05-08T00:00:00Z') },
  { id: 'w3', externalId: 'private', isPrivate: true, publishedAt: new Date('2026-09-25T00:00:00Z') },
];

describe('saveWorkMetrics', () => {
  it('updates known works and snapshots only recent public ones', async () => {
    const { db, updates, snaps } = fakeDb(works);
    expect(await saveWorkMetrics(db, rows, now)).toEqual({ updated: 3, snapshots: 1 });
    expect(updates).toEqual(['w1', 'w2', 'w3']);
    expect([...snaps.keys()]).toEqual([`w1:${localDay(now)}`]);
  });
  it('overwrites the same day snapshot', async () => {
    const { db, snaps } = fakeDb(works);
    await saveWorkMetrics(db, rows, now);
    await saveWorkMetrics(db, rows, new Date(now.getTime() + 3600_000));
    expect(snaps.size).toBe(1);
  });
  it('uses the Shanghai calendar day', () => {
    expect(localDay(new Date('2026-09-29T17:00:00Z'))).toBe('2026-09-30');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/retro`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/retro/work-list.ts`**

```ts
/**
 * 创作者中心「作品管理」用的 work_list: 每条作品带完播/跳出/平均观看等指标, 老作品也有。
 * items[i].id 是超出 JS 精度的数字(会被改写), 不能用 —— 按下标与同页 aweme_list[i] 配对取 aweme_id, create_time 核对。
 */
export const WORK_LIST_MAX_PAGES = 15;

export interface WorkMetrics {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  favoriteCount: number | null;
  subscribeCount: number | null;
  homepageVisitCount: number | null;
  completionRate: number | null;
  completionRate5s: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
  avgViewProportion: number | null;
  fanViewProportion: number | null;
  metricsUpdatedAt: Date | null;
}

export interface WorkMetricRow {
  awemeId: string;
  createTime: number;
  metrics: WorkMetrics;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const int = (v: unknown) => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};

function toMetrics(item: Obj): WorkMetrics {
  const m = obj(item.metrics);
  const upd = num(item.metrics_offline_update_time);
  return {
    viewCount: int(m.view_count),
    likeCount: int(m.like_count),
    commentCount: int(m.comment_count),
    shareCount: int(m.share_count),
    favoriteCount: int(m.favorite_count),
    subscribeCount: int(m.subscribe_count),
    homepageVisitCount: int(m.homepage_visit_count),
    completionRate: num(m.completion_rate),
    completionRate5s: num(m.completion_rate_5s),
    bounceRate2s: num(m.bounce_rate_2s),
    avgViewSec: num(m.avg_view_second),
    avgViewProportion: num(m.avg_view_proportion),
    fanViewProportion: num(m.fan_view_proportion),
    metricsUpdatedAt: upd ? new Date(upd * 1000) : null,
  };
}

export function pairWorkListPage(page: unknown): { rows: WorkMetricRow[]; skipped: number; hasMore: boolean; maxCursor: number } {
  const p = obj(page);
  const aw = Array.isArray(p.aweme_list) ? p.aweme_list.map(obj) : [];
  const items = Array.isArray(p.items) ? p.items.map(obj) : [];
  const rows: WorkMetricRow[] = [];
  let skipped = 0;
  items.forEach((it, i) => {
    const a = aw[i];
    const awemeId = a && typeof a.aweme_id === 'string' ? a.aweme_id : '';
    if (!awemeId || num(a.create_time) !== num(it.create_time)) {
      skipped++;
      return;
    }
    rows.push({ awemeId, createTime: num(a.create_time) ?? 0, metrics: toMetrics(it) });
  });
  return { rows, skipped, hasMore: p.has_more === true || p.has_more === 1, maxCursor: num(p.max_cursor) ?? 0 };
}

/**
 * 在已登录的创作者中心页面里翻 work_list, 每页只保留配对需要的字段(不在浏览器里用 items[].id)。
 * 输出 @@RESULT@@ + 裁剪页数组。只读。
 */
export const WORK_LIST_SCRIPT = `
const task = await taskSpace('抖音账号资料')
const p = task.page('p1')
await p.goto('https://creator.douyin.com/creator-micro/content/manage', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 4000))
const pages = []
let cursor = 0
for (let i = 0; i < ${WORK_LIST_MAX_PAGES}; i++) {
  const r = await p.fetch('https://creator.douyin.com/janus/douyin/creator/pc/work_list?status=0&count=12&max_cursor=' + cursor + '&scene=star_atlas&device_platform=android&aid=1128', { credentials: 'include', timeout: 20000 })
  if (r.status !== 200) throw new Error('work_list HTTP ' + r.status)
  const d = JSON.parse(r.body)
  if (d.status_code !== 0) throw new Error('work_list status_code ' + d.status_code)
  pages.push({
    has_more: d.has_more,
    max_cursor: d.max_cursor,
    aweme_list: (d.aweme_list || []).map((a) => ({ aweme_id: a.aweme_id, create_time: a.create_time })),
    items: (d.items || []).map((it) => ({ create_time: it.create_time, metrics: it.metrics, metrics_offline_update_time: it.metrics_offline_update_time })),
  })
  if (!d.has_more) break
  cursor = d.max_cursor
  await new Promise((r) => setTimeout(r, 1000))
}
cliLog('@@RESULT@@' + JSON.stringify(pages))
`;
```

- [ ] **Step 5: 实现 `src/lib/retro/metrics-store.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { WorkMetricRow } from './work-list';

export const SNAPSHOT_DAYS = 30;

export function localDay(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

/** 写最新指标到作品表; 发布 30 天内的公开作品另记当天快照(同一天覆盖) */
export async function saveWorkMetrics(db: PrismaClient, rows: WorkMetricRow[], now: Date): Promise<{ updated: number; snapshots: number }> {
  const works = await db.publishedWork.findMany({
    where: { platform: 'douyin', externalId: { in: rows.map((r) => r.awemeId) } },
    select: { id: true, externalId: true, isPrivate: true, publishedAt: true },
  });
  const byExt = new Map(works.map((w) => [w.externalId, w]));
  const day = localDay(now);
  let updated = 0;
  let snapshots = 0;
  for (const r of rows) {
    const w = byExt.get(r.awemeId);
    if (!w) continue; // 还没被作品列表回采到的, 等下一晚
    const m = r.metrics;
    await db.publishedWork.update({
      where: { id: w.id },
      data: {
        viewCount: m.viewCount,
        likeCount: m.likeCount,
        commentCount: m.commentCount,
        shareCount: m.shareCount,
        favoriteCount: m.favoriteCount,
        subscribeCount: m.subscribeCount,
        homepageVisitCount: m.homepageVisitCount,
        completionRate: m.completionRate,
        completionRate5sWl: m.completionRate5s,
        bounceRate2sWl: m.bounceRate2s,
        avgViewSec: m.avgViewSec,
        avgViewProportion: m.avgViewProportion,
        fanViewProportion: m.fanViewProportion,
        metricsUpdatedAt: m.metricsUpdatedAt,
      },
    });
    updated++;
    const ageDays = (now.getTime() - w.publishedAt.getTime()) / 86400_000;
    if (w.isPrivate || ageDays > SNAPSHOT_DAYS) continue;
    const snap = {
      viewCount: m.viewCount,
      likeCount: m.likeCount,
      commentCount: m.commentCount,
      shareCount: m.shareCount,
      favoriteCount: m.favoriteCount,
      subscribeCount: m.subscribeCount,
      completionRate: m.completionRate,
      completionRate5s: m.completionRate5s,
      bounceRate2s: m.bounceRate2s,
      avgViewSec: m.avgViewSec,
      avgViewProportion: m.avgViewProportion,
      metricsUpdatedAt: m.metricsUpdatedAt,
    };
    await db.workMetricSnapshot.upsert({
      where: { workId_day: { workId: w.id, day } },
      update: { ...snap, takenAt: now },
      create: { workId: w.id, day, ...snap, takenAt: now },
    });
    snapshots++;
  }
  return { updated, snapshots };
}
```

- [ ] **Step 6: 运行确认通过、提交**

Run: `npx vitest run tests/lib/retro && npm run typecheck`
Expected: 全部 PASS；0 错误。

```bash
git add prisma/schema.prisma src/lib/retro tests/lib/retro tests/fixtures/douyin/work-list.json
git commit -m "feat(retro): 作品指标/快照/复盘/写法经验表 + work_list 配对(不用失精度的 id) + 指标与每日快照入库

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 回采接入作品指标

**Files:**
- Modify: `scripts/collect-douyin.ts`
- Create: `src/lib/retro/collect-step.ts`
- Test: `tests/lib/retro/collect-step.test.ts`

**Interfaces:**
- Consumes: `WORK_LIST_SCRIPT`、`pairWorkListPage`（Task 1）、`saveWorkMetrics`（Task 1）、`readResult`（`src/lib/ego.ts`）
- Produces: `collectWorkMetrics(deps: { runScript(s: string): Promise<string>; save(rows: WorkMetricRow[]): Promise<{ updated: number; snapshots: number }> }): Promise<string>`（返回一行日志文案）

- [ ] **Step 1: 写失败测试 `tests/lib/retro/collect-step.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { collectWorkMetrics } from '@/lib/retro/collect-step';

const page = JSON.parse(fs.readFileSync('tests/fixtures/douyin/work-list.json', 'utf8'));

describe('collectWorkMetrics', () => {
  it('pairs every page and reports updated / snapshots / skipped', async () => {
    const broken = { ...page, items: page.items.map((it: { create_time: number }, i: number) => (i === 0 ? { ...it, create_time: 1 } : it)) };
    const save = vi.fn(async (rows: unknown[]) => ({ updated: rows.length, snapshots: 1 }));
    const line = await collectWorkMetrics({ runScript: async () => `x\n@@RESULT@@${JSON.stringify([page, broken])}\n`, save });
    expect(save.mock.calls[0][0]).toHaveLength(7);
    expect(line).toBe('作品指标: 7 条(快照 1 条, 跳过 1 条)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/collect-step.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/retro/collect-step.ts`**

```ts
import { readResult } from '@/lib/ego';
import { pairWorkListPage, WORK_LIST_SCRIPT, type WorkMetricRow } from './work-list';

export async function collectWorkMetrics(deps: {
  runScript(s: string): Promise<string>;
  save(rows: WorkMetricRow[]): Promise<{ updated: number; snapshots: number }>;
}): Promise<string> {
  const pages = readResult(await deps.runScript(WORK_LIST_SCRIPT));
  if (!Array.isArray(pages)) throw new Error('work_list 没有返回页面数据');
  const rows: WorkMetricRow[] = [];
  let skipped = 0;
  for (const p of pages) {
    const r = pairWorkListPage(p);
    rows.push(...r.rows);
    skipped += r.skipped;
  }
  const s = await deps.save(rows);
  return `作品指标: ${s.updated} 条(快照 ${s.snapshots} 条, 跳过 ${skipped} 条)`;
}
```

`scripts/collect-douyin.ts`：import `collectWorkMetrics`、`saveWorkMetrics`；在「账号资料」那一步之后加独立失败的一步：

```ts
    // 每条作品的完整指标(完播/跳出/平均观看) + 30 天内每日快照 —— 独立失败
    try {
      log(await collectWorkMetrics({ runScript: (s) => runEgo(s), save: (rows) => saveWorkMetrics(prisma, rows, new Date()) }));
    } catch (e) {
      log(`作品指标抓取失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
```

- [ ] **Step 4: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：设置页「作品数据回采」→「立即运行」（占 1 次手动额度）；日志出现「作品指标: N 条(快照 M 条, 跳过 0 条)」，N 约等于作品总数；库里 2025-08-12 那条 `completionRate ≈ 0.0937`。

```bash
git add src/lib/retro/collect-step.ts scripts/collect-douyin.ts tests/lib/retro/collect-step.test.ts
git commit -m "feat(retro): 每晚回采补作品完整指标与 30 天内每日快照

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 作品与项目关联、发布文案

**Files:**
- Create: `src/lib/retro/match.ts`、`src/lib/retro/publish-kit.ts`
- Test: `tests/lib/retro/match.test.ts`、`tests/lib/retro/publish-kit.test.ts`

**Interfaces:**
- Produces（`match.ts`）：
  - `MATCH_THRESHOLD = 0.35`
  - `scoreMatch(p: { filmAt: Date; kitText: string }, w: { publishedAt: Date; text: string }): number`（0～1；发布早于成片 → 0）
  - `pickCandidate(p, works: { id: string; publishedAt: Date; text: string; isPrivate: boolean; projectId: string | null; matchDismissed: boolean }[]): string | null`
  - `findCandidate(db: PrismaClient, projectId: string): Promise<{ workId: string; text: string; publishedAt: string } | null>`
  - `linkWork(db: PrismaClient, projectId: string, workId: string): Promise<void>`（写 projectId、阶段 → published、对话系统通知 `job:publish`）
  - `dismissWork(db: PrismaClient, workId: string): Promise<void>`
- Produces（`publish-kit.ts`）：
  - `PublishKitSchema`：`{ titles: string[3]; hashtags: string[1..8]; coverText: string[1..2] }`；`type PublishKit`
  - `generatePublishKit(llm: StructuredLLM, input: { scriptText: string; personaText: string; benchmarkTitlePattern?: string }): Promise<PublishKit>`

- [ ] **Step 1: 写失败测试**

`tests/lib/retro/match.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pickCandidate, scoreMatch } from '@/lib/retro/match';

const filmAt = new Date('2026-09-28T10:00:00Z');
const kitText = 'U盘干到品类第一 #AI工具 #副业';
const w = (id: string, hours: number, text: string, over: object = {}) => ({ id, publishedAt: new Date(filmAt.getTime() + hours * 3600_000), text, isPrivate: false, projectId: null, matchDismissed: false, ...over });

describe('match', () => {
  it('scores zero for works published before the film', () => {
    expect(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() - 60_000), text: kitText })).toBe(0);
  });
  it('prefers text overlap and recency', () => {
    expect(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() + 3600_000), text: kitText })).toBeGreaterThan(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() + 3600_000), text: '今天吃了火锅' }));
  });
  it('picks the best public, unlinked, not dismissed work above the threshold', () => {
    const works = [w('a', 2, '今天吃了火锅'), w('b', 5, 'U盘干到品类第一 就靠笨办法 #AI工具'), w('c', 1, kitText, { isPrivate: true }), w('d', 1, kitText, { projectId: 'other' })];
    expect(pickCandidate({ filmAt, kitText }, works)).toBe('b');
  });
  it('never suggests a dismissed work', () => {
    expect(pickCandidate({ filmAt, kitText }, [w('b', 5, kitText, { matchDismissed: true })])).toBeNull();
  });
});
```

`tests/lib/retro/publish-kit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { generatePublishKit } from '@/lib/retro/publish-kit';
import type { StructuredLLM } from '@/lib/script/write';

describe('generatePublishKit', () => {
  it('passes script, persona and benchmark title pattern to the model', async () => {
    const call = vi.fn(async () => ({ result: { titles: ['a', 'b', 'c'], hashtags: ['#AI工具'], coverText: ['U盘干到第一'] }, usage: {} }));
    const kit = await generatePublishKit({ callStructured: call } as unknown as StructuredLLM, { scriptText: '稿子', personaText: '定位', benchmarkTitlePattern: '期数栏目化前缀' });
    expect(kit.titles).toHaveLength(3);
    const text = (call.mock.calls[0] as unknown as [{ userMessage: { text: string }[] }])[0].userMessage[0].text;
    expect(text).toContain('【定稿】\n稿子');
    expect(text).toContain('期数栏目化前缀');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/match.test.ts tests/lib/retro/publish-kit.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/retro/match.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

export const MATCH_THRESHOLD = 0.35;
const WINDOW_DAYS = 14;

const chars = (s: string) => new Set(Array.from(s.replace(/[\s\p{P}\p{S}#]/gu, '').toLowerCase()));

/** 字重合度(占较短一方) 0.7 + 时间接近度 0.3; 早于成片登记为 0 */
export function scoreMatch(p: { filmAt: Date; kitText: string }, w: { publishedAt: Date; text: string }): number {
  const hours = (w.publishedAt.getTime() - p.filmAt.getTime()) / 3600_000;
  if (hours < 0 || hours > WINDOW_DAYS * 24) return 0;
  const a = chars(p.kitText);
  const b = chars(w.text);
  const inter = [...a].filter((c) => b.has(c)).length;
  const overlap = a.size && b.size ? inter / Math.min(a.size, b.size) : 0;
  const recency = 1 - hours / (WINDOW_DAYS * 24);
  return Math.round((overlap * 0.7 + recency * 0.3) * 1000) / 1000;
}

export function pickCandidate(
  p: { filmAt: Date; kitText: string },
  works: { id: string; publishedAt: Date; text: string; isPrivate: boolean; projectId: string | null; matchDismissed: boolean }[],
): string | null {
  let best: { id: string; s: number } | null = null;
  for (const w of works) {
    if (w.isPrivate || w.projectId || w.matchDismissed) continue;
    const s = scoreMatch(p, w);
    if (s >= MATCH_THRESHOLD && (!best || s > best.s)) best = { id: w.id, s };
  }
  return best?.id ?? null;
}

type Kit = { titles?: string[]; hashtags?: string[] } | null;

export async function findCandidate(db: PrismaClient, projectId: string) {
  const p = await db.project.findUnique({ where: { id: projectId }, include: { files: { where: { kind: 'final_mp4' }, orderBy: { createdAt: 'asc' }, take: 1 } } });
  if (!p || p.stage !== 'final' || !p.files[0]) return null;
  if (await db.publishedWork.count({ where: { projectId } })) return null;
  const kit = p.publishKit as Kit;
  const kitText = [p.title, ...(kit?.titles ?? []), ...(kit?.hashtags ?? [])].join(' ');
  const filmAt = p.files[0].createdAt;
  const works = await db.publishedWork.findMany({ where: { publishedAt: { gte: filmAt }, isPrivate: false, projectId: null, matchDismissed: false } });
  const id = pickCandidate({ filmAt, kitText }, works.map((w) => ({ ...w, text: `${w.title} ${w.caption}` })));
  const w = works.find((x) => x.id === id);
  return w ? { workId: w.id, text: w.title || w.caption, publishedAt: w.publishedAt.toISOString() } : null;
}

export async function linkWork(db: PrismaClient, projectId: string, workId: string): Promise<void> {
  const w = await db.publishedWork.findUniqueOrThrow({ where: { id: workId } });
  if (w.projectId && w.projectId !== projectId) throw new Error('这条作品已经关联到别的项目了');
  await db.publishedWork.update({ where: { id: workId }, data: { projectId } });
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  if (['draft', 'scripted', 'recorded', 'final'].includes(p.stage)) await db.project.update({ where: { id: projectId }, data: { stage: 'published' } });
  await db.chatMessage.create({
    data: { projectId, role: 'system', content: `已关联发布的作品：${(w.title || w.caption).slice(0, 40)}（${w.publishedAt.toLocaleDateString('zh-CN')}）。第 3 天会自动复盘。`, toolName: 'job:publish', toolResult: { ok: true } },
  });
}

export async function dismissWork(db: PrismaClient, workId: string): Promise<void> {
  await db.publishedWork.update({ where: { id: workId }, data: { matchDismissed: true } });
}
```

- [ ] **Step 4: 实现 `src/lib/retro/publish-kit.ts`**

```ts
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';

export const PublishKitSchema = z.object({
  titles: z.array(z.string().min(1)).length(3),
  hashtags: z.array(z.string().min(1)).min(1).max(8),
  coverText: z.array(z.string().min(1)).min(1).max(2),
});
export type PublishKit = z.infer<typeof PublishKitSchema>;

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，为一条已经做好的口播视频写发布文案。
- titles：3 个候选标题（发布时的文案开头），口语、具体，不标题党、不编数字。
- hashtags：话题标签，每个以 # 开头，3～6 个，贴合内容和账号定位。
- coverText：封面上的大字，1～2 行，每行不超过 12 字。
只用稿子里有的事实；没出处的数字不写。只输出 JSON。`;

export async function generatePublishKit(llm: StructuredLLM, input: { scriptText: string; personaText: string; benchmarkTitlePattern?: string }): Promise<PublishKit> {
  const { result } = await llm.callStructured({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: [
      {
        type: 'text',
        text: `【账号定位】\n${input.personaText || '（未填写）'}\n\n【定稿】\n${input.scriptText}${input.benchmarkTitlePattern ? `\n\n【参考的对标标题写法】（借结构，不照抄）\n${input.benchmarkTitlePattern}` : ''}`,
      },
    ],
    responseSchema: PublishKitSchema,
  });
  return result;
}
```

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/retro/match.ts src/lib/retro/publish-kit.ts tests/lib/retro
git commit -m "feat(retro): 作品-项目匹配打分与关联/驳回 + 发布文案生成

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 平时基准与分段诊断

**Files:**
- Create: `src/lib/retro/diagnose.ts`
- Test: `tests/lib/retro/diagnose.test.ts`

**Interfaces:**
- Produces:
  - `interface MetricSet { viewCount: number | null; likeCount: number | null; favoriteCount: number | null; shareCount: number | null; subscribeCount: number | null; completionRate: number | null; completionRate5s: number | null; bounceRate2s: number | null; avgViewSec: number | null }`
  - `BASELINE_SIZE = 10`、`MIN_BASELINE = 3`、`THRESHOLD = 0.2`
  - `type Verdict = 'good' | 'even' | 'bad' | 'na'`
  - `interface StageResult { key: 'hook2s' | 'hook5s' | 'middle' | 'ending' | 'like' | 'favorite' | 'share' | 'subscribe'; label: string; value: number | null; baseline: number | null; verdict: Verdict; note: string }`
  - `interface Diagnosis { stages: StageResult[]; baselineCount: number; dropAt: { sec: number; segment: string | null; line: string | null } | null; benchmark: { theirRatio: number; myRatio: number | null } | null; curve: { day: string; viewCount: number | null; likeCount: number | null }[] }`
  - `computeBaseline(history: MetricSet[]): { count: number; medians: Partial<Record<StageResult['key'], number>>; likeMedian: number | null }`
  - `assignSegments(segments: { label: string; text: string }[], lines: { startSec: number; endSec: number; text: string }[]): { startSec: number; endSec: number; text: string; segment: string | null }[]`（每句按与各段稿子的字重合度归段，最高重合 < 0.3 → null）
  - `diagnose(input: { work: MetricSet; history: MetricSet[]; lines: { startSec: number; endSec: number; text: string; segment: string | null }[] | null; benchmark: { digg: number; baselineDigg: number | null } | null; curve: Diagnosis['curve'] }): Diagnosis`

- [ ] **Step 1: 写失败测试 `tests/lib/retro/diagnose.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { diagnose, computeBaseline, assignSegments, type MetricSet } from '@/lib/retro/diagnose';

const ms = (o: Partial<MetricSet>): MetricSet => ({ viewCount: 1000, likeCount: 20, favoriteCount: 5, shareCount: 2, subscribeCount: 1, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.3, avgViewSec: 10, ...o });
const history = [ms({}), ms({}), ms({}), ms({ completionRate5s: 0.6 })];
const lines = [
  { startSec: 0, endSec: 4, text: '开头一句', segment: '开场钩子' },
  { startSec: 4, endSec: 12, text: '背景铺垫很长', segment: '概念A' },
  { startSec: 12, endSec: 20, text: '后面的内容', segment: '概念B' },
];

describe('diagnose', () => {
  it('compares each stage with the usual (bounce: lower is better)', () => {
    const d = diagnose({ work: ms({ bounceRate2s: 0.2, completionRate5s: 0.3, completionRate: 0.1 }), history, lines, benchmark: null, curve: [] });
    const by = Object.fromEntries(d.stages.map((s) => [s.key, s.verdict]));
    expect(by).toMatchObject({ hook2s: 'good', hook5s: 'bad', ending: 'even' });
    expect(d.baselineCount).toBe(4);
  });
  it('maps the average view second onto the transcript', () => {
    const d = diagnose({ work: ms({ avgViewSec: 8.2 }), history, lines, benchmark: null, curve: [] });
    expect(d.dropAt).toEqual({ sec: 8.2, segment: '概念A', line: '背景铺垫很长' });
    expect(d.stages.find((s) => s.key === 'middle')?.note).toContain('平均在第 8 秒离开，这时在讲「概念A」：『背景铺垫很长』');
  });
  it('gives seconds only without a transcript', () => {
    const d = diagnose({ work: ms({ avgViewSec: 8.2 }), history, lines: null, benchmark: null, curve: [] });
    expect(d.dropAt).toEqual({ sec: 8.2, segment: null, line: null });
    expect(d.stages.find((s) => s.key === 'middle')?.note).toContain('平均在第 8 秒离开（没有转写，对不到具体句子）');
  });
  it('does not compare when history has fewer than 3 works', () => {
    const d = diagnose({ work: ms({}), history: history.slice(0, 2), lines, benchmark: null, curve: [] });
    expect(d.stages.every((s) => s.verdict === 'na')).toBe(true);
    expect(d.stages[0].note).toContain('历史作品太少');
  });
  it('compares like multiples with the benchmark', () => {
    const d = diagnose({ work: ms({ likeCount: 40 }), history, lines, benchmark: { digg: 4008, baselineDigg: 466 }, curve: [] });
    expect(d.benchmark).toEqual({ theirRatio: 8.6, myRatio: 2 });
  });
  it('assigns transcript lines to script segments by character overlap', () => {
    const segs = [{ label: '开场钩子', text: '做电商的先别买剪辑课' }, { label: '概念A', text: '打开豆包点技能入口接入Flova' }];
    const out = assignSegments(segs, [
      { startSec: 0, endSec: 3, text: '做电商的，先别买剪辑课' },
      { startSec: 3, endSec: 7, text: '打开豆包，点技能入口' },
      { startSec: 7, endSec: 9, text: '哈哈哈哈' },
    ]);
    expect(out.map((l) => l.segment)).toEqual(['开场钩子', '概念A', null]);
  });
  it('computes rate stages from counts', () => {
    const b = computeBaseline(history);
    expect(b.medians.like).toBeCloseTo(0.02);
    expect(b.likeMedian).toBe(20);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/diagnose.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/retro/diagnose.ts`**

```ts
import { median } from '@/lib/benchmark/rules';

export const BASELINE_SIZE = 10;
export const MIN_BASELINE = 3;
export const THRESHOLD = 0.2;

export interface MetricSet {
  viewCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  shareCount: number | null;
  subscribeCount: number | null;
  completionRate: number | null;
  completionRate5s: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
}

export type Verdict = 'good' | 'even' | 'bad' | 'na';
type Key = 'hook2s' | 'hook5s' | 'middle' | 'ending' | 'like' | 'favorite' | 'share' | 'subscribe';

export interface StageResult {
  key: Key;
  label: string;
  value: number | null;
  baseline: number | null;
  verdict: Verdict;
  note: string;
}

export interface Diagnosis {
  stages: StageResult[];
  baselineCount: number;
  dropAt: { sec: number; segment: string | null; line: string | null } | null;
  benchmark: { theirRatio: number; myRatio: number | null } | null;
  curve: { day: string; viewCount: number | null; likeCount: number | null }[];
}

const rate = (n: number | null, v: number | null) => (n === null || !v ? null : n / v);

function values(m: MetricSet): Record<Key, number | null> {
  return {
    hook2s: m.bounceRate2s,
    hook5s: m.completionRate5s,
    middle: m.avgViewSec,
    ending: m.completionRate,
    like: rate(m.likeCount, m.viewCount),
    favorite: rate(m.favoriteCount, m.viewCount),
    share: rate(m.shareCount, m.viewCount),
    subscribe: rate(m.subscribeCount, m.viewCount),
  };
}

const LABEL: Record<Key, string> = {
  hook2s: '开头 2 秒（跳出率）',
  hook5s: '前 5 秒（完播率）',
  middle: '中段（平均观看）',
  ending: '收尾（完播率）',
  like: '点赞率',
  favorite: '收藏率',
  share: '分享率',
  subscribe: '吸粉率',
};

const charSet = (s: string) => new Set(Array.from(s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()));

/** 每句转写归到字重合度最高的那段稿子; 最高也不到 30%(临场发挥)就不归段 */
export function assignSegments(segments: { label: string; text: string }[], lines: { startSec: number; endSec: number; text: string }[]) {
  const segSets = segments.map((s) => ({ label: s.label, set: charSet(s.text) }));
  return lines.map((l) => {
    const ls = charSet(l.text);
    let best: { label: string; r: number } | null = null;
    for (const s of segSets) {
      const r = ls.size ? [...ls].filter((c) => s.set.has(c)).length / ls.size : 0;
      if (!best || r > best.r) best = { label: s.label, r };
    }
    return { ...l, segment: best && best.r >= 0.3 ? best.label : null };
  });
}

export function computeBaseline(history: MetricSet[]) {
  const recent = history.slice(0, BASELINE_SIZE);
  const medians: Partial<Record<Key, number>> = {};
  for (const k of Object.keys(LABEL) as Key[]) {
    const xs = recent.map((m) => values(m)[k]).filter((x): x is number => x !== null);
    if (xs.length >= MIN_BASELINE) medians[k] = median(xs);
  }
  const likes = recent.map((m) => m.likeCount).filter((x): x is number => x !== null);
  return { count: recent.length, medians, likeMedian: likes.length >= MIN_BASELINE ? median(likes) : null };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function verdictOf(key: Key, v: number | null, b: number | null): Verdict {
  if (v === null || b === null || b === 0) return 'na';
  const diff = (v - b) / b;
  const better = key === 'hook2s' ? diff < -THRESHOLD : diff > THRESHOLD;
  const worse = key === 'hook2s' ? diff > THRESHOLD : diff < -THRESHOLD;
  return better ? 'good' : worse ? 'bad' : 'even';
}

export function diagnose(input: {
  work: MetricSet;
  history: MetricSet[];
  lines: { startSec: number; endSec: number; text: string; segment: string | null }[] | null;
  benchmark: { digg: number; baselineDigg: number | null } | null;
  curve: Diagnosis['curve'];
}): Diagnosis {
  const base = computeBaseline(input.history);
  const enough = base.count >= MIN_BASELINE;
  const v = values(input.work);
  const sec = input.work.avgViewSec;
  const hitLine = sec !== null && input.lines ? input.lines.find((l) => sec >= l.startSec && sec < l.endSec) ?? input.lines.at(-1) ?? null : null;
  const dropAt = sec === null ? null : { sec, segment: hitLine?.segment ?? null, line: hitLine?.text ?? null };

  const stages = (Object.keys(LABEL) as Key[]).map((key): StageResult => {
    const value = v[key];
    const baseline = enough ? base.medians[key] ?? null : null;
    const verdict = enough ? verdictOf(key, value, baseline) : 'na';
    let note: string;
    if (key === 'middle' && dropAt) {
      note = dropAt.line
        ? `平均在第 ${Math.round(dropAt.sec)} 秒离开，这时在讲「${dropAt.segment ?? '—'}」：『${dropAt.line}』`
        : `平均在第 ${Math.round(dropAt.sec)} 秒离开（没有转写，对不到具体句子）`;
    } else if (value === null) note = '数据还没出来';
    else note = key === 'middle' ? `${value.toFixed(1)} 秒` : pct(value);
    if (!enough && value !== null) note += `（历史作品太少，暂不和平时比）`;
    else if (baseline !== null) note += `；平时 ${key === 'middle' ? `${baseline.toFixed(1)} 秒` : pct(baseline)}`;
    return { key, label: LABEL[key], value, baseline, verdict, note };
  });

  const benchmark =
    input.benchmark && input.benchmark.baselineDigg
      ? {
          theirRatio: Math.round((input.benchmark.digg / input.benchmark.baselineDigg) * 10) / 10,
          myRatio: base.likeMedian && input.work.likeCount !== null ? Math.round((input.work.likeCount / base.likeMedian) * 10) / 10 : null,
        }
      : null;

  return { stages, baselineCount: base.count, dropAt, benchmark, curve: input.curve };
}
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run tests/lib/retro && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/retro/diagnose.ts tests/lib/retro/diagnose.test.ts
git commit -m "feat(retro): 平时基准与分段诊断(2s/5s/中段对到逐句/收尾/互动, 对标倍数)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 复盘生成与到期复盘

**Files:**
- Create: `src/lib/retro/generate.ts`
- Modify: `scripts/collect-douyin.ts`
- Test: `tests/lib/retro/generate.test.ts`

**Interfaces:**
- Consumes: `diagnose`、`Diagnosis`、`MetricSet`（Task 4）
- Produces:
  - `NarrativeSchema`：`{ summary: string; lessons: { text: string; stage: LessonStage; evidenceMetric: string }[] }`；`LESSON_STAGES = ['topic','hook','opening','middle','ending','interaction','title'] as const`
  - `interface RetroInput { projectId: string; workId: string; publishedAt: Date; work: MetricSet; metricsUpdatedAt: Date | null; history: MetricSet[]; lines: …| null; benchmark: …| null; curve: Diagnosis['curve']; scriptText: string; transcriptText: string; benchmarkAnalysis: string; activeLessons: { id: string; text: string }[] }`
  - `interface RetroDeps { load(projectId: string): Promise<RetroInput | null>; llm: StructuredLLM | null; save(r: { projectId: string; workId: string; dayN: number; diagnosis: Diagnosis; narrative: string | null; narrativeError: string | null; dataAsOf: Date | null; lessons: { text: string; stage: string; evidence: unknown[] }[]; contradictedIds: string[] }): Promise<void>; now(): Date }`
  - `generateRetro(deps: RetroDeps, projectId: string): Promise<{ ok: true } | { ok: false; reason: string }>`
  - `dueRetros(rows: { projectId: string; publishedAt: Date; retroDayN: number | null }[], now: Date): string[]`（满 3 天无复盘 → 生成；满 7 天且 dayN < 7 → 更新）
  - `createRetroDeps(db: PrismaClient): RetroDeps`；`runDueRetros(db: PrismaClient): Promise<string>`（日志一行）

- [ ] **Step 1: 写失败测试 `tests/lib/retro/generate.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { dueRetros, generateRetro, type RetroDeps, type RetroInput } from '@/lib/retro/generate';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-10-02T12:00:00Z');
const ms = { viewCount: 1000, likeCount: 20, favoriteCount: 5, shareCount: 2, subscribeCount: 1, completionRate: 0.1, completionRate5s: 0.5, bounceRate2s: 0.3, avgViewSec: 10 };
const input = (over: Partial<RetroInput> = {}): RetroInput => ({
  projectId: 'p1', workId: 'w1', publishedAt: new Date('2026-09-29T12:00:00Z'), work: ms, metricsUpdatedAt: new Date('2026-10-02T00:00:00Z'),
  history: [ms, ms, ms], lines: null, benchmark: null, curve: [], scriptText: '稿', transcriptText: '转写', benchmarkAnalysis: '', activeLessons: [{ id: 'L1', text: '开头先给结果' }], ...over,
});

function deps(over: Partial<RetroDeps> = {}, llmResult?: unknown) {
  const saved: Parameters<RetroDeps['save']>[0][] = [];
  const llm = { callStructured: vi.fn(async () => ({ result: llmResult ?? { summary: '开头掉人多。', lessons: [{ text: '第一句直接说结果', stage: 'hook', evidenceMetric: 'bounceRate2s' }], contradicts: [] }, usage: {} })) } as unknown as StructuredLLM;
  const d: RetroDeps = { load: async () => input(), llm, save: async (r) => void saved.push(r), now: () => now, ...over };
  return { d, saved };
}

describe('generateRetro', () => {
  it('saves diagnosis, narrative and candidate lessons with evidence', async () => {
    const { d, saved } = deps();
    expect(await generateRetro(d, 'p1')).toEqual({ ok: true });
    expect(saved[0]).toMatchObject({ dayN: 3, narrative: '开头掉人多。', narrativeError: null });
    expect(saved[0].lessons[0]).toMatchObject({ text: '第一句直接说结果', stage: 'hook' });
    expect(saved[0].lessons[0].evidence[0]).toMatchObject({ projectId: 'p1', workId: 'w1', metric: 'bounceRate2s', value: 0.3 });
  });
  it('waits when metrics are not out yet', async () => {
    const { d, saved } = deps({ load: async () => input({ work: { ...ms, viewCount: 0 }, metricsUpdatedAt: null }) });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: false, reason: '数据还没出来，明晚回采后再复盘。' });
    expect(saved).toHaveLength(0);
  });
  it('still saves the diagnosis when the model fails', async () => {
    const { d, saved } = deps({ llm: { callStructured: vi.fn(async () => { throw new Error('x'); }) } as unknown as StructuredLLM });
    await generateRetro(d, 'p1');
    expect(saved[0]).toMatchObject({ narrative: null, narrativeError: '编导解读没写出来，点重试。' });
    expect(saved[0].diagnosis.stages.length).toBeGreaterThan(0);
  });
  it('keeps at most 3 valid lessons and passes contradicted ids', async () => {
    const lessons = [1, 2, 3, 4].map((i) => ({ text: `经验${i}`, stage: i === 2 ? 'bogus' : 'hook', evidenceMetric: 'bounceRate2s' }));
    const { d, saved } = deps({}, { summary: 's', lessons, contradicts: ['L1', 'not-a-lesson'] });
    await generateRetro(d, 'p1');
    expect(saved[0].lessons.map((l) => l.text)).toEqual(['经验1', '经验3', '经验4']);
    expect(saved[0].contradictedIds).toEqual(['L1']);
  });
});

describe('dueRetros', () => {
  it('generates at day 3 and updates once at day 7', () => {
    const d = (days: number) => new Date(now.getTime() - days * 86400_000);
    expect(dueRetros([
      { projectId: 'a', publishedAt: d(2), retroDayN: null },
      { projectId: 'b', publishedAt: d(3.1), retroDayN: null },
      { projectId: 'c', publishedAt: d(7.2), retroDayN: 3 },
      { projectId: 'e', publishedAt: d(8), retroDayN: 7 },
    ], now)).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/generate.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/retro/generate.ts`**

```ts
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { StructuredLLM } from '@/lib/script/write';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { loadCurrentTranscript } from '@/lib/recording/transcript';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { assignSegments, diagnose, type Diagnosis, type MetricSet } from './diagnose';

export const LESSON_STAGES = ['topic', 'hook', 'opening', 'middle', 'ending', 'interaction', 'title'] as const;

export const NarrativeSchema = z.object({
  summary: z.string().min(1),
  lessons: z.array(z.object({ text: z.string().min(1), stage: z.string(), evidenceMetric: z.string() })).max(10),
  contradicts: z.array(z.string()).default([]),
});

export interface RetroInput {
  projectId: string;
  workId: string;
  publishedAt: Date;
  work: MetricSet;
  metricsUpdatedAt: Date | null;
  history: MetricSet[];
  lines: { startSec: number; endSec: number; text: string; segment: string | null }[] | null;
  benchmark: { digg: number; baselineDigg: number | null } | null;
  curve: Diagnosis['curve'];
  scriptText: string;
  transcriptText: string;
  benchmarkAnalysis: string;
  activeLessons: { id: string; text: string }[];
}

export interface RetroDeps {
  load(projectId: string): Promise<RetroInput | null>;
  llm: StructuredLLM | null;
  save(r: {
    projectId: string;
    workId: string;
    dayN: number;
    diagnosis: Diagnosis;
    narrative: string | null;
    narrativeError: string | null;
    dataAsOf: Date | null;
    lessons: { text: string; stage: string; evidence: unknown[] }[];
    contradictedIds: string[];
  }): Promise<void>;
  now(): Date;
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类博主的编导，读一份复盘诊断，给博主解读并提炼写法经验。
- summary：3～5 句，说这条为什么火或不火。只能引用诊断里给出的数字；没把握的原因写"数据看不出原因"，不编。
- lessons：0～3 条写法经验，每条是一句能直接照做的规矩（如"开头第一句直接说结果"），stage 取 topic/hook/opening/middle/ending/interaction/title 之一，evidenceMetric 写它依据的指标名（bounceRate2s/completionRate5s/avgViewSec/completionRate/likeRate/favoriteRate/shareRate/subscribeRate）。
- contradicts：已生效经验里，这次数据明显没应验的经验 id（没有就给空数组）。
只输出 JSON。`;

const METRIC_VALUE: Record<string, (d: Diagnosis) => { value: number | null; baseline: number | null }> = {};
for (const [metric, key] of [
  ['bounceRate2s', 'hook2s'],
  ['completionRate5s', 'hook5s'],
  ['avgViewSec', 'middle'],
  ['completionRate', 'ending'],
  ['likeRate', 'like'],
  ['favoriteRate', 'favorite'],
  ['shareRate', 'share'],
  ['subscribeRate', 'subscribe'],
] as const) {
  METRIC_VALUE[metric] = (d) => {
    const s = d.stages.find((x) => x.key === key);
    return { value: s?.value ?? null, baseline: s?.baseline ?? null };
  };
}

export async function generateRetro(deps: RetroDeps, projectId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const input = await deps.load(projectId);
  if (!input) return { ok: false, reason: '这个项目还没关联发布的作品。' };
  if (!input.work.viewCount) return { ok: false, reason: '数据还没出来，明晚回采后再复盘。' };
  const now = deps.now();
  const dayN = Math.max(1, Math.floor((now.getTime() - input.publishedAt.getTime()) / 86400_000));
  const diagnosis = diagnose({ work: input.work, history: input.history, lines: input.lines, benchmark: input.benchmark, curve: input.curve });

  let narrative: string | null = null;
  let narrativeError: string | null = null;
  let lessons: { text: string; stage: string; evidence: unknown[] }[] = [];
  let contradictedIds: string[] = [];
  if (!deps.llm) narrativeError = '没有配置 DeepSeek key，编导解读需要它：去设置页填入后点重试。';
  else {
    try {
      const { result } = await deps.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [
          {
            type: 'text',
            text: [
              `【诊断】\n${diagnosis.stages.map((s) => `${s.label}：${s.note}（${s.verdict}）`).join('\n')}`,
              diagnosis.benchmark ? `【对标】对标点赞是他平时的 ${diagnosis.benchmark.theirRatio} 倍；这条是你平时的 ${diagnosis.benchmark.myRatio ?? '?'} 倍` : '',
              `【定稿】\n${input.scriptText}`,
              input.transcriptText ? `【实际口播】\n${input.transcriptText}` : '',
              input.benchmarkAnalysis ? `【对标拆解】\n${input.benchmarkAnalysis}` : '',
              input.activeLessons.length ? `【已生效的写法经验】\n${input.activeLessons.map((l) => `[${l.id}] ${l.text}`).join('\n')}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        responseSchema: NarrativeSchema,
      });
      narrative = result.summary;
      lessons = result.lessons
        .filter((l) => (LESSON_STAGES as readonly string[]).includes(l.stage))
        .slice(0, 3)
        .map((l) => {
          const ev = METRIC_VALUE[l.evidenceMetric]?.(diagnosis) ?? { value: null, baseline: null };
          return { text: l.text, stage: l.stage, evidence: [{ projectId: input.projectId, workId: input.workId, metric: l.evidenceMetric, ...ev }] };
        });
      const active = new Set(input.activeLessons.map((l) => l.id));
      contradictedIds = result.contradicts.filter((id) => active.has(id));
    } catch {
      narrativeError = '编导解读没写出来，点重试。';
    }
  }
  await deps.save({ projectId, workId: input.workId, dayN, diagnosis, narrative, narrativeError, dataAsOf: input.metricsUpdatedAt, lessons, contradictedIds });
  return { ok: true };
}

export function dueRetros(rows: { projectId: string; publishedAt: Date; retroDayN: number | null }[], now: Date): string[] {
  return rows
    .filter((r) => {
      const days = (now.getTime() - r.publishedAt.getTime()) / 86400_000;
      if (r.retroDayN === null) return days >= 3;
      return days >= 7 && r.retroDayN < 7;
    })
    .map((r) => r.projectId);
}

const toMetricSet = (w: {
  viewCount: number | null;
  likeCount: number | null;
  favoriteCount: number | null;
  shareCount: number | null;
  subscribeCount: number | null;
  completionRate: number | null;
  completionRate5sWl: number | null;
  completionRate5s: number | null;
  bounceRate2sWl: number | null;
  bounceRate2s: number | null;
  avgViewSec: number | null;
}): MetricSet => ({
  viewCount: w.viewCount,
  likeCount: w.likeCount,
  favoriteCount: w.favoriteCount,
  shareCount: w.shareCount,
  subscribeCount: w.subscribeCount,
  completionRate: w.completionRate,
  completionRate5s: w.completionRate5sWl ?? w.completionRate5s,
  bounceRate2s: w.bounceRate2sWl ?? w.bounceRate2s,
  avgViewSec: w.avgViewSec,
});

export function createRetroDeps(db: PrismaClient): RetroDeps {
  const key = getDeepSeekKey();
  return {
    llm: key ? new DeepSeekTextLLM({ apiKey: key }) : null,
    now: () => new Date(),
    async load(projectId) {
      const work = await db.publishedWork.findFirst({ where: { projectId }, orderBy: { publishedAt: 'desc' } });
      if (!work) return null;
      const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: { include: { account: true } } } });
      const history = await db.publishedWork.findMany({
        where: { isPrivate: false, id: { not: work.id }, viewCount: { gt: 0 } },
        orderBy: { publishedAt: 'desc' },
        take: 10,
      });
      const snaps = await db.workMetricSnapshot.findMany({ where: { workId: work.id }, orderBy: { day: 'asc' }, take: 7 });
      const script = ScriptSchema.safeParse(p.script);
      const t = await loadCurrentTranscript(db, projectId);
      let lines: RetroInput['lines'] = null;
      if (t) {
        const segs = script.success ? script.data.segments.map((s) => ({ label: ROLE_LABEL[s.role], text: s.text })) : [];
        lines = assignSegments(segs, t.data.lines.map((l) => ({ startSec: l.startSec, endSec: l.endSec, text: l.text })));
      }
      const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
      const active = await db.writingLesson.findMany({ where: { status: 'active' }, orderBy: { confirmedAt: 'desc' }, take: 10 });
      return {
        projectId,
        workId: work.id,
        publishedAt: work.publishedAt,
        work: toMetricSet(work),
        metricsUpdatedAt: work.metricsUpdatedAt,
        history: history.map(toMetricSet),
        lines,
        benchmark: p.benchmarkVideo ? { digg: p.benchmarkVideo.digg, baselineDigg: p.benchmarkVideo.account.baselineDigg } : null,
        curve: snaps.map((s) => ({ day: s.day, viewCount: s.viewCount, likeCount: s.likeCount })),
        scriptText: script.success ? script.data.segments.map((s) => `${ROLE_LABEL[s.role]}：${s.text}`).join('\n') : '',
        transcriptText: t ? t.data.lines.map((l) => l.text).join('\n') : '',
        benchmarkAnalysis: a?.success ? `选题：${a.data.topic}；钩子（${a.data.hook.type}）：${a.data.hook.quote}` : '',
        activeLessons: active.map((l) => ({ id: l.id, text: l.text })),
      };
    },
    async save(r) {
      const data = {
        workId: r.workId,
        dayN: r.dayN,
        diagnosis: r.diagnosis as unknown as Prisma.InputJsonValue,
        narrative: r.narrative,
        narrativeError: r.narrativeError,
        dataAsOf: r.dataAsOf,
      };
      const retro = await db.retro.upsert({ where: { projectId: r.projectId }, update: data, create: { projectId: r.projectId, ...data } });
      // 本次复盘的旧候选(未处理的)换成新的
      await db.writingLesson.deleteMany({ where: { retroId: retro.id, status: 'candidate' } });
      for (const l of r.lessons) {
        await db.writingLesson.create({ data: { text: l.text, stage: l.stage, evidence: l.evidence as Prisma.InputJsonValue, retroId: retro.id } });
      }
      if (r.contradictedIds.length) await db.writingLesson.updateMany({ where: { id: { in: r.contradictedIds } }, data: { contradicted: true } });
    },
  };
}

export async function runDueRetros(db: PrismaClient): Promise<string> {
  const works = await db.publishedWork.findMany({ where: { projectId: { not: null }, isPrivate: false }, include: { project: { include: { retro: true } } } });
  const due = dueRetros(
    works.filter((w) => w.project).map((w) => ({ projectId: w.projectId!, publishedAt: w.publishedAt, retroDayN: w.project!.retro?.dayN ?? null })),
    new Date(),
  );
  const deps = createRetroDeps(db);
  let done = 0;
  const waiting: string[] = [];
  for (const id of due) {
    const r = await generateRetro(deps, id);
    if (r.ok) done++;
    else waiting.push(r.reason);
  }
  return `复盘: 到期 ${due.length} 个, 生成 ${done} 个${waiting.length ? `, 等数据 ${waiting.length} 个` : ''}`;
}
```


`scripts/collect-douyin.ts`：在「作品指标」那一步之后加独立失败的一步：

```ts
    // 到期复盘(发布第 3 天生成、第 7 天更新) —— 独立失败
    try {
      log(await runDueRetros(prisma));
    } catch (e) {
      log(`复盘生成失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/retro/generate.ts scripts/collect-douyin.ts tests/lib/retro/generate.test.ts
git commit -m "feat(retro): 复盘生成(诊断 + 编导解读 + 经验候选, 模型失败不影响诊断) + 每晚到期复盘

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 写法经验进编导

**Files:**
- Create: `src/lib/retro/lessons.ts`
- Modify: `src/lib/agent/context.ts`、`src/lib/script/write.ts`、`src/lib/tools/write-script.ts`、`tests/helpers/fake-db.ts`
- Test: `tests/lib/retro/lessons.test.ts`、`tests/lib/agent/context.test.ts`（加用例）、`tests/lib/tools/write-script.test.ts`（加用例）

**Interfaces:**
- Produces（`lessons.ts`）：`MAX_ACTIVE_LESSONS = 10`；`interface LessonForPrompt { text: string; evidenceCount: number }`；`formatLessons(ls: LessonForPrompt[]): string`；`loadActiveLessons(db: PrismaClient): Promise<LessonForPrompt[]>`
- Produces：`formatSystemPrompt` 参数加 `lessons?: LessonForPrompt[]`；`writeScript` opts 加 `lessons?: string`
- Produces（`fake-db.ts`）：seed 加 `lessons?: { text: string; evidence: unknown[] }[]`，`db.writingLesson.findMany` 返回它们

- [ ] **Step 1: 写失败测试**

`tests/lib/retro/lessons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatLessons } from '@/lib/retro/lessons';

describe('formatLessons', () => {
  it('lists lessons and marks thin evidence', () => {
    expect(formatLessons([{ text: '第一句直接说结果', evidenceCount: 1 }, { text: '结尾别拖', evidenceCount: 3 }])).toBe('- 第一句直接说结果（证据少：1 条作品）\n- 结尾别拖（3 条作品）');
  });
  it('is empty without lessons', () => {
    expect(formatLessons([])).toBe('');
  });
});
```

`tests/lib/agent/context.test.ts`（`formatSystemPrompt` 那个 describe 里）追加：

```ts
  it('adds active writing lessons from the user own retros', () => {
    const p = formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null, lessons: [{ text: '第一句直接说结果', evidenceCount: 1 }] });
    expect(p).toContain('【写法经验】（来自你自己的复盘）\n- 第一句直接说结果（证据少：1 条作品）');
  });
```

`tests/lib/tools/write-script.test.ts`（`write_script tool` describe 里）追加：

```ts
  it('passes active writing lessons to the writer', async () => {
    const msgs: string[] = [];
    const spy: StructuredLLM = {
      callStructured: (async (o: { userMessage: { text: string }[] }) => {
        msgs.push(o.userMessage[0].text);
        return { result: { title: 't', segments: onBudget.map((n) => ({ role: 'x', text: '字'.repeat(n) })) }, usage: {} };
      }) as unknown as StructuredLLM['callStructured'],
    };
    const { db } = createFakeDb({ lessons: [{ text: '第一句直接说结果', evidence: [{}, {}] }] });
    await writeScriptTool.execute({ projectId: 'p1', db, llm: spy }, { direction: 'x' });
    expect(msgs[0]).toContain('【写法经验】');
    expect(msgs[0]).toContain('第一句直接说结果（2 条作品）');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/lessons.test.ts tests/lib/agent tests/lib/tools`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/retro/lessons.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

export const MAX_ACTIVE_LESSONS = 10;

export interface LessonForPrompt {
  text: string;
  evidenceCount: number;
}

export function formatLessons(ls: LessonForPrompt[]): string {
  return ls.map((l) => `- ${l.text}（${l.evidenceCount <= 1 ? `证据少：${l.evidenceCount} 条作品` : `${l.evidenceCount} 条作品`}）`).join('\n');
}

export async function loadActiveLessons(db: PrismaClient): Promise<LessonForPrompt[]> {
  const rows = await db.writingLesson.findMany({ where: { status: 'active' }, orderBy: { confirmedAt: 'desc' }, take: MAX_ACTIVE_LESSONS });
  return rows.map((r) => ({ text: r.text, evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0 }));
}
```

`src/lib/agent/context.ts`：`formatSystemPrompt` 参数加 `lessons?: LessonForPrompt[]`；在【账号定位】之后插入 `p.lessons?.length ? `【写法经验】（来自你自己的复盘）\n${formatLessons(p.lessons)}` : ''`；RULES 加一行 `- 有【写法经验】时：写稿遵守；和用户这次的要求冲突时听用户的。`；`buildSystemPrompt` 传 `lessons: await loadActiveLessons(db)`。

`src/lib/script/write.ts`：opts 加 `lessons?: string`；`firstMessage` 在【这条讲什么】之前拼 `${lessons ? `【写法经验】（来自用户自己的复盘，写稿遵守）\n${lessons}\n\n` : ''}`（第五个参数）。

`src/lib/tools/write-script.ts`：`const lessons = await loadActiveLessons(ctx.db);` 传 `lessons: lessons.length ? formatLessons(lessons) : undefined`。

`tests/helpers/fake-db.ts`：seed 加 `lessons?`；db 加：

```ts
    writingLesson: {
      findMany: async () => (seed.lessons ?? []).map((l, i) => ({ id: `L${i}`, text: l.text, evidence: l.evidence, status: 'active', confirmedAt: new Date() })),
    },
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/retro/lessons.ts src/lib/agent/context.ts src/lib/script/write.ts src/lib/tools/write-script.ts tests
git commit -m "feat(retro): 采纳的写法经验进编导上下文与写稿请求(证据少的标出)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 接口

**Files:**
- Create: `src/lib/retro/view.ts`、`src/app/api/projects/[id]/publish/route.ts`、`src/app/api/projects/[id]/publish/kit/route.ts`、`src/app/api/projects/[id]/publish/link/route.ts`、`src/app/api/projects/[id]/publish/dismiss/route.ts`、`src/app/api/projects/[id]/publish/retro/route.ts`、`src/app/api/lessons/route.ts`、`src/app/api/lessons/[id]/route.ts`、`src/app/api/retro/route.ts`
- Test: `tests/lib/retro/view.test.ts`

**Interfaces:**
- Produces（`view.ts`）：
  - `interface LessonView { id: string; text: string; stage: string; stageLabel: string; status: string; evidenceCount: number; contradicted: boolean; confirmedAt: string | null }`
  - `STAGE_LABEL: Record<string, string>`（topic 选题 / hook 开头钩子 / opening 开头 / middle 中段 / ending 收尾 / interaction 互动 / title 标题）
  - `toLessonView(row): LessonView`
- HTTP：
  - `GET /api/projects/[id]/publish` → `{ kit: PublishKit | null; work: { id, text, publishedAt, viewCount, likeCount } | null; candidate: { workId, text, publishedAt } | null; retro: { dayN, diagnosis, narrative, narrativeError, dataAsOf, updatedAt } | null; lessons: LessonView[] }`
  - `POST …/publish/kit` → 生成并保存，返回 `PublishKit`
  - `POST …/publish/link` body `{ workId } | { text }` → 关联（text 走 `resolveLink`；库里没有 → 400 "等今晚回采后再关联"）
  - `POST …/publish/dismiss` body `{ workId }`
  - `POST …/publish/retro` → `generateRetro`；`{ ok:false }` → 400 reason
  - `GET /api/lessons` → `LessonView[]`（候选、生效、停用；不含 rejected）
  - `PATCH /api/lessons/[id]` body `{ status?: 'active'|'retired'|'rejected'; text?: string }`（active 时写 `confirmedAt`、清 `contradicted`）
  - `GET /api/retro` → 已关联作品的项目列表 `{ projectId, title, publishedAt, retroDayN, verdicts: { hook2s, hook5s, ending, like } , pendingCandidate: boolean }[]`，另附 `pendingLinks: { projectId, title }[]`（有候选未确认的项目）

- [ ] **Step 1: 写失败测试 `tests/lib/retro/view.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { toLessonView } from '@/lib/retro/view';

describe('toLessonView', () => {
  it('labels the stage and counts evidence', () => {
    expect(toLessonView({ id: 'L1', text: '第一句直接说结果', stage: 'hook', status: 'active', evidence: [{}, {}], contradicted: true, confirmedAt: new Date('2026-10-01T00:00:00Z') })).toEqual({
      id: 'L1', text: '第一句直接说结果', stage: 'hook', stageLabel: '开头钩子', status: 'active', evidenceCount: 2, contradicted: true, confirmedAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/retro/view.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `view.ts` 与接口**

`src/lib/retro/view.ts`:

```ts
export const STAGE_LABEL: Record<string, string> = { topic: '选题', hook: '开头钩子', opening: '开头', middle: '中段', ending: '收尾', interaction: '互动', title: '标题' };

export interface LessonView {
  id: string;
  text: string;
  stage: string;
  stageLabel: string;
  status: string;
  evidenceCount: number;
  contradicted: boolean;
  confirmedAt: string | null;
}

export function toLessonView(r: { id: string; text: string; stage: string; status: string; evidence: unknown; contradicted: boolean; confirmedAt: Date | null }): LessonView {
  return {
    id: r.id,
    text: r.text,
    stage: r.stage,
    stageLabel: STAGE_LABEL[r.stage] ?? r.stage,
    status: r.status,
    evidenceCount: Array.isArray(r.evidence) ? r.evidence.length : 0,
    contradicted: r.contradicted,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  };
}
```

`src/app/api/projects/[id]/publish/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { findCandidate } from '@/lib/retro/match';
import { PublishKitSchema } from '@/lib/retro/publish-kit';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id }, include: { retro: true } });
  if (!p) return fail('找不到这个项目', 404);
  const w = await prisma.publishedWork.findFirst({ where: { projectId: p.id }, orderBy: { publishedAt: 'desc' } });
  const kit = PublishKitSchema.safeParse(p.publishKit);
  const lessons = p.retro ? await prisma.writingLesson.findMany({ where: { retroId: p.retro.id, status: { not: 'rejected' } }, orderBy: { createdAt: 'asc' } }) : [];
  return ok({
    kit: kit.success ? kit.data : null,
    work: w ? { id: w.id, text: (w.title || w.caption).slice(0, 80), publishedAt: w.publishedAt.toISOString(), viewCount: w.viewCount ?? w.play, likeCount: w.likeCount ?? w.digg } : null,
    candidate: w ? null : await findCandidate(prisma, p.id),
    retro: p.retro
      ? { dayN: p.retro.dayN, diagnosis: p.retro.diagnosis, narrative: p.retro.narrative, narrativeError: p.retro.narrativeError, dataAsOf: p.retro.dataAsOf?.toISOString() ?? null, updatedAt: p.retro.updatedAt.toISOString() }
      : null,
    lessons: lessons.map(toLessonView),
  });
}
```

`…/publish/kit/route.ts`:

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { generatePublishKit } from '@/lib/retro/publish-kit';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const key = getDeepSeekKey();
  if (!key) return fail('没有配置 DeepSeek key：去设置页填入后再试。', 400);
  const p = await prisma.project.findUnique({ where: { id: params.id }, include: { benchmarkVideo: true } });
  if (!p) return fail('找不到这个项目', 404);
  const s = ScriptSchema.safeParse(p.script);
  if (!s.success) return fail('还没有稿子，先写稿再生成发布文案。', 400);
  const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
  try {
    const kit = await generatePublishKit(new DeepSeekTextLLM({ apiKey: key }), {
      scriptText: s.data.segments.map((x) => `${ROLE_LABEL[x.role]}：${x.text}`).join('\n'),
      personaText: formatPersona((p.personaSnapshot as PersonaLike | null) ?? null),
      benchmarkTitlePattern: a?.success ? a.data.titlePattern : undefined,
    });
    await prisma.project.update({ where: { id: p.id }, data: { publishKit: kit as unknown as Prisma.InputJsonValue } });
    return ok(kit);
  } catch {
    return fail('发布文案没写出来（DeepSeek 没按格式回答），再点一次。', 502);
  }
}
```

`…/publish/link/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { resolveLink } from '@/lib/benchmark/link';
import { linkWork } from '@/lib/retro/match';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { workId?: string; text?: string };
  let workId = typeof body.workId === 'string' ? body.workId : null;
  if (!workId && typeof body.text === 'string') {
    const t = await resolveLink(body.text).catch(() => null);
    if (!t || t.kind !== 'video') return fail('这不是抖音视频链接。在抖音里点「分享 → 复制链接」再粘贴。', 400);
    const w = await prisma.publishedWork.findFirst({ where: { platform: 'douyin', externalId: t.awemeId } });
    if (!w) return fail('库里还没有这条作品（可能刚发布），等今晚回采后再关联。', 400);
    workId = w.id;
  }
  if (!workId) return fail('没指定作品', 400);
  try {
    await linkWork(prisma, params.id, workId);
  } catch (e) {
    return fail(e instanceof Error ? e.message : '关联失败', 400);
  }
  return ok({ linked: true });
}
```

`…/publish/dismiss/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { dismissWork } from '@/lib/retro/match';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const { workId } = (await req.json().catch(() => ({}))) as { workId?: string };
  if (typeof workId !== 'string') return fail('没指定作品', 400);
  await dismissWork(prisma, workId);
  return ok({ dismissed: true });
}
```

`…/publish/retro/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createRetroDeps, generateRetro } from '@/lib/retro/generate';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const r = await generateRetro(createRetroDeps(prisma), params.id);
  return r.ok ? ok({ done: true }) : fail(r.reason, 400);
}
```

`src/app/api/lessons/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.writingLesson.findMany({ where: { status: { not: 'rejected' } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  return ok(rows.map(toLessonView));
}
```

`src/app/api/lessons/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { status?: string; text?: string };
  const l = await prisma.writingLesson.findUnique({ where: { id: params.id } });
  if (!l) return fail('找不到这条经验', 404);
  if (body.status && !['active', 'retired', 'rejected'].includes(body.status)) return fail('状态不对', 400);
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;
  if (text !== undefined && (text.length < 4 || text.length > 80)) return fail('经验写成一句话（4～80 字）', 400);
  const row = await prisma.writingLesson.update({
    where: { id: l.id },
    data: {
      ...(text !== undefined ? { text } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.status === 'active' ? { confirmedAt: new Date(), contradicted: false } : {}),
    },
  });
  return ok(toLessonView(row));
}
```

`src/app/api/retro/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { findCandidate } from '@/lib/retro/match';
import type { Diagnosis } from '@/lib/retro/diagnose';

export const dynamic = 'force-dynamic';

export async function GET() {
  const works = await prisma.publishedWork.findMany({ where: { projectId: { not: null } }, include: { project: { include: { retro: true } } }, orderBy: { publishedAt: 'desc' } });
  const published = works
    .filter((w) => w.project)
    .map((w) => {
      const d = w.project!.retro?.diagnosis as Diagnosis | undefined;
      const v = (k: string) => d?.stages.find((s) => s.key === k)?.verdict ?? 'na';
      return { projectId: w.project!.id, title: w.project!.title, publishedAt: w.publishedAt.toISOString(), retroDayN: w.project!.retro?.dayN ?? null, verdicts: { hook2s: v('hook2s'), hook5s: v('hook5s'), ending: v('ending'), like: v('like') } };
    });
  const finals = await prisma.project.findMany({ where: { stage: 'final' }, select: { id: true, title: true } });
  const pendingLinks = [];
  for (const p of finals) if (await findCandidate(prisma, p.id)) pendingLinks.push({ projectId: p.id, title: p.title });
  return ok({ published, pendingLinks });
}
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/retro/view.ts src/app/api/projects src/app/api/lessons src/app/api/retro tests/lib/retro/view.test.ts
git commit -m "feat(retro): 发布与复盘接口(发布文案/关联/驳回/复盘/写法经验/复盘列表)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 界面

**Files:**
- Create: `src/components/project/publish-pane.tsx`、`src/components/retro/diagnosis-view.tsx`、`src/components/retro/lesson-card.tsx`、`src/app/retro/page.tsx`、`src/components/retro/retro-view.tsx`
- Modify: `src/components/project/project-workspace.tsx`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/app/api/projects/[id]/route.ts`（如需返回 published 阶段文案）、首页 `STAGE_TEXT`、`src/lib/agent/context.ts` 的 `STAGE_LABEL`
- Test: `tests/components/retro/diagnosis-view.test.tsx`、`tests/components/retro/lesson-card.test.tsx`

**Interfaces:**
- Consumes: Task 7 全部接口；`Diagnosis`、`LessonView`、`PublishKit`
- Produces: `DiagnosisView({ diagnosis }: { diagnosis: Diagnosis })`；`LessonCard({ lesson, onChanged }: { lesson: LessonView; onChanged: () => void })`；`PublishPane({ projectId }: { projectId: string })`

- [ ] **Step 1: 写失败测试**

`tests/components/retro/diagnosis-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DiagnosisView } from '@/components/retro/diagnosis-view';
import type { Diagnosis } from '@/lib/retro/diagnose';

afterEach(cleanup);

const d: Diagnosis = {
  stages: [
    { key: 'hook2s', label: '开头 2 秒（跳出率）', value: 0.2, baseline: 0.3, verdict: 'good', note: '20.0%；平时 30.0%' },
    { key: 'middle', label: '中段（平均观看）', value: 8.2, baseline: 10, verdict: 'bad', note: '平均在第 8 秒离开，这时在讲「概念A」：『背景铺垫很长』；平时 10.0 秒' },
  ],
  baselineCount: 4,
  dropAt: { sec: 8.2, segment: '概念A', line: '背景铺垫很长' },
  benchmark: { theirRatio: 8.6, myRatio: 1.2 },
  curve: [{ day: '2026-09-30', viewCount: 500, likeCount: 10 }, { day: '2026-10-01', viewCount: 900, likeCount: 18 }],
};

describe('DiagnosisView', () => {
  it('shows each stage with its verdict and note', () => {
    render(<DiagnosisView diagnosis={d} />);
    expect(screen.getByText('开头 2 秒（跳出率）')).toBeTruthy();
    expect(screen.getByText('比平时好')).toBeTruthy();
    expect(screen.getByText('比平时差')).toBeTruthy();
    expect(screen.getByText(/这时在讲「概念A」/)).toBeTruthy();
  });
  it('shows the benchmark comparison and the curve', () => {
    render(<DiagnosisView diagnosis={d} />);
    expect(screen.getByText('对标这条是他平时的 8.6 倍，你这条是你平时的 1.2 倍')).toBeTruthy();
    expect(screen.getByText('第 2 天')).toBeTruthy();
  });
});
```

`tests/components/retro/lesson-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LessonCard } from '@/components/retro/lesson-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lesson = { id: 'L1', text: '第一句直接说结果', stage: 'hook', stageLabel: '开头钩子', status: 'candidate', evidenceCount: 1, contradicted: false, confirmedAt: null };

describe('LessonCard', () => {
  it('adopts a candidate', async () => {
    const f = vi.fn(async () => ({ json: async () => ({ success: true, data: {} }) }));
    vi.stubGlobal('fetch', f);
    const onChanged = vi.fn();
    render(<LessonCard lesson={lesson} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('采纳'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ status: 'active' });
  });
  it('asks to retire an active lesson the latest retro contradicted', () => {
    render(<LessonCard lesson={{ ...lesson, status: 'active', contradicted: true }} onChanged={() => {}} />);
    expect(screen.getByText('最近一次复盘没应验，要不要停用？')).toBeTruthy();
    expect(screen.getByText('证据少：1 条作品')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/retro`
Expected: FAIL。

- [ ] **Step 3: `src/components/retro/diagnosis-view.tsx`**

```tsx
import type { Diagnosis, Verdict } from '@/lib/retro/diagnose';

const VERDICT: Record<Verdict, { text: string; cls: string }> = {
  good: { text: '比平时好', cls: 'text-[var(--success)]' },
  even: { text: '和平时差不多', cls: 'text-[var(--text-secondary)]' },
  bad: { text: '比平时差', cls: 'text-[var(--danger)]' },
  na: { text: '', cls: '' },
};

export function DiagnosisView({ diagnosis: d }: { diagnosis: Diagnosis }) {
  const maxView = Math.max(1, ...d.curve.map((c) => c.viewCount ?? 0));
  return (
    <div className="space-y-4 text-sm">
      <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
        {d.stages.map((s) => (
          <li key={s.key} className="px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{s.label}</span>
              {s.verdict !== 'na' && <span className={`text-xs ${VERDICT[s.verdict].cls}`}>{VERDICT[s.verdict].text}</span>}
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{s.note}</p>
          </li>
        ))}
      </ul>
      {d.benchmark && (
        <p className="text-xs text-[var(--text-secondary)]">{`对标这条是他平时的 ${d.benchmark.theirRatio} 倍，你这条是你平时的 ${d.benchmark.myRatio ?? '?'} 倍`}</p>
      )}
      {d.curve.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-[var(--text-tertiary)]">发布后每天的播放</div>
          <div className="flex items-end gap-2">
            {d.curve.map((c, i) => (
              <div key={c.day} className="flex flex-1 flex-col items-center gap-1">
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">{c.viewCount ?? '—'}</span>
                <div className="w-full rounded-sm bg-[var(--accent)]" style={{ height: `${Math.max(2, ((c.viewCount ?? 0) / maxView) * 80)}px` }} />
                <span className="text-[10px] text-[var(--text-tertiary)]">{`第 ${i + 1} 天`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `src/components/retro/lesson-card.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { LessonView } from '@/lib/retro/view';

async function patch(id: string, body: object) {
  const res = await fetch(`/api/lessons/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function LessonCard({ lesson: l, onChanged }: { lesson: LessonView; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(l.text);
  const [err, setErr] = useState<string | null>(null);
  const act = async (body: object) => {
    const j = await patch(l.id, body);
    if (!j.success) return setErr(j.message);
    setEditing(false);
    onChanged();
  };
  return (
    <div className="rounded-md border border-[var(--border-subtle)] p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <span>{l.stageLabel}</span>
        <span>{l.evidenceCount <= 1 ? `证据少：${l.evidenceCount} 条作品` : `${l.evidenceCount} 条作品`}</span>
        {l.status === 'active' && <span className="text-[var(--success)]">生效中</span>}
        {l.status === 'retired' && <span>已停用</span>}
      </div>
      {editing ? (
        <input className="mt-1 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1" value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <p className="mt-1">{l.text}</p>
      )}
      {l.contradicted && l.status === 'active' && <p className="mt-1 text-xs text-[var(--warning)]">最近一次复盘没应验，要不要停用？</p>}
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        {l.status === 'candidate' && !editing && (
          <>
            <button className="text-[var(--accent)]" onClick={() => void act({ status: 'active' })}>采纳</button>
            <button className="text-[var(--accent)]" onClick={() => setEditing(true)}>改一下再采纳</button>
            <button className="text-[var(--text-tertiary)]" onClick={() => void act({ status: 'rejected' })}>不要</button>
          </>
        )}
        {editing && <button className="text-[var(--accent)]" onClick={() => void act({ text, status: 'active' })}>保存并采纳</button>}
        {l.status === 'active' && <button className="text-[var(--text-tertiary)]" onClick={() => void act({ status: 'retired' })}>停用</button>}
        {l.status === 'retired' && <button className="text-[var(--accent)]" onClick={() => void act({ status: 'active' })}>重新启用</button>}
      </div>
      {err && <p className="mt-1 text-xs text-[var(--danger)]">{err}</p>}
    </div>
  );
}
```

- [ ] **Step 5: `src/components/project/publish-pane.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PublishKit } from '@/lib/retro/publish-kit';
import type { Diagnosis } from '@/lib/retro/diagnose';
import type { LessonView } from '@/lib/retro/view';
import { DiagnosisView } from '@/components/retro/diagnosis-view';
import { LessonCard } from '@/components/retro/lesson-card';

interface State {
  kit: PublishKit | null;
  work: { id: string; text: string; publishedAt: string; viewCount: number; likeCount: number } | null;
  candidate: { workId: string; text: string; publishedAt: string } | null;
  retro: { dayN: number; diagnosis: Diagnosis; narrative: string | null; narrativeError: string | null; dataAsOf: string | null; updatedAt: string } | null;
  lessons: LessonView[];
}

async function call(url: string, method = 'GET', body?: unknown) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="shrink-0 text-xs text-[var(--accent)]"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? '已复制' : '复制'}
    </button>
  );
}

export function PublishPane({ projectId }: { projectId: string }) {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const base = `/api/projects/${projectId}/publish`;
  const load = useCallback(async () => {
    const j = await call(base);
    if (j.success) setS(j.data);
    else setMsg(j.message);
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, url: string, body?: unknown) => {
    setBusy(key);
    setMsg(null);
    const j = await call(url, 'POST', body);
    setBusy(null);
    if (!j.success) setMsg(j.message);
    await load();
  };

  if (!s) return <div className="p-6 text-sm text-[var(--text-secondary)]">{msg ?? '读取中…'}</div>;
  return (
    <div className="h-full space-y-6 overflow-y-auto p-6 text-sm">
      <section>
        <div className="mb-2 flex items-center gap-3">
          <h3 className="font-medium">发布文案</h3>
          <button className="text-xs text-[var(--accent)]" disabled={busy !== null} onClick={() => void run('kit', `${base}/kit`)}>
            {busy === 'kit' ? '生成中…' : s.kit ? '重新生成' : '生成发布文案'}
          </button>
        </div>
        {s.kit ? (
          <div className="space-y-2">
            {s.kit.titles.map((t) => (
              <div key={t} className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
                <span className="min-w-0 flex-1">{t}</span>
                <Copy text={t} />
              </div>
            ))}
            <div className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
              <span className="min-w-0 flex-1">{s.kit.hashtags.join(' ')}</span>
              <Copy text={s.kit.hashtags.join(' ')} />
            </div>
            <div className="flex gap-2 rounded-md bg-[var(--bg-inset)] px-3 py-2">
              <span className="min-w-0 flex-1">封面字：{s.kit.coverText.join(' / ')}</span>
              <Copy text={s.kit.coverText.join('\n')} />
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">生成 3 个候选标题、话题标签和封面字，你挑一个在抖音里手动发。</p>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-medium">发布的作品</h3>
        {s.work ? (
          <p className="text-[var(--text-secondary)]">{`${s.work.text} · ${new Date(s.work.publishedAt).toLocaleDateString('zh-CN')} · 播放 ${s.work.viewCount} · 点赞 ${s.work.likeCount}`}</p>
        ) : (
          <>
            {s.candidate && (
              <div className="mb-3 rounded-md border border-[var(--border-subtle)] p-3">
                <p>这条是你发的吗？</p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">{`${s.candidate.text.slice(0, 60)} · ${new Date(s.candidate.publishedAt).toLocaleString('zh-CN')}`}</p>
                <div className="mt-2 flex gap-3 text-xs">
                  <button className="text-[var(--accent)]" onClick={() => void run('link', `${base}/link`, { workId: s.candidate!.workId })}>确认</button>
                  <button className="text-[var(--text-tertiary)]" onClick={() => void run('dismiss', `${base}/dismiss`, { workId: s.candidate!.workId })}>不是</button>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5" placeholder="发完后粘贴作品分享链接关联" value={link} onChange={(e) => setLink(e.target.value)} />
              <button className="shrink-0 rounded-md border border-[var(--border-strong)] px-3" disabled={!link.trim() || busy !== null} onClick={() => void run('link', `${base}/link`, { text: link })}>关联</button>
            </div>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">发布后第二天回采时，会自动在这里提示候选作品。</p>
          </>
        )}
      </section>

      {s.work && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <h3 className="font-medium">复盘</h3>
            {s.retro && <span className="text-xs text-[var(--text-tertiary)]">{`发布第 ${s.retro.dayN} 天${s.retro.dataAsOf ? ` · 数据截至 ${new Date(s.retro.dataAsOf).toLocaleDateString('zh-CN')}` : ''}`}</span>}
            <button className="text-xs text-[var(--accent)]" disabled={busy !== null} onClick={() => void run('retro', `${base}/retro`)}>
              {busy === 'retro' ? '复盘中…' : '现在复盘'}
            </button>
          </div>
          {s.retro ? (
            <div className="space-y-4">
              <DiagnosisView diagnosis={s.retro.diagnosis} />
              <div className="rounded-md bg-[var(--bg-inset)] p-3">
                <div className="mb-1 text-xs text-[var(--text-tertiary)]">编导解读</div>
                {s.retro.narrative ? <p className="whitespace-pre-wrap">{s.retro.narrative}</p> : <p className="text-[var(--danger)]">{s.retro.narrativeError}</p>}
              </div>
              {s.lessons.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-[var(--text-tertiary)]">写法经验（采纳后编导以后写稿都会遵守）</div>
                  {s.lessons.map((l) => (
                    <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-tertiary)]">发布后第 3 天会自动复盘，第 7 天再更新一次；也可以现在手动复盘。</p>
          )}
        </section>
      )}
      {msg && <p className="text-xs text-[var(--danger)]">{msg}</p>}
    </div>
  );
}
```

- [ ] **Step 6: `/retro` 页面、侧栏、标签页、首页、阶段文案**

`src/components/retro/retro-view.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { LessonView } from '@/lib/retro/view';
import { LessonCard } from './lesson-card';

type Item = { projectId: string; title: string; publishedAt: string; retroDayN: number | null; verdicts: Record<string, string> };
const V: Record<string, string> = { good: '好', even: '平', bad: '差', na: '—' };

export function RetroView() {
  const [data, setData] = useState<{ published: Item[]; pendingLinks: { projectId: string; title: string }[] } | null>(null);
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([fetch('/api/retro').then((r) => r.json()), fetch('/api/lessons').then((r) => r.json())]);
    setData(a.success ? a.data : { published: [], pendingLinks: [] });
    setLessons(b.success ? b.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!data || !lessons) return <p className="text-sm text-[var(--text-secondary)]">读取中…</p>;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="min-w-0 space-y-3">
        <h2 className="text-sm font-medium">已发布</h2>
        {data.pendingLinks.map((p) => (
          <Link key={p.projectId} href={`/projects/${p.projectId}`} className="block rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--warning)]">
            {`「${p.title}」有一条作品等你确认是不是它发的 →`}
          </Link>
        ))}
        {data.published.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">还没有关联发布作品的项目。成片发出去后，在项目的「④ 发布与复盘」里关联。</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)] rounded-md border border-[var(--border-subtle)]">
            {data.published.map((p) => (
              <li key={p.projectId}>
                <Link href={`/projects/${p.projectId}`} className="block px-3 py-2 text-sm hover:bg-[var(--bg-surface-hover)]">
                  <div className="truncate">{p.title}</div>
                  <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                    {`${new Date(p.publishedAt).toLocaleDateString('zh-CN')} · ${p.retroDayN ? `第 ${p.retroDayN} 天复盘` : '等第 3 天复盘'} · 开头2秒 ${V[p.verdicts.hook2s]} · 前5秒 ${V[p.verdicts.hook5s]} · 完播 ${V[p.verdicts.ending]} · 点赞 ${V[p.verdicts.like]}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="min-w-0 space-y-3">
        <h2 className="text-sm font-medium">写法库（生效的最多 10 条进编导）</h2>
        {lessons.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">还没有写法经验。复盘里编导提的经验，你采纳后会出现在这里。</p> : lessons.map((l) => <LessonCard key={l.id} lesson={l} onChanged={() => void load()} />)}
      </section>
    </div>
  );
}
```

`src/app/retro/page.tsx`:

```tsx
import { RetroView } from '@/components/retro/retro-view';

export const dynamic = 'force-dynamic';

export default function RetroPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">复盘</h1>
      <RetroView />
    </div>
  );
}
```

`src/app/layout.tsx`：侧栏在 `{ href: '/topics', label: '选题' }` 之后加 `{ href: '/retro', label: '复盘' }`。

`src/components/project/project-workspace.tsx`：`type Tab` 加 `'publish'`；`TABS` 加 `{ key: 'publish', label: '④ 发布与复盘' }`；初始标签：`stage === 'published'` → `'publish'`；渲染 `{tab === 'publish' && <PublishPane projectId={project.id} />}`。

阶段文案：`src/app/page.tsx` 的 `STAGE_TEXT` 加 `published: '已发布'`；`src/lib/agent/context.ts` 的 `STAGE_LABEL` 加 `published: '已发布'`。

首页（`src/app/page.tsx`）：在 `AccountCard` 之后，若 `/api/retro` 同源逻辑算出有 `pendingLinks` 或近 24 小时更新的复盘，显示一行链接到 `/retro`（服务端直接查库：`prisma.retro.count({ where: { updatedAt: { gte: 24h 前 } } })` 与 `stage = final` 且 `findCandidate` 非空的项目数）。

- [ ] **Step 7: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（重启 dev）：项目页有「④ 发布与复盘」；生成发布文案（3 标题/标签/封面字，复制可用）；`/retro` 空态与写法库空态正确；窄屏无横向溢出（DOM 量 scrollWidth）。

```bash
git add src/components src/app tests/components/retro src/lib/agent/context.ts
git commit -m "feat(retro): ④ 发布与复盘标签 + 复盘页(已发布列表/写法库) + 首页提示

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-29-publish-retro-design.md`（追加实测）

- [ ] **Step 1: README**

「现在能做什么」追加：

```markdown
- **发布与复盘**：项目页「④ 发布与复盘」生成候选标题 / 话题标签 / 封面字（你自己在抖音发）；发布后第二天回采自动提示"这条是你发的吗"，确认即关联（也可贴链接）。发布第 3 天自动复盘、第 7 天更新：按开头 2 秒 / 前 5 秒 / 中段（平均观看秒数对到逐句转写）/ 收尾 / 互动逐段和你平时比，从对标建的项目还会比点赞倍数；编导解读并提出写法经验，你采纳后编导以后写稿都会遵守。侧栏「复盘」看全部已发布作品与写法库。每晚回采另存每条作品的完播/跳出/平均观看等指标，发布 30 天内每天一份快照。
```

- [ ] **Step 2: 真机验收**

1. 设置页「作品数据回采」立即运行：日志有「作品指标: N 条(快照 M 条, 跳过 0 条)」「复盘: 到期 0 个…」。
2. U 盘验收项目「④ 发布与复盘」：生成发布文案。
3. 贴"当我把龙虾装到u盘"那条作品的分享链接（请用户提供，或用库里 externalId 拼 `https://www.douyin.com/video/<id>`）关联；阶段变「已发布」，对话里有通知。
4. 「现在复盘」：诊断逐段显示（这条是 3 月的老作品，成片不是当时发的版本，只验证流程）；编导解读与经验候选出现；采纳一条 → `/retro` 写法库出现 → 新项目让编导写稿，写稿请求含【写法经验】（读 DOM 或对话结果确认）。
5. 验收后把测试关联撤销（`PublishedWork.projectId` 置空、项目阶段改回 `final`、删除该复盘与经验），不留测试数据——先问用户是否保留。

- [ ] **Step 3: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-09-29-publish-retro-design.md
git commit -m "docs: README 补发布与复盘, spec 记录真机实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
