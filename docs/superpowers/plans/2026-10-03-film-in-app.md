# 系统内出片实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作品工作区「成片」一步里点「出一版 / 改这一版」，后台启动本机 `claude` 无界面模式按 produce-film 出片；镜头表、成片两处停下等用户确认；进度、截图、成片预览都在页面上。

**Architecture:** `src/lib/film-session/` 分四块：`args.ts`（启动参数、白名单、规则、首轮消息）、`parse.ts`（解析 stream-json 日志为进度与本轮结论）、`state.ts`（由本轮结论 + 进程是否存活推出状态）、`runner.ts`（建会话、每轮启动子进程、续上、停止、放弃、刷新状态、发通知）。子进程脱离网页服务，stdout 追加到日志文件；网页服务在子进程退出时刷新状态，页面轮询时也会刷新（服务重启后靠这个兜底）。

**Tech Stack:** Next.js 14、Prisma 5、node:child_process、vitest；本机 Claude Code CLI 2.1.x。

**Spec:** `docs/superpowers/specs/2026-10-03-film-in-app-design.md`

## Global Constraints

- 白名单（spec §4.3）逐字使用；白名单外工具在无界面模式下直接被拒。
- 追加规则（spec §4.2）逐字使用。
- 全系统同时最多一个 `running`；一个项目最多一个未结束会话（running / waiting / failed / stopped）。
- 单轮超时 30 分钟；停止 = 结束整个进程组。
- 默认模型 `opus`；设置项 `film.model`（`opus` | `sonnet`）。
- 文件接口只放行该会话片子目录内的 `.png` / `.mp4`。
- 测试不调用真实 Claude（用假的 `claude` 脚本）；真机验收前先跑白名单验证。

## 与 spec 的细微差别（已定）

- 开始改片传 `baseVersion`（版本号）而不是 spec §5 的 `baseFilmDir`：片子目录由 `remotion/films/<id>-v<N>` 推出，页面只需选版本号。
- 超时原因写作"这一轮超过 30 分钟，已停止"（spec 写"超时"，意思相同、更易懂）。
- 登记完成的通知沿用 `film register` 已有的 `job:film` 消息（"成片 vN 已生成：<summary>"），运行器不重复发。

## Review Focus

1. **用户回复时，上一轮进程其实还没退出（双击「可以，继续」或刷新后再点）**：不能并发出两个续轮。→ Task 3 测试 `refuses to reply while a turn is running`。
2. **网页服务重启后子进程跑完了**：页面再打开时状态要更新为等确认 / 完成，通知只发一次。→ Task 3 测试 `reconciles a finished turn on read and notifies once`。
3. **日志里有不完整的最后一行（进程正在写）或非 JSON 行**：解析不报错，跳过。→ Task 2 测试 `skips partial and non-json lines`。
4. **文件接口传 `../` 或其他会话的路径**：拒绝。→ Task 4 测试 `refuses paths outside the session film dir`。
5. **Next 服务的 PATH 里没有 `claude`（装在 `~/.local/bin`）**：仍能找到。→ Task 1 测试 `finds claude in common install locations`。

---

## 文件结构

```
src/lib/film-session/args.ts        白名单、规则、首轮消息、启动参数、claude 路径
src/lib/film-session/parse.ts       日志 → 进度条目 + 本轮结论
src/lib/film-session/state.ts       本轮结论 + 存活 → 状态
src/lib/film-session/runner.ts      会话生命周期、子进程、通知
scripts/film-perms-check.ts         白名单真机验证(用户额度, haiku)
tests/fixtures/fake-claude.mjs      假的 claude(集成测试)
prisma/schema.prisma                + FilmSession
src/app/api/projects/[id]/film-session/route.ts
src/app/api/film-sessions/[id]/file/route.ts
src/components/project/film-assistant.tsx
src/components/project/film-pane.tsx       顶部挂 FilmAssistant; 去掉"去 Claude Code"提示
src/lib/health/checks.ts、src/app/api/settings/health/route.ts   + Claude Code 体检
src/components/settings/models-card.tsx、src/app/api/settings/film-model/route.ts   出片模型
.claude/skills/produce-film/SKILL.md        抽帧路径 /tmp/mp-film/
```

---

### Task 1: 启动参数与白名单（含真机白名单验证）

**Files:**
- Create: `src/lib/film-session/args.ts`、`scripts/film-perms-check.ts`
- Modify: `.claude/skills/produce-film/SKILL.md`（抽帧路径）
- Test: `tests/lib/film-session/args.test.ts`

**Interfaces:**
- Produces：
  - `FILM_ALLOWED_TOOLS: string[]`（spec §4.3）
  - `FILM_RULES: string`（spec §4.2 原文）
  - `firstMessage(i: { kind: 'new' | 'revise'; projectId: string; title: string; baseFilmDir?: string; baseVersion?: number; note?: string }): string`
  - `buildClaudeArgs(i: { message: string; sessionId: string; resume: boolean; model: string }): string[]`
  - `resolveClaudeBin(env: Record<string, string | undefined>, exists: (p: string) => boolean, home: string): string | null`
  - `FILM_MODELS = ['opus', 'sonnet'] as const`；`DEFAULT_FILM_MODEL = 'opus'`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, FILM_ALLOWED_TOOLS, FILM_RULES, firstMessage, resolveClaudeBin } from '@/lib/film-session/args';

describe('film session args', () => {
  it('whitelists only film work', () => {
    expect(FILM_ALLOWED_TOOLS).toContain('Write(remotion/films/**)');
    expect(FILM_ALLOWED_TOOLS).toContain('Bash(npm run -s mp -- film register:*)');
    expect(FILM_ALLOWED_TOOLS.some((t) => /^Bash\((git|rm|curl)/.test(t))).toBe(false);
    expect(FILM_ALLOWED_TOOLS).not.toContain('Bash');
    expect(FILM_ALLOWED_TOOLS).not.toContain('Write');
  });
  it('tells it where to stop', () => {
    expect(FILM_RULES).toContain('镜头表可以吗？可以就回复继续');
    expect(FILM_RULES).toContain('不要运行 film register');
    expect(FILM_RULES).toContain('连续 3 次');
  });
  it('builds the first message for new and revise', () => {
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘', note: '节奏快一点' })).toBe('给项目 p1（U盘）出一版成片。要求：节奏快一点');
    expect(firstMessage({ kind: 'new', projectId: 'p1', title: 'U盘' })).toBe('给项目 p1（U盘）出一版成片。');
    expect(firstMessage({ kind: 'revise', projectId: 'p1', title: 'U盘', baseFilmDir: 'remotion/films/p1-v2', baseVersion: 2, note: '第 3 镜太挤' })).toBe('改项目 p1（U盘）的成片：基于 v2（remotion/films/p1-v2）出新的一版。修改意见：第 3 镜太挤');
  });
  it('starts a session and resumes it later', () => {
    const first = buildClaudeArgs({ message: '出片', sessionId: 'abc', resume: false, model: 'opus' });
    expect(first.slice(0, 2)).toEqual(['-p', '出片']);
    expect(first).toEqual(expect.arrayContaining(['--session-id', 'abc', '--output-format', 'stream-json', '--verbose', '--model', 'opus', '--append-system-prompt', FILM_RULES]));
    expect(first[first.indexOf('--allowedTools') + 1]).toBe(FILM_ALLOWED_TOOLS.join(','));
    const next = buildClaudeArgs({ message: '可以，继续', sessionId: 'abc', resume: true, model: 'sonnet' });
    expect(next).toEqual(expect.arrayContaining(['--resume', 'abc', '--model', 'sonnet']));
    expect(next).not.toContain('--session-id');
  });
  it('finds claude in common install locations', () => {
    const home = '/Users/me';
    expect(resolveClaudeBin({ CLAUDE_BIN: '/x/claude' }, () => true, home)).toBe('/x/claude');
    expect(resolveClaudeBin({}, (p) => p === '/Users/me/.local/bin/claude', home)).toBe('/Users/me/.local/bin/claude');
    expect(resolveClaudeBin({ PATH: '/a:/b' }, (p) => p === '/b/claude', home)).toBe('/b/claude');
    expect(resolveClaudeBin({}, () => false, home)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film-session/args.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `src/lib/film-session/args.ts`**

```ts
import path from 'node:path';

export const FILM_MODELS = ['opus', 'sonnet'] as const;
export const DEFAULT_FILM_MODEL = 'opus';

/** 只放行出片要用的; 白名单外的工具在无界面模式下直接被拒 */
export const FILM_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'Write(remotion/films/**)',
  'Edit(remotion/films/**)',
  'Bash(npm run -s mp -- project list)',
  'Bash(npm run -s mp -- project export:*)',
  'Bash(npm run -s mp -- film new:*)',
  'Bash(npm run -s mp -- film check:*)',
  'Bash(npm run -s mp -- film render:*)',
  'Bash(npm run -s mp -- film register:*)',
  'Bash(ffmpeg:*)',
  'Bash(ffprobe:*)',
  'Bash(mkdir -p /tmp/mp-film:*)',
  'Bash(ls:*)',
];

export const FILM_RULES = `你在 MediaPilot 网页里被调用，用户在网页上看你的进度、在停顿时回复你。
- 按 produce-film skill 的流程出片，只做出片相关的事。
- 镜头表 shots.json 写好后停下：用一段话说明切了几镜、怎么用素材，然后问"镜头表可以吗？可以就回复继续"。本轮到此结束。
- 渲染成片（film render，不带 --stills）完成后，不要运行 film register：说明这一版做了什么、用了哪些素材、做了哪些取舍，问"要登记为新版本吗？"。本轮到此结束。
- 用户回复"可以，登记"后再运行 film register（--summary 写这一版做了什么）。
- 拿不准的事（素材丢了、不确定放哪里、要求矛盾）停下来问，不要猜。
- film check 或渲染同一个错误连续 3 次没修好，停下来把报错和你的判断告诉用户。
- 不改 remotion/kit、不删除文件、不碰片子目录以外的文件。`;

export function firstMessage(i: { kind: 'new' | 'revise'; projectId: string; title: string; baseFilmDir?: string; baseVersion?: number; note?: string }): string {
  const note = i.note?.trim();
  if (i.kind === 'new') return `给项目 ${i.projectId}（${i.title}）出一版成片。${note ? `要求：${note}` : ''}`;
  return `改项目 ${i.projectId}（${i.title}）的成片：基于 v${i.baseVersion}（${i.baseFilmDir}）出新的一版。${note ? `修改意见：${note}` : ''}`;
}

export function buildClaudeArgs(i: { message: string; sessionId: string; resume: boolean; model: string }): string[] {
  return [
    '-p',
    i.message,
    ...(i.resume ? ['--resume', i.sessionId] : ['--session-id', i.sessionId]),
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    i.model,
    '--allowedTools',
    FILM_ALLOWED_TOOLS.join(','),
    '--append-system-prompt',
    FILM_RULES,
  ];
}

/** 网页服务的 PATH 里常没有 ~/.local/bin: 依次查 CLAUDE_BIN、常见安装位置、PATH */
export function resolveClaudeBin(env: Record<string, string | undefined>, exists: (p: string) => boolean, home: string): string | null {
  if (env.CLAUDE_BIN && exists(env.CLAUDE_BIN)) return env.CLAUDE_BIN;
  const candidates = [path.join(home, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(env.PATH ?? '').split(':').filter(Boolean).map((d) => path.join(d, 'claude'))];
  return candidates.find((p) => exists(p)) ?? null;
}
```

- [ ] **Step 4: 白名单真机验证脚本 `scripts/film-perms-check.ts`**

```ts
/**
 * 白名单真机验证(会用一点 Claude Code 额度, 用 haiku): 写 src 被拒、写片子目录允许、git status 被拒。
 * 用法: npx tsx scripts/film-perms-check.ts
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FILM_ALLOWED_TOOLS, resolveClaudeBin } from '../src/lib/film-session/args';

const bin = resolveClaudeBin(process.env, fs.existsSync, os.homedir());
if (!bin) throw new Error('找不到 claude');
const cases = [
  { name: '写 src/ 应被拒', prompt: '用 Write 工具在 src/__perm_probe.txt 写入 x，只做这一件事。', check: () => !fs.existsSync('src/__perm_probe.txt') },
  { name: '写片子目录应允许', prompt: '用 Write 工具在 remotion/films/__perm_probe/x.txt 写入 x，只做这一件事。', check: () => fs.existsSync('remotion/films/__perm_probe/x.txt') },
  { name: 'git status 应被拒', prompt: '用 Bash 运行 git status，只做这一件事，把输出原样告诉我。', check: (out: string) => /permission|not allowed|denied|拒绝|haven't granted/i.test(out) },
];
let failed = 0;
for (const c of cases) {
  const r = spawnSync(bin, ['-p', c.prompt, '--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--allowedTools', FILM_ALLOWED_TOOLS.join(',')], { encoding: 'utf8', timeout: 180_000 });
  const ok = c.check(r.stdout + r.stderr);
  console.log(`${ok ? '✓' : '✗'} ${c.name}`);
  if (!ok) failed++;
}
fs.rmSync('src/__perm_probe.txt', { force: true });
fs.rmSync(path.join('remotion/films/__perm_probe'), { recursive: true, force: true });
if (failed) {
  console.error(`${failed} 项不符合预期, 先修正 FILM_ALLOWED_TOOLS 的写法`);
  process.exit(1);
}
```

（运行一次并把一条真实的 stream-json 输出样本——去掉本机路径以外的个人信息——存为 `tests/fixtures/claude-stream-sample.jsonl`，供 Task 2 对照事件格式；若格式与 Task 2 假设不同，按真实格式调整 parse.ts 并记 Ruling。）

- [ ] **Step 5: produce-film 抽帧路径**

`.claude/skills/produce-film/SKILL.md` 第 2 步的抽帧命令改为：`mkdir -p /tmp/mp-film && ffmpeg -i <path> -vf fps=1/2,scale=480:-1 /tmp/mp-film/mat-<id>-%03d.jpg`。

- [ ] **Step 6: 测试、真机验证、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

Run（真机，用户额度，约 1 分钟）：`npx tsx scripts/film-perms-check.ts`
Expected: 三项 ✓。任一 ✗：按 Claude Code 文档调整规则写法（如 `Write` 需要与 `Edit` 分开、路径需 `./` 前缀等），重跑到全 ✓，记 Ruling。

```bash
git add src/lib/film-session scripts/film-perms-check.ts .claude/skills/produce-film/SKILL.md tests
git commit -m "feat(film-session): 出片启动参数与白名单(真机验证: 写 src 被拒、写片子目录允许、git 被拒)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 日志解析与状态判断

**Files:**
- Create: `src/lib/film-session/parse.ts`、`src/lib/film-session/state.ts`
- Test: `tests/lib/film-session/parse.test.ts`、`tests/lib/film-session/state.test.ts`

**Interfaces:**
- 日志格式：每行一个 JSON。runner 在每轮开始写一行 `{"type":"mp_turn","n":<轮次>,"message":"<本轮消息>","at":"<ISO>"}`；其余行为 claude 的 stream-json（`system` / `assistant` / `user` / `result`）。
- Produces（parse.ts）：
  - `type Item = { kind: 'you'; text: string } | { kind: 'say'; text: string } | { kind: 'step'; text: string; ok: boolean | null } | { kind: 'denied'; text: string } | { kind: 'still'; path: string }`
  - `interface TurnResult { ended: boolean; isError: boolean; errorText: string | null; lastText: string | null; wroteShots: boolean; renderedFinal: boolean; registeredVersion: number | null; registeredSummary: string | null }`
  - `interface ParsedLog { items: Item[]; turns: number; filmDir: string | null; last: TurnResult }`
  - `parseLog(lines: string[]): ParsedLog`
- Produces（state.ts）：
  - `type FilmStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'abandoned'`
  - `type Checkpoint = 'shots' | 'render' | 'question'`
  - `TURN_TIMEOUT_MS = 30 * 60_000`
  - `deriveState(i: { last: TurnResult; alive: boolean; turnStartedAt: Date | null; now: Date }): { status: 'running' | 'waiting' | 'done' | 'failed'; checkpoint: Checkpoint | null; message: string | null; version: number | null; timedOut: boolean }`

- [ ] **Step 1: 写失败测试**

`tests/lib/film-session/parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseLog } from '@/lib/film-session/parse';

const j = (o: unknown) => JSON.stringify(o);
const use = (id: string, name: string, input: unknown) => j({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (id: string, content: string, is_error = false) => j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const say = (text: string) => j({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const turn = (n: number, message: string) => j({ type: 'mp_turn', n, message, at: '2026-10-03T00:00:00.000Z' });
const done = (is_error = false, result = '') => j({ type: 'result', subtype: is_error ? 'error_during_execution' : 'success', is_error, result });

describe('parseLog', () => {
  it('turns tool calls into readable steps and finds the film dir', () => {
    const p = parseLog([
      turn(1, '给项目 p1（U盘）出一版成片。'),
      use('a', 'Bash', { command: 'npm run -s mp -- project export p1' }),
      res('a', '{...}'),
      use('b', 'Bash', { command: 'npm run -s mp -- film new p1' }),
      res('b', '/Users/me/repo/remotion/films/p1-v3'),
      use('c', 'Write', { file_path: '/Users/me/repo/remotion/films/p1-v3/shots.json', content: '{}' }),
      res('c', 'ok'),
      say('镜头表可以吗？可以就回复继续'),
      done(),
    ]);
    expect(p.items).toEqual([
      { kind: 'you', text: '给项目 p1（U盘）出一版成片。' },
      { kind: 'step', text: '读稿子和素材', ok: true },
      { kind: 'step', text: '建片子目录 v3', ok: true },
      { kind: 'step', text: '排镜头表', ok: true },
      { kind: 'say', text: '镜头表可以吗？可以就回复继续' },
    ]);
    expect(p.filmDir).toBe('remotion/films/p1-v3');
    expect(p.last).toMatchObject({ ended: true, isError: false, wroteShots: true, renderedFinal: false, registeredVersion: null, lastText: '镜头表可以吗？可以就回复继续' });
  });
  it('judges only the last turn', () => {
    const p = parseLog([
      turn(1, 'go'),
      use('c', 'Write', { file_path: 'remotion/films/p1-v3/shots.json', content: '{}' }),
      res('c', 'ok'),
      done(),
      turn(2, '可以，继续'),
      use('d', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3 --stills' }),
      res('d', '渲染完成'),
      use('e', 'Read', { file_path: '/Users/me/repo/remotion/films/p1-v3/stills/1.2.png' }),
      res('e', '[image]'),
      use('f', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3' }),
      res('f', '渲染完成'),
      say('要登记为新版本吗？'),
      done(),
    ]);
    expect(p.turns).toBe(2);
    expect(p.last).toMatchObject({ wroteShots: false, renderedFinal: true, registeredVersion: null });
    expect(p.items).toContainEqual({ kind: 'still', path: 'stills/1.2.png' });
    expect(p.items).toContainEqual({ kind: 'step', text: '渲染关键帧', ok: true });
    expect(p.items).toContainEqual({ kind: 'step', text: '渲染成片（约 2 分钟）', ok: true });
  });
  it('reads the registered version and denied tools', () => {
    const p = parseLog([
      turn(1, '可以，登记'),
      use('g', 'Bash', { command: 'git status' }),
      res('g', "Claude requested permissions to use Bash, but you haven't granted it yet.", true),
      use('h', 'Bash', { command: 'npm run -s mp -- film register remotion/films/p1-v3 --summary "x"' }),
      res('h', '已登记成片 v3'),
      done(),
    ]);
    expect(p.items).toContainEqual({ kind: 'denied', text: 'Bash：git status' });
    expect(p.last.registeredVersion).toBe(3);
    expect(p.last.registeredSummary).toBe('x');
  });
  it('reports a failed check and a failed result', () => {
    const p = parseLog([turn(1, 'go'), use('i', 'Bash', { command: 'npm run -s mp -- film check remotion/films/p1-v3' }), res('i', '✗ a\n✗ b', true), done(true, 'usage limit reached')]);
    expect(p.items).toContainEqual({ kind: 'step', text: '检查：有 2 处问题', ok: false });
    expect(p.last).toMatchObject({ ended: true, isError: true, errorText: 'usage limit reached' });
  });
  it('skips partial and non-json lines', () => {
    const p = parseLog([turn(1, 'go'), 'npm WARN something', '{"type":"assistant","message":{"con']);
    expect(p.items).toEqual([{ kind: 'you', text: 'go' }]);
    expect(p.last.ended).toBe(false);
  });
});
```

`tests/lib/film-session/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveState, TURN_TIMEOUT_MS } from '@/lib/film-session/state';

const last = (over = {}) => ({ ended: true, isError: false, errorText: null, lastText: '要登记吗？', wroteShots: false, renderedFinal: false, registeredVersion: null, registeredSummary: null, ...over });
const now = new Date('2026-10-03T10:00:00Z');

describe('deriveState', () => {
  it('keeps running while the process lives', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: now, now })).toMatchObject({ status: 'running', timedOut: false });
  });
  it('times out after 30 minutes', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: new Date(now.getTime() - TURN_TIMEOUT_MS - 1), now })).toMatchObject({ status: 'failed', message: '这一轮超过 30 分钟，已停止', timedOut: true });
  });
  it('maps the turn outcome to a status and checkpoint', () => {
    const d = (o: object) => deriveState({ last: last(o), alive: false, turnStartedAt: now, now });
    expect(d({ registeredVersion: 3 })).toMatchObject({ status: 'done', version: 3 });
    expect(d({ renderedFinal: true })).toMatchObject({ status: 'waiting', checkpoint: 'render' });
    expect(d({ wroteShots: true })).toMatchObject({ status: 'waiting', checkpoint: 'shots' });
    expect(d({})).toMatchObject({ status: 'waiting', checkpoint: 'question', message: '要登记吗？' });
    expect(d({ isError: true, errorText: 'usage limit reached' })).toMatchObject({ status: 'failed', message: 'usage limit reached' });
    expect(d({ ended: false })).toMatchObject({ status: 'failed', message: '出片进程意外退出' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film-session`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/film-session/parse.ts`**

```ts
export type Item =
  | { kind: 'you'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'step'; text: string; ok: boolean | null }
  | { kind: 'denied'; text: string }
  | { kind: 'still'; path: string };

export interface TurnResult {
  ended: boolean;
  isError: boolean;
  errorText: string | null;
  lastText: string | null;
  wroteShots: boolean;
  renderedFinal: boolean;
  registeredVersion: number | null;
  registeredSummary: string | null;
}

export interface ParsedLog {
  items: Item[];
  turns: number;
  filmDir: string | null;
  last: TurnResult;
}

type Use = { name: string; input: Record<string, unknown> };
const blank = (): TurnResult => ({ ended: false, isError: false, errorText: null, lastText: null, wroteShots: false, renderedFinal: false, registeredVersion: null, registeredSummary: null });
const text = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : '')).join('') : '');
const filmRel = (p: string) => /remotion\/films\/[^\s"'/]+/.exec(p)?.[0] ?? null;

function describe(u: Use, out: string, ok: boolean): string {
  const cmd = String(u.input.command ?? '');
  const file = String(u.input.file_path ?? '');
  if (u.name === 'Bash') {
    if (/mp -- project export/.test(cmd)) return '读稿子和素材';
    if (/mp -- project list/.test(cmd)) return '找项目';
    if (/mp -- film new/.test(cmd)) return `建片子目录 v${/-v(\d+)/.exec(out)?.[1] ?? '?'}`;
    if (/mp -- film check/.test(cmd)) return ok ? '检查：通过' : `检查：有 ${(out.match(/✗/g) ?? []).length || 1} 处问题`;
    if (/mp -- film render .*--stills/.test(cmd)) return '渲染关键帧';
    if (/mp -- film render/.test(cmd)) return '渲染成片（约 2 分钟）';
    if (/mp -- film register/.test(cmd)) return `登记 v${/v(\d+)/.exec(out)?.[1] ?? '?'}`;
    if (/^ffmpeg/.test(cmd)) return '抽帧看素材';
    if (/^ffprobe/.test(cmd)) return '看素材时长';
    return `命令：${cmd.slice(0, 60)}`;
  }
  if (u.name === 'Write' || u.name === 'Edit') {
    if (file.endsWith('shots.json')) return '排镜头表';
    if (/Film\.tsx$|copy\.ts$/.test(file)) return '写画面';
    return `写文件：${file.split('/').pop()}`;
  }
  if (u.name === 'Read') return /\.(png|jpe?g)$/i.test(file) ? '看图' : `读：${file.split('/').pop()}`;
  return `${u.name}`;
}

export function parseLog(lines: string[]): ParsedLog {
  const items: Item[] = [];
  const uses = new Map<string, Use>();
  let turns = 0;
  let filmDir: string | null = null;
  let last = blank();
  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue; // 半行(正在写)或非 JSON 输出
    }
    if (ev.type === 'mp_turn') {
      turns++;
      last = blank();
      items.push({ kind: 'you', text: String(ev.message ?? '') });
      continue;
    }
    if (ev.type === 'result') {
      last.ended = true;
      last.isError = !!ev.is_error;
      if (last.isError) last.errorText = String(ev.result ?? ev.subtype ?? '出错了');
      continue;
    }
    const content = (ev.message as { content?: unknown[] } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content as Record<string, unknown>[]) {
      if (ev.type === 'assistant' && c.type === 'text' && String(c.text).trim()) {
        items.push({ kind: 'say', text: String(c.text).trim() });
        last.lastText = String(c.text).trim();
      }
      if (ev.type === 'assistant' && c.type === 'tool_use') uses.set(String(c.id), { name: String(c.name), input: (c.input ?? {}) as Record<string, unknown> });
      if (ev.type === 'user' && c.type === 'tool_result') {
        const u = uses.get(String(c.tool_use_id));
        if (!u) continue;
        const out = text(c.content);
        const ok = !c.is_error;
        if (!ok && /requested permissions|haven't granted|not allowed|permission/i.test(out)) {
          items.push({ kind: 'denied', text: `${u.name}：${String(u.input.command ?? u.input.file_path ?? '').slice(0, 80)}` });
          continue;
        }
        const file = String(u.input.file_path ?? '');
        if (u.name === 'Read' && /\/stills\/[^/]+\.png$/.test(file)) {
          items.push({ kind: 'still', path: file.slice(file.indexOf('stills/')) });
          continue;
        }
        items.push({ kind: 'step', text: describe(u, out, ok), ok });
        const cmd = String(u.input.command ?? '');
        if (ok && /mp -- film new/.test(cmd)) filmDir = filmRel(out) ?? filmDir;
        if (ok && (u.name === 'Write' || u.name === 'Edit') && file.endsWith('shots.json')) {
          last.wroteShots = true;
          filmDir = filmDir ?? filmRel(file);
        }
        if (ok && /mp -- film render/.test(cmd) && !/--stills/.test(cmd)) last.renderedFinal = true;
        if (ok && /mp -- film register/.test(cmd)) {
          last.registeredVersion = Number(/v(\d+)/.exec(out)?.[1] ?? NaN) || null;
          last.registeredSummary = /--summary "([^"]*)"/.exec(cmd)?.[1] ?? null;
        }
      }
    }
  }
  return { items, turns, filmDir, last };
}
```

- [ ] **Step 4: 实现 `src/lib/film-session/state.ts`**

```ts
import type { TurnResult } from './parse';

export type FilmStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'abandoned';
export type Checkpoint = 'shots' | 'render' | 'question';
export const TURN_TIMEOUT_MS = 30 * 60_000;

export function deriveState(i: { last: TurnResult; alive: boolean; turnStartedAt: Date | null; now: Date }) {
  const base = { checkpoint: null as Checkpoint | null, message: null as string | null, version: null as number | null, timedOut: false };
  if (i.alive) {
    if (i.turnStartedAt && i.now.getTime() - i.turnStartedAt.getTime() > TURN_TIMEOUT_MS) return { ...base, status: 'failed' as const, message: '这一轮超过 30 分钟，已停止', timedOut: true };
    return { ...base, status: 'running' as const };
  }
  const l = i.last;
  if (!l.ended) return { ...base, status: 'failed' as const, message: '出片进程意外退出' };
  if (l.isError) return { ...base, status: 'failed' as const, message: l.errorText };
  if (l.registeredVersion) return { ...base, status: 'done' as const, version: l.registeredVersion, message: l.lastText };
  if (l.renderedFinal) return { ...base, status: 'waiting' as const, checkpoint: 'render' as const, message: l.lastText };
  if (l.wroteShots) return { ...base, status: 'waiting' as const, checkpoint: 'shots' as const, message: l.lastText };
  return { ...base, status: 'waiting' as const, checkpoint: 'question' as const, message: l.lastText };
}
```

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。若 Task 1 存下的真实样本与这里假设的事件结构不同（如 `result` 字段名、拒绝文案），补一条用样本做输入的测试并调整解析，记 Ruling。

```bash
git add src/lib/film-session tests/lib/film-session
git commit -m "feat(film-session): 日志解析为进度(步骤/截图/被拒/对话) + 由本轮结论判断状态与确认点

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 数据表与会话运行器

**Files:**
- Modify: `prisma/schema.prisma`（spec §4.6 `FilmSession`；`Project` 加 `filmSessions FilmSession[]`）
- Create: `src/lib/film-session/runner.ts`、`tests/fixtures/fake-claude.mjs`
- Test: `tests/lib/film-session/runner.test.ts`

**Interfaces:**
- Consumes：`buildClaudeArgs`、`firstMessage`、`DEFAULT_FILM_MODEL`（Task 1）；`parseLog`、`deriveState`（Task 2）
- Produces：
  - `interface RunnerDeps { claudeBin: string | null; cwd: string; logDir: string; spawn(bin: string, args: string[], logPath: string, onExit: () => void): number; isAlive(pid: number): boolean; killGroup(pid: number): void; readLines(p: string): Promise<string[]>; append(p: string, line: string): Promise<void>; now(): Date; uuid(): string }`
  - `class FilmBusy extends Error`（中文消息）
  - `startFilm(db, deps, i: { projectId: string; kind: 'new' | 'revise'; baseVersion?: number; note?: string; model: string }): Promise<FilmSession>`
  - `replyFilm(db, deps, id: string, text: string, model: string): Promise<FilmSession>`
  - `stopFilm(db, deps, id): Promise<FilmSession>`；`abandonFilm(db, id): Promise<FilmSession>`
  - `refreshFilm(db, deps, id): Promise<{ session: FilmSession; parsed: ParsedLog }>`（判状态、超时终止、状态变化时发 `job:film` 通知）
  - `currentFilm(db, projectId)`：项目最新一条未结束会话；`runningElsewhere(db, projectId)`：别的项目正在跑的会话（含项目标题）
  - `createRunnerDeps(): RunnerDeps`（真实实现）

- [ ] **Step 1: schema**

按 spec §4.6 追加（`status` 注释含 `abandoned`），`model Project` 加 `filmSessions   FilmSession[]`。Run: `npx prisma db push && npm run typecheck` → in sync。（**改了 schema：之后真机验收前重启 dev。**）

- [ ] **Step 2: 假的 claude `tests/fixtures/fake-claude.mjs`**

```js
#!/usr/bin/env node
// 测试用: 按 FAKE_SCENARIO 和是否 --resume、消息内容, 输出一轮 stream-json
const args = process.argv.slice(2);
const msg = args[args.indexOf('-p') + 1] ?? '';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const use = (id, name, input) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (id, content, is_error = false) => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const scenario = process.env.FAKE_SCENARIO ?? 'happy';
if (scenario === 'crash') process.exit(1);
if (scenario === 'limit') {
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'usage limit reached' });
  process.exit(0);
}
if (scenario === 'slow') setTimeout(() => process.exit(0), 60_000);
else if (/可以，登记/.test(msg)) {
  use('r', 'Bash', { command: 'npm run -s mp -- film register remotion/films/p1-v3 --summary "x"' });
  res('r', '已登记成片 v3');
  say('已登记 v3');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
} else if (/可以，继续/.test(msg)) {
  use('f', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3' });
  res('f', '渲染完成');
  say('要登记为新版本吗？');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
} else {
  use('n', 'Bash', { command: 'npm run -s mp -- film new p1' });
  res('n', 'remotion/films/p1-v3');
  use('s', 'Write', { file_path: 'remotion/films/p1-v3/shots.json', content: '{}' });
  res('s', 'ok');
  say('镜头表可以吗？可以就回复继续');
  out({ type: 'result', subtype: 'success', is_error: false, result: '' });
}
```

- [ ] **Step 3: 写失败测试 `tests/lib/film-session/runner.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { abandonFilm, createRunnerDeps, FilmBusy, refreshFilm, replyFilm, startFilm, stopFilm, type RunnerDeps } from '@/lib/film-session/runner';

type Row = Record<string, unknown> & { id: string; projectId: string; status: string };

function fakeDb() {
  const sessions: Row[] = [];
  const chat: { projectId: string; content: string; toolName: string }[] = [];
  let seq = 0;
  const match = (r: Row, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as object) ? ((v as { in: unknown[] }).in).includes(r[k]) : v && typeof v === 'object' && 'not' in (v as object) ? r[k] !== (v as { not: unknown }).not : r[k] === v));
  const db = {
    project: { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, title: where.id === 'p2' ? '另一个' : 'U盘' }) },
    filmSession: {
      create: async ({ data }: { data: Row }) => {
        const r = { id: `fs${++seq}`, createdAt: new Date(), updatedAt: new Date(), checkpoint: null, message: null, filmDir: null, version: null, summary: null, pid: null, turnStartedAt: null, ...data } as Row;
        sessions.push(r);
        return { ...r };
      },
      findUnique: async ({ where }: { where: { id: string } }) => sessions.find((s) => s.id === where.id) ?? null,
      findFirst: async ({ where }: { where: Record<string, unknown> }) => [...sessions].reverse().find((s) => match(s, where)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(sessions.find((s) => s.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = sessions.filter((s) => match(s, where));
        hit.forEach((s) => Object.assign(s, data));
        return { count: hit.length };
      },
    },
    chatMessage: { create: async ({ data }: { data: (typeof chat)[number] }) => void chat.push(data) },
  } as unknown as PrismaClient;
  return { db, sessions, chat };
}

let dir: string;
let fake: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-fs-'));
  fake = path.join(dir, 'claude');
  fs.copyFileSync(path.join(process.cwd(), 'tests/fixtures/fake-claude.mjs'), fake);
  fs.chmodSync(fake, 0o755);
});
afterEach(() => {
  delete process.env.FAKE_SCENARIO;
});

const realDeps = (over: Partial<RunnerDeps> = {}): RunnerDeps => ({ ...createRunnerDeps(), claudeBin: fake, cwd: process.cwd(), logDir: dir, ...over });
const settle = async (db: PrismaClient, deps: RunnerDeps, id: string) => {
  for (let i = 0; i < 100; i++) {
    const r = await refreshFilm(db, deps, id);
    if (r.session.status !== 'running') return r;
    await new Promise((x) => setTimeout(x, 50));
  }
  throw new Error('still running');
};

describe('film runner', () => {
  it('walks shots → render → register with notices', async () => {
    const { db, chat } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    let r = await settle(db, deps, s.id);
    expect(r.session).toMatchObject({ status: 'waiting', checkpoint: 'shots', filmDir: 'remotion/films/p1-v3' });
    await replyFilm(db, deps, s.id, '可以，继续', 'opus');
    r = await settle(db, deps, s.id);
    expect(r.session).toMatchObject({ status: 'waiting', checkpoint: 'render' });
    await replyFilm(db, deps, s.id, '可以，登记', 'opus');
    r = await settle(db, deps, s.id);
    expect(r.session).toMatchObject({ status: 'done', version: 3 });
    // 登记通知由 film register(registerFilm) 自己写, 运行器不重复发
    expect(chat.map((c) => c.content)).toEqual(['镜头表排好了，等你确认（在「成片」里看）', '成片渲染好了，等你确认']);
    expect(r.session.summary).toBe('x');
    expect(r.parsed.turns).toBe(3);
  });
  it('allows only one running film at a time and one open session per project', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await expect(startFilm(db, deps, { projectId: 'p2', kind: 'new', model: 'opus' })).rejects.toThrow(FilmBusy);
    await expect(startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' })).rejects.toThrow('这个项目还有一次出片没结束');
    await stopFilm(db, deps, s.id);
  });
  it('refuses to reply while a turn is running', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await expect(replyFilm(db, deps, s.id, '可以，继续', 'opus')).rejects.toThrow('还在做');
    expect((await stopFilm(db, deps, s.id)).status).toBe('stopped');
  });
  it('fails with the model error and can resume', async () => {
    process.env.FAKE_SCENARIO = 'limit';
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    const r = await settle(db, deps, s.id);
    expect(r.session).toMatchObject({ status: 'failed', message: 'usage limit reached' });
    delete process.env.FAKE_SCENARIO;
    await replyFilm(db, deps, s.id, '接着做', 'opus');
    expect((await settle(db, deps, s.id)).session.status).toBe('waiting');
  });
  it('reconciles a finished turn on read and notifies once', async () => {
    const { db, chat } = fakeDb();
    const deps = realDeps({ spawn: (bin, args, log) => createRunnerDeps().spawn(bin, args, log, () => {}) });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await settle(db, deps, s.id);
    await refreshFilm(db, deps, s.id);
    expect(chat).toHaveLength(1);
    expect(chat[0].toolName).toBe('job:film');
  });
  it('marks a vanished process as failed', async () => {
    process.env.FAKE_SCENARIO = 'crash';
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    expect((await settle(db, deps, s.id)).session).toMatchObject({ status: 'failed', message: '出片进程意外退出' });
  });
  it('abandons a session for good', async () => {
    process.env.FAKE_SCENARIO = 'limit';
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await settle(db, deps, s.id);
    expect((await abandonFilm(db, s.id)).status).toBe('abandoned');
    await expect(replyFilm(db, deps, s.id, '接着做', 'opus')).rejects.toThrow('这次出片已经结束');
  });
  it('explains a missing claude', async () => {
    const { db } = fakeDb();
    await expect(startFilm(db, realDeps({ claudeBin: null }), { projectId: 'p1', kind: 'new', model: 'opus' })).rejects.toThrow('本机没有可用的 Claude Code');
  });
});
```

- [ ] **Step 4: 运行确认失败**

Run: `npx vitest run tests/lib/film-session/runner.test.ts`
Expected: FAIL。

- [ ] **Step 5: 实现 `src/lib/film-session/runner.ts`**

```ts
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FilmSession, PrismaClient } from '@prisma/client';
import { buildClaudeArgs, firstMessage, resolveClaudeBin } from './args';
import { parseLog, type ParsedLog } from './parse';
import { deriveState } from './state';

export class FilmBusy extends Error {}
const NO_CLAUDE = '本机没有可用的 Claude Code：安装后在终端运行 claude 登录，再回来点出片';
const OPEN = ['running', 'waiting', 'failed', 'stopped'];

export interface RunnerDeps {
  claudeBin: string | null;
  cwd: string;
  logDir: string;
  spawn(bin: string, args: string[], logPath: string, onExit: () => void): number;
  isAlive(pid: number): boolean;
  killGroup(pid: number): void;
  readLines(p: string): Promise<string[]>;
  append(p: string, line: string): Promise<void>;
  now(): Date;
  uuid(): string;
}

export function createRunnerDeps(): RunnerDeps {
  return {
    claudeBin: resolveClaudeBin(process.env, fs.existsSync, os.homedir()),
    cwd: process.cwd(),
    logDir: path.join(process.cwd(), 'logs', 'film-sessions'),
    spawn(bin, args, logPath, onExit) {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      const out = fs.openSync(logPath, 'a');
      const err = fs.openSync(logPath.replace(/\.jsonl$/, '.err'), 'a');
      const child = nodeSpawn(bin, args, { cwd: this.cwd, detached: true, stdio: ['ignore', out, err] });
      child.on('exit', onExit);
      child.unref();
      fs.closeSync(out);
      fs.closeSync(err);
      return child.pid ?? 0;
    },
    isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    },
    killGroup(pid) {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        // 已经不在了
      }
    },
    readLines: async (p) => (await fs.promises.readFile(p, 'utf8').catch(() => '')).split('\n').filter(Boolean),
    append: (p, line) => fs.promises.mkdir(path.dirname(p), { recursive: true }).then(() => fs.promises.appendFile(p, line + '\n')),
    now: () => new Date(),
    uuid: () => randomUUID(),
  };
}

const NOTICE: Record<string, (s: FilmSession) => string> = {
  shots: () => '镜头表排好了，等你确认（在「成片」里看）',
  render: () => '成片渲染好了，等你确认',
  question: () => '出片助手有问题等你回答（在「成片」里看）',
  failed: (s) => `出片停了：${s.message ?? '出错了'}`,
};

async function notify(db: PrismaClient, s: FilmSession) {
  const key = s.status === 'waiting' ? s.checkpoint ?? 'question' : s.status;
  const f = NOTICE[key];
  if (!f) return;
  await db.chatMessage.create({ data: { projectId: s.projectId, role: 'system', content: f(s), toolName: 'job:film', toolResult: { ok: s.status !== 'failed' } } });
}

export const currentFilm = (db: PrismaClient, projectId: string) => db.filmSession.findFirst({ where: { projectId, status: { in: OPEN } }, orderBy: { createdAt: 'desc' } });

export async function runningElsewhere(db: PrismaClient, projectId: string) {
  const s = await db.filmSession.findFirst({ where: { status: 'running', projectId: { not: projectId } } });
  if (!s) return null;
  const p = await db.project.findUnique({ where: { id: s.projectId } });
  return { sessionId: s.id, projectId: s.projectId, title: p?.title ?? s.projectId };
}

async function launch(db: PrismaClient, deps: RunnerDeps, s: FilmSession, message: string, resume: boolean, model: string) {
  await deps.append(s.logPath, JSON.stringify({ type: 'mp_turn', n: Date.now(), message, at: deps.now().toISOString() }));
  const pid = deps.spawn(deps.claudeBin!, buildClaudeArgs({ message, sessionId: s.claudeSessionId, resume, model }), s.logPath, () => {
    void refreshFilm(db, deps, s.id).catch(() => {});
  });
  return db.filmSession.update({ where: { id: s.id }, data: { status: 'running', checkpoint: null, message: null, pid, turnStartedAt: deps.now() } });
}

export async function startFilm(db: PrismaClient, deps: RunnerDeps, i: { projectId: string; kind: 'new' | 'revise'; baseVersion?: number; note?: string; model: string }): Promise<FilmSession> {
  if (!deps.claudeBin) throw new FilmBusy(NO_CLAUDE);
  const other = await runningElsewhere(db, i.projectId);
  if (other) throw new FilmBusy(`「${other.title}」正在出片，等它做完再开始`);
  if (await currentFilm(db, i.projectId)) throw new FilmBusy('这个项目还有一次出片没结束：先接着做或放弃');
  const p = await db.project.findUnique({ where: { id: i.projectId } });
  if (!p) throw new Error('项目不存在或已删除');
  const baseFilmDir = i.kind === 'revise' && i.baseVersion ? `remotion/films/${p.id}-v${i.baseVersion}` : null;
  const id = deps.uuid();
  const s = await db.filmSession.create({
    data: { projectId: p.id, kind: i.kind, baseFilmDir, claudeSessionId: id, status: 'running', logPath: path.join(deps.logDir, `${id}.jsonl`) },
  });
  return launch(db, deps, s, firstMessage({ kind: i.kind, projectId: p.id, title: p.title, baseFilmDir: baseFilmDir ?? undefined, baseVersion: i.baseVersion, note: i.note }), false, i.model);
}

export async function replyFilm(db: PrismaClient, deps: RunnerDeps, id: string, text: string, model: string): Promise<FilmSession> {
  if (!deps.claudeBin) throw new FilmBusy(NO_CLAUDE);
  const { session: s } = await refreshFilm(db, deps, id);
  if (s.status === 'running') throw new FilmBusy('还在做，等这一步停下来再回复');
  if (!OPEN.includes(s.status)) throw new FilmBusy('这次出片已经结束');
  const other = await runningElsewhere(db, s.projectId);
  if (other) throw new FilmBusy(`「${other.title}」正在出片，等它做完再继续`);
  if (!text.trim()) throw new FilmBusy('回复是空的');
  return launch(db, deps, s, text.trim(), true, model);
}

export async function stopFilm(db: PrismaClient, deps: RunnerDeps, id: string): Promise<FilmSession> {
  const s = await db.filmSession.findUnique({ where: { id } });
  if (!s) throw new Error('找不到这次出片');
  if (s.pid && deps.isAlive(s.pid)) deps.killGroup(s.pid);
  return db.filmSession.update({ where: { id }, data: { status: 'stopped', message: '已停止' } });
}

export async function abandonFilm(db: PrismaClient, id: string): Promise<FilmSession> {
  const s = await db.filmSession.findUnique({ where: { id } });
  if (!s) throw new Error('找不到这次出片');
  if (s.status === 'running') throw new FilmBusy('还在做，先停止再放弃');
  return db.filmSession.update({ where: { id }, data: { status: 'abandoned' } });
}

export async function refreshFilm(db: PrismaClient, deps: RunnerDeps, id: string): Promise<{ session: FilmSession; parsed: ParsedLog }> {
  let s = await db.filmSession.findUnique({ where: { id } });
  if (!s) throw new Error('找不到这次出片');
  const parsed = parseLog(await deps.readLines(s.logPath));
  if (s.status !== 'running') return { session: s, parsed };
  const alive = !!s.pid && deps.isAlive(s.pid);
  const st = deriveState({ last: parsed.last, alive, turnStartedAt: s.turnStartedAt, now: deps.now() });
  if (st.timedOut && s.pid) deps.killGroup(s.pid);
  if (st.status === 'running') {
    if (parsed.filmDir && parsed.filmDir !== s.filmDir) s = await db.filmSession.update({ where: { id }, data: { filmDir: parsed.filmDir } });
    return { session: s, parsed };
  }
  // 只有从 running 变过来的那一次会走到这里: 用条件更新防止并发重复通知
  const claimed = await db.filmSession.updateMany({ where: { id, status: 'running' }, data: { status: st.status, checkpoint: st.checkpoint, message: st.message, version: st.version, summary: parsed.last.registeredSummary, filmDir: parsed.filmDir ?? s.filmDir } });
  s = (await db.filmSession.findUnique({ where: { id } }))!;
  if (claimed.count > 0) await notify(db, s);
  return { session: s, parsed };
}
```


- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add prisma/schema.prisma src/lib/film-session tests
git commit -m "feat(film-session): 出片会话(建/续轮/停止/放弃/刷新状态/通知), 子进程脱离网页服务, 全局一个在跑

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 接口、体检与出片模型设置

**Files:**
- Create: `src/app/api/projects/[id]/film-session/route.ts`、`src/app/api/film-sessions/[id]/file/route.ts`、`src/app/api/settings/film-model/route.ts`、`src/lib/film-session/files.ts`
- Modify: `src/lib/health/checks.ts`、`src/app/api/settings/health/route.ts`、`src/components/settings/models-card.tsx`
- Test: `tests/lib/film-session/files.test.ts`、`tests/lib/health/checks.test.ts`（追加）

**Interfaces:**
- Produces：
  - `resolveSessionFile(filmDirAbs: string, rel: string): string | null`（只放行 `filmDir` 内的 `.png` / `.mp4`）
  - `GET /api/projects/[id]/film-session` → `FilmSessionData = { current: FilmSessionView | null; history: { id: string; version: number | null; status: string; summary: string | null; createdAt: string }[]; busyElsewhere: { projectId: string; title: string } | null; claudeAvailable: boolean; versions: number[] }`；`FilmSessionView = { id; status; checkpoint; message; filmDir; version; createdAt; items: Item[]; shots: { id: string; fromSec: number; toSec: number; intent: string; material: string | null }[] | null; previewUrl: string | null }`
  - `POST` 同路径：`{ action: 'start', kind, baseVersion?, note? } | { action: 'reply', text } | { action: 'stop' } | { action: 'abandon' }` → `FilmSessionData`；`FilmBusy` → 409 + 中文
  - `GET /api/film-sessions/[id]/file?path=` → 文件（支持 Range）
  - `GET/PUT /api/settings/film-model` → `{ model: 'opus' | 'sonnet' }`
  - 体检项：`{ key: 'claude', label: 'Claude Code（出片）', status, detail, fix? }`

- [ ] **Step 1: 写失败测试**

`tests/lib/film-session/files.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSessionFile } from '@/lib/film-session/files';

describe('session files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-film-'));
  fs.mkdirSync(path.join(dir, 'stills'));
  fs.writeFileSync(path.join(dir, 'stills', '1.2.png'), 'x');
  fs.mkdirSync(path.join(dir, 'out'));
  fs.writeFileSync(path.join(dir, 'out', 'final.mp4'), 'x');
  fs.writeFileSync(path.join(dir, 'Film.tsx'), 'x');
  it('serves pngs and mp4s inside the film dir', () => {
    expect(resolveSessionFile(dir, 'stills/1.2.png')).toBe(path.join(dir, 'stills', '1.2.png'));
    expect(resolveSessionFile(dir, 'out/final.mp4')).toBe(path.join(dir, 'out', 'final.mp4'));
  });
  it('refuses paths outside the session film dir', () => {
    expect(resolveSessionFile(dir, '../x.png')).toBeNull();
    expect(resolveSessionFile(dir, '/etc/passwd')).toBeNull();
    expect(resolveSessionFile(dir, 'Film.tsx')).toBeNull();
    expect(resolveSessionFile(dir, 'stills/missing.png')).toBeNull();
  });
});
```

`tests/lib/health/checks.test.ts` 追加一个用例：沿用该文件现有的 deps 工厂，传入 `claudeBin: '/x/claude'` 与 `exec` 对 `/x/claude --version` 返回 `{ code: 0, stdout: '2.1.285 (Claude Code)' }`，断言 items 含 `{ key: 'claude', status: 'ok', detail: 'Claude Code 2.1.285' }`；`claudeBin: null` 时为 `status: 'warn'`、`fix` 含"安装后在终端运行 claude 登录"。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/film-session/files.test.ts tests/lib/health`
Expected: FAIL。

- [ ] **Step 3: 实现**

`src/lib/film-session/files.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';

/** 出片过程里的截图 / 成片预览: 只放行该会话片子目录内的 png / mp4 */
export function resolveSessionFile(filmDirAbs: string, rel: string): string | null {
  if (!/\.(png|mp4)$/i.test(rel) || path.isAbsolute(rel)) return null;
  const root = path.resolve(filmDirAbs);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) return null;
  return fs.existsSync(full) ? full : null;
}
```

`src/lib/health/checks.ts`：deps 加 `claudeBin: string | null`；在 remotion 项之后：

```ts
  if (deps.claudeBin) {
    const v = await deps.exec(deps.claudeBin, ['--version'], 5000);
    items.push(
      v.code === 0
        ? { key: 'claude', label: 'Claude Code（出片）', status: 'ok', detail: `Claude Code ${v.stdout.trim().split(' ')[0]}` }
        : { key: 'claude', label: 'Claude Code（出片）', status: 'warn', detail: 'claude 命令运行失败', fix: '在终端运行 claude 看看报错，必要时重新登录' },
    );
  } else {
    items.push({ key: 'claude', label: 'Claude Code（出片）', status: 'warn', detail: '没有找到 claude 命令，网页里出片用不了', fix: '安装 Claude Code 后在终端运行 claude 登录' });
  }
```

（`exec` 的签名按该文件现有 `Exec` 类型；health 路由传 `claudeBin: resolveClaudeBin(process.env, fsSync.existsSync, os.homedir())`。）

`src/app/api/settings/film-model/route.ts`：GET 读 `AppSetting` `film.model`（无则 `opus`）；PUT 校验 ∈ `FILM_MODELS` 后 upsert。

`models-card.tsx`：卡片底部加一行"出片模型：[Opus ▾]"（`select`，选项 Opus / Sonnet，变更即 PUT），旁注"网页里出片用（本机 Claude Code）"。

`src/app/api/projects/[id]/film-session/route.ts`:

```ts
import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { abandonFilm, createRunnerDeps, currentFilm, FilmBusy, refreshFilm, replyFilm, runningElsewhere, startFilm, stopFilm } from '@/lib/film-session/runner';
import { DEFAULT_FILM_MODEL } from '@/lib/film-session/args';
import { ShotsFileSchema } from '@/lib/film/shots';
import type { Item } from '@/lib/film-session/parse';

export const dynamic = 'force-dynamic';

export interface FilmSessionView {
  id: string;
  status: string;
  checkpoint: string | null;
  message: string | null;
  filmDir: string | null;
  version: number | null;
  createdAt: string;
  items: Item[];
  shots: { id: string; fromSec: number; toSec: number; intent: string; material: string | null }[] | null;
  previewUrl: string | null;
}
export interface FilmSessionData {
  current: FilmSessionView | null;
  history: { id: string; version: number | null; status: string; summary: string | null; createdAt: string }[];
  busyElsewhere: { projectId: string; title: string } | null;
  claudeAvailable: boolean;
  versions: number[];
}

const model = async () => (await prisma.appSetting.findUnique({ where: { key: 'film.model' } }))?.value ?? DEFAULT_FILM_MODEL;

async function view(projectId: string): Promise<FilmSessionData> {
  const deps = createRunnerDeps();
  const cur = await currentFilm(prisma, projectId);
  let current: FilmSessionView | null = null;
  if (cur) {
    const { session: s, parsed } = await refreshFilm(prisma, deps, cur.id);
    let shots: FilmSessionView['shots'] = null;
    if (s.filmDir) {
      const raw = await fs.readFile(path.join(process.cwd(), s.filmDir, 'shots.json'), 'utf8').catch(() => null);
      const f = raw ? ShotsFileSchema.safeParse(JSON.parse(raw)) : null;
      if (f?.success) shots = f.data.shots.map((x) => ({ id: x.id, fromSec: x.fromSec, toSec: x.toSec, intent: x.intent, material: x.material?.id ?? null }));
    }
    current = {
      id: s.id,
      status: s.status,
      checkpoint: s.checkpoint,
      message: s.message,
      filmDir: s.filmDir,
      version: s.version,
      createdAt: s.createdAt.toISOString(),
      items: parsed.items,
      shots,
      previewUrl: s.checkpoint === 'render' ? `/api/film-sessions/${s.id}/file?path=out/final.mp4&t=${s.updatedAt.getTime()}` : null,
    };
  }
  const past = await prisma.filmSession.findMany({ where: { projectId, status: { in: ['done', 'abandoned'] } }, orderBy: { createdAt: 'desc' }, take: 10 });
  const films = await prisma.projectFile.findMany({ where: { projectId, kind: 'final_mp4' }, select: { meta: true } });
  return {
    current,
    history: past.map((h) => ({ id: h.id, version: h.version, status: h.status, summary: h.summary, createdAt: h.createdAt.toISOString() })),
    busyElsewhere: await runningElsewhere(prisma, projectId),
    claudeAvailable: !!deps.claudeBin,
    versions: films.map((f) => Number((f.meta as { filmVersion?: unknown } | null)?.filmVersion) || 0).filter(Boolean).sort((a, b) => b - a),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return ok(await view(params.id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; kind?: string; baseVersion?: number; note?: string; text?: string };
  const deps = createRunnerDeps();
  try {
    if (b.action === 'start') await startFilm(prisma, deps, { projectId: params.id, kind: b.kind === 'revise' ? 'revise' : 'new', baseVersion: b.baseVersion, note: b.note, model: await model() });
    else {
      const cur = await currentFilm(prisma, params.id);
      if (!cur) return fail('没有进行中的出片', 404);
      if (b.action === 'reply') await replyFilm(prisma, deps, cur.id, String(b.text ?? ''), await model());
      else if (b.action === 'stop') await stopFilm(prisma, deps, cur.id);
      else if (b.action === 'abandon') await abandonFilm(prisma, cur.id);
      else return fail('action 不对', 400);
    }
  } catch (e) {
    if (e instanceof FilmBusy) return fail(e.message, 409);
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok(await view(params.id));
}
```


`src/app/api/film-sessions/[id]/file/route.ts`：查 `filmSession`，`filmDir` 为空 404；`resolveSessionFile(path.join(process.cwd(), s.filmDir), url.searchParams.get('path') ?? '')` 为空 404；其余照搬 `src/app/api/projects/[id]/files/[fileId]/route.ts` 的 Range 流式返回（`TYPES` 只保留 png / mp4）。

- [ ] **Step 4: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/app/api src/lib src/components/settings tests
git commit -m "feat(film-session): 出片接口(状态/开始/回复/停止/放弃) + 截图与成片预览文件接口 + Claude Code 体检 + 出片模型设置

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 出片助手卡片

**Files:**
- Create: `src/components/project/film-assistant.tsx`
- Modify: `src/components/project/film-pane.tsx`
- Test: `tests/components/film-assistant.test.tsx`

**Interfaces:**
- Consumes：`FilmSessionData`、`FilmSessionView`（Task 4）
- Produces：`FilmAssistant({ projectId, onChanged }: { projectId: string; onChanged: () => void })`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilmAssistant } from '@/components/project/film-assistant';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = (over = {}) => ({ current: null, history: [], busyElsewhere: null, claudeAvailable: true, versions: [], ...over });
const session = (over = {}) => ({ id: 'fs1', status: 'running', checkpoint: null, message: null, filmDir: 'remotion/films/p1-v3', version: null, createdAt: '2026-10-03T00:00:00.000Z', items: [{ kind: 'you', text: '给项目 p1 出一版' }, { kind: 'step', text: '读稿子和素材', ok: true }], shots: null, previewUrl: null, ...over });
const stub = (d: unknown) => {
  const f = vi.fn(async () => ({ json: async () => ({ success: true, data: d }) }));
  vi.stubGlobal('fetch', f);
  return f;
};
const posted = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST').map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));

describe('FilmAssistant', () => {
  it('starts a new film with an optional note', async () => {
    const f = stub(data());
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('出一版')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/要求/), { target: { value: '节奏快一点' } });
    fireEvent.click(screen.getByText('出一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'new', note: '节奏快一点' }]));
  });
  it('offers revising the latest version when films exist', async () => {
    const f = stub(data({ versions: [2, 1] }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('改这一版')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/修改意见/), { target: { value: '第 3 镜太挤' } });
    fireEvent.click(screen.getByText('改这一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'revise', baseVersion: 2, note: '第 3 镜太挤' }]));
  });
  it('shows progress and a stop button while running', async () => {
    stub(data({ current: session() }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('✓ 读稿子和素材')).toBeTruthy());
    expect(screen.getByText('停止')).toBeTruthy();
  });
  it('asks to confirm the shot list', async () => {
    const f = stub(data({ current: session({ status: 'waiting', checkpoint: 'shots', message: '切了 2 镜', shots: [{ id: 'a', fromSec: 0, toSec: 4.5, intent: '开场', material: null }, { id: 'b', fromSec: 4.5, toSec: 9, intent: '截图', material: 'm1' }] }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('等你确认镜头表')).toBeTruthy());
    expect(screen.getByText('截图')).toBeTruthy();
    fireEvent.click(screen.getByText('可以，继续'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'reply', text: '可以，继续' }]));
  });
  it('previews the render and registers on confirm', async () => {
    const f = stub(data({ current: session({ status: 'waiting', checkpoint: 'render', message: '这一版用了截图', previewUrl: '/api/film-sessions/fs1/file?path=out/final.mp4' }) }));
    const { container } = render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('等你确认成片')).toBeTruthy());
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/film-sessions/fs1/file?path=out/final.mp4');
    fireEvent.click(screen.getByText('登记为新版本'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'reply', text: '可以，登记' }]));
  });
  it('offers resume and abandon after a failure', async () => {
    stub(data({ current: session({ status: 'failed', message: 'usage limit reached' }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/usage limit reached/)).toBeTruthy());
    expect(screen.getByText('接着做')).toBeTruthy();
    expect(screen.getByText('放弃')).toBeTruthy();
  });
  it('is disabled while another project is filming or claude is missing', async () => {
    stub(data({ busyElsewhere: { projectId: 'p2', title: '另一个' } }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('「另一个」正在出片')).toBeTruthy());
    expect((screen.getByText('出一版') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    stub(data({ claudeAvailable: false }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/本机没有可用的 Claude Code/)).toBeTruthy());
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/film-assistant.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/components/project/film-assistant.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FilmSessionData } from '@/app/api/projects/[id]/film-session/route';
import { cn } from '@/lib/utils';

const sec = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function FilmAssistant({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [d, setD] = useState<FilmSessionData | null>(null);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  const [base, setBase] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const url = `/api/projects/${projectId}/film-session`;

  const load = useCallback(async () => {
    const j = await fetch(url).then((r) => r.json()).catch(() => ({ success: false, message: '读取出片状态失败' }));
    if (j.success) setD(j.data);
    else setErr(j.message);
  }, [url]);
  useEffect(() => {
    void load();
  }, [load]);
  // 在跑时每 3 秒刷新; 状态变化时通知工作区(拿对话里的通知、成片列表)
  const status = d?.current?.status;
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [status, load]);
  const [prevStatus, setPrevStatus] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (prevStatus === 'running' && status !== 'running') onChanged();
    setPrevStatus(status);
  }, [status, prevStatus, onChanged]);

  const post = async (body: object) => {
    setBusy(true);
    setErr(null);
    const j = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ success: false, message: '服务没有响应' }));
    setBusy(false);
    if (j.success) {
      setD(j.data);
      setReply('');
      setNote('');
    } else setErr(j.message);
  };

  if (!d) return <div className="card text-sm text-[var(--text-secondary)]">{err ?? '读取出片状态…'}</div>;
  const c = d.current;
  const blocked = !d.claudeAvailable ? '本机没有可用的 Claude Code：安装后在终端运行 claude 登录' : d.busyElsewhere ? `「${d.busyElsewhere.title}」正在出片` : null;
  const latest = d.versions[0] ?? null;
  const baseVersion = base ?? latest;
  const fileUrl = (p: string) => `/api/film-sessions/${c!.id}/file?path=${encodeURIComponent(p)}`;

  return (
    <section className="card space-y-3 text-sm">
      <h3 className="text-[15px] font-semibold">出片助手</h3>
      {err && <p className="text-[var(--danger)]">{err}</p>}

      {!c ? (
        <div className="space-y-3">
          {blocked && <p className="text-[var(--warning)]">{blocked}</p>}
          <div className="space-y-2">
            <textarea className="h-16 w-full rounded-[var(--r-md)] bg-[var(--bg-inset)] p-2" placeholder="要求（可不填），比如：开头用截图那张素材，节奏快一点" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" disabled={busy || !!blocked} onClick={() => void post({ action: 'start', kind: 'new', ...(note.trim() ? { note: note.trim() } : {}) })}>
                出一版
              </button>
              {latest !== null && (
                <>
                  <select className="rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1" value={baseVersion ?? ''} onChange={(e) => setBase(Number(e.target.value))}>
                    {d.versions.map((v) => (
                      <option key={v} value={v}>{`基于 v${v}`}</option>
                    ))}
                  </select>
                  <input className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-inset)] px-2 py-1.5" placeholder="修改意见，比如：第 3 镜太挤，换成对比卡" value={reply} onChange={(e) => setReply(e.target.value)} />
                  <button className="btn-secondary" disabled={busy || !!blocked || !reply.trim()} onClick={() => void post({ action: 'start', kind: 'revise', baseVersion, note: reply.trim() })}>
                    改这一版
                  </button>
                </>
              )}
            </div>
          </div>
          {d.history.length > 0 && (
            <ul className="space-y-1 text-xs text-[var(--text-tertiary)]">
              {d.history.map((h) => (
                <li key={h.id}>{`${h.status === 'done' ? `v${h.version}` : '已放弃'} · ${new Date(h.createdAt).toLocaleDateString('zh-CN')}${h.summary ? ` · ${h.summary}` : ''}`}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <ol className="space-y-1.5">
            {c.items.map((it, i) =>
              it.kind === 'you' ? (
                <li key={i} className="ml-8 rounded-[var(--r-md)] bg-[var(--accent-subtle)] px-3 py-1.5">{it.text}</li>
              ) : it.kind === 'say' ? (
                <li key={i} className="mr-8 whitespace-pre-wrap rounded-[var(--r-md)] bg-[var(--bg-inset)] px-3 py-1.5">{it.text}</li>
              ) : it.kind === 'denied' ? (
                <li key={i} className="text-xs text-[var(--warning)]">{`⛔ 被拒绝：${it.text}`}</li>
              ) : it.kind === 'still' ? (
                <li key={i} className="inline-block pr-2">
                  <button onClick={() => setZoom(it.path)}>
                    <img src={fileUrl(it.path)} alt={it.path} className="h-24 rounded-[var(--r-sm)]" />
                  </button>
                </li>
              ) : (
                <li key={i} className={cn('text-xs', it.ok === false ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]')}>{`${it.ok === false ? '✗' : '✓'} ${it.text}`}</li>
              ),
            )}
            {c.status === 'running' && <li className="text-xs text-[var(--text-tertiary)]">⏳ 正在做…</li>}
          </ol>

          {c.status === 'running' && (
            <button className="btn-secondary" disabled={busy} onClick={() => void post({ action: 'stop' })}>
              停止
            </button>
          )}

          {c.status === 'waiting' && (
            <div className="card-hero space-y-2">
              <div className="font-semibold">{c.checkpoint === 'shots' ? '等你确认镜头表' : c.checkpoint === 'render' ? '等你确认成片' : '它在等你回答'}</div>
              {c.checkpoint === 'shots' && c.shots && (
                <table className="w-full text-xs tabular-nums">
                  <tbody>
                    {c.shots.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--border-subtle)]">
                        <td className="py-1 pr-2">{`${sec(s.fromSec)}–${sec(s.toSec)}`}</td>
                        <td className="py-1 pr-2">{s.intent}</td>
                        <td className="py-1 text-[var(--text-tertiary)]">{s.material ? `素材 ${s.material}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.checkpoint === 'render' && c.previewUrl && <video src={c.previewUrl} controls className="max-h-[60vh] w-full rounded-[var(--r-md)] bg-black" />}
              <div className="flex flex-wrap gap-2">
                {c.checkpoint === 'shots' && (
                  <button className="btn-primary" disabled={busy} onClick={() => void post({ action: 'reply', text: '可以，继续' })}>可以，继续</button>
                )}
                {c.checkpoint === 'render' && (
                  <button className="btn-primary" disabled={busy} onClick={() => void post({ action: 'reply', text: '可以，登记' })}>登记为新版本</button>
                )}
                <input className="min-w-0 flex-1 rounded-[var(--r-md)] bg-[var(--bg-surface)] px-2 py-1.5" placeholder="或者写你的意见…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <button className="btn-secondary" disabled={busy || !reply.trim()} onClick={() => void post({ action: 'reply', text: reply.trim() })}>发送</button>
              </div>
            </div>
          )}

          {(c.status === 'failed' || c.status === 'stopped') && (
            <div className="space-y-2">
              <p className="text-[var(--danger)]">{`出片停了：${c.message ?? '出错了'}`}</p>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={busy || !!blocked} onClick={() => void post({ action: 'reply', text: '接着做' })}>接着做</button>
                <button className="btn-secondary" disabled={busy} onClick={() => void post({ action: 'abandon' })}>放弃</button>
              </div>
            </div>
          )}
        </div>
      )}

      {zoom && c && (
        <button className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setZoom(null)}>
          <img src={fileUrl(zoom)} alt={zoom} className="max-h-[90vh] rounded-[var(--r-md)]" />
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 4: 接进成片页**

`film-pane.tsx`：在组件最外层内容的第一个子元素位置渲染 `<FilmAssistant projectId={projectId} onChanged={onChanged} />`；把"还没有成片。在 Claude Code 里说「给这个项目出片」，出好的成片会出现在这里。"改为"还没有成片。在上面「出片助手」里点「出一版」。"；把"修改成片：在 Claude Code 里说「改这个项目的成片：……」"一行删除（改片入口在出片助手）。相关测试里断言这两句文案的同步改。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/components/project tests/components
git commit -m "feat(film-session): 成片页出片助手(出一版/改这一版、进度与截图、镜头表与成片确认、停止/接着做/放弃)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-10-03-film-in-app-design.md`（追加实测）、`src/lib/assistant/context.ts`（总助手规则里"出片要在 Claude Code 里做"改为"出片在作品的「成片」一步点「出一版」，也可以在 Claude Code 里说"）、`tests/lib/assistant/context.test.ts`（同步断言）

- [ ] **Step 1: README**

把"③ 成片"条目改为：

```markdown
- **③ 成片**：上传录屏、视频、截图、图片作素材（可写一句说明）。在「成片」一步的出片助手里点「出一版」（或「改这一版」写修改意见），后台用本机 Claude Code 按 produce-film 流程出片：进度、关键帧截图实时显示，镜头表排好、成片渲染好时各停一次等你确认，确认后登记为新版本；可停止、接着做、放弃。也可以继续在 Claude Code 里说「给这个项目出片」。出片模型在设置页「模型」里选（默认 Opus），需要本机装好并登录 Claude Code。
```

目录一节加 `src/lib/film-session/  网页出片：启动参数与白名单、日志解析、状态判断、会话运行`。

- [ ] **Step 2: 真机验收（重启 dev；会用订阅额度）**

1. `npx tsx scripts/film-perms-check.ts` 三项 ✓（Task 1 已跑过则跳过）。
2. 设置页体检出现"Claude Code（出片）"为绿；「模型」卡片有出片模型选择。
3. 「U盘干到品类第一（验收）」→ 成片 → 基于 v2「改这一版」，意见写"第 1 镜的字再大一点，其他不变"：看到进度行与关键帧缩略图 → 停在"等你确认镜头表"并显示表格 →「可以，继续」→ 停在"等你确认成片"可播放 →「登记为新版本」→ 成片列表出现 v3；编导对话收到三条通知。
4. 过程中刷新页面一次，进度不丢。
5. 再开一次「改这一版」，进行中点「停止」→ 显示"出片停了：已停止"→「放弃」。
6. 问用户 v3 是否保留。

实测写入 spec 末尾。

- [ ] **Step 3: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-10-03-film-in-app-design.md src/lib/assistant/context.ts tests/lib/assistant/context.test.ts
git commit -m "docs: README 补网页出片, spec 记录真机实测; 总助手规则改为可在成片页出片

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
