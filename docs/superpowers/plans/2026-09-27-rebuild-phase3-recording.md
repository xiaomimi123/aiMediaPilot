# 重构 阶段 3 实施计划：口播上传、提词器、后台转写

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在项目里新增「② 口播」标签：用提词器照稿录制 → 把录好的视频拖进来 → 后台自动转写并按原稿校对错字 → 标出临场加的话与没讲到的段落，完成后编导对话里出现通知。

**Architecture:** 上传走流式 PUT 直接写盘（`projects/<id>/raw.vN.ext`），不进内存。耗时任务由 web 进程内的执行器跑，状态写 `Job` 表；服务重启后残留的运行中任务标为「已中断」，由用户点「重试」。转写 = ffmpeg 抽音 → 本地 faster-whisper → DeepSeek 按原稿只修错字（逐行编辑距离守门）→ 与稿子做字级 LCS 比对。编导 agent 新增 `transcribe` 工具，上下文带转写摘要。

**Tech Stack:** Next.js 14 App Router、Prisma 5、Node streams、ffmpeg/ffprobe、Python faster-whisper（`PYTHON_BIN`）、DeepSeek、vitest + @testing-library/react。

**Spec:** `docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`（§5.1 进程与依赖、§5.2 `ProjectFile`/`Job`、§5.3 落盘、§6.3 `transcribe` 工具、§6.4 规则、§7.2 ② 口播）

**前置：** 阶段 0～2 已完成（分支 `rebuild/project-agent`，PR #2）。本计划在 `rebuild/phase3` 上执行，该分支从 `rebuild/project-agent` 拉出。

## Global Constraints

- 单进程：不引入 Redis/BullMQ/独立 worker；任务在 web 进程内执行，状态落 `Job` 表。
- 任务失败或中断**绝不自动重跑**，只在界面给「重试」。
- 项目文件根目录：`PROJECT_FILES_ROOT`，默认 `<仓库>/projects`（gitignore）。命名 `raw.v<N>.<ext>`、`transcript.v<N>.json`、`audio.v<N>.wav`（抽音中间件，转写后删除）；转写版本号与视频版本号一致。
- 只接受 `.mp4` / `.mov` / `.m4v`；上传必须流式写盘，失败时删掉半截文件、不留 `ProjectFile` 行。
- 同一项目同一时刻只允许一个运行中的转写任务；有运行中任务时上传返回 409。
- 转写：`LocalWhisperClient`（10 分钟超时），模型由 `WHISPER_MODEL` 决定（默认 small）。
- 校对只修识别错字：每行 `编辑距离 / max(原长, 新长) ≤ 0.34` 才采纳，否则保留原识别；行数不一致或调用失败 → 整体保留原识别，任务不失败。
- 比对阈值：转写行与稿子的字匹配率 < 0.5 记为「临场加的」；稿子段落被讲到的字覆盖率 < 0.3 记为「没讲到」。比对前去掉标点与空白（`[^\p{L}\p{N}]`）。
- `Job.userMessage` 永远是中文「原因 + 怎么办」；原始报错只进 `errorDetail`，界面折叠展示。
- 阶段只前进：转写成功时 `draft`/`scripted` → `recorded`，其他阶段不动。
- 界面不出现内部 id、英文状态码、原始报错栈（`errorDetail` 折叠区除外）。
- 继承阶段 0～2 的约束：DeepSeek key 只从 `.env` 读；不在 dev 运行时跑 `npm run build`；改 schema 后 `prisma generate` 并重启 dev。

## Review Focus

1. **上传中途断开或写盘失败**——应删掉半截文件、不产生 `ProjectFile` 行、不占用版本号。→ Task 1 测试 `saveStreamToFile removes the partial file when the stream errors`。
2. **dev server 在转写中途重启**——任务不能永远卡在「运行中」，应变成「已中断」并可重试。→ Task 2 测试 `marks jobs left running by a previous process as interrupted`。
3. **本机没装好 Python / faster-whisper**——应给出能照做的中文提示，而不是 `spawn ENOENT`。→ Task 5 测试 `whisperErrorMessage maps missing python / missing module / timeout`。
4. **转写里有英文、数字、标点而稿子写法不同**（如「GPT 4o」vs「GPT-4o」）——不应被误判为临场加的。→ Task 3 测试 `ignores punctuation and spacing differences`。
5. **转写没完成时又上传一次**——第二次应被拒绝并说明原因。→ Task 2 测试 `findActiveJob returns the running job`，Task 6 路由用它返回 409。

---

## 文件结构（本计划新增/修改）

```
next.config.js                            清掉 remotion alias 与 playwright 残留
.gitignore                                加 /projects/
src/lib/files/storage.ts                  项目目录、版本化文件名、扩展名校验、流式落盘
src/lib/files/range.ts                    HTTP Range 解析
src/lib/jobs/runner.ts                    startJob / reconcileInterruptedJobs / findActiveJob / JobError
src/lib/jobs/registry.ts                  任务种类注册表 + launchJob(给上传、重试、agent 工具共用)
src/lib/recording/transcript.ts           TranscriptLine / TranscriptFile / loadLatestTranscript
src/lib/recording/compare.ts              与稿子的字级比对(临场加的 / 没讲到)
src/lib/recording/proofread.ts            按原稿校对识别错字(带编辑距离守门)
src/lib/recording/transcribe.ts           转写流水线 runTranscribe + whisperErrorMessage
src/lib/recording/deps.ts                 真实依赖(ffmpeg / LocalWhisperClient / DeepSeek)
src/lib/project/view.ts                   + JobView / RecordingView / MessageView.ok 覆盖 system 行
src/lib/project/load.ts                   loadProjectBundle(页面与 GET 共用)
src/lib/tools/transcribe.ts               transcribe 工具
src/lib/tools/index.ts                    注册 transcribe
src/lib/agent/context.ts                  + 转写摘要、recorded 阶段文案
src/app/api/projects/[id]/route.ts        GET 改用 loadProjectBundle(先 reconcile)
src/app/api/projects/[id]/upload/route.ts PUT 流式上传 → 建文件行 → 启动转写
src/app/api/projects/[id]/files/[fileId]/route.ts  GET 带 Range 的文件读取(视频播放)
src/app/api/projects/[id]/jobs/[jobId]/retry/route.ts  POST 重试
src/app/projects/[id]/page.tsx            改用 loadProjectBundle
src/app/page.tsx                          recorded 阶段文案
src/components/project/teleprompter.tsx   全屏提词器
src/components/project/upload.ts          XHR 上传(带进度)
src/components/project/recording-pane.tsx ② 口播标签页
src/components/project/project-workspace.tsx  标签切换 + 任务轮询 + 通知转发
src/components/project/chat-panel.tsx     incoming 通知 + system 信息样式
src/components/project/script-pane.tsx    去掉顶部「① 脚本」标签(移到工作区)
tests/helpers/fake-db.ts                  + job / projectFile
tests/lib/files/*.test.ts, tests/lib/jobs/runner.test.ts, tests/lib/recording/*.test.ts,
tests/lib/tools/transcribe.test.ts, tests/components/{teleprompter,recording-pane}.test.tsx
README.md                                 口播与转写说明
```

---

### Task 1: 清理残留配置，文件存储与 Range 解析

**Files:**
- Replace: `next.config.js`
- Modify: `.gitignore`
- Create: `src/lib/files/storage.ts`、`src/lib/files/range.ts`
- Test: `tests/lib/files/storage.test.ts`、`tests/lib/files/range.test.ts`

**Interfaces:**
- Produces:
  - `type FileKind = 'raw_video' | 'transcript'`
  - `filesRoot(): string`、`projectDir(projectId: string): string`（非 `[A-Za-z0-9]+` 抛错）
  - `versionedName(kind: FileKind, version: number, ext: string): string`
  - `audioName(version: number): string`
  - `VIDEO_EXTS: readonly string[]`、`videoExt(filename: string): string | null`（返回小写带点扩展名）
  - `saveStreamToFile(stream: NodeJS.ReadableStream, dest: string): Promise<number>`（返回字节数；失败时删掉 dest 并重新抛出）
  - `type ByteRange = { start: number; end: number }`、`parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable'`

- [ ] **Step 1: 清理 `next.config.js`（整体替换）**

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
};

module.exports = nextConfig;
```

- [ ] **Step 2: `.gitignore` 追加**

```
# 重构阶段 3: 项目文件(口播原片、转写), 本机运行时产物, 可能很大
/projects/
```

- [ ] **Step 3: 写失败测试**

`tests/lib/files/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { projectDir, versionedName, audioName, videoExt, saveStreamToFile } from '@/lib/files/storage';

describe('storage names', () => {
  it('builds versioned names per kind', () => {
    expect(versionedName('raw_video', 2, '.mov')).toBe('raw.v2.mov');
    expect(versionedName('transcript', 1, '.json')).toBe('transcript.v1.json');
    expect(audioName(3)).toBe('audio.v3.wav');
  });
  it('rejects project ids that could escape the root', () => {
    expect(() => projectDir('../etc')).toThrow('非法项目编号');
    expect(projectDir('cmuabc123')).toMatch(/cmuabc123$/);
  });
  it('accepts only mp4/mov/m4v, case-insensitive', () => {
    expect(videoExt('口播.MOV')).toBe('.mov');
    expect(videoExt('a.mp4')).toBe('.mp4');
    expect(videoExt('a.avi')).toBeNull();
    expect(videoExt('noext')).toBeNull();
  });
});

describe('saveStreamToFile', () => {
  it('writes the stream and returns the byte count', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-store-'));
    const dest = path.join(dir, 'raw.v1.mp4');
    const n = await saveStreamToFile(Readable.from([Buffer.from('abc'), Buffer.from('de')]), dest);
    expect(n).toBe(5);
    expect(await fs.readFile(dest, 'utf8')).toBe('abcde');
  });
  it('removes the partial file when the stream errors', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-store-'));
    const dest = path.join(dir, 'raw.v1.mp4');
    const broken = new Readable({
      read() {
        this.push(Buffer.from('half'));
        this.destroy(new Error('connection reset'));
      },
    });
    await expect(saveStreamToFile(broken, dest)).rejects.toThrow('connection reset');
    await expect(fs.access(dest)).rejects.toThrow();
  });
});
```

`tests/lib/files/range.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/files/range';

describe('parseRange', () => {
  it('returns null without a header (serve whole file)', () => {
    expect(parseRange(null, 1000)).toBeNull();
  });
  it('parses open-ended and closed ranges, clamping the end', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });
  it('parses suffix ranges', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });
  it('flags ranges starting past the end as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
  });
  it('ignores malformed headers', () => {
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=5-2', 1000)).toBeNull();
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `npx vitest run tests/lib/files`
Expected: FAIL，`Cannot find module '@/lib/files/storage'` / `'@/lib/files/range'`。

- [ ] **Step 5: 实现 `src/lib/files/storage.ts`**

```ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

/** 项目文件(口播原片、转写)落盘位置。每个项目一个目录, 文件名带版本号, 重传不覆盖旧版。 */
export type FileKind = 'raw_video' | 'transcript';

const BASE: Record<FileKind, string> = { raw_video: 'raw', transcript: 'transcript' };

export function filesRoot(): string {
  return process.env.PROJECT_FILES_ROOT || path.join(process.cwd(), 'projects');
}

/** 项目 id 是 cuid(字母数字); 其他形状一律拒绝, 防止路径穿越。 */
export function projectDir(projectId: string): string {
  if (!/^[A-Za-z0-9]+$/.test(projectId)) throw new Error('非法项目编号');
  return path.join(filesRoot(), projectId);
}

export function versionedName(kind: FileKind, version: number, ext: string): string {
  return `${BASE[kind]}.v${version}${ext}`;
}

/** 转写用的抽音中间文件, 转写完成后删除 */
export function audioName(version: number): string {
  return `audio.v${version}.wav`;
}

export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v'] as const;

export function videoExt(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  return (VIDEO_EXTS as readonly string[]).includes(ext) ? ext : null;
}

/** 流式写盘(口播原片动辄上百 MB, 不能整个读进内存)。失败时删掉半截文件再抛出。 */
export async function saveStreamToFile(stream: NodeJS.ReadableStream, dest: string): Promise<number> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await pipeline(stream, createWriteStream(dest));
  } catch (e) {
    await fs.unlink(dest).catch(() => {});
    throw e;
  }
  return (await fs.stat(dest)).size;
}
```

- [ ] **Step 6: 实现 `src/lib/files/range.ts`**

```ts
export type ByteRange = { start: number; end: number };

/**
 * 解析 HTTP Range(视频拖进度条靠它)。
 * null = 没有或看不懂的 Range, 回整个文件; 'unsatisfiable' = 起点越界, 回 416。
 */
export function parseRange(header: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const n = Number(m[2]);
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}
```

- [ ] **Step 7: 运行确认通过 + 全量检查**

Run: `npx vitest run tests/lib/files && npm run typecheck && npm test`
Expected: files 测试 10 个 PASS；typecheck 0 错误；全量测试全绿。

- [ ] **Step 8: dev 冒烟（确认 next.config 清理没破坏页面）**

Run: 在 `npm run dev` 运行中执行 `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/`
Expected: `200`。

- [ ] **Step 9: Commit**

```bash
git add next.config.js .gitignore src/lib/files tests/lib/files
git commit -m "feat(files): 项目文件存储(版本化命名/流式落盘/失败清理) + Range 解析; 清掉 next.config 的 remotion 残留

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 进程内任务执行器

**Files:**
- Replace: `tests/helpers/fake-db.ts`（加 `job`、`projectFile`）
- Create: `src/lib/jobs/runner.ts`
- Test: `tests/lib/jobs/runner.test.ts`

**Interfaces:**
- Consumes: `PrismaClient`（`job`、`chatMessage`）。
- Produces:
  - `class JobError extends Error { userMessage: string; detail?: unknown }`
  - `interface JobContext { jobId: string; projectId: string; db: PrismaClient; progress(p: number): Promise<void> }`
  - `interface JobOutcome { notice: string }`、`type JobRun = (ctx: JobContext) => Promise<JobOutcome>`
  - `BOOT_AT: Date`（进程级，热重载不变）
  - `startJob(db, opts: { projectId: string; kind: string; label: string; run: JobRun }): Promise<{ jobId: string; finished: Promise<void> }>`
  - `reconcileInterruptedJobs(db, bootAt?: Date): Promise<number>`
  - `findActiveJob(db, projectId: string, kind: string): Promise<{ id: string } | null>`
  - 任务结束时写一条 `ChatMessage`：`role: 'system'`、`toolName: 'job:<kind>'`、`toolResult: { ok: boolean }`、`content` = 通知或 userMessage。
  - `createFakeDb` 返回值新增 `jobs`、`files` 数组；seed 新增 `jobs?`、`files?`。

- [ ] **Step 1: 替换 `tests/helpers/fake-db.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * 工具层、对话循环、任务执行器测试用的内存假库 —— 只实现被用到的方法。
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
export interface FakeJob {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  progress: number;
  userMessage: string;
  errorDetail: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface FakeFile {
  id: string;
  projectId: string;
  kind: string;
  path: string;
  meta: unknown;
  version: number;
  createdAt: Date;
}

type JobWhere = { id?: string; projectId?: string; kind?: string; status?: { in: string[] }; updatedAt?: { lt: Date } };

export function createFakeDb(
  seed: {
    project?: Partial<FakeProject>;
    persona?: Record<string, unknown> | null;
    jobs?: Partial<FakeJob>[];
    files?: Partial<FakeFile>[];
  } = {},
) {
  let seq = 0;
  const now = () => new Date(Date.now() + ++seq);
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
  const jobs: FakeJob[] = (seed.jobs ?? []).map((j) => ({
    id: `j${++seq}`,
    projectId: 'p1',
    kind: 'transcribe',
    status: 'queued',
    progress: 0,
    userMessage: '',
    errorDetail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...j,
  }));
  const files: FakeFile[] = (seed.files ?? []).map((f) => ({
    id: `f${++seq}`,
    projectId: 'p1',
    kind: 'raw_video',
    path: '/tmp/none',
    meta: {},
    version: 1,
    createdAt: new Date(),
    ...f,
  }));
  const jobMatch = (j: FakeJob, w: JobWhere) =>
    (!w.id || j.id === w.id) &&
    (!w.projectId || j.projectId === w.projectId) &&
    (!w.kind || j.kind === w.kind) &&
    (!w.status || w.status.in.includes(j.status)) &&
    (!w.updatedAt || j.updatedAt < w.updatedAt.lt);

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
        const m: FakeMessage = { id: `m${++seq}`, content: '', toolName: null, toolInput: null, toolResult: null, createdAt: now(), ...data };
        messages.push(m);
        return m;
      },
      findMany: async ({ where, take }: { where: { projectId: string }; take?: number }) => {
        const rows = messages.filter((m) => m.projectId === where.projectId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
    job: {
      create: async ({ data }: { data: Partial<FakeJob> & { projectId: string; kind: string } }) => {
        const t = now();
        const j: FakeJob = { id: `j${++seq}`, status: 'queued', progress: 0, userMessage: '', errorDetail: null, createdAt: t, updatedAt: t, ...data };
        jobs.push(j);
        return { ...j };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeJob> }) => {
        const j = jobs.find((x) => x.id === where.id);
        if (!j) throw new Error('not found');
        Object.assign(j, data, { updatedAt: now() });
        return { ...j };
      },
      updateMany: async ({ where, data }: { where: JobWhere; data: Partial<FakeJob> }) => {
        const hit = jobs.filter((j) => jobMatch(j, where));
        for (const j of hit) Object.assign(j, data, { updatedAt: now() });
        return { count: hit.length };
      },
      findFirst: async ({ where }: { where: JobWhere }) =>
        jobs.filter((j) => jobMatch(j, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      findMany: async ({ where, take }: { where: JobWhere; take?: number }) => {
        const rows = jobs.filter((j) => jobMatch(j, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? rows.slice(0, take) : rows;
      },
    },
    projectFile: {
      create: async ({ data }: { data: Partial<FakeFile> & { projectId: string; kind: string; path: string } }) => {
        const f: FakeFile = { id: `f${++seq}`, meta: {}, version: 1, createdAt: now(), ...data };
        files.push(f);
        return { ...f };
      },
      findFirst: async ({ where }: { where: { id?: string; projectId?: string; kind?: string } }) =>
        files
          .filter((f) => (!where.id || f.id === where.id) && (!where.projectId || f.projectId === where.projectId) && (!where.kind || f.kind === where.kind))
          .sort((a, b) => b.version - a.version)[0] ?? null,
    },
  };
  return { db: db as unknown as PrismaClient, project, messages, jobs, files };
}
```

- [ ] **Step 2: 写失败测试 `tests/lib/jobs/runner.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { startJob, reconcileInterruptedJobs, findActiveJob, JobError } from '@/lib/jobs/runner';
import { createFakeDb } from '../../helpers/fake-db';

describe('startJob', () => {
  it('runs in the background, marks done, and posts a success notice to chat', async () => {
    const { db, jobs, messages } = createFakeDb();
    // 用闸门卡住任务, 保证检查"运行中"时它确实还没跑完(否则是竞态)
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { jobId, finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async (ctx) => { await ctx.progress(0.5); await gate; return { notice: '转写完成：12 句' }; },
    });
    expect(jobs.find((j) => j.id === jobId)?.status).toBe('running');
    open();
    await finished;
    expect(jobs[0]).toMatchObject({ status: 'done', progress: 1, userMessage: '转写完成：12 句' });
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: '转写完成：12 句', toolName: 'job:transcribe', toolResult: { ok: true } });
  });

  it('uses JobError.userMessage for the user and keeps the detail separately', async () => {
    const { db, jobs, messages } = createFakeDb();
    const { finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async () => { throw new JobError('还没有口播视频，先上传一个再转写。', 'no raw_video row'); },
    });
    await finished;
    expect(jobs[0]).toMatchObject({ status: 'failed', userMessage: '还没有口播视频，先上传一个再转写。', errorDetail: 'no raw_video row' });
    expect(messages.at(-1)).toMatchObject({ role: 'system', content: '还没有口播视频，先上传一个再转写。', toolResult: { ok: false } });
  });

  it('gives a generic plain-Chinese message for unexpected errors, stack goes to detail', async () => {
    const { db, jobs } = createFakeDb();
    const { finished } = await startJob(db, {
      projectId: 'p1', kind: 'transcribe', label: '转写',
      run: async () => { throw new TypeError('Cannot read properties of undefined'); },
    });
    await finished;
    expect(jobs[0].userMessage).toBe('转写没完成：出了意外错误。点「重试」再跑一次，还不行就把详情发给我。');
    expect(jobs[0].errorDetail).toContain('TypeError: Cannot read properties of undefined');
  });
});

describe('reconcileInterruptedJobs', () => {
  it('marks jobs left running by a previous process as interrupted', async () => {
    const boot = new Date('2026-09-27T10:00:00Z');
    const { db, jobs } = createFakeDb({
      jobs: [
        { status: 'running', updatedAt: new Date('2026-09-27T09:59:00Z') },
        { status: 'running', updatedAt: new Date('2026-09-27T10:00:05Z') },
        { status: 'done', updatedAt: new Date('2026-09-27T09:00:00Z') },
      ],
    });
    expect(await reconcileInterruptedJobs(db, boot)).toBe(1);
    expect(jobs.map((j) => j.status)).toEqual(['interrupted', 'running', 'done']);
    expect(jobs[0].userMessage).toBe('服务重启打断了这个任务，点「重试」重新跑。');
  });
});

describe('findActiveJob', () => {
  it('returns the running job and ignores finished ones', async () => {
    const { db } = createFakeDb({ jobs: [{ status: 'done' }, { status: 'running' }] });
    expect(await findActiveJob(db, 'p1', 'transcribe')).not.toBeNull();
    const empty = createFakeDb({ jobs: [{ status: 'failed' }] });
    expect(await findActiveJob(empty.db, 'p1', 'transcribe')).toBeNull();
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/jobs`
Expected: FAIL，`Cannot find module '@/lib/jobs/runner'`。

- [ ] **Step 4: 实现 `src/lib/jobs/runner.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

/**
 * 进程内任务执行器(spec §5.1): 不要 Redis/worker, 任务在 web 进程里跑, 状态落 Job 表。
 * 代价是热重载或重启会打断任务 —— 用 reconcileInterruptedJobs 把残留的标成"已中断",
 * 由用户点重试, 绝不自动重跑。
 */

/** 给用户看的失败原因(中文, 原因 + 怎么办); detail 只进 errorDetail。 */
export class JobError extends Error {
  constructor(
    public userMessage: string,
    public detail?: unknown,
  ) {
    super(userMessage);
  }
}

export interface JobContext {
  jobId: string;
  projectId: string;
  db: PrismaClient;
  progress(p: number): Promise<void>;
}
export interface JobOutcome {
  notice: string;
}
export type JobRun = (ctx: JobContext) => Promise<JobOutcome>;

// 挂在 globalThis 上: 热重载会重新执行本模块, 但同一进程里的启动时间不能变,
// 否则正在跑的任务会被误判成"上个进程留下的"
const g = globalThis as unknown as { __mpBootAt?: Date };
export const BOOT_AT: Date = (g.__mpBootAt ??= new Date());

const detailOf = (e: unknown): string =>
  e instanceof JobError ? (e.detail instanceof Error ? e.detail.stack ?? e.detail.message : String(e.detail ?? '')) : e instanceof Error ? e.stack ?? e.message : String(e);

export async function startJob(
  db: PrismaClient,
  opts: { projectId: string; kind: string; label: string; run: JobRun },
): Promise<{ jobId: string; finished: Promise<void> }> {
  const job = await db.job.create({ data: { projectId: opts.projectId, kind: opts.kind, status: 'running', progress: 0 } });
  const ctx: JobContext = {
    jobId: job.id,
    projectId: opts.projectId,
    db,
    progress: async (p) => {
      await db.job.update({ where: { id: job.id }, data: { progress: Math.max(0, Math.min(1, p)) } });
    },
  };
  const post = (content: string, ok: boolean) =>
    db.chatMessage.create({ data: { projectId: opts.projectId, role: 'system', content, toolName: `job:${opts.kind}`, toolResult: { ok } } });

  const finished = (async () => {
    try {
      const out = await opts.run(ctx);
      await db.job.update({ where: { id: job.id }, data: { status: 'done', progress: 1, userMessage: out.notice } });
      await post(out.notice, true);
    } catch (e) {
      const userMessage =
        e instanceof JobError ? e.userMessage : `${opts.label}没完成：出了意外错误。点「重试」再跑一次，还不行就把详情发给我。`;
      try {
        await db.job.update({ where: { id: job.id }, data: { status: 'failed', userMessage, errorDetail: detailOf(e) } });
        await post(userMessage, false);
      } catch (inner) {
        console.error('[job] 写失败状态时出错', inner);
      }
    }
  })();
  return { jobId: job.id, finished };
}

export async function reconcileInterruptedJobs(db: PrismaClient, bootAt: Date = BOOT_AT): Promise<number> {
  const r = await db.job.updateMany({
    where: { status: { in: ['queued', 'running'] }, updatedAt: { lt: bootAt } },
    data: { status: 'interrupted', userMessage: '服务重启打断了这个任务，点「重试」重新跑。' },
  });
  return r.count;
}

export async function findActiveJob(db: PrismaClient, projectId: string, kind: string): Promise<{ id: string } | null> {
  return db.job.findFirst({ where: { projectId, kind, status: { in: ['queued', 'running'] } }, select: { id: true } });
}
```

注：假库的 `findFirst` 忽略 `select`，返回整行，测试只判空/非空。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/lib/jobs && npm run typecheck && npm test`
Expected: runner 5 个 PASS；0 类型错误；全量全绿（旧测试不受假库扩展影响）。

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/runner.ts tests/lib/jobs tests/helpers/fake-db.ts
git commit -m "feat(jobs): 进程内任务执行器(中文失败原因/重启后标记中断/单项目单任务检测)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 转写数据形状与「和稿子比对」

**Files:**
- Create: `src/lib/recording/transcript.ts`、`src/lib/recording/compare.ts`
- Test: `tests/lib/recording/compare.test.ts`、`tests/lib/recording/transcript.test.ts`

**Interfaces:**
- Consumes: `Script`、`ROLE_LABEL`、`SegmentRole`（`src/lib/script/model.ts`）。
- Produces:
  - `interface TranscriptLine { startSec: number; endSec: number; text: string }`
  - `interface TranscriptFile { lines: TranscriptLine[]; rawLines: TranscriptLine[]; durationSec: number; proofread: 'done' | 'skipped' | 'failed' }`
  - `TranscriptFileSchema: z.ZodType<TranscriptFile>`
  - `loadLatestTranscript(db: PrismaClient, projectId: string): Promise<{ fileId: string; version: number; data: TranscriptFile } | null>`（文件丢失或格式不对返回 null）
  - `ADLIB_THRESHOLD = 0.5`、`SKIP_THRESHOLD = 0.3`
  - `interface ScriptComparison { lines: { index: number; matchRatio: number; adlib: boolean }[]; segments: { id: string; role: SegmentRole; coverage: number; skipped: boolean }[]; adlibCount: number; skippedCount: number }`
  - `compareWithScript(script: Script, lines: TranscriptLine[]): ScriptComparison`

- [ ] **Step 1: 写失败测试**

`tests/lib/recording/compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compareWithScript } from '@/lib/recording/compare';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const texts = ['你敢不敢让AI骂你的方案', '大多数人只让它帮忙写', '换个说法让它当评审', '模型会顺着你说', '所以要逼它挑刺', '方案是被骂出来的'];
const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: texts[i] })) };
const line = (text: string, i: number) => ({ startSec: i * 3, endSec: i * 3 + 3, text });

describe('compareWithScript', () => {
  it('reports nothing when the recording follows the script', () => {
    const r = compareWithScript(script, texts.map(line));
    expect(r.adlibCount).toBe(0);
    expect(r.skippedCount).toBe(0);
  });

  it('flags a line that is not in the script as adlib', () => {
    const r = compareWithScript(script, [...texts.map(line), line('对了上周我还去爬了趟山', 6)]);
    expect(r.lines.at(-1)).toMatchObject({ adlib: true });
    expect(r.adlibCount).toBe(1);
  });

  it('flags a segment that was never spoken as skipped', () => {
    const spoken = texts.filter((_, i) => i !== 3).map(line);
    const r = compareWithScript(script, spoken);
    expect(r.segments.find((s) => s.id === 's4')).toMatchObject({ skipped: true, role: 'fact' });
    expect(r.skippedCount).toBe(1);
  });

  it('ignores punctuation and spacing differences', () => {
    const s: Script = { segments: script.segments.map((seg, i) => (i === 0 ? { ...seg, text: 'GPT-4o 涨价了，你慌不慌？' } : seg)) };
    const r = compareWithScript(s, [line('GPT 4o涨价了 你慌不慌', 0), ...texts.slice(1).map((t, i) => line(t, i + 1))]);
    expect(r.lines[0].adlib).toBe(false);
    expect(r.adlibCount).toBe(0);
  });
});
```

`tests/lib/recording/transcript.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadLatestTranscript } from '@/lib/recording/transcript';
import { createFakeDb } from '../../helpers/fake-db';

describe('loadLatestTranscript', () => {
  it('reads the newest transcript file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-tr-'));
    const p = path.join(dir, 'transcript.v2.json');
    await fs.writeFile(p, JSON.stringify({ lines: [{ startSec: 0, endSec: 1, text: '你好' }], rawLines: [], durationSec: 1, proofread: 'done' }));
    const { db } = createFakeDb({ files: [{ kind: 'transcript', path: '/nope', version: 1 }, { kind: 'transcript', path: p, version: 2 }] });
    const t = await loadLatestTranscript(db, 'p1');
    expect(t?.version).toBe(2);
    expect(t?.data.lines[0].text).toBe('你好');
  });
  it('returns null when the file is missing on disk', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'transcript', path: '/definitely/missing.json', version: 1 }] });
    expect(await loadLatestTranscript(db, 'p1')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/recording`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/recording/transcript.ts`**

```ts
import fs from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

export interface TranscriptLine {
  startSec: number;
  endSec: number;
  text: string;
}

export interface TranscriptFile {
  /** 校对后的逐句(界面与后续特效编排都用这份) */
  lines: TranscriptLine[];
  /** whisper 原始识别, 留作对照 */
  rawLines: TranscriptLine[];
  durationSec: number;
  proofread: 'done' | 'skipped' | 'failed';
}

const LineSchema = z.object({ startSec: z.number(), endSec: z.number(), text: z.string() });
export const TranscriptFileSchema: z.ZodType<TranscriptFile> = z.object({
  lines: z.array(LineSchema),
  rawLines: z.array(LineSchema),
  durationSec: z.number(),
  proofread: z.enum(['done', 'skipped', 'failed']),
});

export async function loadLatestTranscript(
  db: PrismaClient,
  projectId: string,
): Promise<{ fileId: string; version: number; data: TranscriptFile } | null> {
  const f = await db.projectFile.findFirst({ where: { projectId, kind: 'transcript' }, orderBy: { version: 'desc' } });
  if (!f) return null;
  try {
    const parsed = TranscriptFileSchema.safeParse(JSON.parse(await fs.readFile(f.path, 'utf8')));
    return parsed.success ? { fileId: f.id, version: f.version, data: parsed.data } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 实现 `src/lib/recording/compare.ts`**

```ts
import type { Script, SegmentRole } from '@/lib/script/model';
import type { TranscriptLine } from './transcript';

/** 转写行里能在稿子中对上的字不到一半 → 临场加的 */
export const ADLIB_THRESHOLD = 0.5;
/** 稿子段落里被讲到的字不到三成 → 没讲到 */
export const SKIP_THRESHOLD = 0.3;

export interface ScriptComparison {
  lines: { index: number; matchRatio: number; adlib: boolean }[];
  segments: { id: string; role: SegmentRole; coverage: number; skipped: boolean }[];
  adlibCount: number;
  skippedCount: number;
}

/** 只留字母与数字(含汉字), 标点空白不参与比对 */
const chars = (s: string) => Array.from(s.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase());

/**
 * 字级最长公共子序列: 录音是照着稿子念的, 顺序大体一致, LCS 能把"对得上的字"找出来,
 * 剩下的就是临场加的话(转写侧)与没讲到的内容(稿子侧)。
 */
export function compareWithScript(script: Script, lines: TranscriptLine[]): ScriptComparison {
  const a: number[] = []; // 稿子每个字属于第几段
  const aChars: string[] = [];
  script.segments.forEach((s, si) => chars(s.text).forEach((c) => (aChars.push(c), a.push(si))));
  const b: number[] = []; // 转写每个字属于第几行
  const bChars: string[] = [];
  lines.forEach((l, li) => chars(l.text).forEach((c) => (bChars.push(c), b.push(li))));

  const n = aChars.length;
  const m = bChars.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = aChars[i] === bChars[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  const aHit = new Uint8Array(n);
  const bHit = new Uint8Array(m);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (aChars[i] === bChars[j]) {
      aHit[i] = 1;
      bHit[j] = 1;
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) i++;
    else j++;
  }

  const lineTotals = lines.map(() => [0, 0]);
  b.forEach((li, k) => {
    lineTotals[li][0]++;
    lineTotals[li][1] += bHit[k];
  });
  const segTotals = script.segments.map(() => [0, 0]);
  a.forEach((si, k) => {
    segTotals[si][0]++;
    segTotals[si][1] += aHit[k];
  });

  const lineResults = lines.map((_, index) => {
    const [total, hit] = lineTotals[index];
    const matchRatio = total === 0 ? 1 : hit / total;
    return { index, matchRatio, adlib: matchRatio < ADLIB_THRESHOLD };
  });
  const segResults = script.segments.map((s, si) => {
    const [total, hit] = segTotals[si];
    const coverage = total === 0 ? 1 : hit / total;
    return { id: s.id, role: s.role, coverage, skipped: coverage < SKIP_THRESHOLD };
  });
  return {
    lines: lineResults,
    segments: segResults,
    adlibCount: lineResults.filter((l) => l.adlib).length,
    skippedCount: segResults.filter((s) => s.skipped).length,
  };
}
```

注：`Uint16Array` 单格上限 65535，足够（稿子与转写都在几千字以内）。

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run tests/lib/recording && npm run typecheck`
Expected: 6 个 PASS；0 错误。

- [ ] **Step 6: Commit**

```bash
git add src/lib/recording tests/lib/recording
git commit -m "feat(recording): 转写文件格式与读取 + 与稿子的字级比对(临场加的/没讲到)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 按原稿校对识别错字

**Files:**
- Create: `src/lib/recording/proofread.ts`
- Test: `tests/lib/recording/proofread.test.ts`

**Interfaces:**
- Consumes: `StructuredLLM`（`src/lib/script/write.ts`）、`Script`、`ROLE_LABEL`、`TranscriptLine`（Task 3）。
- Produces:
  - `editDistance(a: string, b: string): number`
  - `MAX_CORRECTION_RATIO = 0.34`
  - `acceptCorrection(orig: string, fixed: string): string`
  - `type ProofreadResult = { lines: TranscriptLine[]; status: 'done' | 'skipped' | 'failed'; changed: number }`
  - `proofreadLines(llm: StructuredLLM, script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult>`

- [ ] **Step 1: 写失败测试 `tests/lib/recording/proofread.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { editDistance, acceptCorrection, proofreadLines } from '@/lib/recording/proofread';
import type { StructuredLLM } from '@/lib/script/write';
import { SEGMENT_ROLES, type Script } from '@/lib/script/model';

const script: Script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段，今天讲赛道和类目第一` })) };
const lines = [
  { startSec: 0, endSec: 2, text: '今天讲室看' },
  { startSec: 2, endSec: 4, text: '做到LAM第一' },
];
const llmReturning = (value: unknown): StructuredLLM => ({
  callStructured: (async () => {
    if (value instanceof Error) throw value;
    return { result: value, usage: { model: 'fake', promptTokens: 0, completionTokens: 0, estCostUSD: 0 } };
  }) as unknown as StructuredLLM['callStructured'],
});

describe('editDistance / acceptCorrection', () => {
  it('computes Levenshtein distance', () => {
    expect(editDistance('今天讲室看', '今天讲赛道')).toBe(2);
    expect(editDistance('', 'ab')).toBe(2);
  });
  it('accepts a small word-level fix', () => {
    expect(acceptCorrection('今天讲室看', '今天讲赛道')).toBe('今天讲赛道');
  });
  it('rejects a rewrite and keeps what was actually said', () => {
    expect(acceptCorrection('今天讲室看', '我们今天来深入聊一聊赛道选择')).toBe('今天讲室看');
  });
  it('rejects an empty correction', () => {
    expect(acceptCorrection('今天讲室看', '  ')).toBe('今天讲室看');
  });
});

describe('proofreadLines', () => {
  it('applies accepted fixes and counts them, keeping timestamps', async () => {
    const r = await proofreadLines(llmReturning({ lines: ['今天讲赛道', '做到类目第一'] }), script, lines);
    expect(r.status).toBe('done');
    expect(r.changed).toBe(2);
    expect(r.lines).toEqual([
      { startSec: 0, endSec: 2, text: '今天讲赛道' },
      { startSec: 2, endSec: 4, text: '做到类目第一' },
    ]);
  });
  it('keeps the raw lines when the model returns a different line count', async () => {
    const r = await proofreadLines(llmReturning({ lines: ['只有一行'] }), script, lines);
    expect(r).toMatchObject({ status: 'failed', changed: 0, lines });
  });
  it('keeps the raw lines when the call fails', async () => {
    const r = await proofreadLines(llmReturning(new Error('timeout')), script, lines);
    expect(r).toMatchObject({ status: 'failed', lines });
  });
  it('skips when there is no script to compare with', async () => {
    const r = await proofreadLines(llmReturning({ lines: [] }), null, lines);
    expect(r).toMatchObject({ status: 'skipped', lines });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/recording/proofread.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/recording/proofread.ts`**

```ts
import { z } from 'zod';
import type { StructuredLLM } from '@/lib/script/write';
import { ROLE_LABEL, type Script } from '@/lib/script/model';
import type { TranscriptLine } from './transcript';

/**
 * 按原稿校对识别错字。本地 whisper 会把"赛道"听成"室看"、"类目第一"听成"LAM第一",
 * 而转写会变成字幕上片。校对只修错字, 不能把说话人的临场发挥改回稿子原文 ——
 * 所以每一行的修改幅度用编辑距离守门, 改动太大就当它在"重写", 保留原识别。
 */
export const MAX_CORRECTION_RATIO = 0.34;

export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

export function acceptCorrection(orig: string, fixed: string): string {
  const f = fixed.trim();
  if (!f) return orig;
  const ratio = editDistance(orig, f) / Math.max(Array.from(orig).length, Array.from(f).length, 1);
  return ratio <= MAX_CORRECTION_RATIO ? f : orig;
}

export type ProofreadResult = { lines: TranscriptLine[]; status: 'done' | 'skipped' | 'failed'; changed: number };

const ProofreadSchema = z.object({ lines: z.array(z.string()) });

const SYSTEM_PROMPT = `你是口播转写的校对员。给你一份语音识别结果（逐行，带行号）和博主的原稿。
只修正识别错的字词：同音字、专有名词、英文名、数字写法。
不改说话人的原话、口头禅、语气词和临场发挥，不把原话改回原稿，不增删句子。
只输出 JSON：{"lines": ["第1行校对后", "第2行校对后", ...]}，行数必须与输入完全一致。`;

export async function proofreadLines(llm: StructuredLLM, script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult> {
  if (!script || lines.length === 0) return { lines, status: 'skipped', changed: 0 };
  const scriptText = script.segments.map((s) => `${ROLE_LABEL[s.role]}：${s.text}`).join('\n');
  const input = lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n');
  try {
    const { result } = await llm.callStructured({
      systemPrompt: SYSTEM_PROMPT,
      userMessage: [{ type: 'text', text: `【原稿】\n${scriptText}\n\n【识别结果，共 ${lines.length} 行】\n${input}` }],
      responseSchema: ProofreadSchema,
    });
    if (result.lines.length !== lines.length) return { lines, status: 'failed', changed: 0 };
    let changed = 0;
    const out = lines.map((l, i) => {
      const text = acceptCorrection(l.text, result.lines[i]);
      if (text !== l.text) changed++;
      return { ...l, text };
    });
    return { lines: out, status: 'done', changed };
  } catch {
    return { lines, status: 'failed', changed: 0 };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/lib/recording && npm run typecheck`
Expected: 全部 PASS；0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/lib/recording/proofread.ts tests/lib/recording/proofread.test.ts
git commit -m "feat(recording): 按原稿校对识别错字(逐行编辑距离守门, 不改临场发挥)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 转写流水线与任务注册表

**Files:**
- Create: `src/lib/recording/transcribe.ts`、`src/lib/recording/deps.ts`、`src/lib/jobs/registry.ts`
- Test: `tests/lib/recording/transcribe.test.ts`

**Interfaces:**
- Consumes: `JobContext`、`JobOutcome`、`JobError`、`startJob`（Task 2）；`versionedName`、`audioName`（Task 1）；`TranscriptLine`、`TranscriptFile`（Task 3）；`compareWithScript`（Task 3）；`ProofreadResult`、`proofreadLines`（Task 4）；`ScriptSchema`、`Script`；`extractAudio`（`src/lib/video/ffmpeg.ts`）；`LocalWhisperClient`（`src/lib/llm/local-whisper.ts`，返回 `{ segments: {startSec,endSec,text}[], durationSec }`）；`getDeepSeekKey`；`DeepSeekTextLLM`。
- Produces:
  - `interface TranscribeDeps { extractAudio(videoPath: string, audioPath: string): Promise<void>; transcribeAudio(audioPath: string): Promise<{ segments: TranscriptLine[]; durationSec: number }>; proofread(script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult> }`
  - `whisperErrorMessage(e: unknown): string`
  - `runTranscribe(ctx: JobContext, deps: TranscribeDeps): Promise<JobOutcome>`
  - `createTranscribeDeps(): TranscribeDeps`（`deps.ts`）
  - `JOB_KINDS: { transcribe: { label: '转写'; run: JobRun } }`、`type JobKind = keyof typeof JOB_KINDS`、`isJobKind(k: string): k is JobKind`
  - `launchJob(db: PrismaClient, projectId: string, kind: JobKind): Promise<{ jobId: string; finished: Promise<void> }>`

- [ ] **Step 1: 写失败测试 `tests/lib/recording/transcribe.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTranscribe, whisperErrorMessage, type TranscribeDeps } from '@/lib/recording/transcribe';
import { JobError, type JobContext } from '@/lib/jobs/runner';
import { SEGMENT_ROLES } from '@/lib/script/model';
import { createFakeDb } from '../../helpers/fake-db';

const texts = ['你敢不敢让AI骂你的方案', '大多数人只让它帮忙写', '换个说法让它当评审', '模型会顺着你说', '所以要逼它挑刺', '方案是被骂出来的'];
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: texts[i] })) };

async function setup(opts: { stage?: string; withVideo?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-tx-'));
  const video = path.join(dir, 'raw.v2.mov');
  await fs.writeFile(video, 'fake');
  const fake = createFakeDb({
    project: { script, stage: opts.stage ?? 'scripted' },
    files: opts.withVideo === false ? [] : [{ kind: 'raw_video', path: video, version: 2 }],
  });
  const progress: number[] = [];
  const ctx: JobContext = { jobId: 'j1', projectId: 'p1', db: fake.db, progress: async (p) => void progress.push(p) };
  return { ...fake, ctx, dir, progress };
}

const okDeps = (spoken: string[]): TranscribeDeps => ({
  extractAudio: async (_v, audio) => fs.writeFile(audio, 'wav'),
  transcribeAudio: async () => ({ segments: spoken.map((t, i) => ({ startSec: i * 3, endSec: i * 3 + 3, text: t })), durationSec: spoken.length * 3 }),
  proofread: async (_s, lines) => ({ lines, status: 'done', changed: 1 }),
});

describe('runTranscribe', () => {
  it('writes transcript.v<N>.json next to the video, records the file, advances the stage, removes the audio', async () => {
    const { ctx, dir, files, project, progress } = await setup();
    const out = await runTranscribe(ctx, okDeps(texts));
    const t = files.find((f) => f.kind === 'transcript')!;
    expect(t).toMatchObject({ version: 2, path: path.join(dir, 'transcript.v2.json') });
    const saved = JSON.parse(await fs.readFile(t.path, 'utf8'));
    expect(saved).toMatchObject({ durationSec: 18, proofread: 'done' });
    expect(saved.lines).toHaveLength(6);
    expect(project.stage).toBe('recorded');
    await expect(fs.access(path.join(dir, 'audio.v2.wav'))).rejects.toThrow();
    expect(progress).toEqual([0.1, 0.8, 0.95]);
    expect(out.notice).toBe('转写完成：6 句，约 18 秒，校对改了 1 处识别错字。和稿子基本一致。');
  });

  it('reports adlib lines and skipped segments in the notice', async () => {
    const { ctx } = await setup();
    const spoken = [...texts.filter((_, i) => i !== 3), '对了上周我还去爬了趟山'];
    const out = await runTranscribe(ctx, okDeps(spoken));
    expect(out.notice).toContain('和稿子比：1 句是临场加的，1 段没讲到。');
  });

  it('does not move a project backwards', async () => {
    const { ctx, project } = await setup({ stage: 'final' });
    await runTranscribe(ctx, okDeps(texts));
    expect(project.stage).toBe('final');
  });

  it('fails with a readable message when no video was uploaded', async () => {
    const { ctx } = await setup({ withVideo: false });
    await expect(runTranscribe(ctx, okDeps(texts))).rejects.toMatchObject({ userMessage: '还没有口播视频，先上传一个再转写。' });
  });

  it('wraps whisper failures in a JobError with the mapped message', async () => {
    const { ctx } = await setup();
    const deps = { ...okDeps(texts), transcribeAudio: async () => { throw Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }); } };
    const err = await runTranscribe(ctx, deps).catch((e) => e);
    expect(err).toBeInstanceOf(JobError);
    expect(err.userMessage).toContain('找不到 Python');
  });

  it('mentions when proofreading failed but still succeeds', async () => {
    const { ctx } = await setup();
    const deps = { ...okDeps(texts), proofread: async (_s: unknown, lines: never[]) => ({ lines, status: 'failed' as const, changed: 0 }) };
    const out = await runTranscribe(ctx, deps);
    expect(out.notice).toContain('（自动校对没成功，用的是原始识别结果）');
  });
});

describe('whisperErrorMessage', () => {
  it('maps missing python / missing module / timeout', () => {
    expect(whisperErrorMessage(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toContain('找不到 Python');
    expect(whisperErrorMessage(new Error("ModuleNotFoundError: No module named 'faster_whisper'"))).toContain('pip install faster-whisper');
    expect(whisperErrorMessage(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))).toContain('超时');
    expect(whisperErrorMessage(new Error('boom'))).toBe('本地转写出错了。点「重试」再跑一次，还不行就把详情发给我。');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/recording/transcribe.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/recording/transcribe.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { JobError, type JobContext, type JobOutcome } from '@/lib/jobs/runner';
import { versionedName, audioName } from '@/lib/files/storage';
import { ScriptSchema, type Script } from '@/lib/script/model';
import type { TranscriptFile, TranscriptLine } from './transcript';
import type { ProofreadResult } from './proofread';
import { compareWithScript } from './compare';

export interface TranscribeDeps {
  extractAudio(videoPath: string, audioPath: string): Promise<void>;
  transcribeAudio(audioPath: string): Promise<{ segments: TranscriptLine[]; durationSec: number }>;
  proofread(script: Script | null, lines: TranscriptLine[]): Promise<ProofreadResult>;
}

export function whisperErrorMessage(e: unknown): string {
  const err = e as { code?: string; killed?: boolean; signal?: string; message?: string; stderr?: string };
  const text = `${err?.message ?? ''}\n${err?.stderr ?? ''}`;
  if (err?.code === 'ENOENT') return '本地转写没装好：找不到 Python（.env 里的 PYTHON_BIN）。装好后点「重试」。';
  if (/No module named ['"]?faster_whisper/.test(text)) return '本地转写没装好：缺 faster-whisper。在 PYTHON_BIN 对应的环境里运行 pip install faster-whisper，然后点「重试」。';
  if (err?.killed || err?.signal === 'SIGTERM') return '转写超时（超过 10 分钟）。视频可能太长，剪短一点重新上传。';
  return '本地转写出错了。点「重试」再跑一次，还不行就把详情发给我。';
}

/** 阶段只前进: 只有写稿中/已定稿会进到已录制 */
const ADVANCE_FROM = ['draft', 'scripted'];

export async function runTranscribe(ctx: JobContext, deps: TranscribeDeps): Promise<JobOutcome> {
  const video = await ctx.db.projectFile.findFirst({
    where: { projectId: ctx.projectId, kind: 'raw_video' },
    orderBy: { version: 'desc' },
  });
  if (!video) throw new JobError('还没有口播视频，先上传一个再转写。', 'no raw_video row');

  const dir = path.dirname(video.path);
  const audio = path.join(dir, audioName(video.version));
  try {
    await deps.extractAudio(video.path, audio);
  } catch (e) {
    throw new JobError('从视频里提取声音失败：视频可能损坏或没有音轨。换一个文件重新上传试试。', e);
  }
  await ctx.progress(0.1);

  let result: { segments: TranscriptLine[]; durationSec: number };
  try {
    result = await deps.transcribeAudio(audio);
  } catch (e) {
    throw new JobError(whisperErrorMessage(e), e);
  } finally {
    await fs.unlink(audio).catch(() => {});
  }
  await ctx.progress(0.8);

  const project = await ctx.db.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
  const parsed = ScriptSchema.safeParse(project.script);
  const script = parsed.success ? parsed.data : null;
  const pr = await deps.proofread(script, result.segments);
  await ctx.progress(0.95);

  const file: TranscriptFile = { lines: pr.lines, rawLines: result.segments, durationSec: result.durationSec, proofread: pr.status };
  const tPath = path.join(dir, versionedName('transcript', video.version, '.json'));
  await fs.writeFile(tPath, JSON.stringify(file, null, 2));
  await ctx.db.projectFile.create({
    data: {
      projectId: ctx.projectId,
      kind: 'transcript',
      path: tPath,
      version: video.version,
      meta: { lineCount: pr.lines.length, proofread: pr.status, changed: pr.changed } as Prisma.InputJsonValue,
    },
  });
  if (ADVANCE_FROM.includes(project.stage)) {
    await ctx.db.project.update({ where: { id: ctx.projectId }, data: { stage: 'recorded' } });
  }

  const parts = [`转写完成：${pr.lines.length} 句，约 ${Math.round(result.durationSec)} 秒`];
  if (pr.status === 'done' && pr.changed > 0) parts.push(`，校对改了 ${pr.changed} 处识别错字`);
  if (pr.status === 'failed') parts.push('（自动校对没成功，用的是原始识别结果）');
  parts.push('。');
  if (script) {
    const cmp = compareWithScript(script, pr.lines);
    parts.push(
      cmp.adlibCount || cmp.skippedCount
        ? `和稿子比：${cmp.adlibCount} 句是临场加的，${cmp.skippedCount} 段没讲到。`
        : '和稿子基本一致。',
    );
  }
  return { notice: parts.join('') };
}
```

- [ ] **Step 4: 实现 `src/lib/recording/deps.ts`**

```ts
import { extractAudio } from '@/lib/video/ffmpeg';
import { LocalWhisperClient } from '@/lib/llm/local-whisper';
import { DeepSeekTextLLM } from '@/lib/llm/deepseek';
import { getDeepSeekKey } from '@/lib/env';
import { proofreadLines } from './proofread';
import type { TranscribeDeps } from './transcribe';

/** 真实依赖。没配 DeepSeek key 时跳过校对(转写照常完成)。 */
export function createTranscribeDeps(): TranscribeDeps {
  const whisper = new LocalWhisperClient();
  return {
    extractAudio: (videoPath, audioPath) => extractAudio({ videoPath, audioPath }),
    transcribeAudio: async (audioPath) => {
      const r = await whisper.transcribe(audioPath);
      return { segments: r.segments, durationSec: r.durationSec };
    },
    proofread: async (script, lines) => {
      const key = getDeepSeekKey();
      if (!key) return { lines, status: 'skipped', changed: 0 };
      return proofreadLines(new DeepSeekTextLLM({ apiKey: key }), script, lines);
    },
  };
}
```

- [ ] **Step 5: 实现 `src/lib/jobs/registry.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { startJob, type JobRun } from './runner';
import { runTranscribe } from '@/lib/recording/transcribe';
import { createTranscribeDeps } from '@/lib/recording/deps';

/** 所有后台任务种类。上传、重试、agent 工具都从这里启动, 保证同一种任务只有一种跑法。 */
export const JOB_KINDS = {
  transcribe: { label: '转写', run: ((ctx) => runTranscribe(ctx, createTranscribeDeps())) as JobRun },
} as const;

export type JobKind = keyof typeof JOB_KINDS;

export function isJobKind(k: string): k is JobKind {
  return k in JOB_KINDS;
}

export function launchJob(db: PrismaClient, projectId: string, kind: JobKind) {
  const def = JOB_KINDS[kind];
  return startJob(db, { projectId, kind, label: def.label, run: def.run });
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run tests/lib/recording && npm run typecheck && npm test`
Expected: transcribe 7 个 PASS；0 错误；全量全绿。

- [ ] **Step 7: Commit**

```bash
git add src/lib/recording src/lib/jobs/registry.ts tests/lib/recording/transcribe.test.ts
git commit -m "feat(recording): 转写流水线(抽音/本地 whisper/校对/落盘/阶段前进/比对通知) + 任务注册表

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 接口——上传、文件读取、重试、项目详情带口播数据

**Files:**
- Modify: `src/lib/project/view.ts`（加 `JobView`、`RecordingView`，`toMessageView` 覆盖 system 行）
- Create: `src/lib/project/load.ts`、`src/app/api/projects/[id]/upload/route.ts`、`src/app/api/projects/[id]/files/[fileId]/route.ts`、`src/app/api/projects/[id]/jobs/[jobId]/retry/route.ts`
- Modify: `src/app/api/projects/[id]/route.ts`（GET）、`src/app/projects/[id]/page.tsx`
- Test: `tests/lib/project/view.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1～5 的导出；`probeVideo`（`src/lib/video/ffmpeg.ts`）；`ok`/`fail`。
- Produces:
  - `interface JobView { id: string; kind: string; status: string; progress: number; userMessage: string; errorDetail: string | null }`、`toJobView(j): JobView`
  - `interface RecordingView { videoFileId: string; videoUrl: string; durationSec: number | null; transcript: { lines: { startSec: number; endSec: number; text: string; adlib: boolean }[]; skipped: string[]; proofread: 'done' | 'skipped' | 'failed' } | null }`
  - `buildRecordingView(projectId: string, script: Script | null, video: { id: string; meta: unknown } | null, transcript: TranscriptFile | null): RecordingView | null`（`skipped` 为段落中文名）
  - `toMessageView`：`role` 为 `tool` 或 `system` 且有 `toolResult` 时读 `ok`
  - `interface ProjectBundle { project: ProjectView; messages: MessageView[]; recording: RecordingView | null; jobs: JobView[] }`、`loadProjectBundle(db, id): Promise<ProjectBundle | null>`（先 `reconcileInterruptedJobs`；`jobs` 为最近 5 条，新→旧）
  - HTTP：`PUT /api/projects/:id/upload`（请求头 `x-filename` 为 `encodeURIComponent` 后的原文件名，body 为文件）→ `{ fileId, jobId }`；`GET /api/projects/:id/files/:fileId`（支持 Range）；`POST /api/projects/:id/jobs/:jobId/retry` → `{ jobId }`；`GET /api/projects/:id` → `ProjectBundle`。

- [ ] **Step 1: 追加失败测试到 `tests/lib/project/view.test.ts`**

在文件末尾追加：

```ts
import { buildRecordingView, toJobView } from '@/lib/project/view';

describe('buildRecordingView', () => {
  const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: ['开场白', '第一点', '第二点', '冷知识内容', '串起来', '收个尾'][i] })) };
  it('returns null when no video was uploaded', () => {
    expect(buildRecordingView('p1', script, null, null)).toBeNull();
  });
  it('builds the video url and marks adlib lines and skipped segments by Chinese name', () => {
    const transcript = {
      lines: ['开场白', '第一点', '第二点', '串起来', '收个尾', '顺便说个题外话'].map((text, i) => ({ startSec: i, endSec: i + 1, text })),
      rawLines: [],
      durationSec: 6,
      proofread: 'done' as const,
    };
    const v = buildRecordingView('p1', script, { id: 'f9', meta: { durationSec: 6.2 } }, transcript)!;
    expect(v.videoUrl).toBe('/api/projects/p1/files/f9');
    expect(v.durationSec).toBe(6.2);
    expect(v.transcript?.lines.at(-1)).toMatchObject({ text: '顺便说个题外话', adlib: true });
    expect(v.transcript?.skipped).toEqual(['冷知识']);
  });
});

describe('toJobView / toMessageView for system rows', () => {
  it('exposes only the fields the UI needs', () => {
    expect(toJobView({ id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.3, userMessage: '坏了', errorDetail: 'stack' })).toEqual({
      id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.3, userMessage: '坏了', errorDetail: 'stack',
    });
  });
  it('reads ok for job notices stored as system rows', () => {
    expect(toMessageView({ id: 'm1', role: 'system', content: '转写完成', toolName: 'job:transcribe', toolResult: { ok: true } }).ok).toBe(true);
    expect(toMessageView({ id: 'm2', role: 'system', content: '连不上', toolName: null, toolResult: null }).ok).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/project/view.test.ts`
Expected: FAIL（`buildRecordingView` / `toJobView` 未导出；system 行 ok 为 null）。

- [ ] **Step 3: 修改 `src/lib/project/view.ts`**

(a) 在文件顶部 import 区追加：

```ts
import { ROLE_LABEL } from '@/lib/script/model';
import type { TranscriptFile } from '@/lib/recording/transcript';
import { compareWithScript } from '@/lib/recording/compare';
```

（`ScriptSchema, type Script` 的已有 import 保持；把 `ROLE_LABEL` 合并进同一行 import 亦可。）

(b) 把 `toMessageView` 整体替换为：

```ts
export function toMessageView(m: { id: string; role: string; content: string; toolName: string | null; toolResult: unknown }): MessageView {
  // 工具结果行与任务通知(system + toolResult)都带 ok; 普通 system 报错行为 null
  const ok =
    (m.role === 'tool' || m.role === 'system') && m.toolResult && typeof m.toolResult === 'object'
      ? Boolean((m.toolResult as { ok?: unknown }).ok)
      : null;
  return { id: m.id, role: m.role as MessageView['role'], content: m.content, toolName: m.toolName, ok };
}
```

(c) 文件末尾追加：

```ts
export interface JobView {
  id: string;
  kind: string;
  status: string;
  progress: number;
  userMessage: string;
  errorDetail: string | null;
}

export function toJobView(j: { id: string; kind: string; status: string; progress: number; userMessage: string; errorDetail: string | null }): JobView {
  return { id: j.id, kind: j.kind, status: j.status, progress: j.progress, userMessage: j.userMessage, errorDetail: j.errorDetail };
}

export interface RecordingView {
  videoFileId: string;
  videoUrl: string;
  durationSec: number | null;
  transcript: {
    lines: { startSec: number; endSec: number; text: string; adlib: boolean }[];
    /** 没讲到的段落(中文名) */
    skipped: string[];
    proofread: 'done' | 'skipped' | 'failed';
  } | null;
}

export function buildRecordingView(
  projectId: string,
  script: Script | null,
  video: { id: string; meta: unknown } | null,
  transcript: TranscriptFile | null,
): RecordingView | null {
  if (!video) return null;
  const meta = (video.meta ?? {}) as { durationSec?: unknown };
  let view: RecordingView['transcript'] = null;
  if (transcript) {
    const cmp = script ? compareWithScript(script, transcript.lines) : null;
    view = {
      lines: transcript.lines.map((l, i) => ({ ...l, adlib: cmp ? cmp.lines[i].adlib : false })),
      skipped: cmp ? cmp.segments.filter((s) => s.skipped).map((s) => ROLE_LABEL[s.role]) : [],
      proofread: transcript.proofread,
    };
  }
  return {
    videoFileId: video.id,
    videoUrl: `/api/projects/${projectId}/files/${video.id}`,
    durationSec: typeof meta.durationSec === 'number' ? meta.durationSec : null,
    transcript: view,
  };
}
```

- [ ] **Step 4: 实现 `src/lib/project/load.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { reconcileInterruptedJobs } from '@/lib/jobs/runner';
import { loadLatestTranscript } from '@/lib/recording/transcript';
import { toProjectView, toMessageView, toJobView, buildRecordingView, type ProjectView, type MessageView, type RecordingView, type JobView } from './view';

export interface ProjectBundle {
  project: ProjectView;
  messages: MessageView[];
  recording: RecordingView | null;
  jobs: JobView[];
}

/** 项目页与 GET /api/projects/:id 共用。先把上个进程留下的运行中任务标成已中断。 */
export async function loadProjectBundle(db: PrismaClient, id: string): Promise<ProjectBundle | null> {
  await reconcileInterruptedJobs(db);
  const p = await db.project.findUnique({ where: { id } });
  if (!p) return null;
  const [messages, video, transcript, jobs] = await Promise.all([
    db.chatMessage.findMany({ where: { projectId: id }, orderBy: { createdAt: 'asc' } }),
    db.projectFile.findFirst({ where: { projectId: id, kind: 'raw_video' }, orderBy: { version: 'desc' } }),
    loadLatestTranscript(db, id),
    db.job.findMany({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);
  const project = toProjectView(p);
  // 只展示与最新视频同版本的转写; 重传后旧转写不再显示
  const matching = transcript && video && transcript.version === video.version ? transcript.data : null;
  return {
    project,
    messages: messages.map(toMessageView),
    recording: buildRecordingView(id, project.script, video, matching),
    jobs: jobs.map(toJobView),
  };
}
```

- [ ] **Step 5: 修改 `GET /api/projects/[id]` 与项目页**

`src/app/api/projects/[id]/route.ts`：把 `GET` 函数整体替换为：

```ts
export async function GET(_req: Request, { params }: Ctx) {
  const bundle = await loadProjectBundle(prisma, params.id);
  if (!bundle) return fail('项目不存在或已删除', 404);
  return ok(bundle);
}
```

并在该文件 import 区追加 `import { loadProjectBundle } from '@/lib/project/load';`，删除不再使用的 `toMessageView` import（`toProjectView` 仍被 PATCH 使用）。

`src/app/projects/[id]/page.tsx` 整体替换为：

```tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { loadProjectBundle } from '@/lib/project/load';
import { ProjectWorkspace } from '@/components/project/project-workspace';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const bundle = await loadProjectBundle(prisma, params.id);
  if (!bundle) notFound();
  return (
    <ProjectWorkspace
      initialProject={bundle.project}
      initialMessages={bundle.messages}
      initialRecording={bundle.recording}
      initialJobs={bundle.jobs}
    />
  );
}
```

（`ProjectWorkspace` 的新 props 在 Task 9 加；本任务先让它们为可选 props，见 Step 9。）

- [ ] **Step 6: 实现上传接口 `src/app/api/projects/[id]/upload/route.ts`**

```ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { projectDir, versionedName, videoExt, saveStreamToFile } from '@/lib/files/storage';
import { probeVideo } from '@/lib/video/ffmpeg';
import { findActiveJob } from '@/lib/jobs/runner';
import { launchJob } from '@/lib/jobs/registry';

export const dynamic = 'force-dynamic';

/** 流式上传口播原片: 边收边写盘, 不进内存。成功后自动启动转写。 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!project) return fail('项目不存在或已删除', 404);
  if (await findActiveJob(prisma, project.id, 'transcribe')) return fail('上一个视频还在转写，等它完成再传。', 409);

  const name = decodeURIComponent(req.headers.get('x-filename') ?? '');
  const ext = videoExt(name);
  if (!ext) return fail('只支持 mp4 / mov / m4v 视频', 400);
  if (!req.body) return fail('没收到文件', 400);

  const last = await prisma.projectFile.findFirst({ where: { projectId: project.id, kind: 'raw_video' }, orderBy: { version: 'desc' } });
  const version = (last?.version ?? 0) + 1;
  const dest = path.join(projectDir(project.id), versionedName('raw_video', version, ext));

  let sizeBytes: number;
  try {
    sizeBytes = await saveStreamToFile(Readable.fromWeb(req.body as unknown as WebReadableStream), dest);
  } catch {
    return fail('上传中断了，文件没存完整。重新拖进来再传一次。', 400);
  }
  let durationSec: number;
  try {
    durationSec = (await probeVideo(dest)).durationSec;
  } catch {
    await fs.unlink(dest).catch(() => {});
    return fail('这个文件读不出视频时长，可能不是视频或已经损坏。', 400);
  }

  const file = await prisma.projectFile.create({
    data: { projectId: project.id, kind: 'raw_video', path: dest, version, meta: { originalName: name, sizeBytes, durationSec } },
  });
  const { jobId } = await launchJob(prisma, project.id, 'transcribe');
  return ok({ fileId: file.id, jobId });
}
```

- [ ] **Step 7: 实现文件读取 `src/app/api/projects/[id]/files/[fileId]/route.ts`**

```ts
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { parseRange } from '@/lib/files/range';

export const dynamic = 'force-dynamic';

// mov/m4v 也按 video/mp4 发: Chrome 对 video/quicktime 常拒播, 而 H.264 的 mov 用 mp4 类型能正常播放
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/mp4', '.m4v': 'video/mp4', '.json': 'application/json' };

export async function GET(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const f = await prisma.projectFile.findFirst({ where: { id: params.fileId, projectId: params.id } });
  if (!f) return fail('文件不存在', 404);
  const stat = await fs.stat(f.path).catch(() => null);
  if (!stat) return fail('文件不在磁盘上了（可能被移动或删除）', 404);

  const size = stat.size;
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(f.path, { start, end })) as unknown as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'content-type': TYPES[path.extname(f.path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
```

- [ ] **Step 8: 实现重试 `src/app/api/projects/[id]/jobs/[jobId]/retry/route.ts`**

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { findActiveJob } from '@/lib/jobs/runner';
import { launchJob, isJobKind } from '@/lib/jobs/registry';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string; jobId: string } }) {
  const job = await prisma.job.findFirst({ where: { id: params.jobId, projectId: params.id } });
  if (!job) return fail('任务不存在', 404);
  if (!['failed', 'interrupted'].includes(job.status)) return fail('这个任务没有失败，不需要重试', 400);
  if (!isJobKind(job.kind)) return fail('这种任务已经不支持了', 400);
  if (await findActiveJob(prisma, params.id, job.kind)) return fail('已经有一个同类任务在跑了', 409);
  const { jobId } = await launchJob(prisma, params.id, job.kind);
  return ok({ jobId });
}
```

- [ ] **Step 9: 让 `ProjectWorkspace` 先接受可选的新 props（不改行为）**

在 `src/components/project/project-workspace.tsx` 顶部 import 区把 `import type { MessageView, ProjectView } from '@/lib/project/view';` 改为：

```ts
import type { JobView, MessageView, ProjectView, RecordingView } from '@/lib/project/view';
```

并把函数签名改为：

```tsx
export function ProjectWorkspace({
  initialProject,
  initialMessages,
}: {
  initialProject: ProjectView;
  initialMessages: MessageView[];
  initialRecording?: RecordingView | null;
  initialJobs?: JobView[];
}) {
```

同一文件里 `refresh` 读取的是 `j.data.project`，GET 新形状下仍成立，不用改。

- [ ] **Step 10: 单测 + 类型检查**

Run: `npx vitest run tests/lib/project && npm run typecheck && npm test`
Expected: view 测试全部 PASS；0 错误；全量全绿。

- [ ] **Step 11: 真机冒烟（用 09-20 那条真实口播原片）**

`npm run dev` 运行中（重启一次让新路由生效），执行：

```bash
ID=$(curl -s -X POST localhost:3000/api/projects -H 'content-type: application/json' -d '{}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')
echo $ID
curl -s -X PUT localhost:3000/api/projects/$ID/upload -H 'x-filename: a.avi' --data-binary 'x'; echo
curl -s -X PUT localhost:3000/api/projects/$ID/upload -H 'x-filename: a.mp4' --data-binary 'not a video'; echo
ls projects/$ID 2>/dev/null
time curl -s -X PUT localhost:3000/api/projects/$ID/upload -H "x-filename: $(node -pe 'encodeURIComponent("口播.mov")')" --data-binary @$HOME/mediapilot-archive/video-productions/51525511-00d/source.mov; echo
curl -s -X PUT localhost:3000/api/projects/$ID/upload -H 'x-filename: b.mp4' --data-binary 'x'; echo
curl -s localhost:3000/api/projects/$ID | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)).data; JSON.stringify({rec: d.recording && d.recording.videoUrl, jobs: d.jobs.map(j=>[j.status, Math.round(j.progress*100)])})'
```
Expected:
- 第 2 条：`只支持 mp4 / mov / m4v 视频`（400）。
- 第 3 条：`这个文件读不出视频时长，可能不是视频或已经损坏。`（400），`ls` 显示目录为空或不存在（半截文件已删）。
- 第 4 条：`{"success":true,"data":{"fileId":"...","jobId":"..."}}`，耗时仅为写盘时间（几秒）。
- 第 5 条：`上一个视频还在转写，等它完成再传。`（409）。
- 最后一条：`rec` 为 `/api/projects/<id>/files/<fileId>`，`jobs` 为 `[["running", <0~95>]]`。

等 1～3 分钟后再查：

```bash
curl -s localhost:3000/api/projects/$ID | node -e 'const d=JSON.parse(require("fs").readFileSync(0)).data; console.log(d.project.stage, d.jobs[0].status, d.jobs[0].userMessage); const t=d.recording.transcript; console.log(t && t.lines.length, t && t.proofread); (t?t.lines:[]).slice(0,8).forEach(l=>console.log(l.startSec.toFixed(1), l.text))'
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' -H 'Range: bytes=0-1023' localhost:3000/api/projects/$ID/files/$(curl -s localhost:3000/api/projects/$ID | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.recording.videoFileId')
```
Expected：第一行为 `recorded done 转写完成：N 句，约 79 秒。`（冒烟项目没有稿子：阶段仍从 draft 前进到 recorded；不做校对与比对，所以通知里没有校对和比对那两句）；前 8 句是可读的简体中文；Range 请求返回 `206 1024`。把转写前几句贴进 ledger，作为校对质量的基线。

**若转写失败：** 读 `jobs[0].userMessage` 与 `errorDetail`；Python/faster-whisper 问题按提示修环境，不改代码掩盖。

- [ ] **Step 12: 删掉冒烟项目，Commit**

```bash
docker exec mediapilot-postgres psql -U mediapilot -d mediapilot_v2 -c "delete from \"Project\" where id='$ID'"
rm -rf projects/$ID
git add src/lib/project src/app/api/projects src/app/projects src/components/project/project-workspace.tsx tests/lib/project
git commit -m "feat(api): 口播流式上传/带 Range 的文件读取/任务重试, 项目详情带口播与任务数据

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 编导 agent——`transcribe` 工具与转写摘要

**Files:**
- Create: `src/lib/tools/transcribe.ts`
- Modify: `src/lib/tools/index.ts`、`src/lib/agent/context.ts`
- Test: `tests/lib/tools/transcribe.test.ts`、`tests/lib/agent/context.test.ts`（追加）

**Interfaces:**
- Consumes: `launchJob`（Task 5，测试中 mock）、`findActiveJob`（Task 2）、`loadLatestTranscript`、`compareWithScript`（Task 3）。
- Produces:
  - `transcribeTool: Tool<Record<string, never>>`（`name: 'transcribe'`，`label: '转写'`）
  - `formatSystemPrompt` 参数新增可选 `transcript?: { lines: { startSec: number; text: string; adlib: boolean }[]; skipped: string[] } | null`
  - `STAGE_LABEL` 新增 `recorded: '已录制，等待配特效'`

- [ ] **Step 1: 写失败测试**

`tests/lib/tools/transcribe.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFakeDb } from '../../helpers/fake-db';

// vi.mock 会被提升到文件顶部, 工厂里只能用 vi.hoisted 定义的变量
const { launchJob } = vi.hoisted(() => ({ launchJob: vi.fn(async () => ({ jobId: 'jNew', finished: Promise.resolve() })) }));
vi.mock('@/lib/jobs/registry', () => ({ launchJob }));

import { transcribeTool } from '@/lib/tools/transcribe';
const ctx = (db: ReturnType<typeof createFakeDb>['db']) => ({ projectId: 'p1', db, llm: {} as never });

describe('transcribe tool', () => {
  it('refuses when no video was uploaded', async () => {
    const { db } = createFakeDb();
    expect(await transcribeTool.execute(ctx(db), {})).toMatchObject({ ok: false, summary: '转写没开始：还没上传口播视频' });
  });
  it('refuses when a transcription is already running', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video' }], jobs: [{ status: 'running' }] });
    expect(await transcribeTool.execute(ctx(db), {})).toMatchObject({ ok: false, summary: '转写没开始：已经在转写了' });
  });
  it('starts a background job', async () => {
    const { db } = createFakeDb({ files: [{ kind: 'raw_video' }] });
    const r = await transcribeTool.execute(ctx(db), {});
    expect(r).toMatchObject({ ok: true, summary: '已开始重新转写，1～3 分钟后出结果' });
    expect(launchJob).toHaveBeenCalledWith(db, 'p1', 'transcribe');
  });
});
```

在 `tests/lib/agent/context.test.ts` 的 `describe('formatSystemPrompt', ...)` 里追加：

```ts
  it('includes the transcript with adlib marks and skipped segments', () => {
    const p = formatSystemPrompt({
      title: 't', stage: 'recorded', targetSec: 60, script: null, persona: null,
      transcript: { lines: [{ startSec: 3.2, text: '你敢不敢', adlib: false }, { startSec: 65, text: '顺便说个题外话', adlib: true }], skipped: ['冷知识'] },
    });
    expect(p).toContain('已录制，等待配特效');
    expect(p).toContain('[0:03] 你敢不敢');
    expect(p).toContain('[1:05] 顺便说个题外话（临场加的）');
    expect(p).toContain('没讲到的段落：冷知识');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/tools/transcribe.test.ts tests/lib/agent/context.test.ts`
Expected: FAIL（transcribe 模块不存在；context 缺转写块）。

- [ ] **Step 3: 实现 `src/lib/tools/transcribe.ts`**

```ts
import { z } from 'zod';
import { findActiveJob } from '@/lib/jobs/runner';
import { launchJob } from '@/lib/jobs/registry';
import type { Tool } from './types';

const Input = z.object({});

export const transcribeTool: Tool<z.infer<typeof Input>> = {
  name: 'transcribe',
  label: '转写',
  description: '重新转写最近上传的口播视频(后台任务, 1～3 分钟)。上传后系统会自动转写, 只有用户要求重新转写时才调用。',
  input: Input,
  async execute(ctx) {
    const video = await ctx.db.projectFile.findFirst({ where: { projectId: ctx.projectId, kind: 'raw_video' }, orderBy: { version: 'desc' } });
    if (!video) return { ok: false, summary: '转写没开始：还没上传口播视频' };
    if (await findActiveJob(ctx.db, ctx.projectId, 'transcribe')) return { ok: false, summary: '转写没开始：已经在转写了' };
    await launchJob(ctx.db, ctx.projectId, 'transcribe');
    return { ok: true, summary: '已开始重新转写，1～3 分钟后出结果' };
  },
};
```

- [ ] **Step 4: 注册工具（`src/lib/tools/index.ts` 整体替换）**

```ts
import type { Tool } from './types';
import { writeScriptTool } from './write-script';
import { patchScriptTool } from './patch-script';
import { transcribeTool } from './transcribe';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SCRIPT_TOOLS: Tool<any>[] = [writeScriptTool, patchScriptTool, transcribeTool];
```

- [ ] **Step 5: 修改 `src/lib/agent/context.ts`**

(a) `STAGE_LABEL` 改为：

```ts
const STAGE_LABEL: Record<string, string> = {
  draft: '写稿中',
  scripted: '已定稿，等待录制',
  recorded: '已录制，等待配特效',
};
```

(b) `formatSystemPrompt` 的参数类型追加一项，并在返回数组里 `【当前稿子】` 之后加入转写块：

```ts
export function formatSystemPrompt(p: {
  title: string;
  stage: string;
  targetSec: number;
  script: unknown;
  persona: PersonaLike | null;
  transcript?: { lines: { startSec: number; text: string; adlib: boolean }[]; skipped: string[] } | null;
}): string {
```

在函数体 `return [` 之前加：

```ts
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const transcriptBlock = p.transcript
    ? `【口播转写】（用户实际录下来的话，共 ${p.transcript.lines.length} 句）\n${p.transcript.lines
        .map((l) => `[${mmss(l.startSec)}] ${l.text}${l.adlib ? '（临场加的）' : ''}`)
        .join('\n')}${p.transcript.skipped.length ? `\n没讲到的段落：${p.transcript.skipped.join('、')}` : ''}`
    : '';
```

并把返回数组改为：

```ts
  return [
    RULES,
    persona ? `【账号定位】\n${persona}` : '',
    `【项目】${p.title}｜${STAGE_LABEL[p.stage] ?? p.stage}｜目标 ${p.targetSec} 秒`,
    `【当前稿子】\n${scriptBlock}`,
    transcriptBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
```

(c) `buildSystemPrompt` 改为同时读取转写：

```ts
export async function buildSystemPrompt(db: PrismaClient, projectId: string): Promise<string> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId } });
  const parsed = ScriptSchema.safeParse(p.script);
  const t = await loadLatestTranscript(db, projectId);
  let transcript: { lines: { startSec: number; text: string; adlib: boolean }[]; skipped: string[] } | null = null;
  if (t) {
    const cmp = parsed.success ? compareWithScript(parsed.data, t.data.lines) : null;
    transcript = {
      lines: t.data.lines.map((l, i) => ({ startSec: l.startSec, text: l.text, adlib: cmp ? cmp.lines[i].adlib : false })),
      skipped: cmp ? cmp.segments.filter((s) => s.skipped).map((s) => ROLE_LABEL[s.role]) : [],
    };
  }
  return formatSystemPrompt({
    title: p.title,
    stage: p.stage,
    targetSec: p.targetSec,
    script: p.script,
    persona: (p.personaSnapshot as PersonaLike | null) ?? null,
    transcript,
  });
}
```

在文件 import 区追加：

```ts
import { loadLatestTranscript } from '@/lib/recording/transcript';
import { compareWithScript } from '@/lib/recording/compare';
```

注：`loadLatestTranscript` 调用 `db.projectFile.findFirst`；Task 2 的假库已实现该方法，现有 loop 测试不受影响（无文件时返回 null）。

- [ ] **Step 6: 运行确认通过**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。

- [ ] **Step 7: Commit**

```bash
git add src/lib/tools src/lib/agent/context.ts tests/lib/tools/transcribe.test.ts tests/lib/agent/context.test.ts
git commit -m "feat(agent): transcribe 工具 + 上下文带口播转写(临场加的/没讲到)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 全屏提词器

**Files:**
- Create: `src/components/project/teleprompter.tsx`
- Test: `tests/components/teleprompter.test.tsx`

**Interfaces:**
- Consumes: `Script`、`CHARS_PER_SEC`、`countSpokenChars`。
- Produces:
  - `scrollSpeedPxPerSec(scrollableHeight: number, totalChars: number, charsPerSec: number): number`
  - `Teleprompter({ script: Script; onClose(): void })`：全屏；空格开始/暂停；↑/↓ 调语速（3～8 字/秒，默认 `CHARS_PER_SEC`）；R 回到开头；Esc 退出。

- [ ] **Step 1: 写失败测试 `tests/components/teleprompter.test.tsx`**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Teleprompter, scrollSpeedPxPerSec } from '@/components/project/teleprompter';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(cleanup);
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段的口播内容` })) };

describe('scrollSpeedPxPerSec', () => {
  it('scrolls the whole height in totalChars / charsPerSec seconds', () => {
    expect(scrollSpeedPxPerSec(3000, 300, 5)).toBe(50);
    expect(scrollSpeedPxPerSec(0, 300, 5)).toBe(0);
    expect(scrollSpeedPxPerSec(3000, 0, 5)).toBe(0);
  });
});

describe('Teleprompter', () => {
  it('shows every segment and starts paused', () => {
    render(<Teleprompter script={script} onClose={vi.fn()} />);
    expect(screen.getByText('第4段的口播内容')).toBeTruthy();
    expect(screen.getByText('空格 开始')).toBeTruthy();
  });
  it('space toggles play/pause, arrows change speed, Esc closes', () => {
    const onClose = vi.fn();
    render(<Teleprompter script={script} onClose={onClose} />);
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getByText('空格 暂停')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(screen.getByText('语速 6 字/秒')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/teleprompter.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/components/project/teleprompter.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Script } from '@/lib/script/model';
import { CHARS_PER_SEC, countSpokenChars } from '@/lib/script/duration';

/** 按"整篇字数 ÷ 语速"算出滚完全文所需秒数, 再换成每秒滚动像素。 */
export function scrollSpeedPxPerSec(scrollableHeight: number, totalChars: number, charsPerSec: number): number {
  if (scrollableHeight <= 0 || totalChars <= 0) return 0;
  return (scrollableHeight * charsPerSec) / totalChars;
}

const MIN_CPS = 3;
const MAX_CPS = 8;

export function Teleprompter({ script, onClose }: { script: Script; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cps, setCps] = useState(CHARS_PER_SEC);
  const totalChars = script.segments.reduce((n, s) => n + countSpokenChars(s.text), 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowUp') setCps((c) => Math.min(MAX_CPS, c + 1));
      else if (e.key === 'ArrowDown') setCps((c) => Math.max(MIN_CPS, c - 1));
      else if (e.key === 'r' || e.key === 'R') box.current?.scrollTo({ top: 0 });
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!playing) return;
    // 测试环境(jsdom)不一定有 requestAnimationFrame
    const requestFrame = window.requestAnimationFrame ?? ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
    const cancelFrame = window.cancelAnimationFrame ?? window.clearTimeout;
    let raf = 0;
    let last = performance.now();
    let carry = 0; // scrollTop 只接受整数像素, 累积小数部分
    const tick = (now: number) => {
      const el = box.current;
      if (el) {
        const speed = scrollSpeedPxPerSec(el.scrollHeight - el.clientHeight, totalChars, cps);
        carry += (speed * (now - last)) / 1000;
        const step = Math.floor(carry);
        if (step > 0) {
          el.scrollTop += step;
          carry -= step;
        }
      }
      last = now;
      raf = requestFrame(tick);
    };
    raf = requestFrame(tick);
    return () => cancelFrame(raf);
  }, [playing, cps, totalChars]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div ref={box} className="flex-1 overflow-y-auto px-[8vw] py-[40vh]">
        {script.segments.map((s) => (
          <p key={s.id} className="mb-10 text-[clamp(28px,4vw,56px)] font-medium leading-[1.6]">
            {s.text}
          </p>
        ))}
      </div>
      <div className="flex items-center gap-6 border-t border-white/10 px-6 py-3 text-sm text-white/70">
        <span>{playing ? '空格 暂停' : '空格 开始'}</span>
        <span>语速 {cps} 字/秒</span>
        <span>↑↓ 调速 · R 回到开头 · Esc 退出</span>
        <div className="flex-1" />
        <button className="rounded-md border border-white/20 px-3 py-1 hover:bg-white/10" onClick={onClose}>
          退出
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/components/teleprompter.test.tsx && npm run typecheck`
Expected: 3 个 PASS；0 错误。

- [ ] **Step 5: Commit**

```bash
git add src/components/project/teleprompter.tsx tests/components/teleprompter.test.tsx
git commit -m "feat(ui): 全屏提词器(按稿子字数与语速匀速滚动, 空格/方向键/R/Esc)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ② 口播标签页、标签切换、任务轮询与通知

**Files:**
- Create: `src/components/project/upload.ts`、`src/components/project/recording-pane.tsx`
- Modify: `src/components/project/project-workspace.tsx`（整体替换）、`src/components/project/chat-panel.tsx`、`src/components/project/script-pane.tsx`、`src/app/page.tsx`
- Test: `tests/components/recording-pane.test.tsx`、`tests/components/project-workspace.test.tsx`（追加）

**Interfaces:**
- Consumes: `RecordingView`、`JobView`、`ProjectView`、`MessageView`（Task 6）；`Teleprompter`（Task 8）；`GET /api/projects/:id` 返回 `ProjectBundle`；上传与重试接口（Task 6）。
- Produces:
  - `uploadVideo(projectId: string, file: File, onProgress: (ratio: number) => void): Promise<{ ok: true } | { ok: false; message: string }>`
  - `RecordingPane({ project, recording, job, onUploaded(): void, onRetry(jobId: string): Promise<void> })`
  - `ChatPanel` 新增可选 prop `incoming?: MessageView[]`（只追加没见过 id 的任务通知）；`role === 'system' && ok === true` 用信息样式，其余 system 用红色。
  - `ProjectWorkspace` 使用 `initialRecording`、`initialJobs`；有运行中任务时每 2 秒轮询；任务由运行中变为完成时切到「② 口播」。

- [ ] **Step 1: 写失败测试**

`tests/components/recording-pane.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecordingPane } from '@/components/project/recording-pane';
import { toProjectView } from '@/lib/project/view';
import { SEGMENT_ROLES } from '@/lib/script/model';

afterEach(cleanup);
const script = { segments: SEGMENT_ROLES.map((role, i) => ({ id: `s${i + 1}`, role, text: `第${i + 1}段` })) };
const project = toProjectView({ id: 'p1', title: 't', stage: 'scripted', targetSec: 60, script, updatedAt: new Date() });
const noop = { onUploaded: vi.fn(), onRetry: vi.fn(async () => {}) };

describe('RecordingPane', () => {
  it('asks for a script first when there is none', () => {
    render(<RecordingPane project={{ ...project, script: null, report: null }} recording={null} job={null} {...noop} />);
    expect(screen.getByText('先在「① 脚本」里把稿子写出来，再来录。')).toBeTruthy();
  });

  it('offers the teleprompter and the upload area before anything is uploaded', () => {
    render(<RecordingPane project={project} recording={null} job={null} {...noop} />);
    expect(screen.getByText('打开提词器')).toBeTruthy();
    expect(screen.getByText('把录好的口播视频拖到这里，或点击选择（mp4 / mov）')).toBeTruthy();
  });

  it('shows progress while transcribing', () => {
    const job = { id: 'j1', kind: 'transcribe', status: 'running', progress: 0.42, userMessage: '', errorDetail: null };
    render(<RecordingPane project={project} recording={null} job={job} {...noop} />);
    expect(screen.getByText('正在转写… 42%')).toBeTruthy();
  });

  it('shows the plain-language failure with a retry button and a folded detail', () => {
    const onRetry = vi.fn(async () => {});
    const job = { id: 'j1', kind: 'transcribe', status: 'failed', progress: 0.1, userMessage: '本地转写没装好：缺 faster-whisper。', errorDetail: 'Traceback…' };
    render(<RecordingPane project={project} recording={null} job={job} onUploaded={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByText('本地转写没装好：缺 faster-whisper。')).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledWith('j1');
    expect(screen.getByText('详情')).toBeTruthy();
  });

  it('lists the transcript with adlib badges and skipped segments', () => {
    const recording = {
      videoFileId: 'f1',
      videoUrl: '/api/projects/p1/files/f1',
      durationSec: 79.2,
      transcript: {
        lines: [
          { startSec: 0, endSec: 2, text: '第1段', adlib: false },
          { startSec: 62, endSec: 64, text: '顺便说个题外话', adlib: true },
        ],
        skipped: ['冷知识'],
        proofread: 'done' as const,
      },
    };
    render(<RecordingPane project={project} recording={recording} job={null} {...noop} />);
    expect(screen.getByText('顺便说个题外话')).toBeTruthy();
    expect(screen.getAllByText('临场加的')).toHaveLength(1);
    expect(screen.getByText('没讲到：冷知识')).toBeTruthy();
    expect(screen.getByText('1:02')).toBeTruthy();
  });
});
```

在 `tests/components/project-workspace.test.tsx` 末尾的 `});` 之前追加：

```tsx
  it('polls while a job runs, forwards the job notice to chat and switches to the recording tab when done', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const running = { id: 'j1', kind: 'transcribe', status: 'running', progress: 0.5, userMessage: '', errorDetail: null };
    const done = { ...running, status: 'done', progress: 1, userMessage: '转写完成：6 句' };
    const bundle = (jobs: unknown[], messages: unknown[]) => ({
      json: async () => ({ success: true, data: { project: toProjectView({ ...base, title: 't', stage: 'recorded' }), messages, recording: null, jobs } }),
    });
    const fetchMock = vi.fn(async () => bundle([done], [{ id: 'mJob', role: 'system', content: '转写完成：6 句', toolName: 'job:transcribe', ok: true }]));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ProjectWorkspace initialProject={toProjectView({ ...base, title: 't' })} initialMessages={[]} initialRecording={null} initialJobs={[running]} />);
    await vi.advanceTimersByTimeAsync(2100);
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('转写完成：6 句')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('tab', { name: '② 口播' }).getAttribute('aria-selected')).toBe('true'));
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components`
Expected: FAIL（`recording-pane` 不存在；工作区没有标签与轮询）。

- [ ] **Step 3: 实现 `src/components/project/upload.ts`**

```ts
/** 用 XHR 上传(fetch 拿不到上传进度)。请求体直接是文件, 服务端流式写盘。 */
export function uploadVideo(
  projectId: string,
  file: File,
  onProgress: (ratio: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/projects/${projectId}/upload`);
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { success?: boolean; message?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // 非 JSON 响应按失败处理
      }
      resolve(body.success ? { ok: true } : { ok: false, message: body.message ?? `上传失败（${xhr.status}）` });
    };
    xhr.onerror = () => resolve({ ok: false, message: '网络断了，上传没完成。重新拖进来再传一次。' });
    xhr.send(file);
  });
}
```

- [ ] **Step 4: 实现 `src/components/project/recording-pane.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import type { JobView, ProjectView, RecordingView } from '@/lib/project/view';
import { cn } from '@/lib/utils';
import { Teleprompter } from './teleprompter';
import { uploadVideo } from './upload';

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export function RecordingPane({
  project,
  recording,
  job,
  onUploaded,
  onRetry,
}: {
  project: ProjectView;
  recording: RecordingView | null;
  job: JobView | null;
  onUploaded: () => void;
  onRetry: (jobId: string) => Promise<void>;
}) {
  const [prompter, setPrompter] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!project.script) {
    return <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-secondary)]">先在「① 脚本」里把稿子写出来，再来录。</div>;
  }
  const running = job && (job.status === 'running' || job.status === 'queued');
  const failed = job && (job.status === 'failed' || job.status === 'interrupted');

  async function send(file: File | undefined) {
    if (!file || uploading !== null || running) return;
    setUploadError(null);
    setUploading(0);
    const r = await uploadVideo(project.id, file, setUploading);
    setUploading(null);
    if (r.ok) onUploaded();
    else setUploadError(r.message);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      {prompter && <Teleprompter script={project.script} onClose={() => setPrompter(false)} />}

      <div className="mb-4 flex items-center gap-3">
        <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]" onClick={() => setPrompter(true)}>
          打开提词器
        </button>
        <span className="text-xs text-[var(--text-tertiary)]">照着稿子录，录完把视频拖进来</span>
      </div>

      <div
        className={cn(
          'mb-4 flex cursor-pointer items-center justify-center rounded-lg border border-dashed p-6 text-sm',
          dragging ? 'border-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
        )}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void send(e.dataTransfer.files[0]);
        }}
      >
        {uploading !== null
          ? `上传中… ${Math.round(uploading * 100)}%`
          : recording
            ? '重新录了？把新视频拖到这里替换（旧版本会保留）'
            : '把录好的口播视频拖到这里，或点击选择（mp4 / mov）'}
        <input ref={input} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" className="hidden" onChange={(e) => void send(e.target.files?.[0])} />
      </div>
      {uploadError && <p className="mb-4 text-sm text-[var(--danger)]">{uploadError}</p>}

      {running && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--info-subtle)] px-4 py-3 text-sm text-[var(--info)]">
          正在转写… {Math.round(job.progress * 100)}%
        </div>
      )}
      {failed && (
        <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--danger-subtle)] px-4 py-3 text-sm">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-[var(--danger)]">{job.userMessage}</p>
            <button className="rounded-md border border-[var(--border-strong)] px-3 py-1 text-[var(--text-primary)]" onClick={() => void onRetry(job.id)}>
              重试
            </button>
          </div>
          {job.errorDetail && (
            <details className="mt-2 text-xs text-[var(--text-tertiary)]">
              <summary>详情</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{job.errorDetail}</pre>
            </details>
          )}
        </div>
      )}

      {recording && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <video src={recording.videoUrl} controls className="max-h-[60vh] w-full rounded-lg bg-black" />
          <div className="min-w-0">
            {recording.transcript ? (
              <>
                {recording.transcript.skipped.length > 0 && (
                  <p className="mb-2 text-sm text-[var(--warning)]">没讲到：{recording.transcript.skipped.join('、')}</p>
                )}
                {recording.transcript.proofread === 'failed' && (
                  <p className="mb-2 text-xs text-[var(--text-tertiary)]">自动校对没成功，下面是原始识别结果。</p>
                )}
                <ol className="space-y-1 text-sm">
                  {recording.transcript.lines.map((l, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-10 shrink-0 font-mono text-xs text-[var(--text-tertiary)]">{mmss(l.startSec)}</span>
                      <span className="flex-1">{l.text}</span>
                      {l.adlib && <span className="shrink-0 text-xs text-[var(--warning)]">临场加的</span>}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              !running && !failed && <p className="text-sm text-[var(--text-secondary)]">还没有转写结果。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 修改 `src/components/project/chat-panel.tsx`**

(a) 函数参数追加 `incoming`（放在 `initialMessages` 之后）：

```tsx
  initialMessages,
  incoming = [],
```

类型块对应追加：

```tsx
  initialMessages: MessageView[];
  incoming?: MessageView[];
```

(b) 在 `const bottom = useRef...` 之前加入：

```tsx
  // 任务通知(转写完成/失败)由工作区轮询送进来; 只追加没见过的
  const seen = useRef(new Set(initialMessages.map((m) => m.id)));
  useEffect(() => {
    const fresh = incoming.filter((m) => !seen.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seen.current.add(m.id));
    setLines((ls) => [...ls, ...fresh.map((m) => ({ key: m.id, role: m.role, content: m.content, ok: m.ok }))]);
  }, [incoming]);
```

(c) 气泡样式：把

```tsx
                l.role === 'system' && 'bg-[var(--danger-subtle)] text-[var(--danger)]',
```

替换为：

```tsx
                l.role === 'system' && l.ok === true && 'border border-[var(--border-subtle)] bg-[var(--info-subtle)] text-[var(--info)]',
                l.role === 'system' && l.ok !== true && 'bg-[var(--danger-subtle)] text-[var(--danger)]',
```

- [ ] **Step 6: 修改 `src/components/project/script-pane.tsx`**

删除顶部栏里的这一行（标签移到工作区）：

```tsx
        <span className="rounded-md bg-[var(--accent-subtle)] px-2 py-0.5 text-[var(--text-primary)]">① 脚本</span>
```

并把已定稿文案

```tsx
          <span className="text-[var(--text-secondary)]">已定稿 · 录口播的入口在下一阶段加入</span>
```

改为：

```tsx
          <span className="text-[var(--text-secondary)]">已定稿 · 去「② 口播」录制</span>
```

- [ ] **Step 7: 替换 `src/components/project/project-workspace.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobView, MessageView, ProjectView, RecordingView } from '@/lib/project/view';
import type { AgentEvent } from '@/lib/agent/loop';
import { cn } from '@/lib/utils';
import { ScriptPane } from './script-pane';
import { RecordingPane } from './recording-pane';
import { ChatPanel } from './chat-panel';

type Tab = 'script' | 'recording';
const TABS: { key: Tab; label: string }[] = [
  { key: 'script', label: '① 脚本' },
  { key: 'recording', label: '② 口播' },
];
const isActive = (j: JobView | undefined) => !!j && (j.status === 'running' || j.status === 'queued');

export function ProjectWorkspace({
  initialProject,
  initialMessages,
  initialRecording = null,
  initialJobs = [],
}: {
  initialProject: ProjectView;
  initialMessages: MessageView[];
  initialRecording?: RecordingView | null;
  initialJobs?: JobView[];
}) {
  const [project, setProject] = useState(initialProject);
  const [recording, setRecording] = useState(initialRecording);
  const [jobs, setJobs] = useState(initialJobs);
  const [notices, setNotices] = useState<MessageView[]>([]);
  const [tab, setTab] = useState<Tab>(initialProject.stage === 'draft' ? 'script' : 'recording');
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const transcribeJob = jobs.find((j) => j.kind === 'transcribe');
  const wasActive = useRef(isActive(transcribeJob));

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${project.id}`);
    const j = await res.json();
    if (!j.success) return;
    setProject(j.data.project);
    setRecording(j.data.recording ?? null);
    setJobs(j.data.jobs ?? []);
    setNotices(((j.data.messages ?? []) as MessageView[]).filter((m) => m.role === 'system' && m.toolName?.startsWith('job:')));
  }, [project.id]);

  // 有任务在跑就每 2 秒拉一次; 任务从"运行中"变成结束时切到口播标签
  useEffect(() => {
    const active = isActive(transcribeJob);
    if (wasActive.current && !active) setTab('recording');
    wasActive.current = active;
    if (!active) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [transcribeJob, refresh]);

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
          // 非受控输入只读一次 defaultValue; 以标题做 key, agent 改名后刷新才会跟上
          key={project.title}
          className="w-full bg-transparent text-base font-semibold outline-none"
          defaultValue={project.title}
          onBlur={(e) => e.target.value.trim() !== project.title && void patch({ title: e.target.value })}
        />
        {error && <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      </div>
      {/* 窄窗口(<768px)上下排: 左右排时对话栏 340px 最小宽度会把页面撑出横向滚动 */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div role="tablist" className="flex gap-1 border-b border-[var(--border-subtle)] px-6 pt-2 text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={cn(
                  'rounded-t-md px-3 py-1.5',
                  tab === t.key ? 'bg-[var(--accent-subtle)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'script' ? (
              <ScriptPane
                project={project}
                highlighted={highlighted}
                onEdit={async (segmentId, text) => {
                  setHighlighted(new Set());
                  await patch({ edit: { segmentId, text } });
                }}
                onFinalize={() => patch({ finalize: true })}
              />
            ) : (
              <RecordingPane
                project={project}
                recording={recording}
                job={transcribeJob ?? null}
                onUploaded={() => void refresh()}
                onRetry={async (jobId) => {
                  const res = await fetch(`/api/projects/${project.id}/jobs/${jobId}/retry`, { method: 'POST' });
                  const j = await res.json();
                  if (!j.success) setError(j.message);
                  await refresh();
                }}
              />
            )}
          </div>
        </div>
        <div className="h-[45%] shrink-0 md:h-auto md:w-[36%] md:min-w-[340px]">
          <ChatPanel
            projectId={project.id}
            initialMessages={initialMessages}
            incoming={notices}
            // 发出新消息时清掉上一轮的高亮; 本轮工具改的段落保留到下一轮
            onTurnStart={() => setHighlighted(new Set())}
            onTurnEvent={onTurnEvent}
            onTurnEnd={() => void refresh()}
          />
        </div>
      </div>
    </div>
  );
}
```

注：初始标签——写稿阶段进「① 脚本」，之后进「② 口播」。已有两条工作区测试的初始 stage 为 `draft`，不受影响。

- [ ] **Step 8: 首页阶段文案（`src/app/page.tsx`）**

```tsx
const STAGE_TEXT: Record<string, string> = { draft: '写稿中', scripted: '已定稿', recorded: '已录制' };
```

- [ ] **Step 9: 运行确认通过**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿；0 错误。若工作区既有测试因新增标签栏失败（如 `getByText('定稿')` 找到多个元素），只调整测试定位方式，不改行为。

- [ ] **Step 10: 真机浏览器验收（逐项亲手点到）**

重启 `npm run dev`（新路由），浏览器打开一个**已有稿子**的项目（没有就先建一个并让编导写稿、定稿）：
1. 顶部有「① 脚本」「② 口播」两个标签；已定稿项目默认进「② 口播」。
2. 点「打开提词器」→ 全屏黑底大字，显示全部 6 段；按空格开始匀速滚动，↑ 变快，Esc 退出。
3. 把 `~/mediapilot-archive/video-productions/51525511-00d/source.mov` 拖进上传区 → 显示「上传中… N%」→ 变成「正在转写… N%」，进度会动。
4. 转写期间再拖一次同一个文件 → 出现「上一个视频还在转写，等它完成再传。」
5. 1～3 分钟后：右侧对话出现蓝色通知「转写完成：…」；页面自动停在「② 口播」；左边视频可播放、可拖进度条；右边逐句带时间，临场加的句子有标记，没讲到的段落在上方列出。
6. 在对话里问编导「我录的时候哪些地方和稿子不一样？」→ 它能根据转写回答（说明上下文里有转写）。
7. 转写进行中重启 `npm run dev` → 刷新页面：显示「服务重启打断了这个任务，点「重试」重新跑。」和「重试」按钮；点重试后重新开始转写。
8. 首页列表该项目显示「已录制」。
9. 页面上除「详情」折叠区外，没有英文报错、内部编号或状态码。

每项记录通过/不通过；不通过的先写失败测试再修。

- [ ] **Step 11: Commit**

```bash
git add src/components/project src/app/page.tsx tests/components
git commit -m "feat(ui): ② 口播标签页(提词器/拖拽上传/转写进度与重试/逐句转写与改口标记) + 任务轮询与对话通知

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 文档同步与收尾

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md`（§10 记录实测）

- [ ] **Step 1: README「现在能做什么」追加一条，「环境变量」补 `PROJECT_FILES_ROOT` 与 `WHISPER_MODEL`**

在「手改与定稿」条目之后追加：

```markdown
- **② 口播**：全屏提词器照稿录制；把录好的视频拖进来，后台自动转写（本地 faster-whisper），再按原稿只修识别错字；逐句显示并标出「临场加的」和「没讲到」的段落。转写完成后编导对话里会收到通知，编导也能看到转写内容。任务失败或被重启打断时点「重试」，不会自动重跑。
```

「环境变量」表格追加两行：

```markdown
| `PROJECT_FILES_ROOT` | 项目文件（口播原片、转写）存放目录，默认仓库下 `projects/`（已 gitignore） |
| `WHISPER_MODEL` | 本地转写模型，默认 `small`；要更准可设 `medium`（更慢） |
```

并把「录口播上传、特效编排、合成成片…在后续阶段加入」改为「特效编排、合成成片、首页账号数据、定位页、设置页在后续阶段加入。」

- [ ] **Step 2: spec §10 记录阶段 3 实测**

在 §10 末尾追加一条（数值取 Task 6 Step 11 与 Task 9 Step 10 的实际结果）：

```markdown
- **阶段 3 实测（2026-09-27）**：79 秒口播（181MB）上传耗时 <实测> 秒；本地 small 模型转写耗时 <实测> 秒；校对改动 <实测> 处。
```

- [ ] **Step 3: 收尾检查**

Run:
```bash
npm test && npm run typecheck
git grep -nE "userId|bullmq|ioredis|cockpit" -- src tests prisma package.json
git status --short
```
Expected: 全绿；grep 无输出；`git status` 无 `projects/`、`data/`、`.env`。

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-27-project-agent-rebuild-design.md
git commit -m "docs: README 补口播与转写, spec 记录阶段 3 实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
