# 阶段 5 实施计划：首页账号数据、定位页、设置页（依赖体检）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏补齐「项目 / 定位 / 设置」三项：首页顶部显示真实账号数据并在回采失败时直接提示原因；定位页可编辑人设档案；设置页可更换 DeepSeek key 并逐项体检本机依赖（数据库、ffmpeg、本地转写、出片子工程、回采）。

**Architecture:** 纯函数优先：回采日志解析、账号概览组装、人设 schema、`.env` 行替换、依赖体检（命令执行可注入）全部放在 `src/lib/` 并单测；API 与页面只做薄封装。DeepSeek key 仍只存 `.env`（单一来源），设置页写入 `.env` 并同步 `process.env`。

**Tech Stack:** Next.js 14 App Router、Prisma 5、zod、vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md` §7.1（侧栏三项）；`docs/superpowers/specs/2026-09-28-film-production-design.md` §7（Overlay Studio 已移除，体检不再包含它与 node 22）。

## Global Constraints

- 没有的数据如实显示并说明原因，不补零、不估算（例：近 90 天没有投稿 → 写"近 90 天没有投稿"）。
- 首页只展示口径明确的指标：粉丝数（`DouyinMetricSummary.metric = 'fans'`）、作品数与公开数、作品播放总和（`PublishedWork.play` 求和，注明"作品列表接口口径"）、最近发布日期、数据更新时间。
- 回采告警条件：最近一次回采失败，或距最近一次成功超过 36 小时，或从未成功过。告警文案 = 原因 + 怎么办。
- DeepSeek key 只存 `.env` 的 `DEEPSEEK_API_KEY`；格式校验 `^sk-[A-Za-z0-9]{20,}$`；写入用"临时文件 + rename"；界面只显示末 4 位；绝不写日志、绝不回传完整 key。
- 依赖体检每项返回 `{ key, label, status: 'ok' | 'warn' | 'fail', detail, fix? }`，`fix` 是可直接执行的中文说明或命令；体检不修改任何东西。
- 人设档案改动只影响之后新建的项目（已有项目用建项目时的快照），页面上写明。
- 继承既有约束：界面不出现内部 id/英文状态码/报错栈；新增 API 目录后若出现 Next 404 页，重启 dev。

## Review Focus

1. **回采日志里夹杂 npm 输出、shell 报错与多行堆栈**——解析只认 `[ISO时间] 消息` 行，不被干扰。→ Task 1 测试 `ignores npm noise and stack lines`。
2. **日志文件不存在（从没装定时任务）**——首页提示"还没开始回采"并给出安装命令，而不是报错。→ Task 1 测试 `reports never-run when the log is missing`。
3. **`.env` 里没有 `DEEPSEEK_API_KEY` 这一行 / 有注释 / 末尾无换行**——替换或追加都不破坏其他行。→ Task 4 测试 `upsertEnvLine` 三条。
4. **人设字段为空数组或缺字段（旧数据）**——编辑页正常显示并可保存。→ Task 3 测试 `accepts a persona with empty lists`。
5. **体检时某个命令卡住**——单项超时记为失败，不拖住整页。→ Task 4 测试 `times out a hanging command`。

---

## 文件结构

```
src/lib/douyin/collect-log.ts        回采日志解析(纯函数) + 读日志文件
src/lib/account/summary.ts           首页账号概览组装
src/lib/persona/schema.ts            人设 zod schema + 默认值
src/lib/settings/env-file.ts         .env 行替换(纯函数) + 安全写入
src/lib/settings/deepseek.ts         key 校验、掩码、测试连接
src/lib/health/checks.ts             依赖体检(命令执行可注入)
src/app/page.tsx                     + 账号数据卡 + 回采告警
src/components/home/account-card.tsx
src/app/persona/page.tsx + src/components/persona/persona-editor.tsx
src/app/api/persona/route.ts         GET / PUT
src/app/settings/page.tsx + src/components/settings/{deepseek-key,health-panel}.tsx
src/app/api/settings/deepseek/route.ts   GET(掩码) / PUT(写入) / POST(测试连接)
src/app/api/settings/health/route.ts     GET 体检
src/app/layout.tsx                   侧栏 + 定位、设置
tests/lib/douyin/collect-log.test.ts, tests/lib/account/summary.test.ts, tests/lib/persona/schema.test.ts,
tests/lib/settings/*.test.ts, tests/lib/health/checks.test.ts, tests/components/{account-card,persona-editor}.test.tsx
```

---

### Task 1: 回采日志解析与账号概览

**Files:**
- Create: `src/lib/douyin/collect-log.ts`、`src/lib/account/summary.ts`
- Test: `tests/lib/douyin/collect-log.test.ts`、`tests/lib/account/summary.test.ts`

**Interfaces:**
- Produces（`collect-log.ts`）：
  - `interface CollectRun { startedAt: string; ok: boolean; message: string }`（`message`：成功时为"回采完成…"那行，失败时为该次最后一条带时间的消息）
  - `interface CollectStatus { state: 'never' | 'ok' | 'failing' | 'stale'; lastRun: CollectRun | null; lastSuccessAt: string | null; consecutiveFailures: number; hint: string }`
  - `parseCollectLog(text: string, now: Date): CollectStatus`
  - `readCollectStatus(now?: Date, file?: string): Promise<CollectStatus>`（默认 `<cwd>/logs/collect-douyin.log`；文件不存在 → `state: 'never'`）
  - `STALE_HOURS = 36`
- Produces（`summary.ts`）：
  - `interface AccountSummary { fans: number | null; fansDelta: number | null; works: number; publicWorks: number; totalPlay: number; lastPublishedAt: string | null; recent90: { submissionCount: number; medianPlay: number; completionRate5s: number } | null; dataAt: string | null; collect: CollectStatus }`
  - `buildAccountSummary(db: PrismaClient, collect: CollectStatus): Promise<AccountSummary>`

- [ ] **Step 1: 写失败测试**

`tests/lib/douyin/collect-log.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { parseCollectLog, readCollectStatus } from '@/lib/douyin/collect-log';

const now = new Date('2026-09-28T12:00:00Z');
const okRun = (d: string) => `[${d}T12:00:06.000Z] 开始回采\n[${d}T12:00:24.000Z] 回采完成: 共 101 条(新增 0 / 更新 101), 其中公开 5 条\n`;

describe('parseCollectLog', () => {
  it('is ok when the latest run completed recently', () => {
    const s = parseCollectLog(okRun('2026-09-27') + okRun('2026-09-28'), now);
    expect(s).toMatchObject({ state: 'ok', consecutiveFailures: 0, lastSuccessAt: '2026-09-28T12:00:24.000Z' });
  });
  it('counts consecutive failures and keeps the failure reason', () => {
    const text =
      okRun('2026-09-24') +
      "[2026-09-25T12:00:03.000Z] 开始回采\n[2026-09-25T12:00:24.000Z] 未预期的错误: PrismaClientInitializationError: \nCan't reach database server at `localhost:5432`\n    at $n.handleRequestError (/x.js:1:1)\n" +
      '[2026-09-26T12:00:02.000Z] 开始回采\n[2026-09-26T12:00:36.000Z] ego-browser 执行失败: 退出码 1\n[2026-09-26T12:00:36.100Z] 常见原因: ego lite 没在运行, 或抖音登录态已过期 —— 打开 ego lite 重新登录一次。\n';
    const s = parseCollectLog(text, now);
    expect(s.state).toBe('failing');
    expect(s.consecutiveFailures).toBe(2);
    expect(s.lastRun?.message).toBe('常见原因: ego lite 没在运行, 或抖音登录态已过期 —— 打开 ego lite 重新登录一次。');
    expect(s.hint).toContain('连续 2 次回采失败');
  });
  it('ignores npm noise and stack lines', () => {
    const text = 'shell-init: error retrieving current directory\n\n> mediapilot@0.1.0 collect:douyin\n> tsx scripts/collect-douyin.ts\n\n' + okRun('2026-09-28');
    expect(parseCollectLog(text, now).state).toBe('ok');
  });
  it('is stale when the last success is older than 36 hours', () => {
    const s = parseCollectLog(okRun('2026-09-26'), now);
    expect(s.state).toBe('stale');
    expect(s.hint).toContain('超过 36 小时没有成功回采');
  });
  it('reports never-run when the log is missing', async () => {
    const s = await readCollectStatus(now, path.join(os.tmpdir(), 'definitely-missing.log'));
    expect(s.state).toBe('never');
    expect(s.hint).toContain('sh scripts/install-collect-cron.sh');
  });
});
```

`tests/lib/account/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildAccountSummary } from '@/lib/account/summary';
import type { CollectStatus } from '@/lib/douyin/collect-log';

const collect: CollectStatus = { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' };

function db(opts: { snapshot?: Record<string, unknown> | null; fans?: { currentCount: number; lastPeriodIncr: number; fetchedAt: Date } | null }) {
  return {
    douyinMetricSummary: { findUnique: async () => opts.fans ?? null },
    douyinOverviewSnapshot: { findFirst: async () => opts.snapshot ?? null },
    publishedWork: {
      count: async ({ where }: { where?: { isPrivate?: boolean } } = {}) => (where?.isPrivate === false ? 5 : 101),
      aggregate: async () => ({ _sum: { play: 257890 }, _max: { publishedAt: new Date('2026-08-20T08:00:00Z') } }),
    },
  } as unknown as PrismaClient;
}

describe('buildAccountSummary', () => {
  it('reports fans, works, plays and the latest publish date', async () => {
    const s = await buildAccountSummary(db({ fans: { currentCount: 2847, lastPeriodIncr: -2, fetchedAt: new Date('2026-09-26T18:50:00Z') } }), collect);
    expect(s).toMatchObject({ fans: 2847, fansDelta: -2, works: 101, publicWorks: 5, totalPlay: 257890, lastPublishedAt: '2026-08-20T08:00:00.000Z', dataAt: '2026-09-26T18:50:00.000Z' });
  });
  it('gives null recent90 when there were no submissions in the window (not zeros)', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 0, medianPlay: 0, completionRate5s: 0 } }), collect);
    expect(s.recent90).toBeNull();
    expect(s.fans).toBeNull();
  });
  it('keeps recent90 when there were submissions', async () => {
    const s = await buildAccountSummary(db({ snapshot: { submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 } }), collect);
    expect(s.recent90).toEqual({ submissionCount: 3, medianPlay: 812, completionRate5s: 0.31 });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/douyin tests/lib/account`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/douyin/collect-log.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 每晚回采(launchd)只写日志, 不写库状态。首页靠解析日志判断回采是否健康 ——
 * 09-25 数据库停了两天、回采静默失败, 就是因为失败只写进了日志。
 */
export const STALE_HOURS = 36;

export interface CollectRun {
  startedAt: string;
  ok: boolean;
  message: string;
}
export interface CollectStatus {
  state: 'never' | 'ok' | 'failing' | 'stale';
  lastRun: CollectRun | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  hint: string;
}

const INSTALL = '在项目目录运行 sh scripts/install-collect-cron.sh 装上每晚 20:00 的回采，或先手动运行 npm run collect:douyin。';

export function parseCollectLog(text: string, now: Date): CollectStatus {
  const runs: { startedAt: string; lines: { at: string; msg: string }[] }[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] (.*)$/.exec(raw.trim());
    if (!m) continue; // npm 输出、shell 报错、堆栈行
    const [, at, msg] = m;
    if (msg.startsWith('开始回采')) runs.push({ startedAt: at, lines: [] });
    else if (runs.length) runs[runs.length - 1].lines.push({ at, msg: msg.trim() });
  }
  if (runs.length === 0) return { state: 'never', lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, hint: `还没有回采记录。${INSTALL}` };

  const done = runs.map((r) => {
    const okLine = r.lines.find((l) => l.msg.startsWith('回采完成'));
    return {
      startedAt: r.startedAt,
      ok: !!okLine,
      message: okLine?.msg ?? r.lines[r.lines.length - 1]?.msg ?? '回采中途中断，没有留下原因',
      okAt: okLine?.at ?? null,
    };
  });
  const last = done[done.length - 1];
  let consecutiveFailures = 0;
  for (let i = done.length - 1; i >= 0 && !done[i].ok; i--) consecutiveFailures++;
  const lastSuccess = [...done].reverse().find((r) => r.ok);
  const lastSuccessAt = lastSuccess?.okAt ?? null;
  const lastRun: CollectRun = { startedAt: last.startedAt, ok: last.ok, message: last.message };

  if (!last.ok) {
    return { state: 'failing', lastRun, lastSuccessAt, consecutiveFailures, hint: `连续 ${consecutiveFailures} 次回采失败：${last.message}` };
  }
  const hours = (now.getTime() - new Date(lastSuccessAt!).getTime()) / 3600_000;
  if (hours > STALE_HOURS) {
    return { state: 'stale', lastRun, lastSuccessAt, consecutiveFailures: 0, hint: `超过 36 小时没有成功回采（上次 ${Math.floor(hours)} 小时前）。检查定时任务是否还在：launchctl list | grep mediapilot` };
  }
  return { state: 'ok', lastRun, lastSuccessAt, consecutiveFailures: 0, hint: '' };
}

export async function readCollectStatus(now = new Date(), file = path.join(process.cwd(), 'logs', 'collect-douyin.log')): Promise<CollectStatus> {
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return { state: 'never', lastRun: null, lastSuccessAt: null, consecutiveFailures: 0, hint: `还没有回采日志。${INSTALL}` };
  return parseCollectLog(text, now);
}
```

- [ ] **Step 4: 实现 `src/lib/account/summary.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { CollectStatus } from '@/lib/douyin/collect-log';

export interface AccountSummary {
  fans: number | null;
  fansDelta: number | null;
  works: number;
  publicWorks: number;
  /** 作品列表接口的播放数之和(与投稿分析口径不同) */
  totalPlay: number;
  lastPublishedAt: string | null;
  /** 近 90 天投稿分析; 窗口内没投稿时为 null(如实说明, 不显示一排 0) */
  recent90: { submissionCount: number; medianPlay: number; completionRate5s: number } | null;
  dataAt: string | null;
  collect: CollectStatus;
}

export async function buildAccountSummary(db: PrismaClient, collect: CollectStatus): Promise<AccountSummary> {
  const [fans, snapshot, works, publicWorks, agg] = await Promise.all([
    db.douyinMetricSummary.findUnique({ where: { metric: 'fans' } }),
    db.douyinOverviewSnapshot.findFirst({ orderBy: { fetchedAt: 'desc' } }),
    db.publishedWork.count(),
    db.publishedWork.count({ where: { isPrivate: false } }),
    db.publishedWork.aggregate({ _sum: { play: true }, _max: { publishedAt: true } }),
  ]);
  return {
    fans: fans?.currentCount ?? null,
    fansDelta: fans?.lastPeriodIncr ?? null,
    works,
    publicWorks,
    totalPlay: agg._sum.play ?? 0,
    lastPublishedAt: agg._max.publishedAt?.toISOString() ?? null,
    recent90:
      snapshot && snapshot.submissionCount > 0
        ? { submissionCount: snapshot.submissionCount, medianPlay: snapshot.medianPlay, completionRate5s: snapshot.completionRate5s }
        : null,
    dataAt: fans?.fetchedAt.toISOString() ?? null,
    collect,
  };
}
```

- [ ] **Step 5: 运行确认通过、提交**

Run: `npx vitest run tests/lib/douyin tests/lib/account && npm run typecheck`
Expected: 8 个 PASS；0 错误。

```bash
git add src/lib/douyin src/lib/account tests/lib/douyin tests/lib/account
git commit -m "feat(home): 回采日志解析(失败/过期/从未回采) + 账号概览组装(无数据如实为空)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 首页账号数据卡与回采告警

**Files:**
- Create: `src/components/home/account-card.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/components/account-card.test.tsx`

**Interfaces:**
- Consumes: `AccountSummary`、`readCollectStatus`、`buildAccountSummary`（Task 1）。
- Produces: `AccountCard({ summary: AccountSummary })`；首页在项目列表上方渲染它。

- [ ] **Step 1: 写失败测试 `tests/components/account-card.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccountCard } from '@/components/home/account-card';
import type { AccountSummary } from '@/lib/account/summary';

afterEach(cleanup);
const base: AccountSummary = {
  fans: 2847, fansDelta: -2, works: 101, publicWorks: 5, totalPlay: 257890, lastPublishedAt: '2026-08-20T08:00:00.000Z',
  recent90: null, dataAt: '2026-09-26T18:50:00.000Z',
  collect: { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' },
};

describe('AccountCard', () => {
  it('shows real numbers and says plainly when there were no recent submissions', () => {
    render(<AccountCard summary={base} />);
    expect(screen.getByText('2,847')).toBeTruthy();
    expect(screen.getByText('较上期 -2')).toBeTruthy();
    expect(screen.getByText('101 条（公开 5 条）')).toBeTruthy();
    expect(screen.getByText('257,890')).toBeTruthy();
    expect(screen.getByText('近 90 天没有投稿，投稿分析暂无数据')).toBeTruthy();
  });
  it('shows a warning banner with the reason when collection is failing', () => {
    render(<AccountCard summary={{ ...base, collect: { ...base.collect, state: 'failing', consecutiveFailures: 2, hint: '连续 2 次回采失败：ego lite 没在运行' } }} />);
    expect(screen.getByRole('alert').textContent).toContain('连续 2 次回采失败：ego lite 没在运行');
  });
  it('shows placeholders instead of zeros when fans are unknown', () => {
    render(<AccountCard summary={{ ...base, fans: null, fansDelta: null }} />);
    expect(screen.getByText('还没回采到')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/account-card.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/components/home/account-card.tsx`**

```tsx
import type { AccountSummary } from '@/lib/account/summary';

const n = (v: number) => v.toLocaleString('en-US');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('zh-CN') : '—');

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 font-mono text-xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  );
}

/** 首页账号数据: 只放口径明确的数; 没有的数据如实说明, 不显示 0 */
export function AccountCard({ summary: s }: { summary: AccountSummary }) {
  const warn = s.collect.state !== 'ok';
  return (
    <section className="mb-6">
      {warn && (
        <div role="alert" className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--warning-subtle)] px-4 py-3 text-sm text-[var(--warning)]">
          {s.collect.hint}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="粉丝" value={s.fans === null ? '还没回采到' : n(s.fans)} sub={s.fansDelta === null ? undefined : `较上期 ${s.fansDelta > 0 ? '+' : ''}${s.fansDelta}`} />
        <Stat label="作品" value={`${s.works} 条（公开 ${s.publicWorks} 条）`} />
        <Stat label="作品播放合计" value={n(s.totalPlay)} sub="作品列表接口口径" />
        <Stat label="最近发布" value={day(s.lastPublishedAt)} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-tertiary)]">
        {s.recent90
          ? `近 90 天投稿 ${s.recent90.submissionCount} 条，播放中位数 ${n(s.recent90.medianPlay)}，5 秒完播率 ${(s.recent90.completionRate5s * 100).toFixed(1)}%`
          : '近 90 天没有投稿，投稿分析暂无数据'}
        {s.dataAt && ` · 数据更新于 ${new Date(s.dataAt).toLocaleString('zh-CN')}`}
      </p>
    </section>
  );
}
```

- [ ] **Step 4: 首页接入（`src/app/page.tsx`）**

在 import 区追加：

```tsx
import { AccountCard } from '@/components/home/account-card';
import { buildAccountSummary } from '@/lib/account/summary';
import { readCollectStatus } from '@/lib/douyin/collect-log';
```

把 `const projects = ...` 那行改为：

```tsx
  const [projects, summary] = await Promise.all([
    prisma.project.findMany({ orderBy: { updatedAt: 'desc' } }).then((rows) => rows.map(toProjectView)),
    readCollectStatus().then((c) => buildAccountSummary(prisma, c)),
  ]);
```

并在 `<div className="mb-6 flex items-center">`（项目标题行）之前插入 `<AccountCard summary={summary} />`。

- [ ] **Step 5: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：打开首页（DOM 查询确认）：粉丝 2,847、作品 101 条（公开 5 条）、播放合计 257,890、"近 90 天没有投稿，投稿分析暂无数据"；按当前日志状态出现或不出现告警条（与 `tail logs/collect-douyin.log` 对照）。

```bash
git add src/components/home src/app/page.tsx tests/components/account-card.test.tsx
git commit -m "feat(home): 首页账号数据卡 + 回采失败/过期告警

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 定位页（人设档案编辑）

**Files:**
- Create: `src/lib/persona/schema.ts`、`src/app/api/persona/route.ts`、`src/app/persona/page.tsx`、`src/components/persona/persona-editor.tsx`
- Modify: `src/app/layout.tsx`（侧栏加「定位」「设置」）
- Test: `tests/lib/persona/schema.test.ts`、`tests/components/persona-editor.test.tsx`

**Interfaces:**
- Produces:
  - `PersonaSchema`（zod）：`{ audience: string; targetFans: string; angle: string; avoid: string; systemSummary: string; pillars: { name: string; description: string }[]; painPoints: { pain: string; evidence: string }[]; offerings: { name: string; type: 'tool' | 'service' | 'course' | 'other'; targetPain: string; description: string }[] }`，缺字段取默认值（空串 / 空数组），`offerings[].type` 未知值归为 `'other'`
  - `type Persona = z.infer<typeof PersonaSchema>`；`EMPTY_PERSONA: Persona`
  - `GET /api/persona` → `Persona`（无档案时返回 `EMPTY_PERSONA`）；`PUT /api/persona` body `Persona` → 保存（upsert id `'me'`）→ `Persona`
  - `PersonaEditor({ initial: Persona })`

- [ ] **Step 1: 写失败测试**

`tests/lib/persona/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';

describe('PersonaSchema', () => {
  it('accepts a persona with empty lists', () => {
    expect(PersonaSchema.parse({ audience: 'x', pillars: [], painPoints: [], offerings: [] })).toMatchObject({ audience: 'x', angle: '', pillars: [] });
  });
  it('fills defaults for missing fields (old data)', () => {
    expect(PersonaSchema.parse({})).toEqual(EMPTY_PERSONA);
  });
  it('maps unknown offering types to other', () => {
    const p = PersonaSchema.parse({ offerings: [{ name: 'A', type: 'membership', targetPain: '', description: '' }] });
    expect(p.offerings[0].type).toBe('other');
  });
  it('rejects a pillar without a name', () => {
    expect(PersonaSchema.safeParse({ pillars: [{ name: '', description: 'x' }] }).success).toBe(false);
  });
});
```

`tests/components/persona-editor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PersonaEditor } from '@/components/persona/persona-editor';
import { EMPTY_PERSONA } from '@/lib/persona/schema';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PersonaEditor', () => {
  it('adds a pillar and saves the whole persona', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: { body: string }) => ({ json: async () => ({ success: true, data: JSON.parse(init!.body) }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PersonaEditor initial={{ ...EMPTY_PERSONA, audience: '职场人' }} />);
    fireEvent.click(screen.getByText('＋ 加一个内容支柱'));
    fireEvent.change(screen.getByPlaceholderText('支柱名称，如：效率革命'), { target: { value: '翻车实测' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('已保存。之后新建的项目会用这份定位。')).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body);
    expect(body).toMatchObject({ audience: '职场人', pillars: [{ name: '翻车实测', description: '' }] });
  });
  it('shows the server message when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false, message: '内容支柱要有名称' }) })));
    render(<PersonaEditor initial={EMPTY_PERSONA} />);
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('内容支柱要有名称')).toBeTruthy());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/persona tests/components/persona-editor.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/persona/schema.ts`**

```ts
import { z } from 'zod';

const text = z.string().default('');
const OFFERING_TYPES = ['tool', 'service', 'course', 'other'] as const;

export const PersonaSchema = z.object({
  audience: text,
  targetFans: text,
  angle: text,
  avoid: text,
  systemSummary: text,
  pillars: z.array(z.object({ name: z.string().trim().min(1, '内容支柱要有名称'), description: text })).default([]),
  painPoints: z.array(z.object({ pain: z.string().trim().min(1, '痛点不能为空'), evidence: text })).default([]),
  offerings: z
    .array(
      z.object({
        name: z.string().trim().min(1, '产品要有名称'),
        type: z.string().transform((t) => ((OFFERING_TYPES as readonly string[]).includes(t) ? (t as (typeof OFFERING_TYPES)[number]) : 'other')),
        targetPain: text,
        description: text,
      }),
    )
    .default([]),
});

export type Persona = z.infer<typeof PersonaSchema>;

export const EMPTY_PERSONA: Persona = {
  audience: '',
  targetFans: '',
  angle: '',
  avoid: '',
  systemSummary: '',
  pillars: [],
  painPoints: [],
  offerings: [],
};
```

- [ ] **Step 4: 实现 `src/app/api/persona/route.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  return ok(row ? PersonaSchema.parse(row) : EMPTY_PERSONA);
}

export async function PUT(req: Request) {
  const parsed = PersonaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? '内容格式不对', 400);
  const p = parsed.data;
  const data = {
    audience: p.audience,
    targetFans: p.targetFans,
    angle: p.angle,
    avoid: p.avoid,
    systemSummary: p.systemSummary,
    pillars: p.pillars as unknown as Prisma.InputJsonValue,
    painPoints: p.painPoints as unknown as Prisma.InputJsonValue,
    offerings: p.offerings as unknown as Prisma.InputJsonValue,
  };
  await prisma.personaProfile.upsert({ where: { id: 'me' }, update: data, create: { id: 'me', ...data } });
  return ok(p);
}
```

- [ ] **Step 5: 实现 `src/components/persona/persona-editor.tsx`**

```tsx
'use client';

import { useState } from 'react';
import type { Persona } from '@/lib/persona/schema';

const input = 'w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm';
const area = `${input} min-h-[72px]`;
const TYPE_LABEL: Record<Persona['offerings'][number]['type'], string> = { tool: '工具', service: '服务', course: '课程', other: '其他' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-[var(--text-secondary)]">{label}</div>
      {children}
    </label>
  );
}

export function PersonaEditor({ initial }: { initial: Persona }) {
  const [p, setP] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Persona>(k: K, v: Persona[K]) => setP((x) => ({ ...x, [k]: v }));
  const setItem = <K extends 'pillars' | 'painPoints' | 'offerings'>(k: K, i: number, patch: Partial<Persona[K][number]>) =>
    setP((x) => ({ ...x, [k]: x[k].map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const remove = (k: 'pillars' | 'painPoints' | 'offerings', i: number) => setP((x) => ({ ...x, [k]: x[k].filter((_, j) => j !== i) }));

  async function save() {
    setMsg(null);
    const res = await fetch('/api/persona', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    const j = await res.json();
    setMsg(j.success ? { ok: true, text: '已保存。之后新建的项目会用这份定位。' } : { ok: false, text: j.message });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-xs text-[var(--text-tertiary)]">编导每次写稿都会读这份定位。改动只影响之后新建的项目，已有项目保留建项目时的版本。</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="目标受众"><textarea className={area} value={p.audience} onChange={(e) => set('audience', e.target.value)} /></Field>
        <Field label="想吸引的粉丝"><textarea className={area} value={p.targetFans} onChange={(e) => set('targetFans', e.target.value)} /></Field>
        <Field label="差异化角度"><textarea className={area} value={p.angle} onChange={(e) => set('angle', e.target.value)} /></Field>
        <Field label="忌讳（不做什么）"><textarea className={area} value={p.avoid} onChange={(e) => set('avoid', e.target.value)} /></Field>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-medium">内容支柱</h3>
        <div className="space-y-2">
          {p.pillars.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input className={`${input} w-40 shrink-0`} placeholder="支柱名称，如：效率革命" value={it.name} onChange={(e) => setItem('pillars', i, { name: e.target.value })} />
              <input className={input} placeholder="说明" value={it.description} onChange={(e) => setItem('pillars', i, { description: e.target.value })} />
              <button className="shrink-0 text-xs text-[var(--danger)]" onClick={() => remove('pillars', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('pillars', [...p.pillars, { name: '', description: '' }])}>＋ 加一个内容支柱</button>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">受众痛点</h3>
        <div className="space-y-2">
          {p.painPoints.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input className={input} placeholder="痛点" value={it.pain} onChange={(e) => setItem('painPoints', i, { pain: e.target.value })} />
              <input className={input} placeholder="依据（可不写）" value={it.evidence} onChange={(e) => setItem('painPoints', i, { evidence: e.target.value })} />
              <button className="shrink-0 text-xs text-[var(--danger)]" onClick={() => remove('painPoints', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('painPoints', [...p.painPoints, { pain: '', evidence: '' }])}>＋ 加一个痛点</button>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium">产品与服务</h3>
        <div className="space-y-2">
          {p.offerings.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-[var(--border-subtle)] p-2 md:grid-cols-[1fr_120px]">
              <input className={input} placeholder="名称" value={it.name} onChange={(e) => setItem('offerings', i, { name: e.target.value })} />
              <select className={input} value={it.type} onChange={(e) => setItem('offerings', i, { type: e.target.value as Persona['offerings'][number]['type'] })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <input className={input} placeholder="解决哪个痛点" value={it.targetPain} onChange={(e) => setItem('offerings', i, { targetPain: e.target.value })} />
              <input className={input} placeholder="说明" value={it.description} onChange={(e) => setItem('offerings', i, { description: e.target.value })} />
              <button className="text-left text-xs text-[var(--danger)]" onClick={() => remove('offerings', i)}>删除</button>
            </div>
          ))}
        </div>
        <button className="mt-2 text-xs text-[var(--accent)]" onClick={() => set('offerings', [...p.offerings, { name: '', type: 'other', targetPain: '', description: '' }])}>＋ 加一个产品</button>
      </section>

      <Field label="定位摘要（Markdown，编导优先读这一段）">
        <textarea className={`${input} min-h-[240px] font-mono text-xs`} value={p.systemSummary} onChange={(e) => set('systemSummary', e.target.value)} />
      </Field>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]" onClick={() => void save()}>保存</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 页面 `src/app/persona/page.tsx`**

```tsx
import { prisma } from '@/lib/prisma';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';
import { PersonaEditor } from '@/components/persona/persona-editor';

export const dynamic = 'force-dynamic';

export default async function PersonaPage() {
  const row = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const initial = row ? PersonaSchema.parse(row) : EMPTY_PERSONA;
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">定位</h1>
      <PersonaEditor initial={initial} />
    </div>
  );
}
```

注：旧数据若有空名称的支柱会让 `PersonaSchema.parse` 抛错——页面改用 `safeParse`，失败时退回 `EMPTY_PERSONA` 并在页面顶部提示"旧档案格式不完整，已按空白显示"。把上面的 `const initial = ...` 替换为：

```tsx
  const parsed = row ? PersonaSchema.safeParse(row) : null;
  const initial = parsed?.success ? parsed.data : EMPTY_PERSONA;
  const broken = parsed !== null && !parsed.success;
```

并在 `<h1>` 之后加 `{broken && <p className="mb-3 text-sm text-[var(--warning)]">旧档案格式不完整，已按空白显示。保存会覆盖旧档案。</p>}`；`GET /api/persona` 同样改用 `safeParse`（失败返回 `EMPTY_PERSONA`）。

- [ ] **Step 7: 侧栏（`src/app/layout.tsx`）**

把唯一的 `<Link href="/" ...>项目</Link>` 替换为：

```tsx
          {[
            { href: '/', label: '项目' },
            { href: '/persona', label: '定位' },
            { href: '/settings', label: '设置' },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-surface-hover)]">
              {l.label}
            </Link>
          ))}
```

- [ ] **Step 8: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（重启 dev，新增了路由目录）：打开 `/persona`：显示当前受众、3 个支柱、4 个痛点、3 个产品、定位摘要；加一个支柱「翻车实测」保存 → 提示已保存；刷新仍在；删掉它再保存恢复原状（不留测试改动）。

```bash
git add src/lib/persona src/app/api/persona src/app/persona src/components/persona src/app/layout.tsx tests/lib/persona tests/components/persona-editor.test.tsx
git commit -m "feat(persona): 定位页(人设档案编辑, 旧数据兼容) + 侧栏三项

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 设置页（DeepSeek key 与依赖体检）

**Files:**
- Create: `src/lib/settings/env-file.ts`、`src/lib/settings/deepseek.ts`、`src/lib/health/checks.ts`、`src/app/api/settings/deepseek/route.ts`、`src/app/api/settings/health/route.ts`、`src/app/settings/page.tsx`、`src/components/settings/deepseek-key.tsx`、`src/components/settings/health-panel.tsx`
- Test: `tests/lib/settings/env-file.test.ts`、`tests/lib/settings/deepseek.test.ts`、`tests/lib/health/checks.test.ts`

**Interfaces:**
- Produces:
  - `upsertEnvLine(content: string, key: string, value: string): string`；`writeEnvKey(key: string, value: string, file?: string): Promise<void>`（临时文件 + rename，并设置 `process.env[key]`）
  - `isValidDeepSeekKey(k: string): boolean`；`maskKey(k: string | null): string | null`（`sk-…a1b2`）；`testDeepSeekKey(key: string, fetcher?: typeof fetch): Promise<{ ok: boolean; message: string }>`
  - `type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>`
  - `interface HealthItem { key: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; fix?: string }`
  - `runHealthChecks(deps: { exec: Exec; exists: (p: string) => Promise<boolean>; dbPing: () => Promise<void>; env: NodeJS.ProcessEnv; cwd: string; collect: CollectStatus }): Promise<HealthItem[]>`（项：`db`、`deepseek`、`ffmpeg`、`whisper`、`remotion`、`collect`）
  - `realExec: Exec`（`execFile` + 超时 → `code: 124`）
  - HTTP：`GET /api/settings/deepseek` → `{ masked: string | null }`；`PUT` `{ key }` → 校验并写入 → `{ masked }`；`POST` `{ key? }` → 测试连接（不传则测当前 key）→ `{ ok, message }`；`GET /api/settings/health` → `HealthItem[]`

- [ ] **Step 1: 写失败测试**

`tests/lib/settings/env-file.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { upsertEnvLine, writeEnvKey } from '@/lib/settings/env-file';

describe('upsertEnvLine', () => {
  it('replaces an existing line and keeps the others', () => {
    expect(upsertEnvLine('A=1\nDEEPSEEK_API_KEY=old\n# 注释\nB=2\n', 'DEEPSEEK_API_KEY', 'new')).toBe('A=1\nDEEPSEEK_API_KEY=new\n# 注释\nB=2\n');
  });
  it('appends when the key is missing, even without a trailing newline', () => {
    expect(upsertEnvLine('A=1', 'DEEPSEEK_API_KEY', 'k')).toBe('A=1\nDEEPSEEK_API_KEY=k\n');
  });
  it('does not touch a commented-out line with the same name', () => {
    expect(upsertEnvLine('# DEEPSEEK_API_KEY=x\n', 'DEEPSEEK_API_KEY', 'k')).toBe('# DEEPSEEK_API_KEY=x\nDEEPSEEK_API_KEY=k\n');
  });
});

describe('writeEnvKey', () => {
  it('writes the file and updates process.env', async () => {
    const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-env-')), '.env');
    await fs.writeFile(f, 'A=1\n');
    await writeEnvKey('MP_TEST_KEY', 'v1', f);
    expect(await fs.readFile(f, 'utf8')).toBe('A=1\nMP_TEST_KEY=v1\n');
    expect(process.env.MP_TEST_KEY).toBe('v1');
  });
});
```

`tests/lib/settings/deepseek.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isValidDeepSeekKey, maskKey, testDeepSeekKey } from '@/lib/settings/deepseek';

const res = (status: number) => (async () => ({ status, ok: status >= 200 && status < 300 })) as unknown as typeof fetch;

describe('deepseek key helpers', () => {
  it('validates the key format', () => {
    expect(isValidDeepSeekKey('sk-' + 'a'.repeat(32))).toBe(true);
    expect(isValidDeepSeekKey('sk-short')).toBe(false);
    expect(isValidDeepSeekKey('abc')).toBe(false);
  });
  it('masks all but the last 4 characters', () => {
    expect(maskKey('sk-abcdefghijklmnopqrstuvwx1234')).toBe('sk-…1234');
    expect(maskKey(null)).toBeNull();
  });
  it('explains test results in plain Chinese', async () => {
    expect(await testDeepSeekKey('sk-x', res(200))).toEqual({ ok: true, message: '连接成功，这个 key 可以用。' });
    expect((await testDeepSeekKey('sk-x', res(401))).message).toBe('DeepSeek 说这个 key 无效，检查是否复制完整或已被删除。');
    const down = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    expect((await testDeepSeekKey('sk-x', down)).message).toBe('连不上 DeepSeek（ENOTFOUND），检查网络后再试。');
  });
});
```

`tests/lib/health/checks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runHealthChecks, type Exec } from '@/lib/health/checks';
import type { CollectStatus } from '@/lib/douyin/collect-log';

const okCollect: CollectStatus = { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' };
const allOk: Exec = async () => ({ code: 0, stdout: 'ok', stderr: '' });

function deps(over: Partial<Parameters<typeof runHealthChecks>[0]> = {}) {
  return {
    exec: allOk,
    exists: async () => true,
    dbPing: async () => {},
    env: { DEEPSEEK_API_KEY: 'sk-' + 'a'.repeat(32), PYTHON_BIN: '/py' } as NodeJS.ProcessEnv,
    cwd: '/repo',
    collect: okCollect,
    ...over,
  };
}

describe('runHealthChecks', () => {
  it('reports every item ok on a healthy machine', async () => {
    const items = await runHealthChecks(deps());
    expect(items.map((i) => [i.key, i.status])).toEqual([
      ['db', 'ok'], ['deepseek', 'ok'], ['ffmpeg', 'ok'], ['whisper', 'ok'], ['remotion', 'ok'], ['collect', 'ok'],
    ]);
  });
  it('gives an actionable fix for each failure', async () => {
    const items = await runHealthChecks(
      deps({
        dbPing: async () => { throw new Error('ECONNREFUSED'); },
        env: {} as NodeJS.ProcessEnv,
        exec: async (cmd, args) => (cmd === 'ffmpeg' ? { code: 127, stdout: '', stderr: 'not found' } : args.includes('import faster_whisper') ? { code: 1, stdout: '', stderr: "No module named 'faster_whisper'" } : { code: 0, stdout: '', stderr: '' }),
        exists: async (p) => !p.includes('@remotion'),
        collect: { ...okCollect, state: 'failing', hint: '连续 2 次回采失败：ego lite 没在运行' },
      }),
    );
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(by.db).toMatchObject({ status: 'fail', fix: '启动 Docker Desktop，然后运行 docker compose up -d' });
    expect(by.deepseek).toMatchObject({ status: 'fail', fix: '在下方填入 DeepSeek key' });
    expect(by.ffmpeg).toMatchObject({ status: 'fail', fix: 'brew install ffmpeg' });
    expect(by.whisper.fix).toContain('pip install faster-whisper');
    expect(by.remotion).toMatchObject({ status: 'fail', fix: 'cd remotion && npm install' });
    expect(by.collect).toMatchObject({ status: 'warn', detail: '连续 2 次回采失败：ego lite 没在运行' });
  });
  it('times out a hanging command', async () => {
    const hanging: Exec = async (cmd) => (cmd === 'ffmpeg' ? { code: 124, stdout: '', stderr: 'timeout' } : { code: 0, stdout: '', stderr: '' });
    const items = await runHealthChecks(deps({ exec: hanging }));
    expect(items.find((i) => i.key === 'ffmpeg')).toMatchObject({ status: 'fail', detail: 'ffmpeg 没有响应（超时）' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/settings tests/lib/health`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/settings/env-file.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';

/** 替换 KEY=... 这一行; 没有就追加。注释行(#)不算。其他行原样保留。 */
export function upsertEnvLine(content: string, key: string, value: string): string {
  const lines = content.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) {
    lines[i] = `${key}=${value}`;
    return lines.join('\n');
  }
  const base = content === '' || content.endsWith('\n') ? content : `${content}\n`;
  return `${base}${key}=${value}\n`;
}

/** 写 .env(临时文件 + rename, 不会写出半个文件), 并立即更新 process.env */
export async function writeEnvKey(key: string, value: string, file = path.join(process.cwd(), '.env')): Promise<void> {
  const content = await fs.readFile(file, 'utf8').catch(() => '');
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, upsertEnvLine(content, key, value), { mode: 0o600 });
  await fs.rename(tmp, file);
  process.env[key] = value;
}
```

- [ ] **Step 4: 实现 `src/lib/settings/deepseek.ts`**

```ts
export function isValidDeepSeekKey(k: string): boolean {
  return /^sk-[A-Za-z0-9]{20,}$/.test(k.trim());
}

export function maskKey(k: string | null): string | null {
  return k ? `sk-…${k.slice(-4)}` : null;
}

/** 调 DeepSeek 的模型列表接口验证 key(不花钱); 结果写成人话 */
export async function testDeepSeekKey(key: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetcher('https://api.deepseek.com/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { ok: true, message: '连接成功，这个 key 可以用。' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'DeepSeek 说这个 key 无效，检查是否复制完整或已被删除。' };
    return { ok: false, message: `DeepSeek 返回了异常（${res.status}），稍后再试。` };
  } catch (e) {
    return { ok: false, message: `连不上 DeepSeek（${e instanceof Error ? e.message : String(e)}），检查网络后再试。` };
  }
}
```

- [ ] **Step 5: 实现 `src/lib/health/checks.ts`**

```ts
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { CollectStatus } from '@/lib/douyin/collect-log';

export type Exec = (cmd: string, args: string[], timeoutMs: number) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface HealthItem {
  key: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

/** 超时记为 code 124(与 coreutils timeout 一致); 命令不存在记为 127 */
export const realExec: Exec = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null;
      const code = !e ? 0 : e.killed ? 124 : e.code === 'ENOENT' ? 127 : typeof e.code === 'number' ? e.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

const TIMEOUT = 8000;

/** 逐项体检本机依赖; 只读, 不修改任何东西 */
export async function runHealthChecks(deps: {
  exec: Exec;
  exists: (p: string) => Promise<boolean>;
  dbPing: () => Promise<void>;
  env: NodeJS.ProcessEnv;
  cwd: string;
  collect: CollectStatus;
}): Promise<HealthItem[]> {
  const items: HealthItem[] = [];

  try {
    await deps.dbPing();
    items.push({ key: 'db', label: '数据库', status: 'ok', detail: 'Postgres 连接正常' });
  } catch (e) {
    items.push({ key: 'db', label: '数据库', status: 'fail', detail: `连不上数据库（${e instanceof Error ? e.message : String(e)}）`, fix: '启动 Docker Desktop，然后运行 docker compose up -d' });
  }

  const key = deps.env.DEEPSEEK_API_KEY?.trim();
  items.push(
    key
      ? { key: 'deepseek', label: 'DeepSeek key', status: 'ok', detail: `已配置（sk-…${key.slice(-4)}），可在下方测试连接` }
      : { key: 'deepseek', label: 'DeepSeek key', status: 'fail', detail: '没有配置，编导和写稿都用不了', fix: '在下方填入 DeepSeek key' },
  );

  const ff = await deps.exec('ffmpeg', ['-version'], TIMEOUT);
  const fp = ff.code === 0 ? await deps.exec('ffprobe', ['-version'], TIMEOUT) : ff;
  items.push(
    ff.code === 0 && fp.code === 0
      ? { key: 'ffmpeg', label: 'ffmpeg / ffprobe', status: 'ok', detail: '已安装' }
      : { key: 'ffmpeg', label: 'ffmpeg / ffprobe', status: 'fail', detail: ff.code === 124 || fp.code === 124 ? 'ffmpeg 没有响应（超时）' : '没有找到 ffmpeg 或 ffprobe', fix: 'brew install ffmpeg' },
  );

  const py = deps.env.PYTHON_BIN || 'python3';
  const w = await deps.exec(py, ['-c', 'import faster_whisper'], TIMEOUT * 2);
  items.push(
    w.code === 0
      ? { key: 'whisper', label: '本地转写', status: 'ok', detail: `faster-whisper 可用（${py}）` }
      : {
          key: 'whisper',
          label: '本地转写',
          status: 'fail',
          detail: w.code === 127 ? `找不到 Python：${py}` : w.code === 124 ? 'Python 没有响应（超时）' : '缺少 faster-whisper',
          fix: w.code === 127 ? '在 .env 里把 PYTHON_BIN 设为装了 faster-whisper 的 Python 路径' : `${py} -m pip install faster-whisper`,
        },
  );

  const remotionOk = await deps.exists(path.join(deps.cwd, 'remotion', 'node_modules', '@remotion', 'renderer'));
  items.push(
    remotionOk
      ? { key: 'remotion', label: '出片（Remotion）', status: 'ok', detail: '子工程依赖已安装' }
      : { key: 'remotion', label: '出片（Remotion）', status: 'fail', detail: 'remotion/ 子工程还没装依赖', fix: 'cd remotion && npm install' },
  );

  items.push(
    deps.collect.state === 'ok'
      ? { key: 'collect', label: '抖音回采', status: 'ok', detail: `上次成功：${new Date(deps.collect.lastSuccessAt!).toLocaleString('zh-CN')}` }
      : { key: 'collect', label: '抖音回采', status: 'warn', detail: deps.collect.hint },
  );
  return items;
}
```

- [ ] **Step 6: 运行单测确认通过**

Run: `npx vitest run tests/lib/settings tests/lib/health && npm run typecheck`
Expected: 全部 PASS；0 错误。

- [ ] **Step 7: 接口**

`src/app/api/settings/deepseek/route.ts`:

```ts
import { ok, fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { writeEnvKey } from '@/lib/settings/env-file';
import { isValidDeepSeekKey, maskKey, testDeepSeekKey } from '@/lib/settings/deepseek';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ masked: maskKey(getDeepSeekKey()) });
}

export async function PUT(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key || !isValidDeepSeekKey(key)) return fail('key 格式不对：应以 sk- 开头，后面是字母和数字', 400);
  await writeEnvKey('DEEPSEEK_API_KEY', key.trim());
  return ok({ masked: maskKey(key.trim()) });
}

export async function POST(req: Request) {
  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  const k = key?.trim() || getDeepSeekKey();
  if (!k) return fail('还没有 key 可以测试', 400);
  return ok(await testDeepSeekKey(k));
}
```

`src/app/api/settings/health/route.ts`:

```ts
import fs from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { runHealthChecks, realExec } from '@/lib/health/checks';
import { readCollectStatus } from '@/lib/douyin/collect-log';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await runHealthChecks({
    exec: realExec,
    exists: (p) => fs.access(p).then(() => true, () => false),
    dbPing: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    env: process.env,
    cwd: process.cwd(),
    collect: await readCollectStatus(),
  });
  return ok(items);
}
```

- [ ] **Step 8: 组件与页面**

`src/components/settings/deepseek-key.tsx`:

```tsx
'use client';

import { useState } from 'react';

export function DeepSeekKey({ initialMasked }: { initialMasked: string | null }) {
  const [masked, setMasked] = useState(initialMasked);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const call = async (method: 'PUT' | 'POST', body: object) => {
    const res = await fetch('/api/settings/deepseek', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
  };
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-1 text-sm font-medium">DeepSeek key</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">当前：{masked ?? '未配置'}。保存后写入项目目录的 .env，立即生效。</p>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" className="flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1.5 text-sm" placeholder="sk-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <button
          className="rounded-md border border-[var(--border-strong)] px-3 text-sm"
          onClick={async () => {
            const j = await call('POST', key ? { key } : {});
            setMsg(j.success ? { ok: j.data.ok, text: j.data.message } : { ok: false, text: j.message });
          }}
        >
          测试连接
        </button>
        <button
          className="rounded-md bg-[var(--accent)] px-3 text-sm text-[var(--text-on-accent)]"
          onClick={async () => {
            const j = await call('PUT', { key });
            if (j.success) {
              setMasked(j.data.masked);
              setKey('');
              setMsg({ ok: true, text: '已保存。' });
            } else setMsg({ ok: false, text: j.message });
          }}
        >
          保存
        </button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
```

`src/components/settings/health-panel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { HealthItem } from '@/lib/health/checks';

const DOT: Record<HealthItem['status'], string> = { ok: 'bg-[var(--success)]', warn: 'bg-[var(--warning)]', fail: 'bg-[var(--danger)]' };

export function HealthPanel() {
  const [items, setItems] = useState<HealthItem[] | null>(null);
  const load = useCallback(async () => {
    setItems(null);
    const j = await (await fetch('/api/settings/health')).json();
    setItems(j.success ? j.data : []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-center">
        <h3 className="text-sm font-medium">依赖体检</h3>
        <div className="flex-1" />
        <button className="text-xs text-[var(--accent)]" onClick={() => void load()}>重新检查</button>
      </div>
      {items === null ? (
        <p className="text-sm text-[var(--text-secondary)]">检查中…</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex gap-3 text-sm">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[i.status]}`} />
              <div className="min-w-0">
                <div>
                  <b>{i.label}</b> <span className="text-[var(--text-secondary)]">{i.detail}</span>
                </div>
                {i.fix && <code className="mt-1 block text-xs text-[var(--text-tertiary)]">{i.fix}</code>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`src/app/settings/page.tsx`:

```tsx
import { getDeepSeekKey } from '@/lib/env';
import { maskKey } from '@/lib/settings/deepseek';
import { DeepSeekKey } from '@/components/settings/deepseek-key';
import { HealthPanel } from '@/components/settings/health-panel';

export const dynamic = 'force-dynamic';

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-4 text-lg font-semibold">设置</h1>
      <div className="max-w-3xl space-y-4">
        <HealthPanel />
        <DeepSeekKey initialMasked={maskKey(getDeepSeekKey())} />
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（重启 dev）：打开 `/settings`：体检 6 项按本机真实状态显示（数据库、key、ffmpeg、转写、Remotion 应为绿；回采按日志）；点「测试连接」（不填）→ "连接成功，这个 key 可以用。"；填一个格式错误的 key 点保存 → 格式错误提示，`.env` 未改（`git diff --no-index` 不适用，用 `awk -F= '/^DEEPSEEK_API_KEY/{print length($2)}' .env` 确认长度仍为 35）。**不要真的替换 key**。

```bash
git add src/lib/settings src/lib/health src/app/api/settings src/app/settings src/components/settings tests/lib/settings tests/lib/health
git commit -m "feat(settings): 设置页(DeepSeek key 写入 .env 与测试连接, 依赖体检 6 项带补救命令)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 文档与收尾

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`（§7.1 标注已实现并去掉 Studio/node 22）

- [ ] **Step 1: README**

「现在能做什么」追加：

```markdown
- **首页**：顶部显示粉丝、作品数、作品播放合计、最近发布（来自每晚回采）；回采失败或超过 36 小时没成功时直接提示原因和补救方法。
- **定位**：编辑人设档案（受众、差异化角度、忌讳、内容支柱、痛点、产品、定位摘要），编导写稿时读取。
- **设置**：更换 DeepSeek key（写入 .env）并测试连接；依赖体检逐项检查数据库、ffmpeg、本地转写、出片子工程、回采，缺什么给出补救命令。
```

把「首页账号数据、定位页、设置页在后续阶段加入。」这句删掉。

- [ ] **Step 2: spec §7.1**

在原 spec §7.1「设置」那条后追加一句：「（2026-09-28 实现：依赖体检为数据库 / DeepSeek key / ffmpeg / 本地转写 / Remotion 子工程 / 回采 6 项；Overlay Studio 与 node 22 随阶段 4 改版已移除。）」

- [ ] **Step 3: 收尾检查与提交**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git status --short
git add README.md docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md
git commit -m "docs: README 补首页/定位/设置, spec 标注阶段 5 实现

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Expected: 全绿；`git status` 干净（`prisma/dev.db` 这个与本次无关的空文件除外）。
