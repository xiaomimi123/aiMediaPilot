# 重构 阶段 0～2 实施计划：留档、清理、项目 + 编导 agent 磨稿

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 42k 行的旧 MediaPilot 按保留清单清理成一个干净骨架，并交付第一个可用能力——在「项目」里和编导 agent 对话，把一条口播稿磨到时长达标。

**Architecture:** Next.js 14 单进程（去掉 Redis/BullMQ/worker），Postgres 新库 `mediapilot_v2`（旧库 `mediapilot` 原样保留作回退）。编导 agent = 服务端对话循环（DeepSeek function calling，流式 SSE）+ 与界面无关的工具层（`src/lib/tools/`）。稿子是 6 段结构的 JSON，时长由纯函数估算并作为硬约束回喂模型自修。

**Tech Stack:** Next.js 14 App Router、TypeScript、Prisma 5 + PostgreSQL 16（docker）、openai SDK v4（指向 DeepSeek）、zod 3、zod-to-json-schema、vitest 2 + @testing-library/react、Tailwind。

**Spec:** `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`

**本计划范围：** spec §9 的阶段 0、1、2。阶段 3（口播上传/转写）、4（特效/导出/合成）、5（首页数据/定位/设置/依赖体检）各自另写计划——它们依赖阶段 4 的实测（导出耗时、竖屏对位），现在写成代码会写错。`Job`/`ProjectFile` 表在本计划建好但不使用；「启动时标记 interrupted」随阶段 3 的第一个后台任务一起做。

## Global Constraints

- 只列保留项，清单外全部删除；删除前打 tag `v1-final`。
- 单进程：启动只需 `npm run dev` + Postgres；不得引入 Redis、BullMQ 或独立 worker。
- 单用户：新 schema 没有 `User` 表，任何表都没有 `userId`。
- Overlay Studio：绝不 import `tools/overlay-studio` 的源码（本计划不碰它，只保留集成层文件）。
- 稿子固定 6 段，角色与占比：开场钩子 10% / 概念A 22.5% / 概念B 22.5% / 冷知识 15% / 知识串联 22.5% / 金句收尾 7.5%；默认目标 60 秒。
- 时长估算：`CHARS_PER_SEC = 5`；单段上限 = 预算 × 1.25；全片上限 = 目标 × 1.1。
- 写稿超标自修最多 `MAX_REPAIR_ROUNDS = 2` 轮；对话每轮最多 `MAX_TOOL_CALLS_PER_TURN = 8` 次工具调用；上下文带最近 `HISTORY_LIMIT = 20` 条对话。
- 界面与对话里不出现内部 id、英文状态码、原始报错栈；报错写成「原因 + 怎么办」。
- DeepSeek key 只从 `.env` 的 `DEEPSEEK_API_KEY` 读取（设置页录入 key 属阶段 5）。
- 不要在 `npm run dev` 运行时跑 `npm run build`（会覆盖 dev chunk 导致白屏）；build 只在主会话跑，跑完用 `npm run dev` 重启。
- 改完 `prisma/schema.prisma` 必须 `npx prisma generate` 并重启 dev server（旧 client 会把新字段读成 undefined 而不报错）。
- 文档语言：中文。

## Review Focus

1. **模型返回的工具参数不是合法 JSON 或不符合 schema**（DeepSeek 偶发）——应回喂一条可读的错误让模型重试，而不是整轮崩溃。→ Task 7 测试 `invalid tool arguments are fed back, not thrown`。
2. **DeepSeek 连不上 / key 缺失**——对话里应出现「原因 + 怎么办」的人话，已保存的用户消息不丢。→ Task 7 测试 `model failure emits human error and keeps user message`；Task 8 路由在 key 缺失时返回 400 人话。
3. **中英混排与数字的时长估算**（如「GPT-4o 涨价 3 倍」）——英文单词/数字不能按字母数计时长，也不能被忽略。→ Task 4 测试 `counts latin runs by ceil(len/3)`。
4. **模型返回的段数/角色不对**（5 段、7 段、角色乱序）——schema 要求恰好 6 段，角色按位置强制对齐。→ Task 5 测试 `forces roles by position`。
5. **用户在中间栏手改稿子的同时 agent 在改**——以最后一次写入为准，手改后刷新时长报告，不丢另一方的修改之外的段落。→ Task 6 `applySegmentEdit only touches target segment` 测试 + Task 9 手改走同一函数。

---

## 文件结构（本计划结束时）

```
prisma/schema.prisma                      新 schema（8 个 model）
scripts/
  export-legacy.ts                        Task 1：旧库 → data/legacy-export.json（Task 2 后删除，留在 v1-final）
  import-legacy.ts                        Task 3：legacy-export.json → 新库
  collect-douyin.ts                       改造：无 userId，只写 3 张表
  install-collect-cron.sh / *.plist       原样保留
  align/                                  原样保留（阶段 3 用）
data/legacy-export.json                   旧稿子/人设/作品快照（gitignore）
src/app/
  layout.tsx                              侧栏只有「项目」
  page.tsx                                项目列表 + 新建
  projects/[id]/page.tsx                  项目页（服务端取数 → ProjectWorkspace）
  api/projects/route.ts                   GET 列表 / POST 新建
  api/projects/[id]/route.ts              GET 详情 / PATCH 标题、定稿、手改段落
  api/projects/[id]/chat/route.ts         POST 对话（SSE）
  globals.css / tokens.css                原样保留
src/components/
  ui/                                     原样保留
  project/project-workspace.tsx           左稿右聊的容器与状态
  project/script-pane.tsx                 中间栏：分段稿子、时长、高亮、手改、定稿
  project/chat-panel.tsx                  右栏：编导对话、流式显示、工具结果行
  project/new-project-button.tsx          首页新建按钮
src/lib/
  prisma.ts / api.ts / utils.ts           原样保留
  env.ts                                  getDeepSeekKey()
  llm/{deepseek,vision,pricing,whisper,local-whisper}.ts, local_whisper.py, prompts/overlay-arrange.ts   原样保留
  overlay-studio/                         原样保留
  video/ffmpeg.ts                         原样保留
  works/import.ts                         改造：无 userId、无 counted
  script/model.ts                         段落角色、类型、schema
  script/duration.ts                      时长估算与检查报告
  script/edit.ts                          applySegmentEdit
  script/write.ts                         writeScript（生成 + 自修循环）
  project/view.ts                         ProjectView 序列化（页面与 API 共用）
  tools/types.ts                          Tool / ToolContext / ToolResult
  tools/write-script.ts                   write_script
  tools/patch-script.ts                   patch_script
  tools/index.ts                          SCRIPT_TOOLS 注册表
  agent/chat-model.ts                     ChatModel 接口 + DeepSeek 流式实现
  agent/context.ts                        formatSystemPrompt / buildSystemPrompt / loadHistory
  agent/loop.ts                           runAgentTurn
  agent/sse.ts                            encodeSse / parseSseBuffer
tests/
  helpers/fake-db.ts                      内存假库（工具与循环测试用）
  lib/script/{duration,model,edit,write}.test.ts
  lib/tools/{write-script,patch-script}.test.ts
  lib/agent/{context,loop,sse}.test.ts
  components/script-pane.test.tsx
  lib/llm/{deepseek,vision}.test.ts, lib/overlay-studio/, lib/video/ffmpeg.test.ts   原样保留
docs/archive/                             旧 specs/plans/开发文档
README.md                                 重写为一页
```

---

### Task 1: 留档与旧数据导出

**Files:**
- Create: `scripts/export-legacy.ts`
- Modify: `.gitignore`（加 `/data/`）
- Move: `docs/superpowers/specs/*`（本次重构 spec 除外）、`docs/superpowers/plans/*`（本计划除外）、`docs/content-model-deprecation.md`、`自媒体智能管理平台-开发文档.md` → `docs/archive/`

**Interfaces:**
- Produces: `data/legacy-export.json`，形状 `{ exportedAt: string; persona: object | null; scriptDrafts: object[]; publishedWorks: object[]; overviewSnapshots: object[]; metricSummaries: object[] }`（行对象为旧库原样字段）。Task 3 消费。

- [ ] **Step 1: 确认 Postgres 在跑、工作区干净**

Run: `docker compose up -d postgres && git status --short`
Expected: 容器 Started/Running；git status 只有 `.claude/`（未跟踪）。

- [ ] **Step 2: 打回退 tag**

```bash
git tag v1-final main
git tag --list v1-final
```
Expected: 输出 `v1-final`。

- [ ] **Step 3: 写导出脚本**

`scripts/export-legacy.ts`:

```ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

/**
 * 重构前的一次性导出(2026-09-27)。新库不迁移旧数据, 但稿子/人设/回采快照
 * 导成 JSON 留在 data/ 下, 需要时 agent 可以读, Task 3 从这里导入人设与回采数据。
 * 本脚本只在旧 schema 下能跑, 重构后随旧代码一起只留在 tag v1-final 里。
 */
async function main() {
  const prisma = new PrismaClient();
  try {
    const persona = await prisma.personaProfile.findFirst();
    const scriptDrafts = await prisma.scriptDraft.findMany({ orderBy: { createdAt: 'asc' } });
    const publishedWorks = await prisma.publishedWork.findMany({ orderBy: { publishedAt: 'asc' } });
    const overviewSnapshots = await prisma.douyinOverviewSnapshot.findMany({ orderBy: { fetchedAt: 'asc' } });
    const metricSummaries = await prisma.douyinMetricSummary.findMany();
    const out = { exportedAt: new Date().toISOString(), persona, scriptDrafts, publishedWorks, overviewSnapshots, metricSummaries };
    const file = path.join(process.cwd(), 'data', 'legacy-export.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`导出完成: 人设 ${persona ? 1 : 0} / 稿子 ${scriptDrafts.length} / 作品 ${publishedWorks.length} / 账号快照 ${overviewSnapshots.length} / 指标 ${metricSummaries.length} → ${file}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: 运行导出**

Run: `npx tsx scripts/export-legacy.ts`
Expected: `导出完成: 人设 1 / 稿子 3x / 作品 101 / ...`（稿子约 35~36 条，作品 101 条；任何一项为 0 以外的异常都先停下查）。

- [ ] **Step 5: `.gitignore` 加 data 目录**

在 `.gitignore` 末尾追加：

```
# 重构(2026-09-27): 旧库导出与本地数据, 含个人数据, 不入库
/data/
```

- [ ] **Step 6: 归档旧文档**

```bash
mkdir -p docs/archive
for f in docs/superpowers/specs/*; do [ "$f" = "docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md" ] || git mv "$f" docs/archive/; done
for f in docs/superpowers/plans/*; do [ "$f" = "docs/superpowers/plans/2026-09-27-project-agent-rebuild-phase0-2.md" ] || git mv "$f" docs/archive/; done
git mv docs/content-model-deprecation.md docs/archive/
git mv 自媒体智能管理平台-开发文档.md docs/archive/
ls docs/superpowers/specs docs/superpowers/plans
```
Expected: specs 下只剩 `2026-09-27-project-agent-rebuild-design.md`，plans 下只剩本计划。

- [ ] **Step 7: 旧成片移出项目**

```bash
mkdir -p ~/mediapilot-archive
mv video-productions ~/mediapilot-archive/
ls ~/mediapilot-archive/video-productions | wc -l
```
Expected: `26`。（`video-productions/` 本就 gitignore，git 无变化；删不删由用户决定。）

- [ ] **Step 8: Commit**

```bash
git add .gitignore scripts/export-legacy.ts docs
git commit -m "chore(rebuild): 留档 v1-final, 导出旧数据, 归档旧文档

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 按保留清单清理，换新 schema 与新库

**Files:**
- Delete: 保留清单外的 `src/`、`tests/`、`scripts/` 文件；`remotion/`、`vendor/`、`teardowns/`、`scratchpad_probe/`、`public/template-demos/`、`Dockerfile`
- Replace: `prisma/schema.prisma`、`src/app/layout.tsx`、`src/app/page.tsx`、`src/lib/works/import.ts`
- Create: `src/lib/env.ts`
- Modify: `scripts/collect-douyin.ts`、`package.json`、`docker-compose.yml`、`.env`（DATABASE_URL）

**Interfaces:**
- Produces（Prisma client，后续全部任务依赖）：`prisma.project`、`prisma.chatMessage`、`prisma.projectFile`、`prisma.job`、`prisma.personaProfile`（主键 `id`，固定值 `'me'`）、`prisma.publishedWork`（唯一键 `platform_externalId`）、`prisma.douyinOverviewSnapshot`（唯一键 `windowStart_windowEnd`）、`prisma.douyinMetricSummary`（`metric @unique`）。
- Produces: `getDeepSeekKey(): string | null`（`src/lib/env.ts`）。
- Produces: `importWorks(prisma: PrismaClient, platform: string, works: IncomingWork[]): Promise<ImportResult>`。

- [ ] **Step 1: 删除保留清单外的已跟踪文件**

```bash
KEEP='^(src/app/globals\.css|src/app/tokens\.css|src/components/ui/|src/lib/(prisma|api|utils)\.ts|src/lib/llm/(deepseek|vision|pricing|whisper|local-whisper)\.ts|src/lib/llm/local_whisper\.py|src/lib/llm/prompts/overlay-arrange\.ts|src/lib/overlay-studio/|src/lib/video/ffmpeg\.ts|src/lib/works/import\.ts|tests/lib/llm/(deepseek|vision)\.test\.ts|tests/lib/overlay-studio/|tests/lib/video/ffmpeg\.test\.ts|scripts/(collect-douyin\.ts|install-collect-cron\.sh|com\.mediapilot\.collect-douyin\.plist|export-legacy\.ts)|scripts/align/)'
git ls-files src tests scripts | grep -Ev "$KEEP" | xargs git rm -q
git rm -r -q remotion Dockerfile
rm -rf vendor teardowns scratchpad_probe public/template-demos remotion scripts/__pycache__
git ls-files src tests scripts
```
Expected: 列出的文件恰为保留清单（约 20 个 src/tests 文件 + scripts 下 4 项与 align/）。`src/app/layout.tsx`、`page.tsx` 已被删，下面重建。

- [ ] **Step 2: 写新 schema**

整体替换 `prisma/schema.prisma`：

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// 一条内容 = 一个项目。stage 只前进: draft → scripted → recorded → overlaid → final → published
model Project {
  id              String   @id @default(cuid())
  title           String   @default("未命名项目")
  stage           String   @default("draft")
  /// Script | null, 形状见 src/lib/script/model.ts
  script          Json?
  targetSec       Int      @default(60)
  /// 建项目时的人设快照, 事后改人设不影响已有项目的上下文
  personaSnapshot Json?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  messages       ChatMessage[]
  files          ProjectFile[]
  jobs           Job[]
  publishedWorks PublishedWork[]

  @@index([updatedAt])
}

model ChatMessage {
  id         String   @id @default(cuid())
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  /// user | assistant | tool | system
  role       String
  content    String   @default("") @db.Text
  toolName   String?
  toolInput  Json?
  toolResult Json?
  createdAt  DateTime @default(now())

  @@index([projectId, createdAt])
}

/// 阶段 3/4 使用: raw_video | transcript | overlay_json | overlay_mov | final_mp4
model ProjectFile {
  id        String   @id @default(cuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  kind      String
  path      String
  meta      Json     @default("{}")
  version   Int      @default(1)
  createdAt DateTime @default(now())

  @@index([projectId, kind])
}

/// 阶段 3/4 使用: kind = transcribe | arrange | render; status = queued | running | done | failed | interrupted
model Job {
  id          String   @id @default(cuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  kind        String
  status      String   @default("queued")
  progress    Float    @default(0)
  /// 给人看的一句话(原因 + 怎么办)
  userMessage String   @default("")
  /// 原始报错, 界面上折叠展示
  errorDetail String?  @db.Text
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([projectId, createdAt])
}

/// 单用户: 只有一行, id 固定为 "me"
model PersonaProfile {
  id            String   @id @default("me")
  audience      String   @default("")
  targetFans    String   @default("")
  pillars       Json     @default("[]")
  angle         String   @default("")
  avoid         String   @default("")
  painPoints    Json     @default("[]")
  offerings     Json     @default("[]")
  systemSummary String   @default("") @db.Text
  updatedAt     DateTime @updatedAt
}

model PublishedWork {
  id                 String    @id @default(cuid())
  platform           String    @default("douyin")
  externalId         String
  title              String    @db.Text
  caption            String    @default("") @db.Text
  hashtags           Json      @default("[]")
  url                String    @default("")
  publishedAt        DateTime
  durationSec        Int       @default(0)
  isPrivate          Boolean   @default(false)
  play               Int       @default(0)
  digg               Int       @default(0)
  comment            Int       @default(0)
  collect            Int       @default(0)
  share              Int       @default(0)
  /// 以下来自抖音「投稿分析」接口, 与上面 play 等来自不同接口, 数字对不上是正常的
  anaPlay            Int?
  completionRate5s   Float?
  bounceRate2s       Float?
  avgPlayDurationSec Float?
  playPerClient      Json?
  analyticsFetchedAt DateTime?
  /// 这条作品是哪个项目发的(阶段 5 的发布登记写入)
  projectId          String?
  project            Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  fetchedAt          DateTime  @default(now())
  createdAt          DateTime  @default(now())

  @@unique([platform, externalId])
  @@index([publishedAt])
}

model DouyinOverviewSnapshot {
  id                 String   @id @default(cuid())
  windowStart        String
  windowEnd          String
  submissionCount    Int      @default(0)
  medianPlay         Int      @default(0)
  avgLike            Int      @default(0)
  avgComment         Int      @default(0)
  avgShare           Int      @default(0)
  avgPlayDurationSec Float    @default(0)
  bounceRate2s       Float    @default(0)
  completionRate5s   Float    @default(0)
  coverClickRate     Float    @default(0)
  verticals          Json     @default("[]")
  fetchedAt          DateTime @default(now())

  @@unique([windowStart, windowEnd])
  @@index([fetchedAt])
}

/// 账号级当前值(粉丝数等), 首页账号数据用
model DouyinMetricSummary {
  id             String   @id @default(cuid())
  metric         String   @unique
  currentCount   Int      @default(0)
  lastPeriodIncr Int      @default(0)
  fetchedAt      DateTime @default(now())
}
```

- [ ] **Step 3: 建新库并切换 DATABASE_URL（旧库 `mediapilot` 不动，作回退）**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d postgres -c "CREATE DATABASE mediapilot_v2;"
sed -i '' -E 's#(^DATABASE_URL=.*/)mediapilot$#\1mediapilot_v2#' .env
grep -c 'mediapilot_v2' .env
npx prisma db push && npx prisma generate
```
Expected: `CREATE DATABASE`；grep 输出 `1`；`Your database is now in sync with your Prisma schema`。若 grep 输出 0，说明 `.env` 里的 URL 末尾有参数（如 `?schema=`），手工把库名改成 `mediapilot_v2` 再继续。

- [ ] **Step 4: 改造 `src/lib/works/import.ts`**

整体替换为：

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * 回采作品入库。按 (platform, externalId) upsert —— 播放量会随时间涨,
 * 每晚回采要更新同一条, 否则一个月后库里是 30 份同一条作品的快照。
 */

export interface IncomingWork {
  externalId: string;
  title: string;
  caption: string;
  hashtags: string[];
  isPrivate: boolean;
  url: string;
  /** 秒级 unix 时间戳 */
  createTime: number;
  durationSec: number;
  play: number;
  digg: number;
  comment: number;
  collect: number;
  share: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  total: number;
}

export async function importWorks(
  prisma: PrismaClient,
  platform: string,
  works: IncomingWork[],
): Promise<ImportResult> {
  let created = 0;
  let updated = 0;
  for (const w of works) {
    const data = {
      title: w.title,
      caption: w.caption,
      hashtags: w.hashtags,
      isPrivate: w.isPrivate,
      url: w.url,
      publishedAt: new Date(w.createTime * 1000),
      durationSec: w.durationSec,
      play: w.play,
      digg: w.digg,
      comment: w.comment,
      collect: w.collect,
      share: w.share,
      fetchedAt: new Date(),
    };
    const existing = await prisma.publishedWork.findUnique({
      where: { platform_externalId: { platform, externalId: w.externalId } },
      select: { id: true },
    });
    if (existing) {
      await prisma.publishedWork.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.publishedWork.create({ data: { ...data, platform, externalId: w.externalId } });
      created += 1;
    }
  }
  return { created, updated, total: created + updated };
}
```

- [ ] **Step 5: 改造 `scripts/collect-douyin.ts`**

(a) 删除第 7 行 `import { extractAwemeId, linkWorkByAwemeId } from '../src/lib/works/match';`。

(b) 把 `const prisma = new PrismaClient();` 起到文件末尾 `main().catch(...)` 之前的全部内容（原 235~450 行：main 的写库段、`collectAnalytics`、`collectHome`、`backfillLinks`）替换为：

```ts
  const prisma = new PrismaClient();
  try {
    const r = await importWorks(prisma, PLATFORM, works);
    const publicCount = works.filter((w) => !w.isPrivate).length;
    log(`回采完成: 共 ${r.total} 条(新增 ${r.created} / 更新 ${r.updated}), 其中公开 ${publicCount} 条`);

    // 投稿分析 —— 失败不影响主回采(上面的数据已经落库了), 但要吵出来
    try {
      const n = await collectAnalytics(prisma);
      log(`投稿分析: 账号级 1 条快照, 逐条作品 ${n} 条`);
    } catch (e) {
      log(`投稿分析抓取失败(不影响作品列表): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 账号级当前值(粉丝数等) —— 同样独立失败
    try {
      const m = await collectHome(prisma);
      log(`账号指标: ${m} 项`);
    } catch (e) {
      log(`首页数据抓取失败(不影响前面的): ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 抓投稿分析并落库。窗口是页面默认的近 90 天, 不是我们挑的。
 * 逐条作品的分析指标只更新分析那一组字段, 不碰列表接口来的 play/digg。
 */
async function collectAnalytics(prisma: PrismaClient): Promise<number> {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  const raw = await runEgo(ANALYTICS_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到分析结果');
  const data = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  const ov = data.overview ?? {};
  const num = (k: string): number => Number(ov[k]?.metric_value ?? 0);
  const windowStart = start.toISOString().slice(0, 10);
  const windowEnd = end.toISOString().slice(0, 10);
  const values = {
    submissionCount: num('submission_count'),
    medianPlay: num('median_play_count'),
    avgLike: num('average_like_count_per_video'),
    avgComment: num('average_comment_count_per_video'),
    avgShare: num('average_share_count_per_video'),
    avgPlayDurationSec: num('average_play_duration'),
    bounceRate2s: num('bounce_rate_2s'),
    completionRate5s: num('completion_rate_5s'),
    coverClickRate: num('cover_click_ratio'),
    verticals: data.vertical?.primary_verticals ?? [],
  };
  await prisma.douyinOverviewSnapshot.upsert({
    where: { windowStart_windowEnd: { windowStart, windowEnd } },
    update: { ...values, fetchedAt: new Date() },
    create: { windowStart, windowEnd, ...values },
  });

  const items: unknown[] = Array.isArray(data.items?.items) ? data.items.items : [];
  let n = 0;
  for (const it of items as Record<string, unknown>[]) {
    const externalId = String(it.item_id ?? '');
    if (!externalId) continue;
    const r = await prisma.publishedWork.updateMany({
      where: { platform: PLATFORM, externalId },
      data: {
        anaPlay: Number(it.play_count ?? 0),
        completionRate5s: Number(it.completion_rate_5s ?? 0),
        bounceRate2s: Number(it.bounce_rate_2s ?? 0),
        avgPlayDurationSec: Number(it.average_play_duration ?? 0),
        playPerClient: (it.play_count_per_client ?? {}) as object,
        analyticsFetchedAt: new Date(),
      },
    });
    n += r.count;
  }
  return n;
}

/** 抓账号级当前值(粉丝数等)。当前值与日序列口径对不上, 只存当前值与环比, 不换算。 */
async function collectHome(prisma: PrismaClient): Promise<number> {
  const raw = await runEgo(HOME_SCRIPT);
  const marker = raw.lastIndexOf('@@RESULT@@');
  if (marker < 0) throw new Error('没拿到首页数据');
  const home = JSON.parse(raw.slice(marker + '@@RESULT@@'.length).split('\n')[0]);

  let metrics = 0;
  for (const [metric, v] of Object.entries((home.daily?.data ?? {}) as Record<string, unknown>)) {
    const row = v as { option_list?: unknown[]; current_count?: string; last_period_incr?: string };
    if ((row.option_list ?? []).length === 0) continue;
    const currentCount = Number(row.current_count ?? 0);
    const lastPeriodIncr = Number(row.last_period_incr ?? 0);
    await prisma.douyinMetricSummary.upsert({
      where: { metric },
      update: { currentCount, lastPeriodIncr, fetchedAt: new Date() },
      create: { metric, currentCount, lastPeriodIncr },
    });
    metrics++;
  }
  return metrics;
}
```

（`main().catch(...)` 保持原样。文件顶部 FETCH/ANALYTICS/HOME 脚本常量、`runEgo`、`log` 不动。）

- [ ] **Step 6: 新建 `src/lib/env.ts`**

```ts
/** DeepSeek key 只从 .env 读(设置页录入属阶段 5)。空串视为未配置。 */
export function getDeepSeekKey(): string | null {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k ? k : null;
}
```

- [ ] **Step 7: 过渡用的 layout 与首页（Task 9 会替换首页）**

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'MediaPilot',
  description: '项目 + 编导 agent 的口播出片工作台',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex h-screen overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <div className="px-2 py-2 text-sm font-semibold">MediaPilot</div>
          <Link href="/" className="rounded-md px-2 py-1.5 text-sm hover:bg-[var(--bg-surface-hover)]">
            项目
          </Link>
        </nav>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
export default function Home() {
  return <div className="p-8 text-sm text-[var(--text-secondary)]">项目列表正在重建。</div>;
}
```

- [ ] **Step 8: 精简 `package.json`**

`scripts` 整体替换为：

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "collect:douyin": "tsx scripts/collect-douyin.ts",
    "import:legacy": "tsx scripts/import-legacy.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "prisma generate"
  },
```

然后卸载不再使用的依赖：

```bash
npm uninstall @remotion/player remotion bullmq ioredis jszip recharts
```
Expected: 无报错；`package.json` 的 dependencies 不再含这 6 个包。

- [ ] **Step 9: `docker-compose.yml` 去掉 Redis 与 app 服务**

整体替换为：

```yaml
services:
  # 唯一的外部依赖: 数据库。新库 mediapilot_v2, 旧库 mediapilot 保留作回退。
  postgres:
    image: postgres:16-alpine
    container_name: mediapilot-postgres
    environment:
      POSTGRES_USER: mediapilot
      POSTGRES_PASSWORD: ${DB_PASSWORD:-mediapilot_dev_pwd}
      POSTGRES_DB: mediapilot
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mediapilot"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres-data:
```

然后：`docker compose up -d --remove-orphans && docker rm -f mediapilot-redis 2>/dev/null; true`，并从 `.env` 删除 `REDIS_URL` 行：`sed -i '' '/^REDIS_URL=/d' .env`。

（`restart: unless-stopped` 保证 Docker 启动后数据库自己起来——09-25 起库停了两天的问题，前提是 Docker Desktop 设成开机自启，README 里写明。）

- [ ] **Step 10: 类型检查与测试**

Run: `npm run typecheck && npm test`
Expected: typecheck 0 错误；vitest 全部通过（剩 deepseek/vision/overlay-studio/ffmpeg 四组测试）。
若 typecheck 报某个保留文件 import 了已删模块：只允许修改该 import（改为本清单内的等价物或删除该用途），不允许把已删模块加回来。

- [ ] **Step 11: 全仓残留检查**

Run: `git grep -nE "userId|bullmq|ioredis|remotion|cockpit|getOrCreateDefaultUser" -- src scripts tests prisma package.json`
Expected: 无输出。

- [ ] **Step 12: 回采脚本冒烟（只读抖音，写新库）**

Run: `npm run collect:douyin; tail -4 logs/collect-douyin.log`
Expected: `回采完成: 共 101 条(新增 101 / 更新 0)`（或更多作品）。若 ego lite 未登录报错，记录下来告诉用户，不阻塞本任务。

- [ ] **Step 13: Commit**

```bash
git add -A
git status --short | head -30
git commit -m "refactor(rebuild): 按保留清单清理旧代码, 换新 schema 与 mediapilot_v2 库, 去掉 Redis/worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
（`git status` 里不应出现 `data/`、`.env`、`tools/`。）

---

### Task 3: 导入人设与回采数据，删除导出脚本

**Files:**
- Create: `scripts/import-legacy.ts`
- Delete: `scripts/export-legacy.ts`（只在旧 schema 下能跑，留在 v1-final）

**Interfaces:**
- Consumes: `data/legacy-export.json`（Task 1）；新 Prisma client（Task 2）。
- Produces: 新库 `PersonaProfile` 一行（id `'me'`），`PublishedWork`/`DouyinOverviewSnapshot`/`DouyinMetricSummary` 旧行。

- [ ] **Step 1: 写导入脚本**

`scripts/import-legacy.ts`:

```ts
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';

/**
 * 把 data/legacy-export.json 里的人设与回采数据导入新库(2026-09-27 重构)。
 * 旧稿子不导入 —— 留在 JSON 里, 需要时 agent 读。幂等: 重复跑只会 upsert。
 */
type Row = Record<string, unknown>;

async function main() {
  const file = path.join(process.cwd(), 'data', 'legacy-export.json');
  const dump = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    persona: Row | null;
    publishedWorks: Row[];
    overviewSnapshots: Row[];
    metricSummaries: Row[];
  };
  const prisma = new PrismaClient();
  try {
    if (dump.persona) {
      const p = dump.persona;
      const data = {
        audience: String(p.audience ?? ''),
        targetFans: String(p.targetFans ?? ''),
        pillars: (p.pillars ?? []) as Prisma.InputJsonValue,
        angle: String(p.angle ?? ''),
        avoid: String(p.avoid ?? ''),
        painPoints: (p.painPoints ?? []) as Prisma.InputJsonValue,
        offerings: (p.offerings ?? []) as Prisma.InputJsonValue,
        systemSummary: String(p.systemSummary ?? ''),
      };
      await prisma.personaProfile.upsert({ where: { id: 'me' }, update: data, create: { id: 'me', ...data } });
    }

    for (const w of dump.publishedWorks) {
      const data = {
        title: String(w.title),
        caption: String(w.caption ?? ''),
        hashtags: (w.hashtags ?? []) as Prisma.InputJsonValue,
        url: String(w.url ?? ''),
        publishedAt: new Date(String(w.publishedAt)),
        durationSec: Number(w.durationSec ?? 0),
        isPrivate: Boolean(w.isPrivate),
        play: Number(w.play ?? 0),
        digg: Number(w.digg ?? 0),
        comment: Number(w.comment ?? 0),
        collect: Number(w.collect ?? 0),
        share: Number(w.share ?? 0),
        anaPlay: w.anaPlay == null ? null : Number(w.anaPlay),
        completionRate5s: w.completionRate5s == null ? null : Number(w.completionRate5s),
        bounceRate2s: w.bounceRate2s == null ? null : Number(w.bounceRate2s),
        avgPlayDurationSec: w.avgPlayDurationSec == null ? null : Number(w.avgPlayDurationSec),
        playPerClient: w.playPerClient == null ? Prisma.JsonNull : (w.playPerClient as Prisma.InputJsonValue),
        analyticsFetchedAt: w.analyticsFetchedAt ? new Date(String(w.analyticsFetchedAt)) : null,
        fetchedAt: new Date(String(w.fetchedAt)),
      };
      const platform = String(w.platform ?? 'douyin');
      const externalId = String(w.externalId);
      await prisma.publishedWork.upsert({
        where: { platform_externalId: { platform, externalId } },
        update: data,
        create: { platform, externalId, ...data },
      });
    }

    for (const s of dump.overviewSnapshots) {
      const { id: _id, userId: _u, fetchedAt, ...rest } = s;
      const data = { ...(rest as Row), fetchedAt: new Date(String(fetchedAt)) } as Prisma.DouyinOverviewSnapshotCreateInput;
      await prisma.douyinOverviewSnapshot.upsert({
        where: { windowStart_windowEnd: { windowStart: data.windowStart, windowEnd: data.windowEnd } },
        update: data,
        create: data,
      });
    }

    for (const m of dump.metricSummaries) {
      const metric = String(m.metric);
      const data = {
        currentCount: Number(m.currentCount ?? 0),
        lastPeriodIncr: Number(m.lastPeriodIncr ?? 0),
        fetchedAt: new Date(String(m.fetchedAt)),
      };
      await prisma.douyinMetricSummary.upsert({ where: { metric }, update: data, create: { metric, ...data } });
    }

    const counts = await Promise.all([
      prisma.personaProfile.count(),
      prisma.publishedWork.count(),
      prisma.douyinOverviewSnapshot.count(),
      prisma.douyinMetricSummary.count(),
    ]);
    console.log(`导入完成: 人设 ${counts[0]} / 作品 ${counts[1]} / 账号快照 ${counts[2]} / 指标 ${counts[3]}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行导入（跑两次验证幂等）**

Run: `npm run import:legacy && npm run import:legacy`
Expected: 两次输出一致，`人设 1 / 作品 101 / ...`（作品数 ≥ 101）。

- [ ] **Step 3: 删除导出脚本、typecheck、commit**

```bash
git rm -q scripts/export-legacy.ts
npm run typecheck
git add scripts/import-legacy.ts
git commit -m "feat(rebuild): 导入旧人设与回采数据到新库

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 稿子模型与时长估算

**Files:**
- Create: `src/lib/script/model.ts`、`src/lib/script/duration.ts`
- Test: `tests/lib/script/duration.test.ts`

**Interfaces:**
- Produces（`model.ts`）:
  - `SEGMENT_ROLES = ['hook','conceptA','conceptB','fact','bridge','close'] as const`，`type SegmentRole`
  - `ROLE_LABEL: Record<SegmentRole, string>`、`ROLE_SHARE: Record<SegmentRole, number>`
  - `interface Segment { id: string; role: SegmentRole; text: string }`、`interface Script { segments: Segment[] }`
  - `ScriptSchema: z.ZodType<Script>`（恰好 6 段）
- Produces（`duration.ts`）:
  - `CHARS_PER_SEC = 5`、`SEGMENT_TOLERANCE = 1.25`、`TOTAL_TOLERANCE = 1.1`
  - `countSpokenChars(text: string): number`、`estimateSec(text: string): number`
  - `segmentBudgetSec(role: SegmentRole, targetSec: number): number`
  - `interface SegmentReport { id: string; index: number; role: SegmentRole; estSec: number; budgetSec: number; limitSec: number; over: boolean }`
  - `interface DurationReport { totalSec: number; targetSec: number; totalLimitSec: number; ok: boolean; segments: SegmentReport[]; issues: string[] }`
  - `checkDuration(script: Script, targetSec: number): DurationReport`

- [ ] **Step 1: 写失败测试**

`tests/lib/script/duration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countSpokenChars, estimateSec, segmentBudgetSec, checkDuration } from '@/lib/script/duration';
import { SEGMENT_ROLES, ROLE_SHARE, type Script } from '@/lib/script/model';

function scriptWith(lengths: number[]): Script {
  return { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };
}

describe('countSpokenChars', () => {
  it('counts CJK chars one each and ignores punctuation', () => {
    expect(countSpokenChars('你好，世界！')).toBe(4);
  });
  it('counts latin runs by ceil(len/3)', () => {
    // GPT(3→1) 4o(2→1) 涨价(2) 3(1→1) 倍(1)
    expect(countSpokenChars('GPT-4o 涨价 3 倍')).toBe(6);
  });
  it('returns 0 for empty text', () => {
    expect(countSpokenChars('')).toBe(0);
  });
});

describe('estimateSec', () => {
  it('uses 5 chars per second rounded to 0.1', () => {
    expect(estimateSec('字'.repeat(50))).toBe(10);
    expect(estimateSec('字'.repeat(49))).toBe(9.8);
  });
});

describe('segment shares', () => {
  it('sum to 1', () => {
    const sum = SEGMENT_ROLES.reduce((n, r) => n + ROLE_SHARE[r], 0);
    expect(sum).toBeCloseTo(1, 6);
  });
  it('budget for hook at 60s is 6s', () => {
    expect(segmentBudgetSec('hook', 60)).toBe(6);
  });
});

describe('checkDuration', () => {
  it('passes a script exactly on budget', () => {
    // 60s: 6 / 13.5 / 13.5 / 9 / 13.5 / 4.5 秒 → ×5 字
    const r = checkDuration(scriptWith([30, 67, 67, 45, 67, 22]), 60);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.totalSec).toBeCloseTo(59.6, 1);
  });

  it('flags an over-limit segment with actual values and a char target', () => {
    // 冷知识预算 9s, 上限 11.3s; 187 字 = 37.4s
    const r = checkDuration(scriptWith([30, 67, 67, 187, 67, 22]), 60);
    expect(r.ok).toBe(false);
    const fact = r.segments[3];
    expect(fact).toMatchObject({ index: 4, role: 'fact', estSec: 37.4, budgetSec: 9, limitSec: 11.3, over: true });
    expect(r.issues[0]).toBe('第4段「冷知识」约 37.4 秒，上限 11.3 秒 —— 删到约 56 字以内，只改这一段');
    expect(r.issues[1]).toBe('全片约 88 秒，目标 60 秒（上限 66 秒）');
  });

  it('flags total even when every segment is within its own limit', () => {
    // 每段都到 1.2 倍预算: 单段不超 1.25, 全片 72s > 66s
    const r = checkDuration(scriptWith([36, 81, 81, 54, 81, 27]), 60);
    expect(r.segments.every((s) => !s.over)).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(['全片约 72 秒，目标 60 秒（上限 66 秒）']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/script/duration.test.ts`
Expected: FAIL，`Failed to resolve import "@/lib/script/duration"`。

- [ ] **Step 3: 实现 `src/lib/script/model.ts`**

```ts
import { z } from 'zod';

/**
 * 口播稿固定 6 段(沿用旧版验证过的六幕结构)。占比决定每段的时长预算,
 * 60 秒时为 6 / 13.5 / 13.5 / 9 / 13.5 / 4.5 秒。
 */
export const SEGMENT_ROLES = ['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close'] as const;
export type SegmentRole = (typeof SEGMENT_ROLES)[number];

export const ROLE_LABEL: Record<SegmentRole, string> = {
  hook: '开场钩子',
  conceptA: '概念A',
  conceptB: '概念B',
  fact: '冷知识',
  bridge: '知识串联',
  close: '金句收尾',
};

export const ROLE_SHARE: Record<SegmentRole, number> = {
  hook: 0.1,
  conceptA: 0.225,
  conceptB: 0.225,
  fact: 0.15,
  bridge: 0.225,
  close: 0.075,
};

export interface Segment {
  id: string;
  role: SegmentRole;
  text: string;
}

export interface Script {
  segments: Segment[];
}

export const ScriptSchema: z.ZodType<Script> = z.object({
  segments: z
    .array(z.object({ id: z.string().min(1), role: z.enum(SEGMENT_ROLES), text: z.string() }))
    .length(SEGMENT_ROLES.length),
});
```

- [ ] **Step 4: 实现 `src/lib/script/duration.ts`**

```ts
import { ROLE_LABEL, ROLE_SHARE, type Script, type SegmentRole } from './model';

/** 中文口播语速(字/秒)。旧版稿子页实测口径 49 字 ≈ 9.8 秒。阶段 5 用已发作品校准。 */
export const CHARS_PER_SEC = 5;
/** 单段允许超出预算的比例 */
export const SEGMENT_TOLERANCE = 1.25;
/** 全片允许超出目标的比例 */
export const TOTAL_TOLERANCE = 1.1;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 念出来的"字数": 汉字各算 1; 连续的英文/数字按 ceil(长度/3) 算; 标点与空白不算。 */
export function countSpokenChars(text: string): number {
  const cjk = text.match(/[㐀-鿿]/g)?.length ?? 0;
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).reduce((n, w) => n + Math.ceil(w.length / 3), 0);
  return cjk + latin;
}

export function estimateSec(text: string): number {
  return round1(countSpokenChars(text) / CHARS_PER_SEC);
}

export function segmentBudgetSec(role: SegmentRole, targetSec: number): number {
  return round1(targetSec * ROLE_SHARE[role]);
}

export interface SegmentReport {
  id: string;
  index: number;
  role: SegmentRole;
  estSec: number;
  budgetSec: number;
  limitSec: number;
  over: boolean;
}

export interface DurationReport {
  totalSec: number;
  targetSec: number;
  totalLimitSec: number;
  ok: boolean;
  segments: SegmentReport[];
  /** 给模型也给人看的超标说明, 必须带实际值(模型拿不到数值就只能盲改) */
  issues: string[];
}

export function checkDuration(script: Script, targetSec: number): DurationReport {
  const segments = script.segments.map((s, i): SegmentReport => {
    const estSec = estimateSec(s.text);
    const budgetSec = segmentBudgetSec(s.role, targetSec);
    const limitSec = round1(budgetSec * SEGMENT_TOLERANCE);
    return { id: s.id, index: i + 1, role: s.role, estSec, budgetSec, limitSec, over: estSec > limitSec };
  });
  const totalSec = round1(segments.reduce((n, s) => n + s.estSec, 0));
  const totalLimitSec = round1(targetSec * TOTAL_TOLERANCE);
  const issues = segments
    .filter((s) => s.over)
    .map(
      (s) =>
        `第${s.index}段「${ROLE_LABEL[s.role]}」约 ${s.estSec} 秒，上限 ${s.limitSec} 秒 —— 删到约 ${Math.floor(s.limitSec * CHARS_PER_SEC)} 字以内，只改这一段`,
    );
  if (totalSec > totalLimitSec) issues.push(`全片约 ${totalSec} 秒，目标 ${targetSec} 秒（上限 ${totalLimitSec} 秒）`);
  return { totalSec, targetSec, totalLimitSec, ok: issues.length === 0, segments, issues };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/lib/script/duration.test.ts`
Expected: PASS（9 个测试）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/script tests/lib/script
git commit -m "feat(script): 6 段稿子模型与时长估算(超标报告带实际值)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 写稿与自修循环

**Files:**
- Create: `src/lib/script/write.ts`
- Test: `tests/lib/script/write.test.ts`

**Interfaces:**
- Consumes: `Script`、`SEGMENT_ROLES`、`ROLE_LABEL`、`ROLE_SHARE`（Task 4）；`checkDuration`、`DurationReport`、`CHARS_PER_SEC`（Task 4）；`IVisionLLM`（`src/lib/llm/vision.ts`，方法 `callStructured<T>(opts: CallStructuredOpts<T>): Promise<{ result: T; usage: TokenUsage }>`）。
- Produces:
  - `MAX_REPAIR_ROUNDS = 2`
  - `type StructuredLLM = Pick<IVisionLLM, 'callStructured'>`
  - `LlmScriptSchema`（`{ title: string; segments: { role; text }[] }`，恰好 6 段）
  - `toScript(raw: z.infer<typeof LlmScriptSchema>): Script`（按位置强制角色，id 为 `s1`..`s6`）
  - `writeScript(opts: { llm: StructuredLLM; direction: string; targetSec: number; personaText: string }): Promise<{ title: string; script: Script; report: DurationReport; rounds: number }>`

- [ ] **Step 1: 写失败测试**

`tests/lib/script/write.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { writeScript, toScript, MAX_REPAIR_ROUNDS, type StructuredLLM } from '@/lib/script/write';

const onBudget = [30, 67, 67, 45, 67, 22];
const tooLong = [30, 67, 67, 187, 67, 22];
const raw = (lengths: number[]) => ({
  title: '让AI当反方',
  segments: lengths.map((n) => ({ role: 'hook' as const, text: '字'.repeat(n) })),
});

function fakeLLM(outputs: ReturnType<typeof raw>[]): StructuredLLM & { calls: string[] } {
  const calls: string[] = [];
  const fn = vi.fn(async (opts: { userMessage: { type: string; text?: string }[] }) => {
    calls.push(opts.userMessage.map((p) => p.text ?? '').join(''));
    const next = outputs.shift();
    if (!next) throw new Error('fake LLM ran out of outputs');
    return { result: next, usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  });
  return { callStructured: fn as unknown as StructuredLLM['callStructured'], calls };
}

describe('toScript', () => {
  it('forces roles by position and assigns stable ids', () => {
    const s = toScript(raw(onBudget));
    expect(s.segments.map((x) => x.role)).toEqual(['hook', 'conceptA', 'conceptB', 'fact', 'bridge', 'close']);
    expect(s.segments.map((x) => x.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
  });
});

describe('writeScript', () => {
  it('returns first draft when it is on budget', async () => {
    const llm = fakeLLM([raw(onBudget)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(0);
    expect(r.report.ok).toBe(true);
    expect(r.title).toBe('让AI当反方');
    expect(llm.calls).toHaveLength(1);
  });

  it('repairs with the issue text fed back, then succeeds', async () => {
    const llm = fakeLLM([raw(tooLong), raw(onBudget)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(1);
    expect(r.report.ok).toBe(true);
    expect(llm.calls[1]).toContain('第4段「冷知识」约 37.4 秒，上限 11.3 秒');
  });

  it('gives up after MAX_REPAIR_ROUNDS and reports honestly', async () => {
    const llm = fakeLLM([raw(tooLong), raw(tooLong), raw(tooLong)]);
    const r = await writeScript({ llm, direction: '让AI挑刺', targetSec: 60, personaText: '' });
    expect(r.rounds).toBe(MAX_REPAIR_ROUNDS);
    expect(r.report.ok).toBe(false);
    expect(llm.calls).toHaveLength(1 + MAX_REPAIR_ROUNDS);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/script/write.test.ts`
Expected: FAIL，`Failed to resolve import "@/lib/script/write"`。

- [ ] **Step 3: 实现 `src/lib/script/write.ts`**

```ts
import { z } from 'zod';
import type { IVisionLLM } from '@/lib/llm/vision';
import { SEGMENT_ROLES, ROLE_LABEL, type Script } from './model';
import { checkDuration, segmentBudgetSec, CHARS_PER_SEC, type DurationReport } from './duration';

export const MAX_REPAIR_ROUNDS = 2;

export type StructuredLLM = Pick<IVisionLLM, 'callStructured'>;

export const LlmScriptSchema = z.object({
  title: z.string().min(1),
  segments: z
    .array(z.object({ role: z.string(), text: z.string().min(1) }))
    .length(SEGMENT_ROLES.length),
});
type LlmScript = z.infer<typeof LlmScriptSchema>;

/** 角色按位置强制对齐 —— 模型偶尔会把 role 写错或写成中文, 顺序才是契约。 */
export function toScript(raw: LlmScript): Script {
  return {
    segments: raw.segments.map((s, i) => ({ id: `s${i + 1}`, role: SEGMENT_ROLES[i], text: s.text.trim() })),
  };
}

function segmentGuide(targetSec: number): string {
  return SEGMENT_ROLES.map((role, i) => {
    const sec = segmentBudgetSec(role, targetSec);
    return `${i + 1}. ${ROLE_LABEL[role]}：约 ${sec} 秒，≈ ${Math.round(sec * CHARS_PER_SEC)} 字`;
  }).join('\n');
}

const SYSTEM_PROMPT = `你是抖音 AI 知识类口播博主的编导，负责写能直接开口念的口播逐字稿。
要求：
- 口语、短句，不用书面转折词（然而、综上所述、值得注意的是）。
- 不编造数字和事实；没把握的写成相对说法（"好几倍""不少人"）。
- 严格按给定的 6 段结构与每段字数写，字数是硬约束。
- 只输出 JSON：{"title": "视频标题", "segments": [{"role": "段名", "text": "逐字稿"}, ...共 6 段]}。`;

function firstMessage(direction: string, targetSec: number, personaText: string): string {
  return `${personaText ? `【账号定位】\n${personaText}\n\n` : ''}【这条讲什么】\n${direction}\n\n【目标时长】${targetSec} 秒，按口语 ${CHARS_PER_SEC} 字/秒\n\n【6 段结构与字数】\n${segmentGuide(targetSec)}`;
}

function repairMessage(script: Script, report: DurationReport, targetSec: number): string {
  const current = script.segments.map((s, i) => `${i + 1}. ${ROLE_LABEL[s.role]}：${s.text}`).join('\n');
  return `下面这版稿子超时了，请只修改超标的段落，其他段落原样保留，意思不变。\n\n【超标情况】\n${report.issues.join('\n')}\n\n【当前稿子】\n${current}\n\n【6 段结构与字数】\n${segmentGuide(targetSec)}`;
}

export async function writeScript(opts: {
  llm: StructuredLLM;
  direction: string;
  targetSec: number;
  personaText: string;
}): Promise<{ title: string; script: Script; report: DurationReport; rounds: number }> {
  const call = async (text: string) =>
    (
      await opts.llm.callStructured({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [{ type: 'text', text }],
        responseSchema: LlmScriptSchema,
      })
    ).result;

  let raw = await call(firstMessage(opts.direction, opts.targetSec, opts.personaText));
  let script = toScript(raw);
  let report = checkDuration(script, opts.targetSec);
  let rounds = 0;
  while (!report.ok && rounds < MAX_REPAIR_ROUNDS) {
    rounds += 1;
    raw = await call(repairMessage(script, report, opts.targetSec));
    script = toScript(raw);
    report = checkDuration(script, opts.targetSec);
  }
  return { title: raw.title, script, report, rounds };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/script/write.test.ts`
Expected: PASS（4 个测试）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/script/write.ts tests/lib/script/write.test.ts
git commit -m "feat(script): 写稿 + 超标自修循环(最多 2 轮, 放弃时如实返回)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 工具层（write_script / patch_script）

**Files:**
- Create: `src/lib/script/edit.ts`、`src/lib/tools/types.ts`、`src/lib/tools/write-script.ts`、`src/lib/tools/patch-script.ts`、`src/lib/tools/index.ts`、`tests/helpers/fake-db.ts`
- Test: `tests/lib/script/edit.test.ts`、`tests/lib/tools/write-script.test.ts`、`tests/lib/tools/patch-script.test.ts`

**Interfaces:**
- Consumes: Task 4、5 的全部导出；`PrismaClient`。
- Produces:
  - `applySegmentEdit(script: Script, segmentId: string, text: string): Script`（找不到 id 抛 `Error('没有编号为 X 的段落，可用编号：s1、s2…')`）
  - `formatPersona(p: PersonaLike | null): string`，`interface PersonaLike { audience: string; targetFans: string; pillars: unknown; angle: string; avoid: string; painPoints: unknown; offerings: unknown; systemSummary: string }`（放在 `tools/types.ts`，Task 7 的上下文也用它）
  - `interface ToolContext { projectId: string; db: PrismaClient; llm: StructuredLLM }`
  - `interface ToolResult { ok: boolean; summary: string; data?: unknown; segmentIds?: string[] }`
  - `interface Tool<I> { name: string; description: string; input: z.ZodType<I>; execute(ctx: ToolContext, input: I): Promise<ToolResult> }`
  - `writeScriptTool: Tool<{ direction: string; targetSec?: number }>`、`patchScriptTool: Tool<{ segmentId: string; text: string }>`
  - `SCRIPT_TOOLS: Tool<any>[]`
  - 测试辅助 `createFakeDb(seed?)`（`tests/helpers/fake-db.ts`），Task 7 复用。

- [ ] **Step 1: 写内存假库 `tests/helpers/fake-db.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * 工具层与对话循环测试用的内存假库 —— 只实现被用到的方法。
 * 用真 Prisma 需要起库, 单元测试不该依赖外部服务。
 */
export interface FakeProject {
  id: string;
  title: string;
  stage: string;
  script: unknown;
  targetSec: number;
  personaSnapshot: unknown;
  updatedAt: Date;
}
export interface FakeMessage {
  id: string;
  projectId: string;
  role: string;
  content: string;
  toolName: string | null;
  toolInput: unknown;
  toolResult: unknown;
  createdAt: Date;
}

export function createFakeDb(seed: { project?: Partial<FakeProject>; persona?: Record<string, unknown> | null } = {}) {
  const project: FakeProject = {
    id: 'p1',
    title: '未命名项目',
    stage: 'draft',
    script: null,
    targetSec: 60,
    personaSnapshot: null,
    updatedAt: new Date(),
    ...seed.project,
  };
  const messages: FakeMessage[] = [];
  let seq = 0;
  const db = {
    project: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== project.id) throw new Error('not found');
        return { ...project };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === project.id ? { ...project } : null),
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeProject> }) => {
        if (where.id !== project.id) throw new Error('not found');
        Object.assign(project, data, { updatedAt: new Date() });
        return { ...project };
      },
    },
    personaProfile: {
      findUnique: async () => seed.persona ?? null,
    },
    chatMessage: {
      create: async ({ data }: { data: Partial<FakeMessage> & { projectId: string; role: string } }) => {
        const m: FakeMessage = {
          id: `m${++seq}`,
          content: '',
          toolName: null,
          toolInput: null,
          toolResult: null,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        messages.push(m);
        return m;
      },
      findMany: async ({ where, take }: { where: { projectId: string }; take?: number }) => {
        const rows = messages.filter((m) => m.projectId === where.projectId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
  };
  return { db: db as unknown as PrismaClient, project, messages };
}
```

- [ ] **Step 2: 写失败测试**

`tests/lib/script/edit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applySegmentEdit } from '@/lib/script/edit';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `原文${i + 1}` })) };

describe('applySegmentEdit', () => {
  it('only touches the target segment', () => {
    const next = applySegmentEdit(script, 's4', '新文');
    expect(next.segments[3].text).toBe('新文');
    expect(next.segments.filter((_, i) => i !== 3).map((s) => s.text)).toEqual(['原文1', '原文2', '原文3', '原文5', '原文6']);
    expect(script.segments[3].text).toBe('原文4'); // 不改原对象
  });
  it('throws a readable error listing valid ids', () => {
    expect(() => applySegmentEdit(script, 's9', 'x')).toThrow('没有编号为 s9 的段落，可用编号：s1、s2、s3、s4、s5、s6');
  });
});
```

`tests/lib/tools/write-script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { writeScriptTool } from '@/lib/tools/write-script';
import { createFakeDb } from '../../helpers/fake-db';
import type { StructuredLLM } from '@/lib/script/write';

const onBudget = [30, 67, 67, 45, 67, 22];
const llm: StructuredLLM = {
  callStructured: (async () => ({
    result: { title: '让AI当反方', segments: onBudget.map((n) => ({ role: 'x', text: '字'.repeat(n) })) },
    usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 },
  })) as unknown as StructuredLLM['callStructured'],
};

describe('write_script tool', () => {
  it('saves the script, sets the title of an untitled project, reports duration', async () => {
    const { db, project } = createFakeDb();
    const r = await writeScriptTool.execute({ projectId: 'p1', db, llm }, { direction: '让AI挑刺' });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('写稿：6 段，约 59.6 秒');
    expect(r.segmentIds).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(project.title).toBe('让AI当反方');
    expect((project.script as { segments: unknown[] }).segments).toHaveLength(6);
  });

  it('keeps a title the user already set', async () => {
    const { db, project } = createFakeDb({ project: { title: '我自己的标题' } });
    await writeScriptTool.execute({ projectId: 'p1', db, llm }, { direction: '让AI挑刺' });
    expect(project.title).toBe('我自己的标题');
  });
});
```

`tests/lib/tools/patch-script.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { patchScriptTool } from '@/lib/tools/patch-script';
import { createFakeDb } from '../../helpers/fake-db';
import { SEGMENT_ROLES } from '@/lib/script/model';
import type { StructuredLLM } from '@/lib/script/write';

const llm = {} as StructuredLLM;
const lengths = [30, 67, 67, 187, 67, 22];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };

describe('patch_script tool', () => {
  it('replaces one segment and reports before/after seconds', async () => {
    const { db, project } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's4', text: '字'.repeat(45) });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('改稿：第4段「冷知识」37.4s → 9s');
    expect(r.segmentIds).toEqual(['s4']);
    expect((project.script as typeof script).segments[3].text).toHaveLength(45);
    expect(r.data).toMatchObject({ durationOk: true, issues: [] });
  });

  it('applies but returns issues when still over limit', async () => {
    const { db } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's4', text: '字'.repeat(100) });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ durationOk: false });
    expect((r.data as { issues: string[] }).issues[0]).toContain('第4段「冷知识」约 20 秒，上限 11.3 秒');
  });

  it('fails readably when there is no script yet', async () => {
    const { db } = createFakeDb();
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's1', text: 'x' });
    expect(r).toMatchObject({ ok: false, summary: '改稿失败：还没有稿子，先写一版' });
  });

  it('fails readably on unknown segment id', async () => {
    const { db } = createFakeDb({ project: { script } });
    const r = await patchScriptTool.execute({ projectId: 'p1', db, llm }, { segmentId: 's9', text: 'x' });
    expect(r.ok).toBe(false);
    expect(r.summary).toBe('改稿失败：没有编号为 s9 的段落，可用编号：s1、s2、s3、s4、s5、s6');
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/script/edit.test.ts tests/lib/tools`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/script/edit.ts`**

```ts
import type { Script } from './model';

/** agent 的 patch_script 与界面手改共用这一个函数, 保证两边行为一致。 */
export function applySegmentEdit(script: Script, segmentId: string, text: string): Script {
  if (!script.segments.some((s) => s.id === segmentId)) {
    throw new Error(`没有编号为 ${segmentId} 的段落，可用编号：${script.segments.map((s) => s.id).join('、')}`);
  }
  return { segments: script.segments.map((s) => (s.id === segmentId ? { ...s, text: text.trim() } : s)) };
}
```

- [ ] **Step 5: 实现 `src/lib/tools/types.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';

/**
 * 工具层: 与界面无关。对话循环(阶段 2)和将来的 CLI 外壳(给 Claude Code / Hermes)
 * 调的是同一套工具。
 */
export interface ToolContext {
  projectId: string;
  db: PrismaClient;
  llm: StructuredLLM;
}

export interface ToolResult {
  ok: boolean;
  /** 一行人话, 显示在对话里的工具结果行 */
  summary: string;
  /** 回给模型的结构化数据 */
  data?: unknown;
  /** 本次改动的段落, 界面用来高亮 */
  segmentIds?: string[];
}

export interface Tool<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  execute(ctx: ToolContext, input: I): Promise<ToolResult>;
}

export interface PersonaLike {
  audience: string;
  targetFans: string;
  pillars: unknown;
  angle: string;
  avoid: string;
  painPoints: unknown;
  offerings: unknown;
  systemSummary: string;
}

function listLines(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) =>
    item && typeof item === 'object'
      ? Object.values(item as Record<string, unknown>).filter((x) => typeof x === 'string' && x).join('：')
      : String(item),
  ).filter(Boolean);
}

/** 人设 → 给模型读的纯文本。空字段不输出。 */
export function formatPersona(p: PersonaLike | null): string {
  if (!p) return '';
  const parts: string[] = [];
  if (p.systemSummary) parts.push(`定位摘要：${p.systemSummary}`);
  if (p.audience) parts.push(`目标受众：${p.audience}`);
  if (p.targetFans) parts.push(`想吸引的粉丝：${p.targetFans}`);
  const pillars = listLines(p.pillars);
  if (pillars.length) parts.push(`内容支柱：\n${pillars.map((x) => `- ${x}`).join('\n')}`);
  if (p.angle) parts.push(`差异化角度：${p.angle}`);
  const pains = listLines(p.painPoints);
  if (pains.length) parts.push(`受众痛点：\n${pains.map((x) => `- ${x}`).join('\n')}`);
  const offers = listLines(p.offerings);
  if (offers.length) parts.push(`商品/服务：\n${offers.map((x) => `- ${x}`).join('\n')}`);
  if (p.avoid) parts.push(`忌讳：${p.avoid}`);
  return parts.join('\n');
}
```

- [ ] **Step 6: 实现 `src/lib/tools/write-script.ts`**

```ts
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { writeScript } from '@/lib/script/write';
import { formatPersona, type PersonaLike, type Tool } from './types';

const Input = z.object({
  direction: z.string().min(1).describe('这条视频讲什么、从什么角度切入、用什么例子'),
  targetSec: z.number().int().min(15).max(180).optional().describe('目标时长(秒), 不传则用项目当前目标'),
});

export const writeScriptTool: Tool<z.infer<typeof Input>> = {
  name: 'write_script',
  description: '按方向写一整版 6 段口播稿并保存到项目(会覆盖当前稿子)。只在还没有稿子或用户要求重写时用；局部修改用 patch_script。',
  input: Input,
  async execute(ctx, input) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const targetSec = input.targetSec ?? project.targetSec;
    const persona = (project.personaSnapshot as PersonaLike | null) ?? null;
    const { title, script, report, rounds } = await writeScript({
      llm: ctx.llm,
      direction: input.direction,
      targetSec,
      personaText: formatPersona(persona),
    });
    await ctx.db.project.update({
      where: { id: ctx.projectId },
      data: {
        script: script as unknown as Prisma.InputJsonValue,
        targetSec,
        ...(project.title === '未命名项目' ? { title } : {}),
      },
    });
    const summary = report.ok
      ? `写稿：6 段，约 ${report.totalSec} 秒`
      : `写稿：约 ${report.totalSec} 秒，自修 ${rounds} 轮后仍超出目标 ${targetSec} 秒`;
    return {
      ok: true,
      summary,
      segmentIds: script.segments.map((s) => s.id),
      data: { title, durationOk: report.ok, totalSec: report.totalSec, issues: report.issues },
    };
  },
};
```

- [ ] **Step 7: 实现 `src/lib/tools/patch-script.ts`**

```ts
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { applySegmentEdit } from '@/lib/script/edit';
import { checkDuration, estimateSec } from '@/lib/script/duration';
import type { Tool } from './types';

const Input = z.object({
  segmentId: z.string().min(1).describe('要改的段落编号, 如 s4'),
  text: z.string().min(1).describe('这一段改后的完整逐字稿'),
});

export const patchScriptTool: Tool<z.infer<typeof Input>> = {
  name: 'patch_script',
  description: '只替换稿子里指定编号的一段, 其他段落不动。返回改后的时长检查结果；仍超标时 issues 里有具体数值。',
  input: Input,
  async execute(ctx, input) {
    const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const parsed = ScriptSchema.safeParse(project.script);
    if (!parsed.success) return { ok: false, summary: '改稿失败：还没有稿子，先写一版' };
    const before = parsed.data.segments.find((s) => s.id === input.segmentId);
    let next;
    try {
      next = applySegmentEdit(parsed.data, input.segmentId, input.text);
    } catch (e) {
      return { ok: false, summary: `改稿失败：${e instanceof Error ? e.message : String(e)}` };
    }
    await ctx.db.project.update({
      where: { id: ctx.projectId },
      data: { script: next as unknown as Prisma.InputJsonValue },
    });
    const report = checkDuration(next, project.targetSec);
    const seg = report.segments.find((s) => s.id === input.segmentId)!;
    return {
      ok: true,
      summary: `改稿：第${seg.index}段「${ROLE_LABEL[seg.role]}」${estimateSec(before!.text)}s → ${seg.estSec}s`,
      segmentIds: [input.segmentId],
      data: { durationOk: report.ok, totalSec: report.totalSec, issues: report.issues },
    };
  },
};
```

- [ ] **Step 8: 实现 `src/lib/tools/index.ts`**

```ts
import type { Tool } from './types';
import { writeScriptTool } from './write-script';
import { patchScriptTool } from './patch-script';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCRIPT_TOOLS: Tool<any>[] = [writeScriptTool, patchScriptTool];
```

- [ ] **Step 9: 运行确认通过**

Run: `npx vitest run tests/lib/script tests/lib/tools && npm run typecheck`
Expected: 全部 PASS；typecheck 0 错误。

- [ ] **Step 10: Commit**

```bash
git add src/lib/script/edit.ts src/lib/tools tests/helpers tests/lib/script/edit.test.ts tests/lib/tools
git commit -m "feat(tools): write_script / patch_script 工具层(与界面无关)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 编导对话循环、上下文、DeepSeek 流式模型、SSE 编解码

**Files:**
- Create: `src/lib/agent/chat-model.ts`、`src/lib/agent/context.ts`、`src/lib/agent/loop.ts`、`src/lib/agent/sse.ts`
- Test: `tests/lib/agent/context.test.ts`、`tests/lib/agent/loop.test.ts`、`tests/lib/agent/sse.test.ts`

**Interfaces:**
- Consumes: `Tool`、`ToolContext`、`ToolResult`、`formatPersona`、`PersonaLike`（Task 6）；`checkDuration`、`ScriptSchema`、`ROLE_LABEL`（Task 4）；`createFakeDb`（Task 6）。
- Produces:
  - `chat-model.ts`: `type AgentMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam`；`interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }`；`interface ToolCall { id: string; name: string; arguments: string }`；`interface ChatTurnResult { text: string; toolCalls: ToolCall[] }`；`interface ChatModel { streamTurn(messages: AgentMessage[], tools: ToolSpec[], onText: (delta: string) => void): Promise<ChatTurnResult> }`；`createDeepSeekChatModel(apiKey: string, model?: string): ChatModel`；`toToolSpec(tool: Tool<unknown>): ToolSpec`
  - `context.ts`: `HISTORY_LIMIT = 20`；`formatSystemPrompt(p: { title: string; stage: string; targetSec: number; script: unknown; persona: PersonaLike | null }): string`；`buildSystemPrompt(db: PrismaClient, projectId: string): Promise<string>`；`loadHistory(db: PrismaClient, projectId: string): Promise<AgentMessage[]>`
  - `loop.ts`: `MAX_TOOL_CALLS_PER_TURN = 8`；`type AgentEvent = { type: 'text'; delta: string } | { type: 'tool'; name: string; ok: boolean; summary: string; segmentIds: string[] } | { type: 'error'; message: string } | { type: 'done' }`；`runAgentTurn(opts: { projectId: string; userText: string; db: PrismaClient; model: ChatModel; tools: Tool<any>[]; toolCtx: ToolContext; emit: (e: AgentEvent) => void }): Promise<void>`
  - `sse.ts`: `encodeSse(e: AgentEvent): string`；`parseSseBuffer(buffer: string): { events: AgentEvent[]; rest: string }`

- [ ] **Step 1: 写失败测试**

`tests/lib/agent/sse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeSse, parseSseBuffer } from '@/lib/agent/sse';

describe('sse', () => {
  it('round-trips events and keeps an incomplete tail', () => {
    const buf = encodeSse({ type: 'text', delta: '你好\n世界' }) + encodeSse({ type: 'done' }) + 'data: {"type":"te';
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([{ type: 'text', delta: '你好\n世界' }, { type: 'done' }]);
    expect(rest).toBe('data: {"type":"te');
  });
});
```

`tests/lib/agent/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatSystemPrompt, loadHistory } from '@/lib/agent/context';
import { SEGMENT_ROLES } from '@/lib/script/model';
import { createFakeDb } from '../../helpers/fake-db';

const lengths = [30, 67, 67, 187, 67, 22];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) };

describe('formatSystemPrompt', () => {
  it('includes segment ids with est/limit seconds and current issues', () => {
    const p = formatSystemPrompt({ title: '让AI当反方', stage: 'draft', targetSec: 60, script, persona: null });
    expect(p).toContain('[s4] 冷知识（约 37.4 秒 / 上限 11.3 秒，超标）');
    expect(p).toContain('第4段「冷知识」约 37.4 秒');
    expect(p).toContain('write_script');
  });
  it('says there is no script yet when script is null', () => {
    const p = formatSystemPrompt({ title: '未命名项目', stage: 'draft', targetSec: 60, script: null, persona: null });
    expect(p).toContain('还没有稿子');
  });
  it('includes persona text when present', () => {
    const p = formatSystemPrompt({
      title: 't', stage: 'draft', targetSec: 60, script: null,
      persona: { audience: '职场新人', targetFans: '', pillars: [], angle: '', avoid: '不卖课', painPoints: [], offerings: [], systemSummary: '' },
    });
    expect(p).toContain('目标受众：职场新人');
    expect(p).toContain('忌讳：不卖课');
  });
});

describe('loadHistory', () => {
  it('returns oldest-first, maps tool rows to assistant notes, drops system rows', async () => {
    const { db } = createFakeDb();
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'user', content: '写一版' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'tool', content: '写稿：6 段，约 59.6 秒', toolName: 'write_script' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'system', content: '编导暂时连不上' } });
    await db.chatMessage.create({ data: { projectId: 'p1', role: 'assistant', content: '写好了' } });
    const h = await loadHistory(db, 'p1');
    expect(h).toEqual([
      { role: 'user', content: '写一版' },
      { role: 'assistant', content: '（已执行 write_script：写稿：6 段，约 59.6 秒）' },
      { role: 'assistant', content: '写好了' },
    ]);
  });
});
```

`tests/lib/agent/loop.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgentTurn, MAX_TOOL_CALLS_PER_TURN, type AgentEvent } from '@/lib/agent/loop';
import type { ChatModel, ChatTurnResult } from '@/lib/agent/chat-model';
import type { Tool } from '@/lib/tools/types';
import { createFakeDb } from '../../helpers/fake-db';

function scriptedModel(turns: ChatTurnResult[] | (() => ChatTurnResult)): ChatModel & { seenTools: number[] } {
  const seenTools: number[] = [];
  return {
    seenTools,
    async streamTurn(_messages, tools, onText) {
      seenTools.push(tools.length);
      const t = typeof turns === 'function' ? turns() : turns.shift();
      if (!t) throw new Error('no more turns');
      if (t.text) onText(t.text);
      return t;
    },
  };
}

const echoTool: Tool<{ n: number }> = {
  name: 'echo',
  description: 'echo',
  input: z.object({ n: z.number() }),
  async execute(_ctx, input) {
    return { ok: true, summary: `echo ${input.n}`, segmentIds: ['s1'] };
  },
};

async function run(model: ChatModel, tools: Tool<any>[] = [echoTool]) {
  const { db, messages } = createFakeDb();
  const events: AgentEvent[] = [];
  await runAgentTurn({
    projectId: 'p1', userText: '你好', db, model, tools,
    toolCtx: { projectId: 'p1', db, llm: {} as never },
    emit: (e) => events.push(e),
  });
  return { events, messages };
}

describe('runAgentTurn', () => {
  it('plain text reply: streams, saves user + assistant, ends with done', async () => {
    const { events, messages } = await run(scriptedModel([{ text: '你好呀', toolCalls: [] }]));
    expect(events).toEqual([{ type: 'text', delta: '你好呀' }, { type: 'done' }]);
    expect(messages.map((m) => [m.role, m.content])).toEqual([['user', '你好'], ['assistant', '你好呀']]);
  });

  it('executes a tool call, emits tool event, then continues to final text', async () => {
    const { events, messages } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"n":3}' }] },
        { text: '好了', toolCalls: [] },
      ]),
    );
    expect(events).toContainEqual({ type: 'tool', name: 'echo', ok: true, summary: 'echo 3', segmentIds: ['s1'] });
    expect(events.at(-1)).toEqual({ type: 'done' });
    expect(messages.find((m) => m.role === 'tool')).toMatchObject({ toolName: 'echo', content: 'echo 3' });
  });

  it('invalid tool arguments are fed back, not thrown', async () => {
    const { events } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"n":"三"}' }] },
        { text: '参数错了我再试', toolCalls: [] },
      ]),
    );
    const tool = events.find((e) => e.type === 'tool');
    expect(tool).toMatchObject({ ok: false });
    expect((tool as { summary: string }).summary).toContain('参数不对');
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('unknown tool name is fed back, not thrown', async () => {
    const { events } = await run(
      scriptedModel([
        { text: '', toolCalls: [{ id: 'c1', name: 'nope', arguments: '{}' }] },
        { text: '好', toolCalls: [] },
      ]),
    );
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ ok: false, summary: '没有叫 nope 的工具' });
  });

  it('stops offering tools after MAX_TOOL_CALLS_PER_TURN and asks for a summary', async () => {
    let calls = 0;
    const model = scriptedModel(() =>
      calls++ < 20 ? { text: '', toolCalls: [{ id: `c${calls}`, name: 'echo', arguments: '{"n":1}' }] } : { text: '收尾', toolCalls: [] },
    );
    const { events } = await run(model);
    const toolEvents = events.filter((e) => e.type === 'tool');
    expect(toolEvents.filter((e) => (e as { ok: boolean }).ok)).toHaveLength(MAX_TOOL_CALLS_PER_TURN);
    expect(model.seenTools.at(-1)).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('model failure emits human error and keeps user message', async () => {
    const model: ChatModel = { async streamTurn() { throw new Error('401 Unauthorized'); } };
    const { events, messages } = await run(model);
    expect(events).toEqual([{ type: 'error', message: '编导暂时连不上 DeepSeek（401 Unauthorized）。检查 .env 里的 DEEPSEEK_API_KEY 和网络后再发一次。' }]);
    expect(messages[0]).toMatchObject({ role: 'user', content: '你好' });
    expect(messages.at(-1)).toMatchObject({ role: 'system' });
  });

  it('tool that throws becomes a readable failed result', async () => {
    const boom: Tool<Record<string, never>> = {
      name: 'boom', description: 'b', input: z.object({}),
      async execute() { throw new Error('磁盘满了'); },
    };
    const { events } = await run(
      scriptedModel([{ text: '', toolCalls: [{ id: 'c1', name: 'boom', arguments: '{}' }] }, { text: '抱歉', toolCalls: [] }]),
      [boom],
    );
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ ok: false, summary: 'boom 失败：磁盘满了' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/agent`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/agent/sse.ts`**

```ts
import type { AgentEvent } from './loop';

export function encodeSse(e: AgentEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/** 按 "\n\n" 切事件; 末尾不完整的一段原样留在 rest 里等下一块数据。 */
export function parseSseBuffer(buffer: string): { events: AgentEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts
    .map((p) => p.trim())
    .filter((p) => p.startsWith('data: '))
    .map((p) => JSON.parse(p.slice('data: '.length)) as AgentEvent);
  return { events, rest };
}
```

- [ ] **Step 4: 实现 `src/lib/agent/chat-model.ts`**

```ts
import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Tool } from '@/lib/tools/types';

export type AgentMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface ChatTurnResult {
  text: string;
  toolCalls: ToolCall[];
}
/** 对话模型接口 —— 测试注入假实现; 将来换 Claude API 只换这一层。 */
export interface ChatModel {
  streamTurn(messages: AgentMessage[], tools: ToolSpec[], onText: (delta: string) => void): Promise<ChatTurnResult>;
}

export function toToolSpec(tool: Tool<unknown>): ToolSpec {
  const { $schema: _drop, ...parameters } = zodToJsonSchema(tool.input, { $refStrategy: 'none' }) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters };
}

export function createDeepSeekChatModel(apiKey: string, model = 'deepseek-chat'): ChatModel {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
  return {
    async streamTurn(messages, tools, onText) {
      const stream = await client.chat.completions.create({
        model,
        messages,
        stream: true,
        // 空数组会被 DeepSeek 拒绝, 没有工具时不传
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
```

- [ ] **Step 5: 实现 `src/lib/agent/context.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { checkDuration } from '@/lib/script/duration';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import type { AgentMessage } from './chat-model';

export const HISTORY_LIMIT = 20;

const STAGE_LABEL: Record<string, string> = {
  draft: '写稿中',
  scripted: '已定稿，等待录制',
};

const RULES = `你是用户的抖音口播编导，和用户一起把一条口播稿磨到能直接开录。
工作方式：
- 还没有稿子或用户要求重写：调用 write_script。局部修改：调用 patch_script，只改相关段落。
- 稿子显示在用户屏幕中间，不要在回复里整段贴稿子；回复里说明改了什么、为什么。
- 时长是硬约束。工具返回 durationOk=false 时，按 issues 里的数值继续用 patch_script 修；同一段最多再修 2 次，仍超标就如实告诉用户差多少秒，并问他要不要删内容。
- 不编造数字和事实；没把握的写成相对说法。
- 回复用中文，简短。`;

export function formatSystemPrompt(p: {
  title: string;
  stage: string;
  targetSec: number;
  script: unknown;
  persona: PersonaLike | null;
}): string {
  const persona = formatPersona(p.persona);
  const parsed = ScriptSchema.safeParse(p.script);
  let scriptBlock = '还没有稿子。';
  if (parsed.success) {
    const report = checkDuration(parsed.data, p.targetSec);
    const lines = parsed.data.segments.map((s, i) => {
      const r = report.segments[i];
      return `[${s.id}] ${ROLE_LABEL[s.role]}（约 ${r.estSec} 秒 / 上限 ${r.limitSec} 秒${r.over ? '，超标' : ''}）\n${s.text}`;
    });
    scriptBlock = `${lines.join('\n\n')}\n\n全片约 ${report.totalSec} 秒。${report.ok ? '时长达标。' : `\n当前问题：\n${report.issues.join('\n')}`}`;
  }
  return [
    RULES,
    persona ? `【账号定位】\n${persona}` : '',
    `【项目】${p.title}｜${STAGE_LABEL[p.stage] ?? p.stage}｜目标 ${p.targetSec} 秒`,
    `【当前稿子】\n${scriptBlock}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 每轮从库里重建, 不依赖聊天记录推断当前状态。 */
export async function buildSystemPrompt(db: PrismaClient, projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  return formatSystemPrompt({
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script: p.script,
    persona: (p.personaSnapshot as PersonaLike | null) ?? null,
  });
}

/** 最近 HISTORY_LIMIT 条, 旧→新。tool 行转成 assistant 备注(不配对 tool_call_id 发不出去), system 行不回传。 */
export async function loadHistory(db: PrismaClient, projectId: string): Promise<AgentMessage[]> {
  const rows = await db.chatMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  return rows
    .reverse()
    .flatMap((m): AgentMessage[] => {
      if (m.role === 'user') return [{ role: 'user', content: m.content }];
      if (m.role === 'assistant') return m.content ? [{ role: 'assistant', content: m.content }] : [];
      if (m.role === 'tool') return [{ role: 'assistant', content: `（已执行 ${m.toolName}：${m.content}）` }];
      return [];
    });
}
```

- [ ] **Step 6: 实现 `src/lib/agent/loop.ts`**

```ts
import type { PrismaClient, Prisma } from '@prisma/client';
import type { Tool, ToolContext, ToolResult } from '@/lib/tools/types';
import { toToolSpec, type AgentMessage, type ChatModel, type ChatTurnResult, type ToolCall } from './chat-model';
import { buildSystemPrompt, loadHistory } from './context';

export const MAX_TOOL_CALLS_PER_TURN = 8;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string; segmentIds: string[] }
  | { type: 'error'; message: string }
  | { type: 'done' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeToolCall(call: ToolCall, tools: Tool<any>[], ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { ok: false, summary: `没有叫 ${call.name} 的工具`, data: { error: `可用工具：${tools.map((t) => t.name).join('、')}` } };
  let args: unknown;
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    return { ok: false, summary: `${call.name} 参数不对：不是合法 JSON`, data: { error: '参数必须是合法 JSON，请重新调用' } };
  }
  const parsed = tool.input.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(根)'}：${i.message}`).join('；');
    return { ok: false, summary: `${call.name} 参数不对：${detail}`, data: { error: detail } };
  }
  try {
    return await tool.execute(ctx, parsed.data);
  } catch (e) {
    return { ok: false, summary: `${call.name} 失败：${errMsg(e)}`, data: { error: errMsg(e) } };
  }
}

function safeJson(s: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return { raw: s };
  }
}

export async function runAgentTurn(opts: {
  projectId: string;
  userText: string;
  db: PrismaClient;
  model: ChatModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: Tool<any>[];
  toolCtx: ToolContext;
  emit: (e: AgentEvent) => void;
}): Promise<void> {
  const { projectId, db, emit } = opts;
  await db.chatMessage.create({ data: { projectId, role: 'user', content: opts.userText } });

  const messages: AgentMessage[] = [
    { role: 'system', content: await buildSystemPrompt(db, projectId) },
    ...(await loadHistory(db, projectId)),
  ];
  const specs = opts.tools.map((t) => toToolSpec(t));
  let used = 0;

  for (;;) {
    const offerTools = used < MAX_TOOL_CALLS_PER_TURN;
    let turn: ChatTurnResult;
    try {
      turn = await opts.model.streamTurn(messages, offerTools ? specs : [], (delta) => emit({ type: 'text', delta }));
    } catch (e) {
      const message = `编导暂时连不上 DeepSeek（${errMsg(e)}）。检查 .env 里的 DEEPSEEK_API_KEY 和网络后再发一次。`;
      await db.chatMessage.create({ data: { projectId, role: 'system', content: message } });
      emit({ type: 'error', message });
      return;
    }

    if (turn.toolCalls.length === 0) {
      await db.chatMessage.create({ data: { projectId, role: 'assistant', content: turn.text } });
      emit({ type: 'done' });
      return;
    }

    if (turn.text) await db.chatMessage.create({ data: { projectId, role: 'assistant', content: turn.text } });
    messages.push({
      role: 'assistant',
      content: turn.text || null,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of turn.toolCalls) {
      used += 1;
      const result: ToolResult =
        used > MAX_TOOL_CALLS_PER_TURN
          ? { ok: false, summary: '本轮工具调用次数已到上限', data: { error: `本轮最多调用 ${MAX_TOOL_CALLS_PER_TURN} 次工具，已停止。请把目前的进展和剩下的问题如实告诉用户。` } }
          : await executeToolCall(call, opts.tools, opts.toolCtx);
      await db.chatMessage.create({
        data: {
          projectId,
          role: 'tool',
          content: result.summary,
          toolName: call.name,
          toolInput: safeJson(call.arguments),
          toolResult: { ok: result.ok, summary: result.summary, data: (result.data ?? null) as Prisma.InputJsonValue, segmentIds: result.segmentIds ?? [] },
        },
      });
      emit({ type: 'tool', name: call.name, ok: result.ok, summary: result.summary, segmentIds: result.segmentIds ?? [] });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: result.ok, summary: result.summary, data: result.data ?? null }) });
    }
  }
}
```

注：用满 8 次后，下一轮起不再给模型工具（`offerTools=false`），真模型拿不到工具就只能用文字收尾。万一模型仍返回工具调用，每一次都记为"已到上限"的失败结果回喂，不会执行——超限测试的假模型正是这样：前 20 轮都返回工具调用，第 21 轮才返回文字。

- [ ] **Step 7: 运行确认通过**

Run: `npx vitest run tests/lib/agent && npm run typecheck`
Expected: 全部 PASS；typecheck 0 错误。

- [ ] **Step 8: 真实 DeepSeek 冒烟（确认 function calling 与流式真的通）**

创建临时文件 `scripts/_agent-smoke.ts`（放在项目里才能解析到 node_modules 与 `@/` 别名；跑完即删，不入库）：

```ts
import 'dotenv/config';
import { z } from 'zod';
import { createDeepSeekChatModel, toToolSpec } from '@/lib/agent/chat-model';

const model = createDeepSeekChatModel(process.env.DEEPSEEK_API_KEY!);
const tool = { name: 'get_weather', description: '查城市天气', input: z.object({ city: z.string() }), execute: async () => ({ ok: true, summary: '' }) };
model
  .streamTurn([{ role: 'user', content: '北京天气怎么样？必须调用工具。' }], [toToolSpec(tool)], (d) => process.stdout.write(d))
  .then((r) => console.log('\nRESULT', JSON.stringify(r)));
```

Run: `npx tsx scripts/_agent-smoke.ts; rm scripts/_agent-smoke.ts`
Expected: `RESULT {"text":"...","toolCalls":[{"id":"call_...","name":"get_weather","arguments":"{\"city\":\"北京\"}"}]}`。若 toolCalls 为空或 arguments 被截断，停下报告，不要继续 Task 8。

- [ ] **Step 9: Commit**

```bash
git add src/lib/agent tests/lib/agent
git commit -m "feat(agent): 编导对话循环(工具调用上限/参数回喂/人话报错) + DeepSeek 流式模型 + SSE 编解码

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 项目 API（列表、新建、详情、手改/定稿、对话 SSE）

**Files:**
- Create: `src/lib/project/view.ts`、`src/app/api/projects/route.ts`、`src/app/api/projects/[id]/route.ts`、`src/app/api/projects/[id]/chat/route.ts`
- Test: `tests/lib/project/view.test.ts`

**Interfaces:**
- Consumes: `ok`/`fail`（`src/lib/api.ts`）、`getDeepSeekKey`、`getDeepSeekTextLLM` 的替代——直接 `new DeepSeekTextLLM({ apiKey })`（`src/lib/llm/deepseek.ts`）、`createDeepSeekChatModel`、`runAgentTurn`、`encodeSse`、`SCRIPT_TOOLS`、`applySegmentEdit`、`checkDuration`、`ScriptSchema`。
- Produces:
  - `interface ProjectView { id: string; title: string; stage: string; targetSec: number; script: Script | null; report: DurationReport | null; updatedAt: string }`
  - `interface MessageView { id: string; role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolName: string | null; ok: boolean | null }`
  - `toProjectView(p: { id; title; stage; targetSec; script: unknown; updatedAt: Date }): ProjectView`
  - `toMessageView(m: { id; role; content; toolName; toolResult: unknown }): MessageView`
  - HTTP：`GET /api/projects` → `ProjectView[]`（按 updatedAt 倒序）；`POST /api/projects` body `{ title?: string }` → `ProjectView`；`GET /api/projects/:id` → `{ project: ProjectView; messages: MessageView[] }`；`PATCH /api/projects/:id` body `{ title?: string; finalize?: true; edit?: { segmentId: string; text: string } }` → `ProjectView`；`POST /api/projects/:id/chat` body `{ text: string }` → `text/event-stream` of `AgentEvent`。

- [ ] **Step 1: 写失败测试**

`tests/lib/project/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toProjectView, toMessageView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

describe('toProjectView', () => {
  it('attaches a duration report when script is valid', () => {
    const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(10) })) };
    const v = toProjectView({ id: 'p1', title: 't', stage: 'draft', targetSec: 60, script, updatedAt: new Date('2026-09-27T00:00:00Z') });
    expect(v.report?.totalSec).toBe(12);
    expect(v.updatedAt).toBe('2026-09-27T00:00:00.000Z');
  });
  it('returns null script/report for malformed or empty script', () => {
    const v = toProjectView({ id: 'p1', title: 't', stage: 'draft', targetSec: 60, script: { foo: 1 }, updatedAt: new Date() });
    expect(v.script).toBeNull();
    expect(v.report).toBeNull();
  });
});

describe('toMessageView', () => {
  it('reads ok from toolResult for tool rows', () => {
    expect(toMessageView({ id: 'm1', role: 'tool', content: '改稿', toolName: 'patch_script', toolResult: { ok: false } }).ok).toBe(false);
    expect(toMessageView({ id: 'm2', role: 'user', content: 'hi', toolName: null, toolResult: null }).ok).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/project/view.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/project/view.ts`**

```ts
import { ScriptSchema, type Script } from '@/lib/script/model';
import { checkDuration, type DurationReport } from '@/lib/script/duration';

export interface ProjectView {
  id: string;
  title: string;
  stage: string;
  targetSec: number;
  script: Script | null;
  report: DurationReport | null;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName: string | null;
  ok: boolean | null;
}

export function toProjectView(p: { id: string; title: string; stage: string; targetSec: number; script: unknown; updatedAt: Date }): ProjectView {
  const parsed = ScriptSchema.safeParse(p.script);
  const script = parsed.success ? parsed.data : null;
  return {
    id: p.id,
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script,
    report: script ? checkDuration(script, p.targetSec) : null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toMessageView(m: { id: string; role: string; content: string; toolName: string | null; toolResult: unknown }): MessageView {
  const ok = m.role === 'tool' && m.toolResult && typeof m.toolResult === 'object' ? Boolean((m.toolResult as { ok?: unknown }).ok) : null;
  return { id: m.id, role: m.role as MessageView['role'], content: m.content, toolName: m.toolName, ok };
}
```

- [ ] **Step 4: 实现 `src/app/api/projects/route.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { toProjectView } from '@/lib/project/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  return ok(rows.map(toProjectView));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const persona = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const p = await prisma.project.create({
    data: {
      title: body.title?.trim() || '未命名项目',
      // 经 JSON 往返: 行里的 updatedAt 是 Date, Json 列只收纯 JSON 值
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
    },
  });
  return ok(toProjectView(p));
}
```

- [ ] **Step 5: 实现 `src/app/api/projects/[id]/route.ts`**

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toProjectView, toMessageView } from '@/lib/project/view';
import { ScriptSchema } from '@/lib/script/model';
import { applySegmentEdit } from '@/lib/script/edit';

export const dynamic = 'force-dynamic';

type Ctx = { params: { id: string } };

export async function GET(_req: Request, { params }: Ctx) {
  const p = await prisma.project.findUnique({ where: { id: params.id } });
  if (!p) return fail('项目不存在或已删除', 404);
  const messages = await prisma.chatMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
  return ok({ project: toProjectView(p), messages: messages.map(toMessageView) });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    finalize?: boolean;
    edit?: { segmentId: string; text: string };
  };
  const p = await prisma.project.findUnique({ where: { id: params.id } });
  if (!p) return fail('项目不存在或已删除', 404);

  const data: Prisma.ProjectUpdateInput = {};
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim();

  if (body.edit) {
    const parsed = ScriptSchema.safeParse(p.script);
    if (!parsed.success) return fail('还没有稿子，先让编导写一版', 400);
    try {
      data.script = applySegmentEdit(parsed.data, body.edit.segmentId, body.edit.text) as unknown as Prisma.InputJsonValue;
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 400);
    }
  }

  if (body.finalize) {
    if (!ScriptSchema.safeParse(p.script).success) return fail('还没有稿子，不能定稿', 400);
    data.stage = 'scripted';
  }

  const updated = await prisma.project.update({ where: { id: p.id }, data });
  return ok(toProjectView(updated));
}
```

- [ ] **Step 6: 实现 `src/app/api/projects/[id]/chat/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { getDeepSeekKey } from '@/lib/env';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { createDeepSeekChatModel } from '@/lib/agent/chat-model';
import { runAgentTurn, type AgentEvent } from '@/lib/agent/loop';
import { encodeSse } from '@/lib/agent/sse';
import { SCRIPT_TOOLS } from '@/lib/tools';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return fail('消息是空的', 400);
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  const apiKey = getDeepSeekKey();
  if (!apiKey) return fail('还没配置 DeepSeek key：在项目根目录的 .env 里填 DEEPSEEK_API_KEY，然后重启 npm run dev', 400);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(encodeSse(e)));
      try {
        await runAgentTurn({
          projectId: project.id,
          userText: text,
          db: prisma,
          model: createDeepSeekChatModel(apiKey),
          tools: SCRIPT_TOOLS,
          toolCtx: { projectId: project.id, db: prisma, llm: new DeepSeekTextLLM({ apiKey }) },
          emit,
        });
      } catch (e) {
        emit({ type: 'error', message: `这一轮出错了：${e instanceof Error ? e.message : String(e)}。再发一次试试。` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
```

- [ ] **Step 7: 单测 + typecheck**

Run: `npx vitest run tests/lib/project && npm run typecheck`
Expected: PASS；0 错误。

- [ ] **Step 8: 真机冒烟（用 curl 走一遍 API）**

另开终端跑 `npm run dev`，然后：

```bash
ID=$(curl -s -X POST localhost:3000/api/projects -H 'content-type: application/json' -d '{}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')
echo $ID
curl -sN -X POST localhost:3000/api/projects/$ID/chat -H 'content-type: application/json' -d '{"text":"写一条：让AI当反方挑刺，帮你检查方案漏洞。60秒。"}'
curl -s localhost:3000/api/projects/$ID | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)).data; [d.project.title, d.project.report && d.project.report.totalSec, d.project.report && d.project.report.ok, d.messages.map(m=>m.role).join(",")].join(" | ")'
curl -s -X PATCH localhost:3000/api/projects/$ID -H 'content-type: application/json' -d '{"edit":{"segmentId":"s9","text":"x"}}'
```
Expected:
- 第二条命令流式输出若干 `data: {"type":"text",...}`，其中有 `{"type":"tool","name":"write_script","ok":true,...}`，最后 `{"type":"done"}`。
- 第三条输出形如 `让AI当你的反方 | 58.4 | true | user,tool,assistant`（标题/秒数会不同；`ok` 应为 true，若为 false 须能在对话里看到 agent 说明差多少秒）。
- 第四条返回 `{"success":false,"message":"没有编号为 s9 的段落，可用编号：s1、s2、s3、s4、s5、s6"}`。

- [ ] **Step 9: Commit**

```bash
git add src/lib/project src/app/api tests/lib/project
git commit -m "feat(api): 项目列表/新建/详情/手改定稿 + 编导对话 SSE

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 界面——首页项目列表、项目页左稿右聊

**Files:**
- Replace: `src/app/page.tsx`
- Create: `src/app/projects/[id]/page.tsx`、`src/components/project/new-project-button.tsx`、`src/components/project/project-workspace.tsx`、`src/components/project/script-pane.tsx`、`src/components/project/chat-panel.tsx`
- Test: `tests/components/script-pane.test.tsx`

**Interfaces:**
- Consumes: `ProjectView`、`MessageView`、`toProjectView`、`toMessageView`（Task 8）；`AgentEvent`、`parseSseBuffer`（Task 7）；`ROLE_LABEL`（Task 4）；HTTP 接口（Task 8）。
- Produces（组件 props）：
  - `ScriptPane({ project: ProjectView; highlighted: Set<string>; onEdit(segmentId: string, text: string): Promise<void>; onFinalize(): Promise<void> })`
  - `ChatPanel({ projectId: string; initialMessages: MessageView[]; onTurnEvent(e: AgentEvent): void; onTurnEnd(): void })`
  - `ProjectWorkspace({ initialProject: ProjectView; initialMessages: MessageView[] })`

- [ ] **Step 1: 写失败测试**

`tests/components/script-pane.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScriptPane } from '@/components/project/script-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

const lengths = [30, 67, 67, 187, 67, 22];
const project = toProjectView({
  id: 'p1', title: '让AI当反方', stage: 'draft', targetSec: 60, updatedAt: new Date(),
  script: { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: '字'.repeat(lengths[i]) })) },
});

// vitest 未开 globals, testing-library 不会自动清理, 手动清
afterEach(cleanup);

describe('ScriptPane', () => {
  it('shows total vs target and marks the over-limit segment in plain language', () => {
    render(<ScriptPane project={project} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByText('约 88 秒 / 目标 60 秒')).toBeTruthy();
    expect(screen.getByText('冷知识')).toBeTruthy();
    expect(screen.getByText('37.4 / 11.3 秒 · 超了')).toBeTruthy();
  });

  it('marks highlighted segments as just changed', () => {
    render(<ScriptPane project={project} highlighted={new Set(['s2'])} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getAllByText('刚改').length).toBe(1);
  });

  it('shows an empty state when there is no script', () => {
    const empty = { ...project, script: null, report: null };
    render(<ScriptPane project={empty} highlighted={new Set()} onEdit={vi.fn()} onFinalize={vi.fn()} />);
    expect(screen.getByText('还没有稿子。在右边告诉编导这条想讲什么。')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/script-pane.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/components/project/script-pane.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { ROLE_LABEL } from '@/lib/script/model';
import type { ProjectView } from '@/lib/project/view';
import { cn } from '@/lib/utils';

export function ScriptPane({
  project,
  highlighted,
  onEdit,
  onFinalize,
}: {
  project: ProjectView;
  highlighted: Set<string>;
  onEdit: (segmentId: string, text: string) => Promise<void>;
  onFinalize: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (!project.script || !project.report) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-secondary)]">
        还没有稿子。在右边告诉编导这条想讲什么。
      </div>
    );
  }
  const { script, report } = project;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-6 py-3 text-sm">
        <span className="rounded-md bg-[var(--accent-subtle)] px-2 py-0.5 text-[var(--text-primary)]">① 脚本</span>
        <span className={cn('font-mono', report.ok ? 'text-[var(--success)]' : 'text-[var(--warning)]')}>
          约 {report.totalSec} 秒 / 目标 {report.targetSec} 秒
        </span>
        <div className="flex-1" />
        {project.stage === 'draft' ? (
          <button
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
            onClick={() => void onFinalize()}
          >
            {report.ok ? '定稿' : '时长还超，仍然定稿'}
          </button>
        ) : (
          <span className="text-[var(--text-secondary)]">已定稿 · 录口播的入口在下一阶段加入</span>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-6">
        {script.segments.map((s, i) => {
          const r = report.segments[i];
          const isEditing = editing === s.id;
          return (
            <div
              key={s.id}
              className={cn(
                'rounded-lg border p-4',
                highlighted.has(s.id) ? 'border-[var(--warning)] bg-[var(--warning-subtle)]' : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]',
              )}
            >
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="font-medium text-[var(--text-primary)]">{ROLE_LABEL[s.role]}</span>
                {highlighted.has(s.id) && <span className="text-[var(--warning)]">刚改</span>}
                <div className="flex-1" />
                <span className={cn('font-mono', r.over ? 'text-[var(--danger)]' : 'text-[var(--text-tertiary)]')}>
                  {r.over ? `${r.estSec} / ${r.limitSec} 秒 · 超了` : `${r.estSec} / ${r.budgetSec} 秒`}
                </span>
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    className="h-32 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] p-2 text-sm"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex gap-2 text-sm">
                    <button
                      className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--text-on-accent)]"
                      onClick={async () => {
                        await onEdit(s.id, draft);
                        setEditing(null);
                      }}
                    >
                      保存
                    </button>
                    <button className="px-3 py-1 text-[var(--text-secondary)]" onClick={() => setEditing(null)}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="cursor-text whitespace-pre-wrap text-[15px] leading-7"
                  title="点击直接修改"
                  onClick={() => {
                    setEditing(s.id);
                    setDraft(s.text);
                  }}
                >
                  {s.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行组件测试确认通过**

Run: `npx vitest run tests/components/script-pane.test.tsx`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 实现 `src/components/project/chat-panel.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { MessageView } from '@/lib/project/view';
import { parseSseBuffer } from '@/lib/agent/sse';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';

type Line = { key: string; role: MessageView['role']; content: string; ok: boolean | null };

export function ChatPanel({
  projectId,
  initialMessages,
  onTurnEvent,
  onTurnEnd,
}: {
  projectId: string;
  initialMessages: MessageView[];
  onTurnEvent: (e: AgentEvent) => void;
  onTurnEnd: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => initialMessages.map((m) => ({ key: m.id, role: m.role, content: m.content, ok: m.ok })));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [lines]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    const stamp = Date.now();
    let assistantKey = `a${stamp}`;
    setLines((ls) => [...ls, { key: `u${stamp}`, role: 'user', content: text, ok: null }]);

    const appendText = (delta: string) =>
      setLines((ls) => {
        const last = ls[ls.length - 1];
        if (last?.key === assistantKey) return [...ls.slice(0, -1), { ...last, content: last.content + delta }];
        return [...ls, { key: assistantKey, role: 'assistant', content: delta, ok: null }];
      });

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ message: `请求失败（${res.status}）` }));
        setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: j.message, ok: false }]);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = parseSseBuffer(buffer);
        buffer = rest;
        for (const e of events) {
          onTurnEvent(e);
          if (e.type === 'text') appendText(e.delta);
          if (e.type === 'tool') {
            setLines((ls) => [...ls, { key: `t${Date.now()}${Math.random()}`, role: 'tool', content: e.summary, ok: e.ok }]);
            assistantKey = `a${Date.now()}${Math.random()}`; // 工具之后的文字另起一条
          }
          if (e.type === 'error') setLines((ls) => [...ls, { key: `e${Date.now()}`, role: 'system', content: e.message, ok: false }]);
        }
      }
    } catch (e) {
      setLines((ls) => [...ls, { key: `e${stamp}`, role: 'system', content: `连接中断：${e instanceof Error ? e.message : String(e)}。刷新页面后再发一次。`, ok: false }]);
    } finally {
      setBusy(false);
      onTurnEnd();
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-base)]">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 text-sm font-medium">编导对话</div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
        {lines.length === 0 && (
          <p className="text-[var(--text-tertiary)]">说说这条想讲什么，比如：「让 AI 当反方挑刺，帮你检查方案漏洞，60 秒」。</p>
        )}
        {lines.map((l) =>
          l.role === 'tool' ? (
            <div key={l.key} className={cn('border-l-2 pl-2 text-xs', l.ok ? 'border-[var(--accent)] text-[var(--text-secondary)]' : 'border-[var(--danger)] text-[var(--danger)]')}>
              {l.ok ? '✓' : '✗'} {l.content}
            </div>
          ) : (
            <div
              key={l.key}
              className={cn(
                'whitespace-pre-wrap rounded-lg px-3 py-2',
                l.role === 'user' && 'ml-8 bg-[var(--accent-subtle)]',
                l.role === 'assistant' && 'mr-8 bg-[var(--bg-surface)]',
                l.role === 'system' && 'bg-[var(--danger-subtle)] text-[var(--danger)]',
              )}
            >
              {l.content}
            </div>
          ),
        )}
        {busy && <div className="text-xs text-[var(--text-tertiary)]">编导在想…</div>}
        <div ref={bottom} />
      </div>
      <div className="border-t border-[var(--border-subtle)] p-3">
        <textarea
          className="h-20 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] p-2 text-sm"
          placeholder="和编导说点什么…（Enter 发送，Shift+Enter 换行）"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 实现 `src/components/project/project-workspace.tsx`**

```tsx
'use client';

import { useCallback, useState } from 'react';
import type { MessageView, ProjectView } from '@/lib/project/view';
import type { AgentEvent } from '@/lib/agent/loop';
import { ScriptPane } from './script-pane';
import { ChatPanel } from './chat-panel';

export function ProjectWorkspace({ initialProject, initialMessages }: { initialProject: ProjectView; initialMessages: MessageView[] }) {
  const [project, setProject] = useState(initialProject);
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`);
    const j = await res.json();
    if (j.success) setProject(j.data.project);
  }, [project.id]);

  const patch = useCallback(
    async (body: object) => {
      setError(null);
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.success) setProject(j.data);
      else setError(j.message);
    },
    [project.id],
  );

  const onTurnEvent = useCallback((e: AgentEvent) => {
    if (e.type === 'tool' && e.ok && e.segmentIds.length) {
      setHighlighted((prev) => new Set([...prev, ...e.segmentIds]));
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border-subtle)] px-6 py-3">
        <input
          className="w-full bg-transparent text-base font-semibold outline-none"
          defaultValue={project.title}
          onBlur={(e) => e.target.value.trim() !== project.title && void patch({ title: e.target.value })}
        />
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ScriptPane
            project={project}
            highlighted={highlighted}
            onEdit={async (segmentId, text) => {
              setHighlighted(new Set());
              await patch({ edit: { segmentId, text } });
            }}
            onFinalize={() => patch({ finalize: true })}
          />
        </div>
        <div className="w-[36%] min-w-[340px]">
          <ChatPanel
            projectId={project.id}
            initialMessages={initialMessages}
            onTurnEvent={(e) => {
              if (e.type === 'text' && highlighted.size) setHighlighted(new Set());
              onTurnEvent(e);
            }}
            onTurnEnd={() => void refresh()}
          />
        </div>
      </div>
    </div>
  );
}
```

注：高亮在「新一轮对话开始产出文字」或「手改保存」时清空，工具改动的段落在本轮结束后保持高亮，直到下一轮。

- [ ] **Step 7: 实现 `src/app/projects/[id]/page.tsx`**

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { toMessageView, toProjectView } from '@/lib/project/view';
import { ProjectWorkspace } from '@/components/project/project-workspace';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const p = await prisma.project.findUnique({ where: { id: params.id } });
  if (!p) notFound();
  const messages = await prisma.chatMessage.findMany({ where: { projectId: p.id }, orderBy: { createdAt: 'asc' } });
  return <ProjectWorkspace initialProject={toProjectView(p)} initialMessages={messages.map(toMessageView)} />;
}
```

- [ ] **Step 8: 实现 `src/components/project/new-project-button.tsx`**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewProjectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        disabled={busy}
        className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          const j = await res.json();
          if (j.success) router.push(`/projects/${j.data.id}`);
          else {
            setError(j.message ?? '新建失败');
            setBusy(false);
          }
        }}
      >
        ＋ 新建项目
      </button>
      {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 9: 替换 `src/app/page.tsx`**

```tsx
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { toProjectView } from '@/lib/project/view';
import { NewProjectButton } from '@/components/project/new-project-button';

export const dynamic = 'force-dynamic';

const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿' };

export default async function Home() {
  const projects = (await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } })).map(toProjectView);
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mb-6 flex items-center">
        <h1 className="text-lg font-semibold">项目</h1>
        <div className="flex-1" />
        <NewProjectButton />
      </div>
      {projects.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)]">还没有项目。新建一个，和编导聊聊今天这条讲什么。</p>
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--bg-surface-hover)]">
                <span className="flex-1 truncate text-sm">{p.title}</span>
                <span className="text-xs text-[var(--text-secondary)]">{STAGE_TEXT[p.stage] ?? p.stage}</span>
                <span className="w-24 text-right font-mono text-xs text-[var(--text-tertiary)]">
                  {p.report ? `约 ${p.report.totalSec} 秒` : '无稿'}
                </span>
                <span className="w-28 text-right font-mono text-xs text-[var(--text-tertiary)]">
                  {new Date(p.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 10: 全量测试 + typecheck**

Run: `npm test && npm run typecheck`
Expected: 全绿。

- [ ] **Step 11: 真机浏览器验收（每一项都要亲自点到，不能只看测试）**

`npm run dev` 在跑的情况下，在浏览器里：
1. 打开 `http://localhost:3000`，点「＋ 新建项目」→ 跳到项目页，左边显示「还没有稿子…」，右边对话框有示例提示。
2. 在对话框输入「让 AI 当反方挑刺，帮你检查方案漏洞，60 秒」回车 → 右侧逐字出现回复，出现一条「✓ 写稿：6 段，约 xx 秒」，结束后左侧出现 6 段稿子，全部带「刚改」高亮，顶部标题自动变成模型起的标题，时长显示为绿色（达标）或橙色。
3. 输入「冷知识那段再短一点，只留一个例子」→ 出现「✓ 改稿：第4段「冷知识」a s → b s」，左侧只有第 4 段高亮。
4. 点第 2 段文字 → 变成输入框，改几个字保存 → 该段时长数字更新，高亮清空。
5. 点「定稿」→ 按钮变成「已定稿 · 录口播的入口在下一阶段加入」。回首页，列表显示该项目「已定稿」和秒数。
6. 刷新项目页 → 对话历史（含工具结果行）和稿子都还在。
7. 把 `.env` 的 `DEEPSEEK_API_KEY` 临时改错、重启 dev、发一条消息 → 对话里出现红底人话「编导暂时连不上 DeepSeek（…）。检查 .env 里的 DEEPSEEK_API_KEY 和网络后再发一次。」；改回并重启。
8. 页面上任何位置都不应出现 `s1` 这类段落编号、英文状态码或报错栈。

每一项的结果（通过/不通过 + 截图或现象）记录下来，不通过的修掉再继续。

- [ ] **Step 12: Commit**

```bash
git add src/app src/components/project tests/components
git commit -m "feat(ui): 首页项目列表 + 项目页左稿右聊(流式对话/改动高亮/手改/定稿)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: README 重写、spec 修订、收尾验收

**Files:**
- Replace: `README.md`
- Modify: `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`（§5.2 表数 7 → 8：保留 `DouyinMetricSummary` 存粉丝数等账号当前值）

- [ ] **Step 1: 重写 README.md（整体替换）**

```markdown
# MediaPilot

AI 知识类抖音口播的个人工作台：一条内容 = 一个项目，在项目里和编导 agent 对话把稿子磨好，再录口播、配特效、出成片。

> 2026-09-27 起整体重构（设计见 `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`）。重构前的全部代码在 git tag `v1-final`，旧文档在 `docs/archive/`。

## 现在能做什么

- **项目**：首页新建项目，列表看每条的阶段与时长。
- **编导对话**：项目页右侧和编导 agent 聊，它会写整稿（`write_script`）或只改某一段（`patch_script`）。
- **时长硬约束**：稿子固定 6 段（开场钩子 / 概念A / 概念B / 冷知识 / 知识串联 / 金句收尾），按 5 字/秒估算；超标时 agent 自己修，修不好会如实告诉你差多少秒。
- **手改与定稿**：点任意一段直接改；改动过的段落会高亮。

录口播上传、特效编排、合成成片、首页账号数据、定位页、设置页在后续阶段加入。

## 快速开始

需要：Node 20+、Docker Desktop（建议设为开机自启，数据库容器会跟着自动起来）。

```bash
docker compose up -d        # 只有一个 Postgres
npm install
npx prisma db push          # 首次或改了 schema 后
npm run dev                 # http://localhost:3000
```

改了 `prisma/schema.prisma` 之后必须 `npx prisma generate` 并重启 `npm run dev`。不要在 dev 运行时跑 `npm run build`。

## 环境变量（`.env`）

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | `postgresql://mediapilot:<密码>@localhost:5432/mediapilot_v2`（旧库 `mediapilot` 原样保留作回退） |
| `DEEPSEEK_API_KEY` | 编导 agent 与写稿用 |
| `DB_PASSWORD` | docker-compose 的数据库密码 |
| `PYTHON_BIN` | 本地 Whisper 用的 Python（阶段 3 起用） |

## 每晚回采抖音数据

```bash
sh scripts/install-collect-cron.sh            # 装定时任务(每晚 20:00)
sh scripts/install-collect-cron.sh uninstall  # 卸载
npm run collect:douyin                        # 手动跑一次
```

依赖 ego lite（共享已登录的浏览器状态），全程只读。日志在 `logs/collect-douyin.log`；抓到 0 条会判定为异常并拒绝写库。写入 `PublishedWork`、`DouyinOverviewSnapshot`、`DouyinMetricSummary` 三张表。

## 目录

```
src/app/                 页面与 API（/、/projects/[id]、/api/projects/...）
src/components/project/  项目页组件（稿子栏、对话栏）
src/lib/script/          稿子模型、时长估算、写稿与自修
src/lib/tools/           agent 工具（与界面无关，将来可套 CLI 给外部 agent）
src/lib/agent/           对话循环、上下文、DeepSeek 流式模型
src/lib/overlay-studio/  Overlay Studio 集成层（阶段 4 接入）
scripts/                 回采、旧数据导入、字级对齐
tools/overlay-studio/    外部工具，gitignore，不入库
```

## 测试

```bash
npm test          # vitest
npm run typecheck
```
```

- [ ] **Step 2: 修订 spec §5.2**

把 spec 中 `### 5.2 数据模型（7 张表）` 改为 `### 5.2 数据模型（8 张表）`，并在表格末尾追加一行：

```markdown
| `DouyinMetricSummary` | 账号级当前值（粉丝数等，`metric` 唯一）。实施时发现粉丝数只在这张表里，`DouyinOverviewSnapshot` 没有 |
```

同时把 §7.1 首页那一条里的「顶部账号真实数据（来自回采快照）」改为「顶部账号真实数据（来自 `DouyinOverviewSnapshot` 与 `DouyinMetricSummary`）」。

- [ ] **Step 3: 收尾验收**

Run:
```bash
npm test && npm run typecheck
git grep -nE "userId|bullmq|ioredis|remotion|cockpit" -- src scripts tests prisma package.json
wc -l README.md
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1
```
Expected: 测试与 typecheck 全绿；grep 无输出；README < 120 行；src 总行数远小于重构前（约 42k），记录实际数字。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md
git commit -m "docs: README 重写为一页, spec 修订为 8 张表

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: 交给用户验收**

请用户亲自用一条真实选题走完：新建项目 → 和编导磨稿 → 手改 → 定稿。收集反馈后再写阶段 3 的计划。
