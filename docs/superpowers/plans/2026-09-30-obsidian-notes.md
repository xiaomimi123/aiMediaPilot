# Obsidian 长期记忆实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 编导和总助手能检索、读取用户勾选的 Obsidian 文件夹；定稿 / 复盘 / 手动时产品提议把项目笔记写进 `MediaPilot/`，用户在卡片上确认才写。

**Architecture:** `src/lib/notes/` 分四块：配置（库路径与可读文件夹）、库读取（路径安全 + 关键词检索）、笔记拼装与写入（标记区块合并）、提议（建 / 过期 / 确认）。编导新增 3 个工具，`mp notes` 命令让总助手自动获得读取能力；定稿与复盘成功后调用 `proposeSafely`；项目对话里 `note:proposal` 行渲染成确认卡片。

**Tech Stack:** Next.js 14、Prisma 5、zod、node:fs、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-09-30-obsidian-notes-design.md`

## Global Constraints

- 只读：库根下「可读文件夹」+ `MediaPilot`；未勾选文件夹一律不读；任何以 `.` 开头的目录不读；符号链接不跟随；只认 `.md`；单篇超过 6000 字截断并注明"（已截断，全文 N 字）"。
- 只写：`MediaPilot/项目/` 下；产品只改 `<!-- mediapilot:start -->` 与 `<!-- mediapilot:end -->` 之间和 front-matter 的 `stage`、`updated`；区块外原样保留；先写临时文件再 `rename`。
- 笔记正文全部由产品数据拼出；模型只能提供可选的「编导小结」。
- 库找不到时的统一文案：`没找到 Obsidian 库：去设置页填库路径`；越界文案：`这篇笔记不在允许读取的文件夹里`；已处理提议：HTTP 409 `这个提议已经处理过了`。
- 建提议失败不影响定稿与复盘。
- `mp notes` 命令 `hermes: false`。
- 单元测试只用临时目录造的假库，不读用户真实笔记（仓库公开）。

## Review Focus

1. **可读文件夹里有指向私人文件夹的符号链接（或 `../` 路径）**：检索和读取都不能拿到链接指向的内容。→ Task 1 测试 `never follows symlinks out of readable folders`、`refuses paths outside readable folders`。
2. **用户在 Obsidian 里给产品笔记加了自己的段落，之后复盘更新再次存进**：用户段落必须还在。→ Task 2 测试 `keeps content outside the marked region`。
3. **用户自己早就有一篇同名笔记**（没有标记区块）：不能覆盖，换文件名。→ Task 3 测试 `writes beside a user's own note with the same name`。
4. **第 7 天复盘更新时第 3 天的复盘不能从笔记里消失**。→ Task 3 测试 `keeps earlier retro days from the last written note`。
5. **库路径失效时点「存进」**：提议保持 pending 并显示原因，可再点。→ Task 3 测试 `keeps the proposal pending with the reason when writing fails`。

---

## 文件结构

```
src/lib/notes/config.ts        库路径识别、可读文件夹、保存与校验
src/lib/notes/vault.ts         路径安全、扫描、检索、读取
src/lib/notes/note.ts          笔记区块拼装、文件合并、文件名、写入
src/lib/notes/proposals.ts     读项目数据、建提议、过期、确认 / 不要
src/lib/tools/notes.ts         search_notes / read_note / propose_note
src/lib/cli/commands/notes.ts  mp notes search / show
prisma/schema.prisma           + NoteProposal
src/lib/script/finalize.ts     定稿后提议
src/lib/retro/generate.ts      复盘后提议
src/app/api/settings/notes/route.ts
src/app/api/notes/proposals/[id]/route.ts
src/components/settings/obsidian-card.tsx
src/components/project/note-proposal-card.tsx
src/components/project/chat-panel.tsx、project-workspace.tsx、src/lib/project/view.ts
```

---

### Task 1: 配置与库读取

**Files:**
- Create: `src/lib/notes/config.ts`、`src/lib/notes/vault.ts`
- Test: `tests/lib/notes/config.test.ts`、`tests/lib/notes/vault.test.ts`、`tests/lib/notes/fixture.ts`

**Interfaces:**
- Produces（config.ts）：
  - `DEFAULT_READ_FOLDERS = ['5-灵感', '3-资源', '1-项目']`、`WRITE_FOLDER = 'MediaPilot'`、`VAULT_MISSING = '没找到 Obsidian 库：去设置页填库路径'`
  - `interface NotesConfig { vault: string | null; readFolders: string[] }`
  - `detectVault(configPath?: string): Promise<string | null>`
  - `checkVault(vault: string): Promise<string | null>`（问题描述或 null）
  - `listTopFolders(vault: string): Promise<string[]>`
  - `getNotesConfig(db: PrismaClient, configPath?: string): Promise<NotesConfig & { detected: boolean }>`
  - `saveNotesConfig(db: PrismaClient, input: { vault?: string; readFolders?: string[] }): Promise<void>`（不合法抛 `Error`，中文）
- Produces（vault.ts）：
  - `class NotesError extends Error`
  - `interface NoteHit { path: string; title: string; snippet: string; mtime: string }`
  - `resolveReadable(cfg: NotesConfig, rel: string): Promise<string>`（绝对路径）
  - `listReadableNotes(cfg: NotesConfig): Promise<string[]>`（库内相对路径，posix 分隔）
  - `searchNotes(cfg: NotesConfig, query: string, limit?: number): Promise<NoteHit[]>`
  - `readNote(cfg: NotesConfig, rel: string): Promise<{ path: string; title: string; text: string }>`
  - `MAX_NOTE_CHARS = 6000`

- [ ] **Step 1: 测试夹具 `tests/lib/notes/fixture.ts`**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** 临时假库: 仓库公开, 测试绝不读真实笔记 */
export async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-vault-'));
  await fs.mkdir(path.join(root, '.obsidian'));
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}
```

- [ ] **Step 2: 写失败测试**

`tests/lib/notes/vault.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { searchNotes, readNote, listReadableNotes, NotesError } from '@/lib/notes/vault';
import { makeVault } from './fixture';

const FILES = {
  '5-灵感/AI 剪辑翻车.md': '---\ntags: [剪辑]\n---\n用 AI 剪辑翻车了三次，字幕全错。',
  '5-灵感/杂记.md': '今天聊到 AI 剪辑，顺便记一下。剪辑剪辑剪辑剪辑剪辑剪辑',
  '3-资源/工具清单.md': '剪映、CapCut',
  '2-领域/人生/日记.md': 'AI 剪辑 私人内容',
  '5-灵感/.hidden/藏.md': 'AI 剪辑',
  'MediaPilot/项目/旧项目.md': '<!-- mediapilot:start -->\n# 旧项目 AI 剪辑\n<!-- mediapilot:end -->',
};
const cfgOf = (vault: string) => ({ vault, readFolders: ['5-灵感', '3-资源'] });

describe('notes vault', () => {
  it('lists only readable folders plus MediaPilot, skipping hidden dirs', async () => {
    const v = await makeVault(FILES);
    expect((await listReadableNotes(cfgOf(v))).sort()).toEqual(['3-资源/工具清单.md', '5-灵感/AI 剪辑翻车.md', '5-灵感/杂记.md', 'MediaPilot/项目/旧项目.md']);
  });
  it('ranks title hits above body hits and returns a snippet', async () => {
    const v = await makeVault(FILES);
    const hits = await searchNotes(cfgOf(v), '剪辑 翻车');
    expect(hits[0]).toMatchObject({ path: '5-灵感/AI 剪辑翻车.md', title: 'AI 剪辑翻车' });
    expect(hits[0].snippet).toContain('翻车了三次');
    expect(hits.map((h) => h.path)).not.toContain('2-领域/人生/日记.md');
  });
  it('returns nothing for words that appear nowhere', async () => {
    const v = await makeVault(FILES);
    expect(await searchNotes(cfgOf(v), '量子计算')).toEqual([]);
  });
  it('refuses paths outside readable folders', async () => {
    const v = await makeVault(FILES);
    await expect(readNote(cfgOf(v), '2-领域/人生/日记.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
    await expect(readNote(cfgOf(v), '5-灵感/../2-领域/人生/日记.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
    await expect(readNote(cfgOf(v), '5-灵感/.hidden/藏.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
  });
  it('never follows symlinks out of readable folders', async () => {
    const v = await makeVault(FILES);
    await fs.symlink(path.join(v, '2-领域/人生/日记.md'), path.join(v, '5-灵感/链接.md'));
    await fs.symlink(path.join(v, '2-领域/人生'), path.join(v, '5-灵感/人生链接'));
    expect(await listReadableNotes(cfgOf(v))).not.toContain('5-灵感/链接.md');
    expect((await searchNotes(cfgOf(v), '私人')).length).toBe(0);
    await expect(readNote(cfgOf(v), '5-灵感/链接.md')).rejects.toThrow('这篇笔记不在允许读取的文件夹里');
  });
  it('truncates long notes', async () => {
    const v = await makeVault({ '5-灵感/长.md': '字'.repeat(7000) });
    const n = await readNote(cfgOf(v), '5-灵感/长.md');
    expect(n.text.length).toBeLessThan(6100);
    expect(n.text).toContain('（已截断，全文 7000 字）');
  });
  it('reports a missing vault', async () => {
    await expect(searchNotes({ vault: '/nonexistent/vault', readFolders: [] }, 'x')).rejects.toThrow(NotesError);
    await expect(searchNotes({ vault: null, readFolders: [] }, 'x')).rejects.toThrow('没找到 Obsidian 库：去设置页填库路径');
  });
});
```

`tests/lib/notes/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { detectVault, getNotesConfig, saveNotesConfig, listTopFolders, DEFAULT_READ_FOLDERS } from '@/lib/notes/config';
import { makeVault } from './fixture';

function settingsDb() {
  const rows = new Map<string, string>();
  const db = {
    appSetting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) => [...rows].filter(([k]) => where.key.in.includes(k)).map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => void rows.set(where.key, rows.has(where.key) ? update.value : create.value),
    },
  } as unknown as PrismaClient;
  return { db, rows };
}

async function obsidianJson(vaults: Record<string, { path: string; open?: boolean }>) {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mp-obs-')), 'obsidian.json');
  await fs.writeFile(f, JSON.stringify({ vaults }));
  return f;
}

describe('notes config', () => {
  it('detects the open vault from obsidian.json', async () => {
    expect(await detectVault(await obsidianJson({ a: { path: '/x/A' }, b: { path: '/x/B', open: true } }))).toBe('/x/B');
    expect(await detectVault('/nonexistent/obsidian.json')).toBeNull();
  });
  it('falls back to detection and default folders', async () => {
    const { db } = settingsDb();
    expect(await getNotesConfig(db, await obsidianJson({ a: { path: '/x/A' } }))).toEqual({ vault: '/x/A', readFolders: DEFAULT_READ_FOLDERS, detected: true });
  });
  it('saves a valid vault and folders', async () => {
    const v = await makeVault({ '5-灵感/a.md': 'a' });
    const { db } = settingsDb();
    await saveNotesConfig(db, { vault: v, readFolders: ['5-灵感'] });
    expect(await getNotesConfig(db, '/nonexistent')).toEqual({ vault: v, readFolders: ['5-灵感'], detected: false });
  });
  it('rejects a folder without .obsidian and unsafe folder names', async () => {
    const { db } = settingsDb();
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-plain-'));
    await expect(saveNotesConfig(db, { vault: plain })).rejects.toThrow('这个文件夹不是 Obsidian 库');
    await expect(saveNotesConfig(db, { readFolders: ['../外面'] })).rejects.toThrow('文件夹名不对');
    await expect(saveNotesConfig(db, { readFolders: ['.obsidian'] })).rejects.toThrow('文件夹名不对');
  });
  it('lists top-level folders without hidden or underscore ones', async () => {
    const v = await makeVault({ '5-灵感/a.md': 'a', '_模板/t.md': 't', '1-项目/p.md': 'p' });
    expect(await listTopFolders(v)).toEqual(['1-项目', '5-灵感']);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/notes`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `src/lib/notes/config.ts`**

```ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const DEFAULT_READ_FOLDERS = ['5-灵感', '3-资源', '1-项目'];
export const WRITE_FOLDER = 'MediaPilot';
export const VAULT_MISSING = '没找到 Obsidian 库：去设置页填库路径';
export const OBSIDIAN_CONFIG = path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
const K_VAULT = 'obsidian.vault';
const K_FOLDERS = 'obsidian.readFolders';

export interface NotesConfig {
  vault: string | null;
  readFolders: string[];
}

/** Obsidian 自己记录的库; 优先当前打开的那个 */
export async function detectVault(configPath = OBSIDIAN_CONFIG): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(configPath, 'utf8')) as { vaults?: Record<string, { path?: string; open?: boolean }> };
    const vs = Object.values(j.vaults ?? {}).filter((v) => typeof v.path === 'string');
    return (vs.find((v) => v.open) ?? vs[0])?.path ?? null;
  } catch {
    return null;
  }
}

export async function checkVault(vault: string): Promise<string | null> {
  const st = await fs.stat(vault).catch(() => null);
  if (!st?.isDirectory()) return '找不到这个文件夹';
  if (!(await fs.stat(path.join(vault, '.obsidian')).catch(() => null))) return '这个文件夹不是 Obsidian 库（里面没有 .obsidian）';
  return null;
}

export async function listTopFolders(vault: string): Promise<string[]> {
  const es = await fs.readdir(vault, { withFileTypes: true }).catch(() => []);
  return es.filter((e) => e.isDirectory() && !/^[._]/.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
}

export async function getNotesConfig(db: PrismaClient, configPath?: string): Promise<NotesConfig & { detected: boolean }> {
  const rows = await db.appSetting.findMany({ where: { key: { in: [K_VAULT, K_FOLDERS] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  let readFolders = DEFAULT_READ_FOLDERS;
  try {
    const raw = get(K_FOLDERS);
    if (raw) readFolders = z.array(z.string()).parse(JSON.parse(raw));
  } catch {
    // 坏值按默认
  }
  const saved = get(K_VAULT);
  if (saved) return { vault: saved, readFolders, detected: false };
  return { vault: await detectVault(configPath), readFolders, detected: true };
}

const badFolder = (f: string) => !f || path.isAbsolute(f) || f.split(/[\\/]/).some((seg) => seg === '..' || seg.startsWith('.'));

export async function saveNotesConfig(db: PrismaClient, input: { vault?: string; readFolders?: string[] }): Promise<void> {
  if (input.vault !== undefined) {
    const problem = await checkVault(input.vault);
    if (problem) throw new Error(problem);
    await db.appSetting.upsert({ where: { key: K_VAULT }, create: { key: K_VAULT, value: input.vault }, update: { value: input.vault } });
  }
  if (input.readFolders !== undefined) {
    if (input.readFolders.some(badFolder)) throw new Error('文件夹名不对：只能选库里的文件夹');
    const value = JSON.stringify(input.readFolders);
    await db.appSetting.upsert({ where: { key: K_FOLDERS }, create: { key: K_FOLDERS, value }, update: { value } });
  }
}
```

- [ ] **Step 5: 实现 `src/lib/notes/vault.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkVault, VAULT_MISSING, WRITE_FOLDER, type NotesConfig } from './config';

export class NotesError extends Error {}
export const MAX_NOTE_CHARS = 6000;
const OUTSIDE = '这篇笔记不在允许读取的文件夹里';

export interface NoteHit {
  path: string;
  title: string;
  snippet: string;
  mtime: string;
}

async function vaultRoot(cfg: NotesConfig): Promise<string> {
  if (!cfg.vault || (await checkVault(cfg.vault))) throw new NotesError(VAULT_MISSING);
  return fs.realpath(cfg.vault);
}

const roots = (cfg: NotesConfig) => [...new Set([...cfg.readFolders, WRITE_FOLDER])];
const toPosix = (p: string) => p.split(path.sep).join('/');

/** 相对路径 → 绝对路径; 必须是可读文件夹里、非隐藏、非符号链接的 .md */
export async function resolveReadable(cfg: NotesConfig, rel: string): Promise<string> {
  const vault = await vaultRoot(cfg);
  const full = path.resolve(vault, rel);
  const inside = path.relative(vault, full);
  const segs = inside.split(path.sep);
  if (inside.startsWith('..') || path.isAbsolute(inside) || segs.some((s) => s.startsWith('.')) || !full.endsWith('.md')) throw new NotesError(OUTSIDE);
  if (!roots(cfg).some((r) => inside === r || inside.startsWith(r + path.sep))) throw new NotesError(OUTSIDE);
  const lst = await fs.lstat(full).catch(() => null);
  if (!lst) throw new NotesError(`找不到这篇笔记：${rel}`);
  if (lst.isSymbolicLink()) throw new NotesError(OUTSIDE);
  // 中间目录也不能是符号链接
  if ((await fs.realpath(full)) !== full) throw new NotesError(OUTSIDE);
  return full;
}

async function walk(dir: string, out: string[]) {
  const es = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of es) {
    if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
  }
}

export async function listReadableNotes(cfg: NotesConfig): Promise<string[]> {
  const vault = await vaultRoot(cfg);
  const out: string[] = [];
  for (const r of roots(cfg)) {
    const dir = path.join(vault, r);
    const st = await fs.lstat(dir).catch(() => null);
    if (st?.isDirectory()) await walk(dir, out);
  }
  return out.map((p) => toPosix(path.relative(vault, p)));
}

const cache = new Map<string, { mtimeMs: number; text: string }>();
async function readCached(full: string): Promise<{ text: string; mtime: Date }> {
  const st = await fs.stat(full);
  const c = cache.get(full);
  if (c && c.mtimeMs === st.mtimeMs) return { text: c.text, mtime: st.mtime };
  const text = await fs.readFile(full, 'utf8');
  cache.set(full, { mtimeMs: st.mtimeMs, text });
  return { text, mtime: st.mtime };
}

function splitFrontmatter(text: string): { front: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  return m ? { front: m[1], body: text.slice(m[0].length) } : { front: '', body: text };
}

const countOf = (hay: string, w: string) => (w ? hay.split(w).length - 1 : 0);

export async function searchNotes(cfg: NotesConfig, query: string, limit = 8): Promise<NoteHit[]> {
  const vault = await vaultRoot(cfg);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: (NoteHit & { score: number; t: number })[] = [];
  for (const rel of await listReadableNotes(cfg)) {
    const { text, mtime } = await readCached(path.join(vault, rel));
    const title = path.basename(rel, '.md');
    const { front, body } = splitFrontmatter(text);
    const tags = [...body.matchAll(/(^|\s)#([^\s#]+)/g)].map((m) => m[2]).join(' ');
    const [lt, lf, lb] = [title.toLowerCase(), `${front}\n${tags}`.toLowerCase(), body.toLowerCase()];
    let score = 0;
    for (const w of words) score += (lt.includes(w) ? 5 : 0) + (lf.includes(w) ? 3 : 0) + Math.min(countOf(lb, w), 5);
    if (score === 0) continue;
    const at = Math.min(...words.map((w) => lb.indexOf(w)).filter((i) => i >= 0), Infinity);
    const start = at === Infinity ? 0 : Math.max(0, at - 40);
    scored.push({ path: rel, title, snippet: body.slice(start, start + 120).replace(/\s+/g, ' ').trim(), mtime: mtime.toISOString(), score, t: mtime.getTime() });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .slice(0, limit)
    .map(({ score: _s, t: _t, ...h }) => h);
}

export async function readNote(cfg: NotesConfig, rel: string): Promise<{ path: string; title: string; text: string }> {
  const full = await resolveReadable(cfg, rel);
  const { text } = await readCached(full);
  const out = text.length > MAX_NOTE_CHARS ? `${text.slice(0, MAX_NOTE_CHARS)}\n（已截断，全文 ${text.length} 字）` : text;
  return { path: toPosix(rel), title: path.basename(rel, '.md'), text: out };
}
```

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/notes tests/lib/notes
git commit -m "feat(notes): Obsidian 库识别与可读文件夹配置 + 路径安全的检索与读取

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 笔记拼装与写入

**Files:**
- Create: `src/lib/notes/note.ts`
- Test: `tests/lib/notes/note.test.ts`

**Interfaces:**
- Consumes：`NotesConfig`、`checkVault`、`VAULT_MISSING`、`WRITE_FOLDER`（Task 1）、`NotesError`（Task 1）
- Produces：
  - `START = '<!-- mediapilot:start -->'`、`END = '<!-- mediapilot:end -->'`
  - `interface NoteSource { projectId: string; title: string; stage: string; topic: string | null; benchmark: { author: string; digg: number; ratio: number | null; url: string } | null; segments: { label: string; text: string }[]; retro: { dayN: number; viewCount: number | null; likeCount: number | null; stages: { label: string; verdict: string; note: string }[]; narrative: string | null } | null; pastRetroBlocks: string[]; lessons: { text: string; status: string }[]; summary: string | null }`
  - `noteFileName(title: string): string`（`MediaPilot/项目/<名>.md`）
  - `buildRegion(src: NoteSource): string`
  - `retroBlocks(region: string): string[]`
  - `ownerOf(file: string): string | null`（有标记区块时返回 front-matter 的 `mediapilot_id`）
  - `renderFile(existing: string | null, meta: { projectId: string; stage: string; today: string }, region: string): string`
  - `writeProjectNote(cfg: NotesConfig, relPath: string, meta: { projectId: string; stage: string; today: string }, region: string): Promise<string>`（返回实际写入的相对路径）

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildRegion, noteFileName, renderFile, retroBlocks, ownerOf, writeProjectNote, START, END, type NoteSource } from '@/lib/notes/note';
import { makeVault } from './fixture';

const src = (over: Partial<NoteSource> = {}): NoteSource => ({
  projectId: 'cmabc123456',
  title: 'U盘干到品类第一',
  stage: 'scripted',
  topic: '小品类也能做到第一',
  benchmark: { author: '添叔AI雷达', digg: 4008, ratio: 8.6, url: 'https://www.douyin.com/video/1' },
  segments: [{ label: '开场钩子', text: '一个 U 盘能卖到第一？' }],
  retro: null,
  pastRetroBlocks: [],
  lessons: [],
  summary: null,
  ...over,
});
const meta = { projectId: 'cmabc123456', stage: 'scripted', today: '2026-09-30' };

describe('note content', () => {
  it('builds the region from product data', () => {
    const r = buildRegion(src());
    expect(r).toContain('# U盘干到品类第一');
    expect(r).toContain('## 选题\n小品类也能做到第一');
    expect(r).toContain('## 对标\n添叔AI雷达 · 4,008 赞（平时的 8.6 倍） · https://www.douyin.com/video/1');
    expect(r).toContain('## 定稿\n### 开场钩子\n一个 U 盘能卖到第一？');
    expect(r).not.toContain('## 复盘');
    expect(r).not.toContain('## 编导小结');
  });
  it('omits the benchmark and uses the title as topic when there is none', () => {
    const r = buildRegion(src({ benchmark: null, topic: null }));
    expect(r).toContain('## 选题\nU盘干到品类第一');
    expect(r).not.toContain('## 对标');
  });
  it('renders retro, lessons and the editor summary', () => {
    const r = buildRegion(src({
      retro: { dayN: 3, viewCount: 1200, likeCount: 30, stages: [{ label: '开头 2 秒', verdict: 'bad', note: '跳出高' }], narrative: '开头太慢' },
      lessons: [{ text: '第一句直接说结果', status: 'active' }, { text: '少用术语', status: 'candidate' }],
      summary: '这条靠对比撑住了。',
    }));
    expect(r).toContain('## 复盘\n### 第 3 天 · 播放 1,200 · 点赞 30\n- 差 开头 2 秒：跳出高\n编导解读：开头太慢');
    expect(r).toContain('## 写法经验\n- 第一句直接说结果（已采纳）\n- 少用术语（待决定）');
    expect(r).toContain('## 编导小结\n这条靠对比撑住了。');
  });
  it('keeps earlier retro days ordered by day', () => {
    const day3 = retroBlocks(buildRegion(src({ retro: { dayN: 3, viewCount: 1, likeCount: 1, stages: [], narrative: null } })));
    expect(day3).toHaveLength(1);
    const r = buildRegion(src({ retro: { dayN: 7, viewCount: 2, likeCount: 2, stages: [], narrative: null }, pastRetroBlocks: day3 }));
    expect(r.indexOf('### 第 3 天')).toBeLessThan(r.indexOf('### 第 7 天'));
    expect(retroBlocks(r)).toHaveLength(2);
  });
  it('makes a safe file name', () => {
    expect(noteFileName('A/B: C?')).toBe('MediaPilot/项目/AB C.md');
    expect(noteFileName('  ')).toBe('MediaPilot/项目/未命名项目.md');
  });
});

describe('note file', () => {
  it('creates front-matter and region for a new file', () => {
    const f = renderFile(null, meta, 'X');
    expect(f).toBe(`---\nmediapilot_id: cmabc123456\nstage: scripted\nupdated: 2026-09-30\ntags: [mediapilot]\n---\n${START}\nX\n${END}\n`);
    expect(ownerOf(f)).toBe('cmabc123456');
  });
  it('keeps content outside the marked region', () => {
    const old = `${renderFile(null, meta, 'OLD')}\n## 我的想法\n下次试试反问开头\n`;
    const f = renderFile(old, { ...meta, stage: 'published', today: '2026-10-07' }, 'NEW');
    expect(f).toContain(`${START}\nNEW\n${END}`);
    expect(f).not.toContain('OLD');
    expect(f).toContain('## 我的想法\n下次试试反问开头');
    expect(f).toContain('stage: published');
    expect(f).toContain('updated: 2026-10-07');
  });
  it('treats files without markers as the user own', () => {
    expect(ownerOf('# 我自己写的')).toBeNull();
  });
  it('writes into MediaPilot and beside a foreign file with the same name', async () => {
    const v = await makeVault({ 'MediaPilot/项目/同名.md': '# 我自己写的' });
    const cfg = { vault: v, readFolders: [] };
    const rel = await writeProjectNote(cfg, 'MediaPilot/项目/同名.md', meta, 'R');
    expect(rel).toBe('MediaPilot/项目/同名-123456.md');
    expect(await fs.readFile(path.join(v, 'MediaPilot/项目/同名.md'), 'utf8')).toBe('# 我自己写的');
    expect(await fs.readFile(path.join(v, rel), 'utf8')).toContain(`${START}\nR\n${END}`);
    // 同一项目再写: 仍写到带 id 的那篇
    expect(await writeProjectNote(cfg, 'MediaPilot/项目/同名.md', meta, 'R2')).toBe(rel);
  });
  it('refuses paths outside MediaPilot and a missing vault', async () => {
    const v = await makeVault({});
    await expect(writeProjectNote({ vault: v, readFolders: [] }, '5-灵感/x.md', meta, 'R')).rejects.toThrow('只能写进 MediaPilot 文件夹');
    await expect(writeProjectNote({ vault: v, readFolders: [] }, 'MediaPilot/../x.md', meta, 'R')).rejects.toThrow('只能写进 MediaPilot 文件夹');
    await expect(writeProjectNote({ vault: null, readFolders: [] }, 'MediaPilot/项目/a.md', meta, 'R')).rejects.toThrow('没找到 Obsidian 库：去设置页填库路径');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/notes/note.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/notes/note.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkVault, VAULT_MISSING, WRITE_FOLDER, type NotesConfig } from './config';
import { NotesError } from './vault';

export const START = '<!-- mediapilot:start -->';
export const END = '<!-- mediapilot:end -->';

export interface NoteSource {
  projectId: string;
  title: string;
  stage: string;
  topic: string | null;
  benchmark: { author: string; digg: number; ratio: number | null; url: string } | null;
  segments: { label: string; text: string }[];
  retro: { dayN: number; viewCount: number | null; likeCount: number | null; stages: { label: string; verdict: string; note: string }[]; narrative: string | null } | null;
  pastRetroBlocks: string[];
  lessons: { text: string; status: string }[];
  summary: string | null;
}

const V: Record<string, string> = { bad: '差', good: '好', even: '平', na: '—' };
const L: Record<string, string> = { active: '已采纳', candidate: '待决定', rejected: '不要', retired: '已停用' };
const n = (v: number | null) => (v === null ? '—' : v.toLocaleString('en-US'));

export function noteFileName(title: string): string {
  const safe = title.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || '未命名项目';
  return `${WRITE_FOLDER}/项目/${safe}.md`;
}

const dayOf = (block: string) => Number(/^### 第 (\d+) 天/.exec(block)?.[1] ?? 0);

/** 区块里「## 复盘」下的每个「### 第 N 天」小节 */
export function retroBlocks(region: string): string[] {
  const m = /## 复盘\n([\s\S]*?)(?=\n## |$)/.exec(region);
  if (!m) return [];
  return m[1].split(/\n(?=### 第 \d+ 天)/).map((s) => s.trim()).filter((s) => /^### 第 \d+ 天/.test(s));
}

export function buildRegion(src: NoteSource): string {
  const parts = [`# ${src.title}`, `## 选题\n${src.topic ?? src.title}`];
  if (src.benchmark) {
    const b = src.benchmark;
    parts.push(`## 对标\n${b.author} · ${n(b.digg)} 赞${b.ratio ? `（平时的 ${b.ratio} 倍）` : ''} · ${b.url}`);
  }
  if (src.segments.length) parts.push(`## 定稿\n${src.segments.map((s) => `### ${s.label}\n${s.text}`).join('\n\n')}`);
  const blocks = src.pastRetroBlocks.filter((b) => !src.retro || dayOf(b) !== src.retro.dayN);
  if (src.retro) {
    const r = src.retro;
    blocks.push(
      [`### 第 ${r.dayN} 天 · 播放 ${n(r.viewCount)} · 点赞 ${n(r.likeCount)}`, ...r.stages.map((s) => `- ${V[s.verdict] ?? '—'} ${s.label}：${s.note}`), r.narrative ? `编导解读：${r.narrative}` : '']
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (blocks.length) parts.push(`## 复盘\n${blocks.sort((a, b) => dayOf(a) - dayOf(b)).join('\n\n')}`);
  if (src.lessons.length) parts.push(`## 写法经验\n${src.lessons.map((l) => `- ${l.text}（${L[l.status] ?? l.status}）`).join('\n')}`);
  if (src.summary) parts.push(`## 编导小结\n${src.summary}`);
  return parts.join('\n\n');
}

const FRONT = /^---\n([\s\S]*?)\n---\n?/;

export function ownerOf(file: string): string | null {
  if (!file.includes(START) || !file.includes(END)) return null;
  return /^mediapilot_id:\s*(\S+)/m.exec(FRONT.exec(file)?.[1] ?? '')?.[1] ?? null;
}

export function renderFile(existing: string | null, meta: { projectId: string; stage: string; today: string }, region: string): string {
  const block = `${START}\n${region}\n${END}`;
  if (!existing || !existing.includes(START) || !existing.includes(END)) {
    return `---\nmediapilot_id: ${meta.projectId}\nstage: ${meta.stage}\nupdated: ${meta.today}\ntags: [mediapilot]\n---\n${block}\n`;
  }
  const replaced = existing.slice(0, existing.indexOf(START)) + block + existing.slice(existing.indexOf(END) + END.length);
  return replaced.replace(FRONT, (fm) => fm.replace(/^stage:.*$/m, `stage: ${meta.stage}`).replace(/^updated:.*$/m, `updated: ${meta.today}`));
}

const readOrNull = (p: string) => fs.readFile(p, 'utf8').catch(() => null);

export async function writeProjectNote(cfg: NotesConfig, relPath: string, meta: { projectId: string; stage: string; today: string }, region: string): Promise<string> {
  if (!cfg.vault || (await checkVault(cfg.vault))) throw new NotesError(VAULT_MISSING);
  const norm = path.posix.normalize(relPath);
  if (!norm.startsWith(`${WRITE_FOLDER}/`) || norm.includes('..') || !norm.endsWith('.md')) throw new NotesError('只能写进 MediaPilot 文件夹');
  let rel = norm;
  let existing = await readOrNull(path.join(cfg.vault, rel));
  // 同名文件属于别人(用户手建或别的项目): 换带项目 id 的文件名, 不动原文件
  if (existing !== null && ownerOf(existing) !== meta.projectId) {
    rel = norm.replace(/\.md$/, `-${meta.projectId.slice(-6)}.md`);
    existing = await readOrNull(path.join(cfg.vault, rel));
    if (existing !== null && ownerOf(existing) !== meta.projectId) throw new NotesError(`${rel} 已经有别的笔记，没有覆盖`);
  }
  const full = path.join(cfg.vault, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.mp-tmp`;
  await fs.writeFile(tmp, renderFile(existing, meta, region));
  await fs.rename(tmp, full);
  return rel;
}
```

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/notes tests/lib/notes
git commit -m "feat(notes): 项目笔记拼装(选题/对标/定稿/复盘/经验) + 只改标记区块的安全写入

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 提议（数据表、建、过期、确认）与定稿 / 复盘触发

**Files:**
- Modify: `prisma/schema.prisma`（+ `NoteProposal`，`Project` 加 `noteProposals NoteProposal[]`）
- Create: `src/lib/notes/proposals.ts`
- Modify: `src/lib/script/finalize.ts`、`src/lib/retro/generate.ts`
- Test: `tests/lib/notes/proposals.test.ts`、`tests/lib/script/finalize.test.ts`、`tests/lib/retro/generate.test.ts`

**Interfaces:**
- Consumes：`buildRegion`、`noteFileName`、`retroBlocks`、`writeProjectNote`、`NoteSource`（Task 2）、`getNotesConfig`、`NotesConfig`（Task 1）
- Produces：
  - `PROPOSAL_PROMPT = '要把这个项目存进 Obsidian 吗？'`
  - `type ProposalTrigger = 'finalize' | 'retro' | 'manual'`
  - `interface ProposalView { id: string; projectId: string; trigger: string; path: string; content: string; status: string; error: string | null; createdAt: string }`
  - `class ProposalConflict extends Error`
  - `loadNoteSource(db: PrismaClient, projectId: string, summary?: string | null): Promise<NoteSource>`
  - `createProposal(db: PrismaClient, p: { projectId: string; trigger: ProposalTrigger; path: string; content: string }): Promise<string>`（返回 id）
  - `proposeProjectNote(db: PrismaClient, projectId: string, trigger: ProposalTrigger, summary?: string | null): Promise<string>`
  - `proposeSafely(db: PrismaClient, projectId: string, trigger: ProposalTrigger): Promise<void>`
  - `toProposalView(row): ProposalView`
  - `decideProposal(db: PrismaClient, id: string, action: 'accept' | 'reject', cfg: NotesConfig, today: string): Promise<ProposalView>`（不存在抛 `Error('找不到这个提议')`；非 pending 抛 `ProposalConflict('这个提议已经处理过了')`；写入失败返回 pending + error，不抛）
  - `finalizeScript(db, projectId, propose?: (projectId: string) => Promise<void>)`
  - `RetroDeps.proposeNote?(projectId: string): Promise<void>`

- [ ] **Step 1: schema**

在 `prisma/schema.prisma` 末尾追加 spec §5.1 的 `NoteProposal`；在 `model Project` 的关系列表里加一行 `noteProposals   NoteProposal[]`。

Run: `npx prisma db push && npm run typecheck`
Expected: in sync；0 错误。

- [ ] **Step 2: 写失败测试**

`tests/lib/notes/proposals.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { createProposal, decideProposal, PROPOSAL_PROMPT, ProposalConflict } from '@/lib/notes/proposals';
import { START } from '@/lib/notes/note';
import { makeVault } from './fixture';

type Row = { id: string; projectId: string; trigger: string; path: string; content: string; status: string; error: string | null; createdAt: Date; updatedAt: Date };

function proposalDb(stage = 'scripted') {
  const rows: Row[] = [];
  const chat: { projectId: string; role: string; content: string; toolName: string; toolResult: unknown }[] = [];
  let seq = 0;
  const db = {
    noteProposal: {
      updateMany: async ({ where, data }: { where: { projectId: string; status: string }; data: Partial<Row> }) => {
        const hit = rows.filter((r) => r.projectId === where.projectId && r.status === where.status);
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      create: async ({ data }: { data: Omit<Row, 'id' | 'status' | 'error' | 'createdAt' | 'updatedAt'> }) => {
        const r: Row = { id: `np${++seq}`, status: 'pending', error: null, createdAt: new Date(), updatedAt: new Date(), ...data };
        rows.push(r);
        return { ...r };
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return { ...r };
      },
    },
    project: { findUnique: async () => ({ id: 'cmabc123456', stage }) },
    chatMessage: { create: async ({ data }: { data: (typeof chat)[number] }) => void chat.push(data) },
  } as unknown as PrismaClient;
  return { db, rows, chat };
}

const base = { projectId: 'cmabc123456', trigger: 'finalize' as const, path: 'MediaPilot/项目/测试.md', content: '# 测试' };

describe('note proposals', () => {
  it('expires older pending proposals and posts a card line in the project chat', async () => {
    const { db, rows, chat } = proposalDb();
    const a = await createProposal(db, base);
    const b = await createProposal(db, { ...base, trigger: 'retro' });
    expect(rows.find((r) => r.id === a)!.status).toBe('expired');
    expect(rows.find((r) => r.id === b)!.status).toBe('pending');
    expect(chat.at(-1)).toMatchObject({ projectId: 'cmabc123456', role: 'system', content: PROPOSAL_PROMPT, toolName: 'note:proposal', toolResult: { ok: true, proposalId: b } });
  });
  it('writes the note on accept', async () => {
    const v = await makeVault({});
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    const view = await decideProposal(db, id, 'accept', { vault: v, readFolders: [] }, '2026-09-30');
    expect(view).toMatchObject({ status: 'written', path: 'MediaPilot/项目/测试.md', error: null });
    expect(await fs.readFile(path.join(v, 'MediaPilot/项目/测试.md'), 'utf8')).toContain(`${START}\n# 测试`);
  });
  it('rejects without writing', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    expect((await decideProposal(db, id, 'reject', { vault: null, readFolders: [] }, '2026-09-30')).status).toBe('rejected');
  });
  it('refuses a proposal that was already handled', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    await createProposal(db, base);
    await expect(decideProposal(db, id, 'accept', { vault: null, readFolders: [] }, '2026-09-30')).rejects.toThrow(ProposalConflict);
  });
  it('keeps the proposal pending with the reason when writing fails', async () => {
    const { db } = proposalDb();
    const id = await createProposal(db, base);
    const view = await decideProposal(db, id, 'accept', { vault: '/nonexistent/vault', readFolders: [] }, '2026-09-30');
    expect(view).toMatchObject({ status: 'pending', error: '没找到 Obsidian 库：去设置页填库路径' });
  });
});
```

`tests/lib/notes/proposals.test.ts` 追加一个 describe，覆盖 Review Focus 4（第 7 天保留第 3 天）——通过 `loadNoteSource` 的纯函数部分测试。为此 `proposals.ts` 导出 `pastBlocksFrom(content: string | null): string[]`（= `content ? retroBlocks(content) : []`），并测试：

```ts
import { pastBlocksFrom } from '@/lib/notes/proposals';
import { buildRegion } from '@/lib/notes/note';

describe('retro history', () => {
  it('keeps earlier retro days from the last written note', () => {
    const src = { projectId: 'p', title: 't', stage: 'published', topic: null, benchmark: null, segments: [], pastRetroBlocks: [], lessons: [], summary: null };
    const day3 = buildRegion({ ...src, retro: { dayN: 3, viewCount: 1, likeCount: 1, stages: [], narrative: null } });
    const day7 = buildRegion({ ...src, retro: { dayN: 7, viewCount: 9, likeCount: 9, stages: [], narrative: null }, pastRetroBlocks: pastBlocksFrom(day3) });
    expect(day7).toContain('### 第 3 天 · 播放 1');
    expect(day7).toContain('### 第 7 天 · 播放 9');
    expect(pastBlocksFrom(null)).toEqual([]);
  });
});
```

`tests/lib/script/finalize.test.ts` 追加：

```ts
  it('proposes a note only when moving draft → scripted', async () => {
    const propose = vi.fn(async () => {});
    const { db } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1', propose);
    await finalizeScript(db, 'p1', propose);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(propose).toHaveBeenCalledWith('p1');
  });
  it('still finalizes when proposing fails', async () => {
    const { db, project } = createFakeDb({ project: { script } });
    await finalizeScript(db, 'p1', async () => { throw new Error('boom'); });
    expect(project.stage).toBe('scripted');
  });
```

（文件头 import 改为 `import { describe, expect, it, vi } from 'vitest';`）

`tests/lib/retro/generate.test.ts` 在 `describe` 里追加（沿用文件里的 `deps()` 工厂）：

```ts
  it('proposes a note after saving, and a failed proposal does not fail the retro', async () => {
    const proposeNote = vi.fn(async () => { throw new Error('vault gone'); });
    const { d, saved } = deps({ proposeNote });
    expect(await generateRetro(d, 'p1')).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(proposeNote).toHaveBeenCalledWith('p1');
  });
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/notes tests/lib/script/finalize.test.ts tests/lib/retro/generate.test.ts`
Expected: FAIL（proposals 模块不存在；finalize / generate 新用例失败）。

- [ ] **Step 4: 实现 `src/lib/notes/proposals.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { ScriptSchema, ROLE_LABEL } from '@/lib/script/model';
import { AnalysisSchema } from '@/lib/benchmark/analyze';
import { buildRegion, noteFileName, retroBlocks, writeProjectNote, type NoteSource } from './note';
import type { NotesConfig } from './config';

export const PROPOSAL_PROMPT = '要把这个项目存进 Obsidian 吗？';
export type ProposalTrigger = 'finalize' | 'retro' | 'manual';
export class ProposalConflict extends Error {}

export interface ProposalView {
  id: string;
  projectId: string;
  trigger: string;
  path: string;
  content: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export const toProposalView = (r: { id: string; projectId: string; trigger: string; path: string; content: string; status: string; error: string | null; createdAt: Date }): ProposalView => ({
  id: r.id,
  projectId: r.projectId,
  trigger: r.trigger,
  path: r.path,
  content: r.content,
  status: r.status,
  error: r.error,
  createdAt: r.createdAt.toISOString(),
});

export const pastBlocksFrom = (content: string | null) => (content ? retroBlocks(content) : []);

export async function loadNoteSource(db: PrismaClient, projectId: string, summary: string | null = null): Promise<NoteSource> {
  const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { benchmarkVideo: { include: { account: true } }, retro: true } });
  const script = ScriptSchema.safeParse(p.script);
  const a = p.benchmarkVideo ? AnalysisSchema.safeParse(p.benchmarkVideo.analysis) : null;
  const work = p.retro ? await db.publishedWork.findUnique({ where: { id: p.retro.workId } }) : null;
  const d = p.retro?.diagnosis as { stages?: { label: string; verdict: string; note: string }[] } | undefined;
  const lessons = p.retro ? await db.writingLesson.findMany({ where: { retroId: p.retro.id }, orderBy: { createdAt: 'asc' } }) : [];
  const lastWritten = await db.noteProposal.findFirst({ where: { projectId, status: 'written' }, orderBy: { updatedAt: 'desc' } });
  return {
    projectId,
    title: p.title,
    stage: p.stage,
    topic: a?.success ? a.data.topic : null,
    benchmark: p.benchmarkVideo ? { author: p.benchmarkVideo.account.nickname, digg: p.benchmarkVideo.digg, ratio: p.benchmarkVideo.ratio, url: p.benchmarkVideo.url } : null,
    segments: script.success ? script.data.segments.map((s) => ({ label: ROLE_LABEL[s.role], text: s.text })) : [],
    retro: p.retro ? { dayN: p.retro.dayN, viewCount: work?.viewCount ?? null, likeCount: work?.likeCount ?? null, stages: d?.stages ?? [], narrative: p.retro.narrative } : null,
    pastRetroBlocks: pastBlocksFrom(lastWritten?.content ?? null),
    lessons: lessons.map((l) => ({ text: l.text, status: l.status })),
    summary,
  };
}

export async function createProposal(db: PrismaClient, p: { projectId: string; trigger: ProposalTrigger; path: string; content: string }): Promise<string> {
  await db.noteProposal.updateMany({ where: { projectId: p.projectId, status: 'pending' }, data: { status: 'expired' } });
  const row = await db.noteProposal.create({ data: p });
  await db.chatMessage.create({ data: { projectId: p.projectId, role: 'system', content: PROPOSAL_PROMPT, toolName: 'note:proposal', toolResult: { ok: true, proposalId: row.id } } });
  return row.id;
}

export async function proposeProjectNote(db: PrismaClient, projectId: string, trigger: ProposalTrigger, summary: string | null = null): Promise<string> {
  const src = await loadNoteSource(db, projectId, summary);
  return createProposal(db, { projectId, trigger, path: noteFileName(src.title), content: buildRegion(src) });
}

/** 定稿 / 复盘后调用: 提议失败只记日志, 不影响主流程 */
export async function proposeSafely(db: PrismaClient, projectId: string, trigger: ProposalTrigger): Promise<void> {
  try {
    await proposeProjectNote(db, projectId, trigger);
  } catch (e) {
    console.warn(`[notes] 提议失败 ${projectId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function decideProposal(db: PrismaClient, id: string, action: 'accept' | 'reject', cfg: NotesConfig, today: string): Promise<ProposalView> {
  const p = await db.noteProposal.findUnique({ where: { id } });
  if (!p) throw new Error('找不到这个提议');
  if (p.status !== 'pending') throw new ProposalConflict('这个提议已经处理过了');
  if (action === 'reject') return toProposalView(await db.noteProposal.update({ where: { id }, data: { status: 'rejected', error: null } }));
  const project = await db.project.findUnique({ where: { id: p.projectId } });
  try {
    const rel = await writeProjectNote(cfg, p.path, { projectId: p.projectId, stage: project?.stage ?? 'draft', today }, p.content);
    return toProposalView(await db.noteProposal.update({ where: { id }, data: { status: 'written', path: rel, error: null } }));
  } catch (e) {
    return toProposalView(await db.noteProposal.update({ where: { id }, data: { error: e instanceof Error ? e.message : String(e) } }));
  }
}
```

- [ ] **Step 5: 接入定稿与复盘**

`src/lib/script/finalize.ts`：

```ts
import type { PrismaClient } from '@prisma/client';
import { ScriptSchema } from './model';
import { proposeSafely } from '@/lib/notes/proposals';

export async function finalizeScript(db: PrismaClient, projectId: string, propose: (projectId: string) => Promise<void> = (id) => proposeSafely(db, id, 'finalize')) {
  const p = await db.project.findUnique({ where: { id: projectId } });
  if (!p) throw new Error('项目不存在或已删除');
  if (!ScriptSchema.safeParse(p.script).success) throw new Error('还没有稿子，不能定稿');
  // 只从写稿中前进; 已定稿/已录制/已出片/已发布的不动(阶段只前进)
  if (p.stage !== 'draft') return p;
  const updated = await db.project.update({ where: { id: projectId }, data: { stage: 'scripted' } });
  // 定稿后提议存进 Obsidian; 失败不影响定稿
  await propose(projectId).catch(() => {});
  return updated;
}
```

（保留文件原有 import；若原文件 import 顺序不同，只增加 `proposeSafely` 一行。）

`src/lib/retro/generate.ts`：
- `RetroDeps` 加 `proposeNote?(projectId: string): Promise<void>;`
- `generateRetro` 里 `await deps.save(...)` 之后、`return { ok: true }` 之前加：

```ts
  // 复盘后提议存进 Obsidian; 失败不影响复盘
  await deps.proposeNote?.(projectId).catch(() => {});
```

- `createRetroDeps` 返回对象加 `proposeNote: (id) => proposeSafely(db, id, 'retro'),`（import `proposeSafely`）。

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（原 finalize / generate 用例不变；fake db 没有 `noteProposal` 时 `proposeSafely` 吞掉错误）。

```bash
git add prisma/schema.prisma src/lib/notes src/lib/script/finalize.ts src/lib/retro/generate.ts tests/lib
git commit -m "feat(notes): 存进 Obsidian 的提议(过期旧提议/对话卡片行/确认写入/失败保留) + 定稿与复盘后自动提议

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 编导工具、编导规则与 `mp notes` 命令

**Files:**
- Create: `src/lib/tools/notes.ts`、`src/lib/cli/commands/notes.ts`
- Modify: `src/lib/tools/index.ts`、`src/lib/cli/index.ts`、`src/lib/agent/context.ts`
- Test: `tests/lib/tools/notes.test.ts`、`tests/lib/cli/notes.test.ts`、`tests/lib/agent/context.test.ts`（追加）

**Interfaces:**
- Consumes：`getNotesConfig`（Task 1）、`searchNotes`、`readNote`、`NotesError`（Task 1）、`proposeProjectNote`（Task 3）
- Produces：
  - `searchNotesTool: Tool<{ query: string }>`（name `search_notes`）；`readNoteTool: Tool<{ path: string }>`（`read_note`）；`proposeNoteTool: Tool<{ summary?: string }>`（`propose_note`）
  - `makeNotesTools(getCfg: (db: PrismaClient) => Promise<NotesConfig>)` 返回上面三个（测试注入配置）
  - `NOTES_COMMANDS: Command[]`（`notes search`、`notes show`，tier `read`，`hermes: false`）
  - `formatHitsText(hits: NoteHit[]): string`

- [ ] **Step 1: 写失败测试**

`tests/lib/tools/notes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeNotesTools } from '@/lib/tools/notes';
import { makeVault } from '../notes/fixture';

const ctx = { projectId: 'p1', db: {} as never, llm: {} as never };

describe('notes tools', () => {
  it('searches and reads notes with text for the model', async () => {
    const v = await makeVault({ '5-灵感/AI 剪辑翻车.md': '用 AI 剪辑翻车了三次' });
    const [search, read] = makeNotesTools(async () => ({ vault: v, readFolders: ['5-灵感'] }));
    const s = await search.execute(ctx, { query: '翻车' });
    expect(s).toMatchObject({ ok: true, summary: '搜笔记「翻车」：找到 1 篇' });
    expect((s.data as { text: string }).text).toContain('5-灵感/AI 剪辑翻车.md');
    const r = await read.execute(ctx, { path: '5-灵感/AI 剪辑翻车.md' });
    expect(r).toMatchObject({ ok: true, summary: '读笔记：AI 剪辑翻车' });
    expect((r.data as { text: string }).text).toContain('翻车了三次');
  });
  it('fails readably when the vault is missing or the path is outside', async () => {
    const v = await makeVault({ '2-领域/人生/日记.md': '私人' });
    const [search, read] = makeNotesTools(async () => ({ vault: null, readFolders: [] }));
    expect(await search.execute(ctx, { query: 'x' })).toMatchObject({ ok: false, summary: '搜笔记失败：没找到 Obsidian 库：去设置页填库路径' });
    const [, read2] = makeNotesTools(async () => ({ vault: v, readFolders: ['5-灵感'] }));
    expect(await read2.execute(ctx, { path: '2-领域/人生/日记.md' })).toMatchObject({ ok: false, summary: '读笔记失败：这篇笔记不在允许读取的文件夹里' });
    expect(read.name).toBe('read_note');
  });
});
```

`tests/lib/cli/notes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NOTES_COMMANDS, formatHitsText } from '@/lib/cli/commands/notes';

describe('mp notes', () => {
  it('is readable by claude-code but not by hermes', () => {
    expect(NOTES_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([['notes search', 'read', false], ['notes show', 'read', false]]);
  });
  it('formats hits', () => {
    expect(formatHitsText([{ path: '5-灵感/a.md', title: 'a', snippet: '片段', mtime: '2026-09-30T00:00:00.000Z' }])).toBe('[5-灵感/a.md] a：片段');
    expect(formatHitsText([])).toBe('笔记里没找到相关内容。');
  });
});
```

`tests/lib/agent/context.test.ts`（若存在则追加一个 it；不存在则新建）：

```ts
import { describe, expect, it } from 'vitest';
import { formatSystemPrompt } from '@/lib/agent/context';

describe('editor rules for notes', () => {
  it('tells the editor to search notes, cite them in the reply and never fill 待补 from them', () => {
    const p = formatSystemPrompt({ title: 't', stage: 'draft', targetSec: 60, script: null, persona: null });
    expect(p).toContain('search_notes');
    expect(p).toContain('[[笔记名]]');
    expect(p).toContain('propose_note');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/tools/notes.test.ts tests/lib/cli/notes.test.ts tests/lib/agent/context.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/cli/commands/notes.ts`**

```ts
import { getNotesConfig } from '@/lib/notes/config';
import { readNote, searchNotes, NotesError, type NoteHit } from '@/lib/notes/vault';
import { CliError, needArg, type Command } from '../registry';

export function formatHitsText(hits: NoteHit[]): string {
  if (!hits.length) return '笔记里没找到相关内容。';
  return hits.map((h) => `[${h.path}] ${h.title}：${h.snippet}`).join('\n');
}

const wrap = async <T>(f: () => Promise<T>) => {
  try {
    return await f();
  } catch (e) {
    if (e instanceof NotesError) throw new CliError('not_found', e.message);
    throw e;
  }
};

/** 笔记只给 Claude Code 与总助手, 不给微信那边(hermes: false) */
export const NOTES_COMMANDS: Command[] = [
  {
    path: ['notes', 'search'],
    tier: 'read',
    hermes: false,
    usage: 'mp notes search <关键词…>',
    summary: '搜 Obsidian 笔记',
    run: (ctx, p) =>
      wrap(async () => {
        needArg(p, 0, '关键词');
        return searchNotes(await getNotesConfig(ctx.db), p.positionals.join(' '));
      }),
    format: (d) => formatHitsText(d as NoteHit[]),
  },
  {
    path: ['notes', 'show'],
    tier: 'read',
    hermes: false,
    usage: 'mp notes show <笔记路径>',
    summary: '读一篇 Obsidian 笔记',
    run: (ctx, p) => wrap(async () => readNote(await getNotesConfig(ctx.db), needArg(p, 0, '笔记路径'))),
    format: (d) => (d as { text: string }).text,
  },
];
```

`src/lib/cli/index.ts`：import `NOTES_COMMANDS` 并加入 `ALL_COMMANDS`（放在 `READ_COMMANDS` 之后）。

- [ ] **Step 4: 实现 `src/lib/tools/notes.ts`**

```ts
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { Tool } from './types';
import { getNotesConfig, type NotesConfig } from '@/lib/notes/config';
import { readNote, searchNotes } from '@/lib/notes/vault';
import { proposeProjectNote } from '@/lib/notes/proposals';
import { formatHitsText } from '@/lib/cli/commands/notes';

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SearchInput = z.object({ query: z.string().min(1).describe('关键词, 多个用空格隔开') });
const ReadInput = z.object({ path: z.string().min(1).describe('search_notes 返回的笔记路径') });
const ProposeInput = z.object({ summary: z.string().max(200).optional().describe('一两句编导小结, 可不填') });

export function makeNotesTools(getCfg: (db: PrismaClient) => Promise<NotesConfig> = (db) => getNotesConfig(db)) {
  const search: Tool<z.infer<typeof SearchInput>> = {
    name: 'search_notes',
    label: '搜笔记',
    description: '在用户 Obsidian 里允许读取的文件夹中按关键词搜笔记，返回路径、标题和命中片段。写稿前用来找用户自己的观点、案例和经历。',
    input: SearchInput,
    async execute(ctx, { query }) {
      try {
        const hits = await searchNotes(await getCfg(ctx.db), query);
        return { ok: true, summary: `搜笔记「${query}」：找到 ${hits.length} 篇`, data: { text: formatHitsText(hits), hits } };
      } catch (e) {
        return { ok: false, summary: `搜笔记失败：${msg(e)}`, data: { error: msg(e) } };
      }
    },
  };
  const read: Tool<z.infer<typeof ReadInput>> = {
    name: 'read_note',
    label: '读笔记',
    description: '读取一篇用户笔记的全文（路径来自 search_notes）。',
    input: ReadInput,
    async execute(ctx, { path }) {
      try {
        const n = await readNote(await getCfg(ctx.db), path);
        return { ok: true, summary: `读笔记：${n.title}`, data: { text: n.text, path: n.path } };
      } catch (e) {
        return { ok: false, summary: `读笔记失败：${msg(e)}`, data: { error: msg(e) } };
      }
    },
  };
  const propose: Tool<z.infer<typeof ProposeInput>> = {
    name: 'propose_note',
    label: '提议存进 Obsidian',
    description: '用户要把这个项目存进笔记 / Obsidian 时调用：产品会在对话里放一张确认卡片，用户点确认才写。可附一两句编导小结。',
    input: ProposeInput,
    async execute(ctx, { summary }) {
      await proposeProjectNote(ctx.db, ctx.projectId, 'manual', summary ?? null);
      return { ok: true, summary: '已提议存进 Obsidian，等你在卡片上确认' };
    },
  };
  return [search, read, propose] as const;
}

export const [searchNotesTool, readNoteTool, proposeNoteTool] = makeNotesTools();
```

`src/lib/tools/index.ts`：`SCRIPT_TOOLS` 追加 `searchNotesTool, readNoteTool, proposeNoteTool`（import 自 `./notes`）。

- [ ] **Step 5: 编导规则**

`src/lib/agent/context.ts` 的 `RULES`，在"有【写法经验】时"一行之后加两行：

```
- 用户的 Obsidian 笔记：写稿前如果这个选题可能在用户笔记里有积累，先调用 search_notes，需要时 read_note 看全文；优先用用户自己的观点、案例和经历。稿子是口播，正文里不写 [[ ]]；在回复里说明借用了哪篇，如「开场的例子来自 [[笔记名]]」。不拿笔记去编【待补】处的经历，只引用笔记里真实写着的内容。
- 用户要把这个项目存进笔记 / Obsidian：调用 propose_note（可附一两句编导小结），然后告诉用户在卡片上确认。
```

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（总助手的工具清单测试仍通过：`notes_search`、`notes_show` 自动加入）。

```bash
git add src/lib/tools src/lib/cli src/lib/agent/context.ts tests/lib
git commit -m "feat(notes): 编导 search_notes / read_note / propose_note + 写稿规则; mp notes search/show(总助手可用, Hermes 不可用)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 接口

**Files:**
- Create: `src/app/api/settings/notes/route.ts`、`src/app/api/notes/proposals/[id]/route.ts`
- Modify: `src/lib/project/view.ts`（`MessageView` 加 `proposalId?: string | null`）
- Test: `tests/lib/project/view.test.ts`（追加）

**Interfaces:**
- HTTP：
  - `GET /api/settings/notes` → `NotesSettingsView = { vault: string | null; detected: boolean; vaultProblem: string | null; readFolders: string[]; topFolders: string[]; missing: string[]; writeFolder: 'MediaPilot'; noteCount: number | null }`
  - `PUT /api/settings/notes` body `{ vault?: string; readFolders?: string[] }` → 同上；不合法 400 + 中文
  - `GET /api/notes/proposals/[id]` → `ProposalView`；不存在 404
  - `POST /api/notes/proposals/[id]` body `{ action: 'accept' | 'reject' }` → `ProposalView`；已处理 409 `这个提议已经处理过了`
- `toMessageView` 从 `toolResult.proposalId` 取 `proposalId`。

- [ ] **Step 1: 写失败测试（view）**

`tests/lib/project/view.test.ts` 末尾追加：

```ts
describe('toMessageView proposal', () => {
  it('exposes the note proposal id', () => {
    expect(toMessageView({ id: 'm', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', toolResult: { ok: true, proposalId: 'np1' } }).proposalId).toBe('np1');
    expect(toMessageView({ id: 'm', role: 'user', content: 'x', toolName: null, toolResult: null }).proposalId).toBeNull();
  });
});
```

Run: `npx vitest run tests/lib/project/view.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现**

`src/lib/project/view.ts`：`MessageView` 加 `proposalId?: string | null;`；`toMessageView` 返回值加 `proposalId: m.toolResult && typeof m.toolResult === 'object' && typeof (m.toolResult as { proposalId?: unknown }).proposalId === 'string' ? (m.toolResult as { proposalId: string }).proposalId : null`。

`src/app/api/settings/notes/route.ts`:

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { checkVault, getNotesConfig, listTopFolders, saveNotesConfig, WRITE_FOLDER } from '@/lib/notes/config';
import { listReadableNotes } from '@/lib/notes/vault';

export const dynamic = 'force-dynamic';

export interface NotesSettingsView {
  vault: string | null;
  detected: boolean;
  vaultProblem: string | null;
  readFolders: string[];
  topFolders: string[];
  missing: string[];
  writeFolder: string;
  noteCount: number | null;
}

async function view(): Promise<NotesSettingsView> {
  const cfg = await getNotesConfig(prisma);
  const vaultProblem = cfg.vault ? await checkVault(cfg.vault) : '没找到 Obsidian 库：填库路径';
  const topFolders = cfg.vault && !vaultProblem ? await listTopFolders(cfg.vault) : [];
  const missing: string[] = [];
  if (cfg.vault && !vaultProblem) for (const f of cfg.readFolders) if (!(await fs.stat(path.join(cfg.vault, f)).catch(() => null))) missing.push(f);
  const noteCount = vaultProblem ? null : (await listReadableNotes(cfg).catch(() => [])).length;
  return { vault: cfg.vault, detected: cfg.detected, vaultProblem, readFolders: cfg.readFolders, topFolders, missing, writeFolder: WRITE_FOLDER, noteCount };
}

export async function GET() {
  return ok(await view());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { vault?: unknown; readFolders?: unknown };
  const vault = typeof body.vault === 'string' ? body.vault.trim() : undefined;
  const readFolders = Array.isArray(body.readFolders) && body.readFolders.every((f) => typeof f === 'string') ? (body.readFolders as string[]) : undefined;
  try {
    await saveNotesConfig(prisma, { vault, readFolders });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok(await view());
}
```

`src/app/api/notes/proposals/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getNotesConfig } from '@/lib/notes/config';
import { decideProposal, ProposalConflict, toProposalView } from '@/lib/notes/proposals';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.noteProposal.findUnique({ where: { id: params.id } });
  if (!p) return fail('找不到这个提议', 404);
  return ok(toProposalView(p));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'accept' && body.action !== 'reject') return fail('action 只能是 accept 或 reject', 400);
  try {
    const today = new Date().toLocaleDateString('sv-SE');
    return ok(await decideProposal(prisma, params.id, body.action, await getNotesConfig(prisma), today));
  } catch (e) {
    if (e instanceof ProposalConflict) return fail(e.message, 409);
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
}
```

- [ ] **Step 3: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（改了 schema、加了 API 目录 → 重启 dev）：`curl localhost:3000/api/settings/notes` 看到自动识别的库、默认三个文件夹、`noteCount` 为数字、`topFolders` 里没有 `.obsidian` / `_模板`。

```bash
git add src/lib/project/view.ts src/app/api/settings/notes src/app/api/notes tests/lib/project
git commit -m "feat(notes): Obsidian 设置接口 + 提议读取/确认接口, 对话消息带提议 id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 页面（设置卡片 + 确认卡片）

**Files:**
- Create: `src/components/settings/obsidian-card.tsx`、`src/components/project/note-proposal-card.tsx`
- Modify: `src/app/settings/page.tsx`、`src/components/project/chat-panel.tsx`、`src/components/project/project-workspace.tsx`
- Test: `tests/components/settings/obsidian-card.test.tsx`、`tests/components/note-proposal-card.test.tsx`、`tests/components/chat-panel.test.tsx`（追加）、`tests/components/project-workspace.test.tsx`（追加）

**Interfaces:**
- Consumes：`NotesSettingsView`、`ProposalView`、`MessageView.proposalId`（Task 5）
- Produces：`ObsidianCard()`、`NoteProposalCard({ proposalId }: { proposalId: string })`

- [ ] **Step 1: 写失败测试**

`tests/components/note-proposal-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteProposalCard } from '@/components/project/note-proposal-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (over = {}) => ({ id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/测试.md', content: '# 测试\n\n## 定稿', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z', ...over });

describe('NoteProposalCard', () => {
  it('previews and writes on confirm', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'POST' ? view({ status: 'written' }) : view() }) }));
    vi.stubGlobal('fetch', f);
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText('MediaPilot/项目/测试.md')).toBeTruthy());
    fireEvent.click(screen.getByText('预览'));
    expect(screen.getByText(/## 定稿/)).toBeTruthy();
    fireEvent.click(screen.getByText('存进 Obsidian'));
    await waitFor(() => expect(screen.getByText('已存进 Obsidian')).toBeTruthy());
    expect(JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'accept' });
  });
  it('shows the failure reason and keeps the buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: view({ error: '没找到 Obsidian 库：去设置页填库路径' }) }) })));
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText(/没找到 Obsidian 库/)).toBeTruthy());
    expect(screen.getByText('存进 Obsidian')).toBeTruthy();
  });
  it('disables handled proposals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: view({ status: 'expired' }) }) })));
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText('已过期')).toBeTruthy());
    expect(screen.queryByText('存进 Obsidian')).toBeNull();
  });
});
```

`tests/components/settings/obsidian-card.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ObsidianCard } from '@/components/settings/obsidian-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = { vault: '/v', detected: true, vaultProblem: null, readFolders: ['5-灵感', '旧文件夹'], topFolders: ['1-项目', '5-灵感'], missing: ['旧文件夹'], writeFolder: 'MediaPilot', noteCount: 42 };

describe('ObsidianCard', () => {
  it('shows the vault, folders, missing ones and saves toggles', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'PUT' ? { ...data, readFolders: ['5-灵感', '旧文件夹', '1-项目'] } : data }) }));
    vi.stubGlobal('fetch', f);
    render(<ObsidianCard />);
    await waitFor(() => expect(screen.getByDisplayValue('/v')).toBeTruthy());
    expect(screen.getByText('可读 42 篇笔记')).toBeTruthy();
    expect(screen.getByText(/旧文件夹.*找不到/)).toBeTruthy();
    expect(screen.getByText('写入文件夹：MediaPilot/（总是可读）')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('1-项目'));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ readFolders: ['5-灵感', '旧文件夹', '1-项目'] });
  });
});
```

`tests/components/chat-panel.test.tsx` 末尾追加：

```tsx
describe('ChatPanel note proposals', () => {
  it('renders a note proposal line as a card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/x.md', content: 'x', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z' } }) })));
    render(<ChatPanel projectId="p1" initialMessages={[{ id: 'm', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' }]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    await waitFor(() => expect(screen.getByText('存进 Obsidian')).toBeTruthy());
  });
});
```

`tests/components/project-workspace.test.tsx`：找到现有断言 `job:transcribe` 通知会出现在对话里的用例，复制一份，把返回的消息改成 `{ id: 'mNote', role: 'system', content: '要把这个项目存进 Obsidian 吗？', toolName: 'note:proposal', ok: true, proposalId: 'np1' }`，并让 `/api/notes/proposals/np1` 返回 pending 的 `ProposalView`，断言出现「存进 Obsidian」。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components`
Expected: FAIL。

- [ ] **Step 3: `NoteProposalCard`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { ProposalView } from '@/lib/notes/proposals';

const DONE: Record<string, string> = { written: '已存进 Obsidian', rejected: '已不要', expired: '已过期' };

export function NoteProposalCard({ proposalId }: { proposalId: string }) {
  const [p, setP] = useState<ProposalView | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/notes/proposals/${proposalId}`)
      .then((r) => r.json())
      .then((j) => (j.success ? setP(j.data) : setErr(j.message)))
      .catch(() => setErr('读取提议失败'));
  }, [proposalId]);

  const decide = async (action: 'accept' | 'reject') => {
    setBusy(true);
    const j = await fetch(`/api/notes/proposals/${proposalId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(false);
    if (j.success) setP(j.data);
    else setErr(j.message);
  };

  if (!p) return <div className="text-xs text-[var(--text-tertiary)]">{err ?? '读取提议…'}</div>;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-xs">
      <div className="font-medium">要把这个项目存进 Obsidian 吗？</div>
      <div className="mt-1 text-[var(--text-tertiary)]">{p.path}</div>
      <button type="button" className="mt-1 underline" onClick={() => setOpen((o) => !o)}>
        {open ? '收起' : '预览'}
      </button>
      {open && <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-[var(--text-secondary)]">{p.content}</pre>}
      {(p.error || err) && <p className="mt-2 text-[var(--danger)]">{p.error ?? err}</p>}
      {p.status === 'pending' ? (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy} className="rounded-md bg-[var(--accent)] px-3 py-1 text-[var(--text-on-accent)] disabled:opacity-50" onClick={() => void decide('accept')}>
            存进 Obsidian
          </button>
          <button type="button" disabled={busy} className="rounded-md border border-[var(--border-strong)] px-3 py-1" onClick={() => void decide('reject')}>
            不要
          </button>
        </div>
      ) : (
        <div className="mt-2 text-[var(--text-secondary)]">{DONE[p.status] ?? p.status}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: ChatPanel 与工作区**

`src/components/project/chat-panel.tsx`：
- `Line` 加 `proposalId?: string | null`；`toLine` 带上 `m.proposalId ?? null`。
- 渲染时在 `l.role === 'tool'` 分支之前：`l.proposalId ? <NoteProposalCard key={l.key} proposalId={l.proposalId} /> : …`。

`src/components/project/project-workspace.tsx:60`：通知过滤改为 `m.role === 'system' && (m.toolName?.startsWith('job:') || m.toolName === 'note:proposal')`。

- [ ] **Step 5: `ObsidianCard` 与设置页**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotesSettingsView } from '@/app/api/settings/notes/route';

async function call(method: string, body?: unknown) {
  const res = await fetch('/api/settings/notes', { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({ success: false, message: '服务没有响应，稍后再试。' }));
}

export function ObsidianCard() {
  const [v, setV] = useState<NotesSettingsView | null>(null);
  const [vault, setVault] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (j: { success: boolean; data?: NotesSettingsView; message?: string }, okText?: string) => {
    if (j.success && j.data) {
      setV(j.data);
      setVault(j.data.vault ?? '');
      if (okText) setMsg({ ok: true, text: okText });
    } else setMsg({ ok: false, text: j.message ?? '保存失败' });
  };
  const load = useCallback(async () => apply(await call('GET')), []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (f: string) => {
    if (!v) return;
    const readFolders = v.readFolders.includes(f) ? v.readFolders.filter((x) => x !== f) : [...v.readFolders, f];
    apply(await call('PUT', { readFolders }));
  };

  return (
    <section className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <h3 className="mb-1 text-sm font-medium">Obsidian</h3>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">编导和助手只读勾选的文件夹；存进 Obsidian 只写 MediaPilot/，每次都要你在对话里确认。</p>
      {!v ? (
        <p className="text-sm text-[var(--text-secondary)]">读取中…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)]">库路径{v.detected ? '（自动识别）' : ''}</span>
            <input className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1" value={vault} onChange={(e) => setVault(e.target.value)} />
            <button className="rounded-md border border-[var(--border-strong)] px-3 py-1" onClick={async () => apply(await call('PUT', { vault }), '已保存库路径。')}>
              保存
            </button>
          </div>
          <p className={`text-xs ${v.vaultProblem ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'}`}>{v.vaultProblem ?? `可读 ${v.noteCount ?? 0} 篇笔记`}</p>
          <div className="flex flex-wrap gap-3">
            {v.topFolders.map((f) => (
              <label key={f} className="flex items-center gap-1 text-xs">
                <input type="checkbox" aria-label={f} checked={v.readFolders.includes(f)} onChange={() => void toggle(f)} />
                {f}
              </label>
            ))}
          </div>
          {v.missing.map((f) => (
            <p key={f} className="text-xs text-[var(--danger)]">
              {f}：找不到（文件夹被删或改名了）
            </p>
          ))}
          <p className="text-xs text-[var(--text-tertiary)]">写入文件夹：{v.writeFolder}/（总是可读）</p>
        </div>
      )}
      {msg && <p className={`mt-2 text-xs ${msg.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{msg.text}</p>}
    </section>
  );
}
```

`src/app/settings/page.tsx`：在 `<ModelsCard />` 之后加 `<ObsidianCard />`（import 自 `@/components/settings/obsidian-card`）。

- [ ] **Step 6: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：设置页「Obsidian」卡片显示自动识别的库与三个勾选、可读笔记数；取消再勾选一个文件夹后数字变化；窄屏不溢出。

```bash
git add src/components src/app/settings tests/components
git commit -m "feat(notes): 设置页 Obsidian 卡片 + 对话里的存进 Obsidian 确认卡片

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-30-obsidian-notes-design.md`（追加实测）、`.claude/skills/mediapilot/SKILL.md`（若列出命令清单，补 `mp notes search/show`）

- [ ] **Step 1: README**

「现在能做什么」在「助手」之后加：

```markdown
- **Obsidian 记忆**：设置页「Obsidian」选编导能读的文件夹（默认 5-灵感 / 3-资源 / 1-项目，库路径自动识别）。编导写稿前会搜你的笔记、优先用你自己的观点和经历，并在回复里注明借用了哪篇；助手也能用 `mp notes search/show` 查。定稿、复盘后对话里会出现「存进 Obsidian」卡片，点确认才把项目笔记（选题 / 对标 / 定稿 / 复盘 / 写法经验）写进库里的 `MediaPilot/项目/`；你在笔记里标记区块外写的内容不会被覆盖。
```

目录一节加 `src/lib/notes/  Obsidian：配置、路径安全检索、笔记拼装与写入、提议`。

- [ ] **Step 2: 真机验收**

1. 设置页卡片：自动识别库、默认三个文件夹、可读笔记数。
2. 在编导对话里问一个 `5-灵感` 里写过的主题（先 `npm run -s mp -- notes search <词>` 确认能搜到，不在对话里贴私人内容），看编导调用 `search_notes` 并在回复里注明 `[[笔记名]]`。
3. 新建测试项目 → 写稿 → 定稿 → 对话里出现卡片 → 预览 → 存进 → Obsidian 里 `MediaPilot/项目/<名>.md` 出现；在区块外加一句话，再让编导 `propose_note` 并存进，那句话仍在。
4. 总助手里问"我笔记里关于 X 写过什么"，调用 `notes_search`。
5. 验收完问用户是否删除测试项目与 `MediaPilot/项目/` 下的测试笔记（删除前确认）。

实测写入 spec 末尾（不写私人笔记内容）。

- [ ] **Step 3: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-09-30-obsidian-notes-design.md .claude/skills/mediapilot/SKILL.md
git commit -m "docs: README 补 Obsidian 记忆, spec 记录真机实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
