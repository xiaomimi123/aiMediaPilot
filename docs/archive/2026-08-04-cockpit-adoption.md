# Creator Cockpit 整体移植 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 creator-cockpit (pinned `197d49b93ff42d80211c1d832d1f8fa8db7c6660`, MIT) 的 UI 组件与交互逻辑整体移植进 MediaPilot：cockpit 侧栏接管全站外壳，8 阶段流水线 + 档期 + 大目标 + 复盘实验室落到 Prisma 数据库，存量数据迁移，并接通 AI 写稿 / 爬虫指标回填 / L1 预测对比。

**Architecture:** cockpit 的业务逻辑全部是 `WorkspaceState → WorkspaceState` 纯函数，与存储解耦。移植策略 = 纯逻辑层零改动复制 + 只替换存储层（IndexedDB → `GET/PUT /api/v1/cockpit/workspace`）+ 视图层复制后按视图拆文件（逻辑一字不改）。Spec: `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`。

**Tech Stack:** Next 14.2 / React 18.3 / Tailwind 3.4 / Prisma 5.22 (PostgreSQL, `db push` 无 migrations) / vitest (node env, `@` → `./src`)。

## Global Constraints

- 移植源固定 commit：`197d49b93ff42d80211c1d832d1f8fa8db7c6660`（下称 `$VENDOR` = `vendor/creator-cockpit`）。
- 复制 cockpit 纯逻辑文件时**唯一允许的改动**：import 路径 `./model.ts` → `./model`（我们 tsconfig 不允许 `.ts` 后缀）。逻辑、命名、顺序一律不改。
- API 一律用 `ok()/fail()` 封装（`src/lib/api.ts`），prisma 走 `@/lib/prisma` 单例，用户走 `getOrCreateDefaultUser()`（`src/lib/user.ts`），所有查询按 `userId` 过滤。
- Prisma 模型全部加 `Cockpit` 前缀避免与既有模型混淆；改 schema 后跑 `npm run db:push`（本项目不用 migrate）。
- 路由测试沿用现有约定：`vi.hoisted()` + `vi.mock('@/lib/prisma', …)` + `vi.mock('@/lib/user', …)`，直接 import route handler 调用（参考 `tests/api/discover/topics.test.ts`）。
- 中文 UI 文案照抄 cockpit 原文，不重写。
- 每个 Task 结束必须：`npm run typecheck && npm run test` 通过后 commit。
- 已废弃模型（`Content`/`PublishTask`/`PublishTarget`/`Competitor`）不得使用。

---

## Phase 1：外壳与样式

### Task 1: Vendor 源码 + 全站样式基座

**Files:**
- Create: `vendor/creator-cockpit/`（clone，加入 .gitignore）
- Create: `src/app/cockpit.css`
- Modify: `src/app/layout.tsx`（import cockpit.css）
- Modify: `.gitignore`

**Interfaces:**
- Produces: `$VENDOR` 路径下的全部源文件（后续所有 Task 的复制来源）；全站生效的 cockpit CSS 类（`.panel`、`.badge`、`html[data-style=…]`、`html[data-theme=dark]` 等）。

- [ ] **Step 1: Clone 并固定 commit**

```bash
git clone https://github.com/AverrryHu/creator-cockpit.git vendor/creator-cockpit
cd vendor/creator-cockpit && git checkout 197d49b93ff42d80211c1d832d1f8fa8db7c6660 && cd ../..
echo "vendor/" >> .gitignore
```

- [ ] **Step 2: 复制样式**

复制 `$VENDOR/app/globals.css` → `src/app/cockpit.css`，**只删第 1 行** `@import "tailwindcss";`（Tailwind 4 语法，我们是 v3，其余 1736 行为纯 CSS 原样保留）。

- [ ] **Step 3: 引入**

`src/app/layout.tsx` 在 `import './globals.css'` 之后加一行 `import './cockpit.css'`。顺带检查 `tailwind.config.ts` 末尾是否有重复的 `export default config;`（勘探时发现疑似重复，若属实删掉一行）。

- [ ] **Step 4: 验证**

`npm run dev` 打开 `http://localhost:3000`：全站 body 变暖纸底色 `#f3f0e8`、字体变 PingFang SC。现有页面功能不受影响（cockpit.css 主要按自有 class 命名，冲突面小；若发现具体冲突记录下来在 Task 10 处理）。`npm run typecheck && npm run test` 通过。

- [ ] **Step 5: Commit** — `feat(cockpit): vendor 源码固定 + 全站纸质样式基座`

### Task 2: 移植纯逻辑库与测试

**Files:**
- Create: `src/lib/cockpit/model.ts` ← `$VENDOR/app/lib/model.ts`
- Create: `src/lib/cockpit/workflow.ts` ← `$VENDOR/app/lib/workflow.ts`
- Create: `src/lib/cockpit/schedule.ts` ← `$VENDOR/app/lib/schedule.ts`
- Create: `src/lib/cockpit/calculations.ts` ← `$VENDOR/app/lib/calculations.ts`
- Create: `src/lib/cockpit/workspace.ts` ← `$VENDOR/app/lib/workspace.ts`
- Test: `tests/lib/cockpit/calculations.test.ts` ← `$VENDOR/tests/calculations.test.ts`

**Interfaces:**
- Produces: `WorkspaceState` 及全部实体类型（`ContentItem`/`StageEvent`/`GoalCycle`/`InsightRule`/…）、`STAGE_LABELS`/`CONTENT_STAGES` 常量、`calculateGoalHealth(goal, contents, snapshots, now?)`、`scheduleStageForDate`/`toggleStageEvent`/`transitionContentStage` 等纯函数——全部按原名导出，供 Task 5/6/8/11/12/13 使用。

- [ ] **Step 1: 复制 5 个文件**，每个文件只把 `from "./model.ts"` 改为 `from "./model"`（Global Constraints 唯一允许改动）。
- [ ] **Step 2: 移植测试**：`$VENDOR/tests/calculations.test.ts` 用的是 `node:test` + `node:assert`；改写为 vitest（`import { describe, it, expect } from 'vitest'`，`assert.equal(a,b)` → `expect(a).toBe(b)`，`assert.deepEqual` → `toEqual`），import 改为 `@/lib/cockpit/calculations` 与 `@/lib/cockpit/model`。**断言值和用例一个不删。**
- [ ] **Step 3: Run** `npx vitest run tests/lib/cockpit/calculations.test.ts` → 全部 PASS；`npm run typecheck` 通过。
- [ ] **Step 4: Commit** — `feat(cockpit): 移植纯逻辑层 (model/workflow/schedule/calculations) + 测试`

---

## Phase 2：数据层

### Task 3: Prisma 模型

**Files:**
- Modify: `prisma/schema.prisma`（文件末尾追加）

**Interfaces:**
- Produces: 下列模型，Task 5/6/11/12/13 依赖。可查询字段用列，嵌套结构（topic 卡/script 骨架/metrics/review/quotas）用 Json 列，字段名与 `src/lib/cockpit/model.ts` 的 TS 类型一一对应。

- [ ] **Step 1: 追加模型**（原样写入）：

```prisma
// ============ Creator Cockpit (2026-08-04 整体移植, spec: docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md) ============

model CockpitContent {
  id                String   @id // 客户端 crypto.randomUUID()
  userId            String
  title             String
  idea              String   @default("")
  contentType       String   @default("")
  tier              String   @default("B") // A | B | C
  stage             String   @default("inbox") // inbox|topic|script|recording|editing|publishing|review|archived
  publicationStatus String   @default("draft") // draft|scheduled|published
  priority          String   @default("normal")
  tags              Json     @default("[]")
  publishedAt       String   @default("") // cockpit 用 ISO date 字符串, 保持原样
  xhsLink           String   @default("")
  coverCopy         String   @default("")
  publishCopy       String   @default("")
  topic             Json // TopicCard
  script            Json // ScriptDraft 骨架
  recordingNotes    String   @default("")
  editingNotes      String   @default("")
  metrics           Json // MetricsSnapshot
  review            Json // Review
  scriptDraftId     String?  // → ScriptDraft (AI 稿)
  analysisId        String?  // → ContentAnalysis (L1/复盘链)
  createdAt         String
  updatedAt         String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, stage])
  @@index([scriptDraftId])
  @@index([analysisId])
}

model CockpitInspiration {
  id                  String @id
  userId              String
  text                String
  convertedContentIds Json   @default("[]")
  createdAt           String
  updatedAt           String
  user                User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitStageEvent {
  id          String @id
  userId      String
  contentId   String
  stage       String
  plannedDate String
  rank        Int
  completedAt String @default("")
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, plannedDate])
  @@index([contentId])
}

model CockpitReviewDay {
  id          String @id
  userId      String
  plannedDate String
  note        String @default("")
  createdAt   String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitLiveSession {
  id          String @id
  userId      String
  title       String
  plannedDate String
  startTime   String @default("")
  endTime     String @default("")
  platform    String @default("")
  content     String @default("")
  createdAt   String
  updatedAt   String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitScheduleObjectType {
  id          String  @id
  userId      String
  kind        String // review|live|custom
  name        String
  description String  @default("")
  color       String
  archived    Boolean @default(false)
  createdAt   String
  user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitScheduleObject {
  id          String @id
  userId      String
  typeId      String
  title       String
  plannedDate String
  startTime   String @default("")
  endTime     String @default("")
  details     String @default("")
  createdAt   String
  updatedAt   String
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitGoalCycle {
  id               String @id
  userId           String
  objective        String @default("")
  startDate        String
  endDate          String
  status           String @default("active") // active|archived
  outputTarget     Int    @default(0)
  quotas           Json   @default("[]")
  followerStart    Int    @default(0)
  followerTarget   Int    @default(0)
  qualityMetric    String @default("views")
  qualityThreshold Float  @default(0)
  qualityTarget    Int    @default(0)
  user             User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, status])
}

model CockpitInsightRule {
  id              String  @id
  userId          String
  text            String
  sourceContentId String?
  active          Boolean @default(true)
  createdAt       String
  user            User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model CockpitPrefs {
  userId          String   @id
  designStyle     String   @default("editorial")
  navigationOrder Json     @default("[]")
  profile         Json // CreatorProfile
  pageTitles      Json // PageTitles
  stageColors     Json // Record<ContentStage,string>
  contentTypes    Json     @default("[]")
  setupComplete   Boolean  @default(false)
  lastBackupAt    String   @default("")
  updatedAt       DateTime @updatedAt // 冲突检测用, 服务端时间
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

并在 `model User` 中追加反向关系字段：`cockpitContents CockpitContent[]`、`cockpitInspirations CockpitInspiration[]`、`cockpitStageEvents CockpitStageEvent[]`、`cockpitReviewDays CockpitReviewDay[]`、`cockpitLiveSessions CockpitLiveSession[]`、`cockpitScheduleObjectTypes CockpitScheduleObjectType[]`、`cockpitScheduleObjects CockpitScheduleObject[]`、`cockpitGoalCycles CockpitGoalCycle[]`、`cockpitInsightRules CockpitInsightRule[]`、`cockpitPrefs CockpitPrefs?`。

> 设计说明（记入代码注释）：日期字段沿用 cockpit 的 ISO 字符串而非 DateTime——纯函数用字符串比较日期（如 `plannedDate < today`），改类型会破坏零改动原则。`FollowerSnapshot` **不建表**：workspace GET 时从 `AccountMetric` 派生（爬虫已每日写入），PUT 忽略该字段。

- [ ] **Step 2: Run** `npm run db:push` → 成功；`npm run typecheck` 通过（会触发 prisma generate）。
- [ ] **Step 3: Commit** — `feat(cockpit): Prisma 数据模型 (10 表, FollowerSnapshot 由 AccountMetric 派生)`

### Task 4: Workspace 组装/持久化模块 + GET/PUT API

**Files:**
- Create: `src/lib/cockpit/server-store.ts`
- Create: `src/app/api/v1/cockpit/workspace/route.ts`
- Test: `tests/api/cockpit/workspace.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `WorkspaceState` 类型与默认常量、Task 3 的 Prisma 模型。
- Produces: `loadWorkspaceFromDb(userId): Promise<{ state: WorkspaceState; rev: string }>`、`saveWorkspaceToDb(userId, state, baseRev): Promise<{ ok: true; rev: string } | { ok: false; conflict: true }>`；HTTP：`GET /api/v1/cockpit/workspace` → `ok({ state, rev, extras })`，`PUT` body `{ state, rev }` → `ok({ rev })` 或 `fail('conflict', 409)`。`rev` = `CockpitPrefs.updatedAt.toISOString()`。`extras` 结构见 Task 13。

- [ ] **Step 1: 写 `server-store.ts`**（核心代码，实现时按此骨架补全全部实体，模式完全相同）：

```ts
import { prisma } from '@/lib/prisma';
import {
  DEFAULT_CREATOR_PROFILE, DEFAULT_DESIGN_STYLE, DEFAULT_NAVIGATION_ORDER,
  DEFAULT_PAGE_TITLES, DEFAULT_SCHEDULE_OBJECT_TYPES, DEFAULT_STAGE_COLORS,
  DEFAULT_CONTENT_TYPES, type WorkspaceState, type GoalCycle,
} from './model';

const EPOCH = '1970-01-01T00:00:00.000Z';

function defaultGoal(): GoalCycle {
  return {
    id: 'goal-default', objective: '', startDate: '', endDate: '', status: 'active',
    outputTarget: 0, quotas: [], followerStart: 0, followerTarget: 0,
    qualityMetric: 'views', qualityThreshold: 0, qualityTarget: 0,
  };
}

export async function loadWorkspaceFromDb(userId: string) {
  const [prefs, contents, inspirations, stageEvents, reviewDays, liveSessions,
    scheduleObjectTypes, scheduleObjects, goals, insightRules, accountMetrics] =
    await Promise.all([
      prisma.cockpitPrefs.findUnique({ where: { userId } }),
      prisma.cockpitContent.findMany({ where: { userId } }),
      prisma.cockpitInspiration.findMany({ where: { userId } }),
      prisma.cockpitStageEvent.findMany({ where: { userId } }),
      prisma.cockpitReviewDay.findMany({ where: { userId } }),
      prisma.cockpitLiveSession.findMany({ where: { userId } }),
      prisma.cockpitScheduleObjectType.findMany({ where: { userId } }),
      prisma.cockpitScheduleObject.findMany({ where: { userId } }),
      prisma.cockpitGoalCycle.findMany({ where: { userId } }),
      prisma.cockpitInsightRule.findMany({ where: { userId } }),
      prisma.accountMetric.findMany({
        where: { account: { userId } }, orderBy: { date: 'asc' }, take: 400,
        select: { id: true, date: true, followerCount: true },
      }),
    ]);
  const active = goals.find((g) => g.status === 'active');
  const state: WorkspaceState = {
    schemaVersion: 16,
    designStyle: (prefs?.designStyle ?? DEFAULT_DESIGN_STYLE) as WorkspaceState['designStyle'],
    navigationOrder: (prefs?.navigationOrder as WorkspaceState['navigationOrder']) ?? DEFAULT_NAVIGATION_ORDER,
    profile: (prefs?.profile as WorkspaceState['profile']) ?? DEFAULT_CREATOR_PROFILE,
    pageTitles: (prefs?.pageTitles as WorkspaceState['pageTitles']) ?? DEFAULT_PAGE_TITLES,
    stageColors: (prefs?.stageColors as WorkspaceState['stageColors']) ?? DEFAULT_STAGE_COLORS,
    contentTypes: (prefs?.contentTypes as string[]) ?? DEFAULT_CONTENT_TYPES,
    setupComplete: prefs?.setupComplete ?? false,
    lastBackupAt: prefs?.lastBackupAt ?? '',
    inspirationCards: inspirations.map(({ userId: _u, ...rest }) => ({
      ...rest, convertedContentIds: rest.convertedContentIds as string[],
    })),
    contents: contents.map(({ userId: _u, scriptDraftId: _s, analysisId: _a, ...rest }) => ({
      ...rest, tags: rest.tags as string[],
      topic: rest.topic as any, script: rest.script as any,
      metrics: rest.metrics as any, review: rest.review as any,
    })) as WorkspaceState['contents'],
    stageEvents: stageEvents.map(({ userId: _u, ...rest }) => rest) as WorkspaceState['stageEvents'],
    reviewDays: reviewDays.map(({ userId: _u, ...rest }) => rest),
    liveSessions: liveSessions.map(({ userId: _u, ...rest }) => rest),
    scheduleObjectTypes: scheduleObjectTypes.length
      ? scheduleObjectTypes.map(({ userId: _u, ...rest }) => rest) as WorkspaceState['scheduleObjectTypes']
      : DEFAULT_SCHEDULE_OBJECT_TYPES,
    scheduleObjects: scheduleObjects.map(({ userId: _u, ...rest }) => rest),
    goal: active ? toGoal(active) : defaultGoal(),
    goalHistory: goals.filter((g) => g.status === 'archived').map(toGoal),
    followerSnapshots: accountMetrics.map((m) => ({
      id: m.id, date: m.date.toISOString().slice(0, 10), followers: m.followerCount,
    })),
    insightRules: insightRules.map(({ userId: _u, ...rest }) => rest),
  };
  return { state, rev: prefs?.updatedAt.toISOString() ?? EPOCH };
}

function toGoal(g: { userId?: string } & Record<string, unknown>): GoalCycle {
  const { userId: _u, ...rest } = g;
  return { ...(rest as unknown as GoalCycle), quotas: (g.quotas ?? []) as GoalCycle['quotas'] };
}
```

`saveWorkspaceToDb(userId, state, baseRev)`：`prisma.$transaction` 内——(1) 读 `cockpitPrefs.updatedAt`，若存在且 `toISOString() !== baseRev` 返回 `{ ok: false, conflict: true }`；(2) 对每张实体表做「全量同步」：`deleteMany({ where: { userId, id: { notIn: ids } } })` + 逐条 `upsert`（goal 与 goalHistory 合并为 CockpitGoalCycle 行集；**followerSnapshots 跳过不写**；contents upsert 时 `update`/`create` 均不带 `scriptDraftId`/`analysisId`，保住服务端 FK 不被客户端覆盖）；(3) upsert `cockpitPrefs` 并读回新 `updatedAt` 作为返回 rev。

- [ ] **Step 2: 写 route**：

```ts
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { loadWorkspaceFromDb, saveWorkspaceToDb } from '@/lib/cockpit/server-store';
import { loadExtras } from '@/lib/cockpit/extras'; // Task 13 前先返回 { predictions: {} } 的占位实现，本 Task 一并创建

export async function GET() {
  try {
    const user = await getOrCreateDefaultUser();
    const { state, rev } = await loadWorkspaceFromDb(user.id);
    const extras = await loadExtras(user.id);
    return ok({ state, rev, extras });
  } catch (e) {
    console.error('[GET cockpit/workspace]', e);
    return fail(`加载失败: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}

export async function PUT(req: Request) {
  let body: { state?: unknown; rev?: string };
  try { body = await req.json(); } catch { return fail('请求体不是合法 JSON', 400); }
  if (!body.state || typeof body.rev !== 'string') return fail('缺少 state 或 rev', 400);
  try {
    const user = await getOrCreateDefaultUser();
    const result = await saveWorkspaceToDb(user.id, body.state as never, body.rev);
    if (!result.ok) return fail('conflict', 409);
    return ok({ rev: result.rev });
  } catch (e) {
    console.error('[PUT cockpit/workspace]', e);
    return fail(`保存失败: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
}
```

- [ ] **Step 3: 写失败测试**（先写测试再实现是理想顺序；本 Task 代码量大，允许实现后补测，但测试必须覆盖）：GET 空库返回默认 state（`schemaVersion===16`、`goal.id==='goal-default'`、followerSnapshots 来自 accountMetric mock）；PUT rev 不匹配 → 409；PUT 正常 → 各表 upsert/deleteMany 被按预期调用（用 hoisted prisma mock 断言参数）。
- [ ] **Step 4: Run** `npx vitest run tests/api/cockpit/workspace.test.ts` → PASS；`npm run typecheck` 通过。
- [ ] **Step 5: Commit** — `feat(cockpit): workspace 组装/持久化 + GET/PUT API (409 冲突检测)`

### Task 5: 客户端存储适配器

**Files:**
- Create: `src/lib/cockpit/storage.ts`

**Interfaces:**
- Consumes: Task 4 的 HTTP API。
- Produces: 与 `$VENDOR/app/lib/storage.ts` **同名同签名**的 `loadWorkspace(): Promise<WorkspaceState | null>` 与 `saveWorkspace(state): Promise<void>`（Task 8 的 Cockpit.tsx 原代码直接调用，行为对齐：load 失败返回 null → cockpit 走 onboarding；save 失败 throw → cockpit 弹「自动保存失败」toast）。额外导出 `getExtras()`（Task 13 用）。

- [ ] **Step 1: 实现**：

```ts
import type { WorkspaceState } from './model';
import type { CockpitExtras } from './extras-types'; // { predictions: Record<string, PredictionExtra> }

let rev = '';
let extras: CockpitExtras = { predictions: {} };

export function getExtras(): CockpitExtras { return extras; }

export async function loadWorkspace(): Promise<WorkspaceState | null> {
  const res = await fetch('/api/v1/cockpit/workspace');
  const json = await res.json();
  if (!res.ok || !json.success) return null;
  rev = json.data.rev;
  extras = json.data.extras;
  const state = json.data.state as WorkspaceState;
  return state.setupComplete ? state : null; // 未完成 onboarding 时与原版 IndexedDB 空库行为一致
}

export async function saveWorkspace(state: WorkspaceState): Promise<void> {
  const res = await fetch('/api/v1/cockpit/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state, rev }),
  });
  const json = await res.json().catch(() => null);
  if (res.status === 409) throw new Error('conflict: 其他标签页已保存，请刷新页面');
  if (!res.ok || !json?.success) throw new Error(json?.message ?? '保存失败');
  rev = json.data.rev;
}
```

注意：cockpit onboarding 完成时会 `saveWorkspace(state)`（`setupComplete: true`），首次保存走 upsert 自然落库，rev 从 EPOCH 起步——`saveWorkspaceToDb` 对「prefs 不存在」时跳过冲突检查（Task 4 已如此实现）。原版还有 `clearWorkspace`/`validateImport`（JSON 备份功能）——**不移植**（spec §8 YAGNI，数据库即备份），Task 8 中把设置页的「导出/导入备份」区块一并裁掉。

- [ ] **Step 2:** `npm run typecheck` 通过；Commit — `feat(cockpit): 客户端存储适配器 (IndexedDB → workspace API)`

---

## Phase 3：视图移植

### Task 6: Cockpit 整体移植并跑通

**Files:**
- Create: `src/components/cockpit/Cockpit.tsx` ← `$VENDOR/app/Cockpit.tsx`（整文件复制）
- Modify: `src/app/page.tsx`（整文件替换为渲染 `<Cockpit />`）
- Delete（本 Task 暂不删，Task 14 统一删）：无

**Interfaces:**
- Consumes: Task 2 逻辑库、Task 5 storage。
- Produces: `/` 路由下完整可用的 cockpit（6 视图 + 内容抽屉 + onboarding + 主题/风格切换），供 Task 7 拆分、Task 9 挂外部导航。

- [ ] **Step 1: 复制并改 import**：头部 `from "./lib/xxx.ts"` → `from "@/lib/cockpit/xxx"`；确认文件顶部有 `'use client'`（原文件如没有则加上——它在 vinext 下由 page.tsx 包 client 边界）。
- [ ] **Step 2: 暗色桥接**（唯一功能性增改，量 ≤3 行）：找到写 `document.documentElement.dataset.theme` 的 effect（约 640 行区域），紧随其后加 `document.documentElement.classList.toggle('dark', resolved === 'dark')`（变量名以实际代码为准）——让我们既有页面的 Tailwind `dark:` 变体跟随 cockpit 主题。
- [ ] **Step 3: 裁掉备份 UI**：删除设置视图中「导出 JSON / 导入备份」区块及其 `importSummary`/`validateImport`/`clearWorkspace` 相关引用（保留其余设置项：风格、页面标题、阶段颜色、内容类型、档案）。
- [ ] **Step 4: `src/app/page.tsx`** 替换为：

```tsx
'use client';
import dynamic from 'next/dynamic';
const Cockpit = dynamic(() => import('@/components/cockpit/Cockpit'), { ssr: false });
export default function Home() { return <Cockpit />; }
```

（`ssr: false` 是因为原代码在模块作用域/首帧就读 `document`/`localStorage`；与原版 CSR 行为一致。）同时把 `MainLayout` 对 `/` 的包裹去掉：在 `src/components/layout/main-layout.tsx` 里，`usePathname() === '/'` 时直接 `return <>{children}</>`（cockpit 自带整套外壳；其余路由仍走旧壳，Task 9 统一替换）。
- [ ] **Step 5: 验证**：`npm run dev` → `/` 出现 cockpit onboarding；选「空白工作区」填档案 → 6 视图可切换；添加一条灵感、转成内容、在档期拖到某天、勾完成——刷新页面数据仍在（走 DB）；DevTools Network 确认 PUT 250ms 防抖生效。React 18 下若有编译/运行时报错（预期极少），做最小语法适配并在 commit message 注明。`npm run typecheck && npm run test` 通过。
- [ ] **Step 6: Commit** — `feat(cockpit): Cockpit 整体移植, / 路由跑通 (DB 持久化)`

### Task 7: 按视图拆分文件（机械拆分，零逻辑改动）

**Files:**
- Modify: `src/components/cockpit/Cockpit.tsx`（缩为壳：state + 全部业务函数 + 视图路由）
- Create: `src/components/cockpit/views/inspirations.tsx`、`momentum.tsx`（含今日/本周）、`schedule.tsx`、`pipeline.tsx`、`goals.tsx`、`review.tsx`、`settings.tsx`、`onboarding.tsx`
- Create: `src/components/cockpit/content-drawer.tsx`、`src/components/cockpit/shared.tsx`（ProgressBar/Empty/Badge/EditablePageTitle/Icon 等小组件与 `shiftDate` 等模块级工具）

**Interfaces:**
- Produces: 各视图组件，props = 它在原文件里实际用到的 state 切片与回调（拆分时照实提取，禁止改名）。`Cockpit.tsx` 仍是唯一 state 持有者。

- [ ] **Step 1:** 逐视图剪切 JSX 与仅该视图使用的局部组件到对应文件，props 按实际引用提取；共享小组件进 `shared.tsx`。**不改任何表达式、文案、类名。**
- [ ] **Step 2:** `npm run typecheck` 通过；`npm run dev` 手工过一遍 6 视图 + 抽屉 + 设置，行为与 Task 6 一致。
- [ ] **Step 3: Commit** — `refactor(cockpit): Cockpit.tsx 按视图拆分 (机械拆分零逻辑改动)`

### Task 8: 外部页面挂入新壳

**Files:**
- Modify: `src/components/cockpit/Cockpit.tsx`（侧栏追加外部链接区）
- Create: `src/components/cockpit/external-shell.tsx`
- Modify: `src/components/layout/main-layout.tsx`

**Interfaces:**
- Produces: 全站统一外壳。cockpit 侧栏底部（版本记录区上方）新增分组：`🪄 创作 /agent · 📊 数据 /dashboard · 👤 账号 /accounts · ⚙️ 设置(平台) /settings`，用 `next/link` + cockpit 的 `.nav-item` 样式类；`ExternalShell` = 复用同一套侧栏渲染（cockpit 视图项此时为 `<Link href="/?view=<id>">`）+ `<main>` 包裹 children。

- [ ] **Step 1:** 侧栏渲染逻辑提取为 `src/components/cockpit/sidebar.tsx`，接受 `mode: 'cockpit' | 'external'`：cockpit 模式下视图项是 `onClick` 切 view（原逻辑），external 模式下是 `<Link href={'/?view=' + id}>`；外部四项两种模式都渲染为 `<Link>`，当前路由高亮沿用 `pathname.startsWith` 规则（参考旧 `src/components/layout/sidebar.tsx`）。拖拽排序、折叠等原交互只在 cockpit 模式启用。
- [ ] **Step 2:** `Cockpit.tsx` 挂载时读 `useSearchParams().get('view')`，合法值（`NavigationItemId`）则作为初始 view（替换硬编码 `"momentum"` 初始值处）。
- [ ] **Step 3:** `main-layout.tsx` 改为：`/` 直通 children；其余路由渲染 `<ExternalShell>{children}</ExternalShell>`。删除旧 `Sidebar`/`Header` 的引用（文件本身 Task 14 删）。
- [ ] **Step 4:** 验证：从 cockpit 点「数据」到 /dashboard（纸质壳 + 旧页面内容），点「Pipeline」回 `/` 且落在 pipeline 视图；暗色切换后 /dashboard 的 `dark:` 样式生效。`npm run typecheck && npm run test`。
- [ ] **Step 5: Commit** — `feat(cockpit): 侧栏接管全站, /agent /dashboard /accounts /settings 挂入新壳`

---

## Phase 4：迁移与强能力集成

### Task 9: 存量数据迁移脚本

**Files:**
- Create: `scripts/migrate-cockpit.ts`（`npx tsx scripts/migrate-cockpit.ts [--apply]`，默认 dry-run）
- Test: `tests/lib/cockpit/migrate-mapping.test.ts`
- Create: `src/lib/cockpit/migrate-mapping.ts`（纯映射函数，便于测试）

**Interfaces:**
- Consumes: `deriveStage`（`src/lib/pipeline/stage.ts`）、Task 2 类型、Task 3 模型。
- Produces: `mapDraftToCockpit(draft, analysis, distributionCount, latestMetric): { content: ContentItem; scriptDraftId: string; analysisId: string | null }`、`mapTopicToCockpit(topic): ContentItem`、`mapInspirationToCockpit(video): InspirationCard`。

- [ ] **Step 1: 写映射纯函数**。阶段映射（基于 `deriveStage` 的读时派生结果）：

| deriveStage 结果 | cockpit stage | publicationStatus | 附加 |
|---|---|---|---|
| `DRAFTING` | `script` | draft | — |
| `READY` (picked≠null) | `recording` | draft | script Json ← `picked` + `output` 摘录 |
| `SHOT` (有 analysis) | `publishing` | draft | analysisId 落 FK |
| `PUBLISHED` | `review` | published | publishedAt ← `analysis.publishedAt`（ISO 日期部分）；metrics ← 最新 `ActualMetric`（BigInt → Number，`capturedAt` ← `snapshotAt`） |
| `RETROED` | `archived` | published | 同上 + review.analysis ← `retroReport` 摘要（有则填，无则空） |

TopicIdea：`status==='POOL'` → `{ stage: 'topic', title, idea: note ?? '' }`；`ADOPTED`/`DISCARDED` 跳过。灵感：`InspirationVideo`（含 insight）→ `CockpitInspiration.text`（标题+要点拼接）。所有新 id 用 `crypto.randomUUID()`，`createdAt/updatedAt` 取源记录时间的 ISO 串。同步生成 StageEvent：对已过阶段各补一条 `completedAt` 非空的事件（`plannedDate` = 源记录相应时间的日期部分），复现 `transitionContentStage` 快进语义。
- [ ] **Step 2: 测试**：每个 deriveStage 分支一个用例 + BigInt 转换 + ADOPTED 跳过，纯函数直测无需 mock prisma。`npx vitest run tests/lib/cockpit/migrate-mapping.test.ts` → PASS。
- [ ] **Step 3: 写脚本壳**：读全量源数据 → 调映射 → dry-run 打印每条 `[stage] 标题 (来源 id)` 清单与计数汇总；`--apply` 时先检查 `cockpitContent.count({ where: { userId } }) === 0`（防重复迁移），然后事务写入。旧表**不删不改**。
- [ ] **Step 4:** 跑 dry-run，把输出贴给用户人工确认后再 `--apply`；apply 后打开 `/` 检查 Pipeline 各列条数与 dry-run 汇总一致。
- [ ] **Step 5: Commit** — `feat(cockpit): 存量数据迁移脚本 (dry-run 默认, --apply 写库)`

### Task 10: 集成 — AI 写稿闭环

**Files:**
- Modify: `src/components/cockpit/content-drawer.tsx`（script tab 加「用 AI 写脚本」按钮）
- Modify: `src/app/api/v1/scripts/route.ts` 及定稿（写 `picked`）的路由（以 grep `picked` 实际定位）
- Test: 扩展对应路由既有测试文件

**Interfaces:**
- Consumes: Task 3 FK 字段、Task 2 `CONTENT_STAGES`。
- Produces: 抽屉按钮 → `/agent?topic=<title>&cockpitId=<contentId>`；`/agent` 生成保存草稿时（scripts POST）若带 `cockpitContentId` 则回写 `CockpitContent.scriptDraftId`；定稿路由（设置 `picked`）时将关联 content `stage: 'script' → 'recording'` 并补一条 completed 的 `script` StageEvent（直接 prisma 更新，语义同 `setContentStageCompletion`，仅当当前 stage 为 `script` 时推进）。

- [ ] **Step 1:** 抽屉按钮（沿用 cockpit `.badge`/按钮类）：`<Link href={'/agent?topic=' + encodeURIComponent(item.title) + '&cockpitId=' + item.id}>用 AI 写脚本</Link>`；`/agent` 页读取 `cockpitId` 并在保存请求 body 透传 `cockpitContentId`（`src/app/agent/page.tsx` 已有 `?topic=&ideaId=` 同款处理，照抄模式）。
- [ ] **Step 2:** scripts POST：body 可选字段 `cockpitContentId`（字符串校验 + 归属校验：该 content.userId === user.id，否则忽略），创建 draft 后 `prisma.cockpitContent.update({ data: { scriptDraftId } })`。定稿路由同理推进 stage + StageEvent。
- [ ] **Step 3:** 测试：POST 带 `cockpitContentId` → update 被调用；定稿 → stage 推进且非 `script` 阶段时不动。Run 对应 vitest 文件 PASS。
- [ ] **Step 4:** 手工闭环验证：cockpit 建内容 → 抽屉点「用 AI 写脚本」→ /agent 生成保存 → 定稿 → 回 `/` 该卡片已到「录制」列。
- [ ] **Step 5: Commit** — `feat(cockpit): AI 写稿闭环 (抽屉→/agent→定稿自动推进录制)`

### Task 11: 集成 — 爬虫发布/指标回填

**Files:**
- Modify: `src/lib/douyin/auto-sync.ts`（匹配成功处）
- Modify: `src/jobs/workers/content-retro-worker.ts`（ActualMetric 落库处，约 64 行「阶段 4」块之后）
- Test: 扩展 `tests/lib/douyin/auto-sync.test.ts`、`tests/jobs/content-retro-worker.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `CockpitContent.analysisId` FK。
- Produces: auto-sync 匹配成功（写入 `douyinAwemeId/publishedAt`）后：`prisma.cockpitContent.updateMany({ where: { analysisId, userId }, data: { publicationStatus: 'published', publishedAt: <ISO 日期>, stage: 'review' } })`（仅当原 stage ∈ publishing 之前——用 `stage: { in: ['recording','editing','publishing'] }` 条件）；retro worker 写完 ActualMetric 后：把 plays/likes/collects/comments Number 化写入 `CockpitContent.metrics` Json（`followerGain` 保留原值），retroStatus COMPLETED 时 stage → `archived`。

- [ ] **Step 1:** 两处各 ~10 行 updateMany，fail-soft（try/catch + console.warn，不让 cockpit 回填失败中断爬虫主流程）。
- [ ] **Step 2:** 扩展两个既有测试：mock prisma 断言 updateMany 参数；匹配失败/无关联 content 时不调用。Run PASS。
- [ ] **Step 3: Commit** — `feat(cockpit): auto-sync 发布回填 + retro 指标回填`

### Task 12: 集成 — L1 预测对比 + 规则沉淀

**Files:**
- Create: `src/lib/cockpit/extras.ts`（替换 Task 4 占位）+ `src/lib/cockpit/extras-types.ts`
- Modify: `src/components/cockpit/views/review.tsx`（复盘详情加对比块）
- Test: `tests/lib/cockpit/extras.test.ts`

**Interfaces:**
- Consumes: `readPredictedPlaysRange`（`src/lib/json-readers.ts`）、`ActualMetric`。
- Produces: `loadExtras(userId): Promise<CockpitExtras>`，`CockpitExtras = { predictions: Record<string /* cockpitContentId */, { lower: number; upper: number; predicted: number; actualPlays: number | null }> }`——遍历有 `analysisId` 的 CockpitContent，从 `ContentAnalysis.report` 读预测区间、从最新 ActualMetric 读实际播放。review 视图在选中内容有 prediction 时渲染一行：`预测 {lower}–{upper} · 实际 {actualPlays}`（沿用 `.review-ledger-metrics` 样式类），并在「学到的规则」保存处保持原逻辑不动（InsightRule 已随 workspace PUT 持久化，规则沉淀开箱即用）。

- [ ] **Step 1:** 实现 extras + 测试（mock prisma；无 analysis / report 无区间 / 无 metric 三种边界返回缺省）。Run PASS。
- [ ] **Step 2:** review 视图接 `getExtras()`（Task 5 已缓存），渲染对比行；无数据不渲染。
- [ ] **Step 3:** 手工验证：迁移后某条已复盘内容显示预测 vs 实际。
- [ ] **Step 4: Commit** — `feat(cockpit): 复盘实验室 L1 预测对比`

---

## Phase 5：收尾

### Task 13: 删除被取代的旧件

**Files:**
- Delete: `src/components/workbench/`（6 个文件）、`src/app/content/`、`src/app/api/v1/workbench/route.ts`、`src/components/layout/sidebar.tsx`、`src/components/layout/header.tsx`
- Modify: `src/components/layout/main-layout.tsx`（清理残留引用）；`src/lib/pipeline/types.ts` 中仅被上述文件使用的类型（`WorkbenchData`/`ContentCard` 等——**`deriveStage` 保留**，迁移脚本与测试还在用）

- [ ] **Step 1:** 删除后全局 grep 确认无残留 import（`workbench`、`components/layout/sidebar`）。`/content` 的入口链接若有残留（grep `'/content'`）改指 `/?view=pipeline`。
- [ ] **Step 2:** `npm run typecheck && npm run test && npm run build` 全过。
- [ ] **Step 3: Commit** — `chore(cockpit): 移除旧工作台看板/内容库/旧侧栏`

### Task 14: 文档更新 + 全量验证

**Files:**
- Modify: `README.md`（§3 IA 重写为 cockpit 导航；新增 cockpit 数据层/迁移说明；标注 creator-cockpit 来源与 MIT 归属）
- Modify: `docs/superpowers/specs/2026-08-04-cockpit-adoption-design.md`（如实现中有偏差，回写实际结论）

- [ ] **Step 1:** 更新 README（IA 图、`npm run db:push`、`npx tsx scripts/migrate-cockpit.ts` 用法、vendor 目录说明）。
- [ ] **Step 2: 端到端验证清单**（逐项执行）：
  1. `npm run build && npm run test && npm run typecheck` 全绿
  2. 新库冷启动：onboarding → 空白工作区可完成
  3. 灵感 → 转内容 → 档期拖拽 → 今日勾选 → 阶段推进 → 发布登记 → 复盘录入，全链路刷新不丢
  4. 大目标设定后健康度四进度条 + 建议渲染；粉丝进度来自爬虫 AccountMetric
  5. AI 闭环（Task 10 场景）、双标签页并发保存出现 409 toast
  6. 明暗切换 + 5 风格切换 + 移动端宽度（375px）侧栏抽屉
  7. /agent /dashboard /accounts /settings 四页在新壳下功能正常
- [ ] **Step 3: Commit** — `docs(cockpit): README/spec 对齐移植后架构`

---

## Self-Review 记录

- Spec 覆盖：§1 纯逻辑零改动（T2）、存储替换（T4/T5）、拆文件（T7）✓；§2 建模+API（T3/T4）✓；§3 外壳接管+删旧（T8/T13）✓;§4 四个集成点（T10/T11/T12 + FollowerSnapshot 派生于 T4）✓；§5 迁移（T9）✓;§6 五阶段顺序 ✓;§7 风险（React 18 → T6 Step 5；并发 → T4/T5 409;迁移 → T9 dry-run）✓;§8 YAGNI（备份 UI 裁剪 → T6 Step 3）✓。
- 与 spec 的两处显式偏差（更简）：FollowerSnapshot 不建表、备份导入导出直接裁掉——已回写 spec 于 T14。
- 类型一致性：`loadWorkspace`/`saveWorkspace` 签名 T5=T6 调用方 ✓;`rev` 贯穿 T4/T5 ✓;`CockpitExtras` T4 占位=T12 实现 ✓。
