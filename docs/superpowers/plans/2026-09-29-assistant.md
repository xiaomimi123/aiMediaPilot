# 产品总助手实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏「助手」：跨项目对话，工具由 `mp` 命令注册表转换（出片与装 Hermes 除外），带 3 个内置 skill，直接做事。

**Architecture:** `runAgentTurn` 注入 `ConversationScope`（系统提示 / 历史 / 存消息），项目编导用 `projectScope`（行为不变），助手用 `assistantScope`。`src/lib/assistant/` 放命令→工具转换、skill 读取、系统提示、范围；`ChatPanel` 泛化出 `endpoint` / 快捷按钮 / 链接渲染后两处共用。

**Tech Stack:** Next.js 14、Prisma 5、zod、vitest + testing-library。

**Spec:** `docs/superpowers/specs/2026-09-29-assistant-design.md`

## Global Constraints

- 编导原有行为与测试不变（`runAgentTurn` 仍接受 `projectId`，未传 `scope` 时用 `projectScope`）。
- 助手工具排除：`film new/check/render/register`、`project export`、`agents install-hermes`；工具名 = 命令路径用 `_` 连接。
- 工具执行身份为 `claude-code`（全权限），命令的中文错误原样交回模型；硬护栏（每日额度、只读抖音、定稿不倒退）由命令本身保证。
- 模型报"不支持工具调用"时，本轮去掉工具重试一次，并先输出一行 `（当前模型只能聊天，不能帮你操作产品，换一个能当编导的模型。）`。
- 上下文只带最近 20 条消息；每轮最多 8 次工具、10 次模型（沿用）。
- skill 位于 `assistant/skills/<名字>/SKILL.md`，YAML 头含 `name`、`description`。
- 回复与工具结果里的 `/projects/<id>`、`/topics` 路径渲染成可点链接。

## Review Focus

1. **助手让编导写稿（`chat` 工具）时编导失败**：失败原因要回到助手、由它转告，而不是整轮崩掉。→ Task 2 测试 `returns a failed result with the command's message`。
2. **模型编了一个不存在的工具名或参数格式不对**：循环原有"没有这个工具 / 参数不对"处理照常生效。→ Task 2 测试 `rejects bad flag values with the command error`。
3. **`load_skill` 传了不存在的名字**：返回可用列表，不抛错。→ Task 2 测试 `lists skills when the name is unknown`。
4. **同一对话第一条消息前刷新页面**：对话标题取第一句用户消息，只设一次。→ Task 3 测试 `titles the thread from the first user message only`。
5. **模型不支持工具**：只重试一次，不无限循环。→ Task 1 测试 `retries once without tools`。

---

## 文件结构

```
src/lib/agent/scope.ts                  ConversationScope + projectScope
src/lib/agent/loop.ts                   改用 scope; 工具事件带 detail; 不支持工具时降级重试
src/lib/assistant/tools.ts              命令 → 工具, ASSISTANT_EXCLUDED, buildAssistantTools
src/lib/assistant/skills.ts             skill 解析 / 列表 / load_skill 工具
src/lib/assistant/context.ts            助手系统提示
src/lib/assistant/scope.ts              assistantScope
assistant/skills/{daily-kickoff,benchmark-to-draft,data-diagnosis}/SKILL.md
prisma/schema.prisma                    + AssistantThread, AssistantMessage
src/app/api/assistant/threads/...       列表/新建/读取/对话(SSE)
src/components/project/chat-panel.tsx   + endpoint / quickPrompts / 链接 / 工具行展开 / 标题与占位文字可配
src/app/assistant/page.tsx, src/components/assistant/assistant-view.tsx
src/app/layout.tsx                      侧栏 + 助手
```

---

### Task 1: 对话循环范围化

**Files:**
- Create: `src/lib/agent/scope.ts`
- Modify: `src/lib/agent/loop.ts`
- Test: `tests/lib/agent/scope.test.ts`、`tests/lib/agent/loop.test.ts`（加用例）

**Interfaces:**
- Produces：
  - `interface ScopeMessage { role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolName?: string; toolInput?: Prisma.InputJsonValue; toolResult?: Prisma.InputJsonValue }`
  - `interface ConversationScope { buildSystemPrompt(): Promise<string>; loadHistory(): Promise<AgentMessage[]>; save(m: ScopeMessage): Promise<void> }`
  - `projectScope(db: PrismaClient, projectId: string): ConversationScope`
  - `runAgentTurn` opts：`projectId?: string; scope?: ConversationScope`（二选一；都没有抛错）
  - `AgentEvent` 的 tool 变体加可选 `detail?: string`（取 `result.data.text` 当其为字符串时）
  - `TOOLS_UNSUPPORTED_NOTE = '（当前模型只能聊天，不能帮你操作产品，换一个能当编导的模型。）\n'`

- [ ] **Step 1: 写失败测试**

`tests/lib/agent/scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runAgentTurn, type AgentEvent } from '@/lib/agent/loop';
import type { ConversationScope, ScopeMessage } from '@/lib/agent/scope';
import type { ChatModel } from '@/lib/agent/chat-model';

describe('runAgentTurn with a custom scope', () => {
  it('uses the scope for prompt, history and saving', async () => {
    const saved: ScopeMessage[] = [];
    const seen: unknown[] = [];
    const scope: ConversationScope = {
      buildSystemPrompt: async () => '你是总助手',
      loadHistory: async () => [{ role: 'user', content: '之前的话' }],
      save: async (m) => void saved.push(m),
    };
    const model: ChatModel = { async streamTurn(messages, _t, onText) { seen.push(...messages); onText('好的'); return { text: '好的', toolCalls: [] }; } };
    const events: AgentEvent[] = [];
    await runAgentTurn({ scope, userText: '你好', db: {} as never, model, tools: [], toolCtx: { projectId: '', db: {} as never, llm: {} as never }, emit: (e) => events.push(e) });
    expect(seen[0]).toEqual({ role: 'system', content: '你是总助手' });
    expect(saved.map((m) => [m.role, m.content])).toEqual([['user', '你好'], ['assistant', '好的']]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
});
```

在 `tests/lib/agent/loop.test.ts` 的 `describe` 里追加：

```ts
  it('retries once without tools when the model cannot call tools', async () => {
    let calls = 0;
    const model: ChatModel & { seen: number[] } = {
      seen: [],
      async streamTurn(_m, tools, onText) {
        calls++;
        model.seen.push(tools.length);
        if (tools.length) throw Object.assign(new Error('model does not support tools'), { status: 400 });
        onText('只能聊天的回答');
        return { text: '只能聊天的回答', toolCalls: [] };
      },
    };
    const { events } = await run(model);
    expect(calls).toBe(2);
    expect(model.seen).toEqual([1, 0]);
    expect(events[0]).toEqual({ type: 'text', delta: '（当前模型只能聊天，不能帮你操作产品，换一个能当编导的模型。）\n' });
    expect(events.at(-1)).toEqual({ type: 'done' });
  });
  it('carries a tool detail when the tool returns text', async () => {
    const withText: Tool<Record<string, never>> = { name: 'status', label: '概况', description: 's', input: z.object({}), async execute() { return { ok: true, summary: '概况', data: { text: '粉丝 408' } }; } };
    const { events } = await run(scriptedModel([{ text: '', toolCalls: [{ id: 'c', name: 'status', arguments: '{}' }] }, { text: '好', toolCalls: [] }]), [withText]);
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ detail: '粉丝 408' });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/agent`
Expected: FAIL（`scope` 模块不存在；新用例失败）。

- [ ] **Step 3: 实现 `src/lib/agent/scope.ts`**

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AgentMessage } from './chat-model';
import { buildSystemPrompt, loadHistory } from './context';

export interface ScopeMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolName?: string;
  toolInput?: Prisma.InputJsonValue;
  toolResult?: Prisma.InputJsonValue;
}

/** 一段对话在哪: 系统提示怎么来、历史从哪读、消息存到哪。项目编导与总助手各一种。 */
export interface ConversationScope {
  buildSystemPrompt(): Promise<string>;
  loadHistory(): Promise<AgentMessage[]>;
  save(m: ScopeMessage): Promise<void>;
}

export function projectScope(db: PrismaClient, projectId: string): ConversationScope {
  return {
    buildSystemPrompt: () => buildSystemPrompt(db, projectId),
    loadHistory: () => loadHistory(db, projectId),
    save: async (m) => {
      await db.chatMessage.create({ data: { projectId, ...m } });
    },
  };
}
```

- [ ] **Step 4: 改 `src/lib/agent/loop.ts`**

- import `projectScope, type ConversationScope` from `./scope`；删掉对 `buildSystemPrompt, loadHistory` 的直接 import（改由 scope 提供）。
- `AgentEvent` 的 tool 变体改为 `{ type: 'tool'; name: string; ok: boolean; summary: string; segmentIds: string[]; detail?: string }`。
- 导出 `export const TOOLS_UNSUPPORTED_NOTE = '（当前模型只能聊天，不能帮你操作产品，换一个能当编导的模型。）\n';`
- opts 改为 `{ projectId?: string; scope?: ConversationScope; userText; db; model; tools; toolCtx; emit }`；函数开头：

```ts
  const scope = opts.scope ?? (opts.projectId ? projectScope(opts.db, opts.projectId) : null);
  if (!scope) throw new Error('runAgentTurn 需要 projectId 或 scope');
```

- 全部 `db.chatMessage.create({ data: { projectId, … } })` 改为 `scope.save({ … })`（字段不变）。
- 初始消息：`{ role: 'system', content: await scope.buildSystemPrompt() }, ...(await scope.loadHistory())`。
- 模型调用改为（增加 `toolsDisabled` 标志，只降级一次）：

```ts
    const offerTools = used < MAX_TOOL_CALLS_PER_TURN && !toolsDisabled;
    let turn: ChatTurnResult;
    try {
      turn = await opts.model.streamTurn(messages, offerTools ? specs : [], (delta) => emit({ type: 'text', delta }));
    } catch (e) {
      const explained = explainModelError(e, opts.model.label ?? '模型');
      // 模型不会调用工具: 去掉工具重试一次, 让它至少能聊天
      if (offerTools && specs.length && !toolsDisabled && /不支持工具调用/.test(explained)) {
        toolsDisabled = true;
        emit({ type: 'text', delta: TOOLS_UNSUPPORTED_NOTE });
        continue;
      }
      const message = `编导这一轮没连上：${explained}`;
      await scope.save({ role: 'system', content: message });
      emit({ type: 'error', message });
      return;
    }
```

  （`let toolsDisabled = false;` 声明在循环前；`continue` 不增加 `used`，`modelCalls` 已计数，天然受上限约束。）
- 工具事件：`emit({ type: 'tool', name: call.name, ok: result.ok, summary: result.summary, segmentIds: result.segmentIds ?? [], ...(typeof (result.data as { text?: unknown } | undefined)?.text === 'string' ? { detail: (result.data as { text: string }).text } : {}) })`。

- [ ] **Step 5: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿（编导原有用例不变）。

```bash
git add src/lib/agent tests/lib/agent
git commit -m "refactor(agent): 对话循环范围化(项目编导/总助手共用); 工具事件带详情; 模型不支持工具时降级聊天一次

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 命令 → 工具、skill 与 load_skill

**Files:**
- Create: `src/lib/assistant/tools.ts`、`src/lib/assistant/skills.ts`、`assistant/skills/daily-kickoff/SKILL.md`、`assistant/skills/benchmark-to-draft/SKILL.md`、`assistant/skills/data-diagnosis/SKILL.md`
- Test: `tests/lib/assistant/tools.test.ts`、`tests/lib/assistant/skills.test.ts`

**Interfaces:**
- Consumes：`Command`、`CommandCtx`、`toCliError`、`ALL_COMMANDS`（`src/lib/cli`）、`Tool`、`ToolResult`
- Produces（`tools.ts`）：
  - `ASSISTANT_EXCLUDED = ['film new', 'film check', 'film render', 'film register', 'project export', 'agents install-hermes']`
  - `toolName(cmd: Command): string`（`path.join('_')`）
  - `commandToTool(cmd: Command, now?: () => Date): Tool<{ args?: string[]; flags?: Record<string, string | boolean> }>`
  - `buildAssistantTools(cmds: Command[], skillsDir: string): Tool<any>[]`（命令工具 + `load_skill`）
- Produces（`skills.ts`）：
  - `interface SkillInfo { name: string; description: string; title: string; dir: string }`
  - `parseSkill(text: string): { name: string; description: string; body: string } | null`
  - `listSkills(dir: string): Promise<SkillInfo[]>`
  - `loadSkillTool(dir: string): Tool<{ name: string }>`（成功 summary `已使用 skill：<name>`，data `{ text: body }`；名字不存在 → ok false，data 列出可用名）
  - `SKILLS_DIR = path.join(process.cwd(), 'assistant', 'skills')`

- [ ] **Step 1: 写失败测试**

`tests/lib/assistant/tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { commandToTool, buildAssistantTools, ASSISTANT_EXCLUDED } from '@/lib/assistant/tools';
import { CliError, needArg, type Command } from '@/lib/cli/registry';
import { ALL_COMMANDS } from '@/lib/cli';

const ctx = { projectId: '', db: {} as never, llm: {} as never };
const cmd = (over: Partial<Command>): Command => ({ path: ['topics', 'hits'], tier: 'read', hermes: true, usage: 'mp topics hits [--days 14]', summary: '近期对标爆款', run: async (_c, p) => ({ days: p.flags.days ?? 14 }), format: (d) => `近 ${(d as { days: unknown }).days} 天`, ...over });

describe('commandToTool', () => {
  it('names the tool after the command path and describes its usage', () => {
    const t = commandToTool(cmd({}));
    expect(t.name).toBe('topics_hits');
    expect(t.description).toBe('近期对标爆款。用法：mp topics hits [--days 14]');
  });
  it('runs the command with args and flags and returns the formatted text', async () => {
    const r = await commandToTool(cmd({})).execute(ctx, { flags: { days: '3' } });
    expect(r).toEqual({ ok: true, summary: '近期对标爆款：近 3 天', data: { text: '近 3 天', json: { days: '3' } } });
  });
  it("returns a failed result with the command's message", async () => {
    const r = await commandToTool(cmd({ run: async () => { throw new CliError('quota', '今天搜索次数用完了'); } })).execute(ctx, {});
    expect(r).toEqual({ ok: false, summary: '近期对标爆款失败：今天搜索次数用完了', data: { error: '今天搜索次数用完了' } });
  });
  it('rejects bad flag values with the command error', async () => {
    const r = await commandToTool(cmd({ run: async (_c, p) => needArg(p, 0, '项目') })).execute(ctx, {});
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('缺少参数：项目');
  });
});

describe('buildAssistantTools', () => {
  it('excludes film and hermes install, adds load_skill', () => {
    const names = buildAssistantTools(ALL_COMMANDS, '/nonexistent').map((t) => t.name);
    for (const ex of ASSISTANT_EXCLUDED) expect(names).not.toContain(ex.replace(' ', '_'));
    expect(names).toContain('status');
    expect(names).toContain('chat');
    expect(names).toContain('load_skill');
  });
});
```

`tests/lib/assistant/skills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSkill, listSkills, loadSkillTool, SKILLS_DIR } from '@/lib/assistant/skills';

const ctx = { projectId: '', db: {} as never, llm: {} as never };

describe('skills', () => {
  it('parses frontmatter and body', () => {
    expect(parseSkill('---\nname: daily-kickoff\ndescription: 每日开工\n---\n\n# 每日开工\n步骤')).toEqual({ name: 'daily-kickoff', description: '每日开工', body: '# 每日开工\n步骤' });
    expect(parseSkill('没有头')).toBeNull();
  });
  it('lists the three built-in skills', async () => {
    expect((await listSkills(SKILLS_DIR)).map((s) => s.name).sort()).toEqual(['benchmark-to-draft', 'daily-kickoff', 'data-diagnosis']);
  });
  it('loads a skill body', async () => {
    const r = await loadSkillTool(SKILLS_DIR).execute(ctx, { name: 'daily-kickoff' });
    expect(r.ok).toBe(true);
    expect(r.summary).toBe('已使用 skill：daily-kickoff');
    expect((r.data as { text: string }).text).toContain('status');
  });
  it('lists skills when the name is unknown', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-sk-'));
    await fs.mkdir(path.join(dir, 'a'));
    await fs.writeFile(path.join(dir, 'a', 'SKILL.md'), '---\nname: a\ndescription: x\n---\nbody');
    const r = await loadSkillTool(dir).execute(ctx, { name: 'nope' });
    expect(r).toEqual({ ok: false, summary: '没有叫 nope 的 skill', data: { error: '可用的 skill：a' } });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/lib/assistant`
Expected: FAIL。

- [ ] **Step 3: 实现 `src/lib/assistant/skills.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Tool } from '@/lib/tools/types';

export const SKILLS_DIR = path.join(process.cwd(), 'assistant', 'skills');

export interface SkillInfo {
  name: string;
  description: string;
  dir: string;
}

/** SKILL.md: YAML 头(name/description) + 正文; 格式与 Claude Code / Hermes 相同 */
export function parseSkill(text: string): { name: string; description: string; body: string } | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.trim());
  if (!m) return null;
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(m[1])?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const name = field('name');
  if (!name) return null;
  return { name, description: field('description'), body: m[2].trim() };
}

export async function listSkills(dir: string): Promise<SkillInfo[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: SkillInfo[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const text = await fs.readFile(path.join(dir, e.name, 'SKILL.md'), 'utf8').catch(() => null);
    const s = text ? parseSkill(text) : null;
    if (s) out.push({ name: s.name, description: s.description, dir: path.join(dir, e.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const Input = z.object({ name: z.string().min(1).describe('skill 名字(见系统提示里的清单)') });

export function loadSkillTool(dir: string): Tool<z.infer<typeof Input>> {
  return {
    name: 'load_skill',
    label: '读取 skill',
    description: '读取一个 skill 的完整步骤。做系统提示清单里列出的那类事之前先调用它，然后照着步骤做。',
    input: Input,
    async execute(_ctx, { name }) {
      const all = await listSkills(dir);
      const hit = all.find((s) => s.name === name);
      if (!hit) return { ok: false, summary: `没有叫 ${name} 的 skill`, data: { error: `可用的 skill：${all.map((s) => s.name).join('、') || '（无）'}` } };
      const s = parseSkill(await fs.readFile(path.join(hit.dir, 'SKILL.md'), 'utf8'))!;
      return { ok: true, summary: `已使用 skill：${s.name}`, data: { text: s.body } };
    },
  };
}
```

- [ ] **Step 4: 实现 `src/lib/assistant/tools.ts`**

```ts
import { z } from 'zod';
import type { Tool } from '@/lib/tools/types';
import { toCliError, type Command, type CommandCtx } from '@/lib/cli/registry';
import { loadSkillTool } from './skills';

/** 出片要在 Claude Code 里做; 装 Hermes 改用户系统 —— 不给总助手 */
export const ASSISTANT_EXCLUDED = ['film new', 'film check', 'film render', 'film register', 'project export', 'agents install-hermes'];

export const toolName = (cmd: Command) => cmd.path.join('_');

const Input = z.object({
  args: z.array(z.string()).optional().describe('位置参数, 按用法里的顺序, 如 ["项目id", "消息"]'),
  flags: z.record(z.union([z.string(), z.boolean()])).optional().describe('选项, 如 {"days": "7"} 或 {"json": true}'),
});

const firstLine = (s: string) => (s.split('\n')[0] ?? '').slice(0, 60);

export function commandToTool(cmd: Command, now: () => Date = () => new Date()): Tool<z.infer<typeof Input>> {
  return {
    name: toolName(cmd),
    label: cmd.summary,
    description: `${cmd.summary}。用法：${cmd.usage}`,
    input: Input,
    async execute(ctx, input) {
      const cctx: CommandCtx = { db: ctx.db, agent: 'claude-code', now: now(), progress: () => {}, write: () => {} };
      try {
        const data = await cmd.run(cctx, { positionals: input.args ?? [], flags: input.flags ?? {} });
        const text = cmd.format ? cmd.format(data) : JSON.stringify(data);
        return { ok: true, summary: `${cmd.summary}：${firstLine(text) || '完成'}`, data: { text, json: data } };
      } catch (e) {
        const err = toCliError(e);
        return { ok: false, summary: `${cmd.summary}失败：${firstLine(err.message)}`, data: { error: err.message } };
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAssistantTools(cmds: Command[], skillsDir: string): Tool<any>[] {
  return [...cmds.filter((c) => !ASSISTANT_EXCLUDED.includes(c.path.join(' '))).map((c) => commandToTool(c)), loadSkillTool(skillsDir)];
}
```

- [ ] **Step 5: 三个 SKILL.md**

`assistant/skills/daily-kickoff/SKILL.md`:

```markdown
---
name: daily-kickoff
description: 每日开工 —— 用户问"今天做什么/今天有什么"时, 看状态、爆款、待确认事项, 给出今天最多 3 条建议
---

# 每日开工

1. 调 `status`。回采或巡检失败时, 先把原因和补救原样告诉用户(放在最前面)。
2. 调 `topics_hits`(flags: {"days": "1"})看近 24 小时对标爆款; 没有就调 `topics_hits`(默认 14 天)取最近的。
3. 调 `publish_candidates` 看有没有等确认的作品关联; 调 `lessons_list` 看有没有待采纳的写法经验。
4. 给出"今天建议做什么", 最多 3 条, 按重要性排:
   - 每条一句话 + 可以直接执行的下一步(例如"对 /topics 里的 XX 建项目写首版, 说'开工'我来做");
   - 有等确认的关联或经验, 列一条"回电脑确认"。
5. 只引用工具给的数据, 不编数字。
```

`assistant/skills/benchmark-to-draft/SKILL.md`:

```markdown
---
name: benchmark-to-draft
description: 从对标到首版稿 —— 用户要"找个选题开工/用这条爆款写一版"时, 建项目并让编导写第一版稿
---

# 从对标到首版稿

1. 确定用哪条对标作品:
   - 用户指定了作品 id 就用它;
   - 否则调 `topics_suggest`; 数据不足(失败并说数据太少)时, 如实转告并建议先多关注几个对标账号, 到此结束;
   - 有结果就取第一个选题参考的第一条作品 id。
2. 调 `project_new`(flags: {"from-video": "<作品id>"})。记下返回的项目 id。
3. 调 `chat`(args: ["<项目id>", "按这条对标的选题写第一版稿, 用我的角度讲, 需要我真实经历的地方留【待补】"])。
4. 调 `project_show`(args: ["<项目id>"])。
5. 回复用户: 选题一句话、稿子要点(每段一句)、约多少秒、有没有照抄提示或【待补】; 最后给链接 `/projects/<项目id>`, 让用户进去接着磨稿。
```

`assistant/skills/data-diagnosis/SKILL.md`:

```markdown
---
name: data-diagnosis
description: 数据诊断 —— 用户说"最近数据不好/怎么调整"时, 对照复盘、写法经验、对标给 2~3 条调整建议
---

# 数据诊断

1. 调 `status` 看粉丝与任务。
2. 调 `project_list`, 对阶段为 published 的项目逐个调 `retro_show`(最多 5 个), 记下每条"差"的阶段。
3. 调 `lessons_list` 看已生效与待采纳的经验。
4. 调 `topics_hits` 看近期对标爆款的选题与钩子类型。
5. 回复:
   - 先说看到了什么(哪几个阶段反复差、对标爆款的共同点), 每条带出处(哪个项目 / 哪条对标);
   - 再给 2~3 条具体可执行的调整;
   - 数据不足(没有已发布的复盘)就直说数据不足, 建议先发布并等第 3 天复盘; 不编原因、不编数字。
```

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add src/lib/assistant assistant tests/lib/assistant
git commit -m "feat(assistant): 命令注册表转助手工具(排除出片与装 Hermes) + skill 解析与 load_skill + 内置 3 个 skill

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 数据表、系统提示与助手范围

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/lib/assistant/context.ts`、`src/lib/assistant/scope.ts`
- Test: `tests/lib/assistant/context.test.ts`、`tests/lib/assistant/scope.test.ts`

**Interfaces:**
- Produces：
  - `formatAssistantPrompt(p: { persona: string; status: string; lessons: string; skills: { name: string; description: string }[] }): string`
  - `buildAssistantPrompt(db: PrismaClient, now?: Date): Promise<string>`（persona 取 `PersonaProfile` → `formatPersona`；status 用 `READ_COMMANDS` 里 `status` 的 run+format，失败写"（概况读取失败）"；lessons 用 `loadActiveLessons` + `formatLessons`；skills 用 `listSkills(SKILLS_DIR)`）
  - `assistantScope(db: PrismaClient, threadId: string, now?: Date): ConversationScope`
  - `THREAD_TITLE_LEN = 30`

- [ ] **Step 1: schema**

`prisma/schema.prisma` 末尾追加 spec §5 的 `AssistantThread`、`AssistantMessage`。

Run: `npx prisma db push && npm run typecheck`
Expected: in sync；0 错误。

- [ ] **Step 2: 写失败测试**

`tests/lib/assistant/context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatAssistantPrompt } from '@/lib/assistant/context';

describe('formatAssistantPrompt', () => {
  it('includes rules, persona, status, lessons and the skill list', () => {
    const p = formatAssistantPrompt({ persona: '定位摘要：真实是差异化', status: '粉丝 408', lessons: '- 第一句直接说结果（1 条作品）', skills: [{ name: 'daily-kickoff', description: '每日开工' }] });
    expect(p).toContain('你是用户的抖音创作总助手');
    expect(p).toContain('出片要在 Claude Code 里做');
    expect(p).toContain('【账号定位】\n定位摘要：真实是差异化');
    expect(p).toContain('【账号概况】\n粉丝 408');
    expect(p).toContain('【写法经验】\n- 第一句直接说结果（1 条作品）');
    expect(p).toContain('【可用 skill】（做这类事前先 load_skill）\n- daily-kickoff：每日开工');
    expect(p).toContain('/projects/<id>');
  });
  it('omits empty sections', () => {
    const p = formatAssistantPrompt({ persona: '', status: '粉丝 408', lessons: '', skills: [] });
    expect(p).not.toContain('【账号定位】');
    expect(p).not.toContain('【写法经验】');
  });
});
```

`tests/lib/assistant/scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assistantScope } from '@/lib/assistant/scope';

function fakeDb() {
  const thread = { id: 't1', title: '新对话', updatedAt: new Date(0) };
  const msgs: { role: string; content: string; toolName: string | null; createdAt: Date }[] = [];
  let seq = 0;
  const db = {
    assistantThread: {
      findUnique: async () => ({ ...thread }),
      update: async ({ data }: { data: Partial<typeof thread> }) => Object.assign(thread, data),
    },
    assistantMessage: {
      create: async ({ data }: { data: { role: string; content: string; toolName?: string } }) => void msgs.push({ role: data.role, content: data.content, toolName: data.toolName ?? null, createdAt: new Date(++seq) }),
      findMany: async ({ take }: { take: number }) => [...msgs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take),
    },
  } as unknown as PrismaClient;
  return { db, thread, msgs };
}

describe('assistantScope', () => {
  it('titles the thread from the first user message only', async () => {
    const { db, thread } = fakeDb();
    const s = assistantScope(db, 't1');
    await s.save({ role: 'user', content: '今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎么样了，给我三条建议' });
    expect(thread.title).toBe('今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎');
    await s.save({ role: 'user', content: '第二句' });
    expect(thread.title).toBe('今天有什么爆款？顺便看看昨晚回采成功没有，还有上周那条复盘怎');
  });
  it('loads history oldest-first and turns tool rows into notes', async () => {
    const { db } = fakeDb();
    const s = assistantScope(db, 't1');
    await s.save({ role: 'user', content: '你好' });
    await s.save({ role: 'tool', content: '概况：粉丝 408', toolName: 'status' });
    await s.save({ role: 'assistant', content: '粉丝 408' });
    expect(await s.loadHistory()).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '（已执行 status：概况：粉丝 408）' },
      { role: 'assistant', content: '粉丝 408' },
    ]);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/lib/assistant`
Expected: FAIL。

- [ ] **Step 4: 实现 `src/lib/assistant/context.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { formatPersona, type PersonaLike } from '@/lib/tools/types';
import { formatLessons, loadActiveLessons } from '@/lib/retro/lessons';
import { READ_COMMANDS } from '@/lib/cli/commands/read';
import { listSkills, SKILLS_DIR } from './skills';

const RULES = `你是用户的抖音创作总助手，能用工具查数据、操作产品（选题、项目、复盘、写法经验、每晚任务），也能和用户讨论。
工作方式：
- 用工具查数据、做事；做完用一两句话说明做了什么、结果如何。
- 做系统提示里【可用 skill】列出的那类事之前，先调用 load_skill 读步骤，再照着做。
- 只引用工具给的数据，不编数字、不编原因；工具没给的就说"工具里没有"。
- 工具失败时，把原因和下一步用中文告诉用户。
- 出片要在 Claude Code 里做，你做不了；用户要出片就告诉他去 Claude Code 说"给 X 项目出片"。
- 提到项目时给链接 /projects/<id>，提到对标作品时给 /topics。
- 回复用中文，简短，手机上也好读。`;

export function formatAssistantPrompt(p: { persona: string; status: string; lessons: string; skills: { name: string; description: string }[] }): string {
  return [
    RULES,
    p.persona ? `【账号定位】\n${p.persona}` : '',
    `【账号概况】\n${p.status}`,
    p.lessons ? `【写法经验】\n${p.lessons}` : '',
    p.skills.length ? `【可用 skill】（做这类事前先 load_skill）\n${p.skills.map((s) => `- ${s.name}：${s.description}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function buildAssistantPrompt(db: PrismaClient, now = new Date()): Promise<string> {
  const persona = await db.personaProfile.findUnique({ where: { id: 'me' } });
  const statusCmd = READ_COMMANDS.find((c) => c.path.join(' ') === 'status')!;
  let status = '（概况读取失败）';
  try {
    status = statusCmd.format!(await statusCmd.run({ db, agent: 'claude-code', now, progress: () => {}, write: () => {} }, { positionals: [], flags: {} }));
  } catch {
    // 概况读不到不影响对话
  }
  const lessons = await loadActiveLessons(db);
  return formatAssistantPrompt({
    persona: formatPersona(persona as PersonaLike | null),
    status,
    lessons: lessons.length ? formatLessons(lessons) : '',
    skills: await listSkills(SKILLS_DIR),
  });
}
```

- [ ] **Step 5: 实现 `src/lib/assistant/scope.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { ConversationScope } from '@/lib/agent/scope';
import type { AgentMessage } from '@/lib/agent/chat-model';
import { HISTORY_LIMIT } from '@/lib/agent/context';
import { buildAssistantPrompt } from './context';

export const THREAD_TITLE_LEN = 30;

export function assistantScope(db: PrismaClient, threadId: string, now = new Date()): ConversationScope {
  return {
    buildSystemPrompt: () => buildAssistantPrompt(db, now),
    async loadHistory(): Promise<AgentMessage[]> {
      const rows = await db.assistantMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'desc' }, take: HISTORY_LIMIT });
      return rows.reverse().flatMap((m): AgentMessage[] => {
        if (m.role === 'user') return [{ role: 'user', content: m.content }];
        if (m.role === 'assistant') return m.content ? [{ role: 'assistant', content: m.content }] : [];
        if (m.role === 'tool') return [{ role: 'assistant', content: `（已执行 ${m.toolName}：${m.content}）` }];
        return [];
      });
    },
    async save(m) {
      await db.assistantMessage.create({ data: { threadId, ...m } });
      const t = await db.assistantThread.findUnique({ where: { id: threadId } });
      const title = m.role === 'user' && t?.title === '新对话' ? m.content.replace(/\s+/g, ' ').trim().slice(0, THREAD_TITLE_LEN) : undefined;
      await db.assistantThread.update({ where: { id: threadId }, data: { ...(title ? { title } : {}), updatedAt: new Date() } });
    },
  };
}
```

（用户消息取前 30 字；`HISTORY_LIMIT` 已由 `src/lib/agent/context.ts` 导出。）

- [ ] **Step 6: 测试、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

```bash
git add prisma/schema.prisma src/lib/assistant tests/lib/assistant
git commit -m "feat(assistant): 助手对话表 + 系统提示(定位/概况/经验/skill 清单) + 助手对话范围

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 接口

**Files:**
- Create: `src/app/api/assistant/threads/route.ts`、`src/app/api/assistant/threads/[id]/route.ts`、`src/app/api/assistant/threads/[id]/chat/route.ts`
- Modify: `src/lib/project/view.ts`（`MessageView` 加可选 `detail?: string | null`——可选是为了不破坏现有测试里手写的消息对象；`toMessageView` 从 `toolResult.data.text` 取）
- Test: `tests/lib/project/view.test.ts`（已存在，追加用例）

**Interfaces:**
- HTTP：
  - `GET /api/assistant/threads` → `{ id, title, updatedAt }[]`（新→旧，最多 50）
  - `POST /api/assistant/threads` → `{ id, title, updatedAt }`
  - `GET /api/assistant/threads/[id]` → `{ id, title, messages: MessageView[] }`（旧→新）
  - `POST /api/assistant/threads/[id]/chat` body `{ text }` → SSE（与项目对话同格式）

- [ ] **Step 1: 写失败测试（`toMessageView` 的 detail）**

在 `tests/lib/project/view.test.ts` 末尾追加（文件已 import `toMessageView`）：

```ts
describe('toMessageView detail', () => {
  it('exposes the tool detail text', () => {
    expect(toMessageView({ id: 'm', role: 'tool', content: '概况', toolName: 'status', toolResult: { ok: true, data: { text: '粉丝 408' } } })).toMatchObject({ ok: true, detail: '粉丝 408' });
    expect(toMessageView({ id: 'm', role: 'user', content: 'x', toolName: null, toolResult: null }).detail).toBeNull();
  });
});
```

Run: `npx vitest run tests/lib/project/view.test.ts`
Expected: FAIL。

- [ ] **Step 2: 实现**

`src/lib/project/view.ts`：`MessageView` 加 `detail?: string | null;`；`toMessageView` 返回 `detail: m.toolResult && typeof m.toolResult === 'object' && typeof (m.toolResult as { data?: { text?: unknown } }).data?.text === 'string' ? (m.toolResult as { data: { text: string } }).data.text : null`。

`src/app/api/assistant/threads/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const view = (t: { id: string; title: string; updatedAt: Date }) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() });

export async function GET() {
  const rows = await prisma.assistantThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
  return ok(rows.map(view));
}

export async function POST() {
  return ok(view(await prisma.assistantThread.create({ data: {} })));
}
```

`src/app/api/assistant/threads/[id]/route.ts`:

```ts
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toMessageView } from '@/lib/project/view';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const t = await prisma.assistantThread.findUnique({ where: { id: params.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
  if (!t) return fail('找不到这个对话', 404);
  return ok({ id: t.id, title: t.title, messages: t.messages.map(toMessageView) });
}
```

`src/app/api/assistant/threads/[id]/chat/route.ts`：复制 `src/app/api/projects/[id]/chat/route.ts` 的结构，差异：
- 查 `prisma.assistantThread.findUnique`，不存在 → `fail('找不到这个对话', 404)`；
- `runAgentTurn({ scope: assistantScope(prisma, thread.id), userText: text, db: prisma, model: m.chat, tools: buildAssistantTools(ALL_COMMANDS, SKILLS_DIR), toolCtx: { projectId: '', db: prisma, llm: m.llm }, emit })`；
- 其余（SSE 流、断开处理、`NO_MODEL_MESSAGE`）与项目对话一致。

- [ ] **Step 3: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机（重启 dev：改了 schema、加了 API 目录）：`curl -X POST /api/assistant/threads` 得到 id；`curl -N -X POST /api/assistant/threads/<id>/chat -d '{"text":"今天做什么"}'` 看到 `tool` 事件（`load_skill`、`status`…）与 `text` 事件；再 `GET /api/assistant/threads/<id>` 标题为"今天做什么"。

```bash
git add src/lib/project/view.ts src/app/api/assistant tests/lib/project
git commit -m "feat(assistant): 助手对话接口(列表/新建/读取/流式对话), 工具行带详情

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 页面

**Files:**
- Modify: `src/components/project/chat-panel.tsx`（新增可选 props：`endpoint`、`title`、`placeholder`、`emptyHint`、`busyText`、`quickPrompts`；链接渲染；工具行可展开 `detail`）
- Create: `src/app/assistant/page.tsx`、`src/components/assistant/assistant-view.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/components/chat-panel.test.tsx`（已存在，追加）、`tests/components/assistant-view.test.tsx`（新建）

**Interfaces:**
- `ChatPanel` 新 props（都可选，默认值 = 现有编导文案与 `/api/projects/${projectId}/chat`）：`endpoint?: string; title?: string; placeholder?: string; emptyHint?: string; busyText?: string; quickPrompts?: string[]`；`MessageView.detail` 与 `AgentEvent.detail` 用于工具行展开。
- `linkify(text: string): (string | { href: string; label: string })[]`（导出，识别 `/projects/<id>` 与 `/topics`）
- `AssistantView()`：对话列表 + 当前对话（`ChatPanel` with `endpoint=/api/assistant/threads/<id>/chat`、`key=threadId`）+「新对话」。

- [ ] **Step 1: 写失败测试**

`tests/components/chat-panel.test.tsx`：把文件头的 import 改为下面这样（保留原有 `survives unmount…` 用例），并在末尾追加两个 `describe`：

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatPanel, linkify } from '@/components/project/chat-panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
// jsdom 没有 scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
});

const noop = () => {};

// …原有 describe('ChatPanel', …) 保持不变…

describe('linkify', () => {
  it('turns project and topics paths into links', () => {
    expect(linkify('去 /projects/cmu123abc 看，或者 /topics')).toEqual(['去 ', { href: '/projects/cmu123abc', label: '/projects/cmu123abc' }, ' 看，或者 ', { href: '/topics', label: '/topics' }]);
  });
});

describe('ChatPanel options', () => {
  it('posts to a custom endpoint from a quick prompt', async () => {
    const f = vi.fn(async () => ({ ok: false, body: null, status: 500, json: async () => ({ message: 'x' }) }));
    vi.stubGlobal('fetch', f);
    render(<ChatPanel projectId="" endpoint="/api/assistant/threads/t1/chat" title="总助手" quickPrompts={['今天做什么']} initialMessages={[]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    expect(screen.getByText('总助手')).toBeTruthy();
    fireEvent.click(screen.getByText('今天做什么'));
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/assistant/threads/t1/chat');
  });
  it('expands a tool line to show its detail', () => {
    render(<ChatPanel projectId="p1" initialMessages={[{ id: 'm', role: 'tool', content: '概况：粉丝 408', toolName: 'status', ok: true, detail: '粉丝 408\n今天对标爆款 1 条' }]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    fireEvent.click(screen.getByText(/概况：粉丝 408/));
    expect(screen.getByText(/今天对标爆款 1 条/)).toBeTruthy();
  });
  it('keeps the editor defaults', () => {
    render(<ChatPanel projectId="p1" initialMessages={[]} onTurnStart={noop} onTurnEvent={noop} onTurnEnd={noop} />);
    expect(screen.getByText('编导对话')).toBeTruthy();
  });
});
```

`tests/components/assistant-view.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AssistantView } from '@/components/assistant/assistant-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
});

describe('AssistantView', () => {
  it('lists threads and opens the latest one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () =>
        url === '/api/assistant/threads'
          ? { success: true, data: [{ id: 't1', title: '今天做什么', updatedAt: '2026-09-29T10:00:00.000Z' }] }
          : { success: true, data: { id: 't1', title: '今天做什么', messages: [{ id: 'm1', role: 'assistant', content: '去 /projects/p9 看看', toolName: null, ok: null, detail: null }] } },
    })));
    render(<AssistantView />);
    await waitFor(() => expect(screen.getAllByText('今天做什么').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('link', { name: '/projects/p9' }).getAttribute('href')).toBe('/projects/p9'));
    expect(screen.getByText('新对话')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/components/chat-panel.test.tsx tests/components/assistant-view.test.tsx`
Expected: FAIL。

- [ ] **Step 3: 改 `ChatPanel`**

- props 增加 `endpoint?`、`title = '编导对话'`、`placeholder = '和编导说点什么…（Enter 发送，Shift+Enter 换行）'`、`emptyHint = '说说这条想讲什么，比如：「让 AI 当反方挑刺，帮你检查方案漏洞，60 秒」。'`、`busyText = '编导在想…'`、`quickPrompts = []`。
- `Line` 加 `detail: string | null; open?: boolean`；初始化与 incoming 映射带上 `m.detail ?? null`；工具事件 `detail: e.detail ?? null`。
- `send(textOverride?: string)`：`const text = (textOverride ?? input).trim()`；fetch 地址 `endpoint ?? \`/api/projects/${projectId}/chat\``。
- 工具行渲染为可点击：点一下切换 `open`；`open && l.detail` 时下方显示 `<pre className="mt-1 whitespace-pre-wrap text-[var(--text-tertiary)]">{l.detail}</pre>`。
- 文本行内容用 `linkify` 渲染：字符串原样，链接渲染为 `<Link href className="text-[var(--accent)] underline">`（`next/link`）。
- 输入框上方在 `quickPrompts.length` 时渲染一排按钮，点击 `void send(p)`，`busy` 时禁用。
- 导出：

```ts
export function linkify(text: string): (string | { href: string; label: string })[] {
  const out: (string | { href: string; label: string })[] = [];
  const re = /\/projects\/[a-z0-9]+|\/topics\b/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ href: m[0], label: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
```

- [ ] **Step 4: `AssistantView` 与页面**

`src/components/assistant/assistant-view.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChatPanel } from '@/components/project/chat-panel';
import type { MessageView } from '@/lib/project/view';

type Thread = { id: string; title: string; updatedAt: string };
const QUICK = ['今天做什么', '找个选题开工', '最近数据怎么样'];

export function AssistantView() {
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [current, setCurrent] = useState<{ id: string; messages: MessageView[] } | null>(null);

  const loadThreads = useCallback(async () => {
    const j = await (await fetch('/api/assistant/threads')).json().catch(() => ({ success: false }));
    const list: Thread[] = j.success ? j.data : [];
    setThreads(list);
    return list;
  }, []);
  const open = useCallback(async (id: string) => {
    const j = await (await fetch(`/api/assistant/threads/${id}`)).json().catch(() => ({ success: false }));
    if (j.success) setCurrent({ id, messages: j.data.messages });
  }, []);
  const create = useCallback(async () => {
    const j = await (await fetch('/api/assistant/threads', { method: 'POST' })).json().catch(() => ({ success: false }));
    if (j.success) {
      setCurrent({ id: j.data.id, messages: [] });
      await loadThreads();
    }
  }, [loadThreads]);

  useEffect(() => {
    void (async () => {
      const list = await loadThreads();
      if (list[0]) await open(list[0].id);
      else await create();
    })();
  }, [loadThreads, open, create]);

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-[var(--border-subtle)] p-3 md:w-56 md:border-b-0 md:border-r">
        <button className="mb-2 w-full rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-[var(--text-on-accent)]" onClick={() => void create()}>
          新对话
        </button>
        <select className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-inset)] px-2 py-1 text-sm md:hidden" value={current?.id ?? ''} onChange={(e) => void open(e.target.value)}>
          {(threads ?? []).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
        <ul className="hidden space-y-1 md:block">
          {(threads ?? []).map((t) => (
            <li key={t.id}>
              <button className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${current?.id === t.id ? 'bg-[var(--bg-surface-hover)]' : 'hover:bg-[var(--bg-surface-hover)]'}`} onClick={() => void open(t.id)}>
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        {current && (
          <ChatPanel
            key={current.id}
            projectId=""
            endpoint={`/api/assistant/threads/${current.id}/chat`}
            title="总助手"
            placeholder="问数据、让我开工、或者聊聊怎么调整…（Enter 发送）"
            emptyHint="可以问「今天有什么爆款」「帮我找个选题建项目写第一版」「最近数据不好怎么调整」。"
            busyText="助手在处理…"
            quickPrompts={QUICK}
            initialMessages={current.messages}
            onTurnStart={() => {}}
            onTurnEvent={() => {}}
            onTurnEnd={() => void loadThreads()}
          />
        )}
      </div>
    </div>
  );
}
```

`src/app/assistant/page.tsx`:

```tsx
import { AssistantView } from '@/components/assistant/assistant-view';

export const dynamic = 'force-dynamic';

export default function AssistantPage() {
  return <AssistantView />;
}
```

`src/app/layout.tsx`：侧栏在 `{ href: '/', label: '项目' }` 之后加 `{ href: '/assistant', label: '助手' }`。

- [ ] **Step 5: 测试、真机、提交**

Run: `npx vitest run && npm run typecheck`
Expected: 全绿。

真机：`/assistant` 首次进入自动建一个对话；点"今天做什么"→ 出现"✓ 已使用 skill：daily-kickoff"、"✓ 账号与任务概况：…"等工具行，点开能看原文；回复里的 `/projects/…` 可点；窄屏对话列表为下拉框，无横向溢出；项目页编导对话框外观与行为不变。

```bash
git add src/components src/app tests/components
git commit -m "feat(assistant): 助手页面(对话列表/快捷按钮/工具行展开/链接) + ChatPanel 可配置复用

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 文档与真机验收

**Files:**
- Modify: `README.md`、`docs/superpowers/specs/2026-09-29-assistant-design.md`（追加实测）

- [ ] **Step 1: README**

「现在能做什么」追加：

```markdown
- **助手**：侧栏「助手」是跨项目的总助手（用设置页的当前模型）：问状态和数据、一句话开工（找选题→建项目→编导写首版）、讨论怎么调整。它能用 `mp` 命令行的全部能力（出片与安装 Hermes 除外），做事不先问你（每日额度、只读抖音等护栏照旧）。内置 3 个 skill：每日开工、从对标到首版稿、数据诊断（`assistant/skills/`）。
```

目录一节加 `src/lib/assistant/  总助手：命令→工具、skill、系统提示、对话范围` 与 `assistant/skills/  内置 skill`。

- [ ] **Step 2: 真机验收**

1. "今天做什么"：按 daily-kickoff 调 status、topics_hits、publish_candidates、lessons_list，给 ≤3 条建议。
2. "找个选题开工"：数据不足如实说明；若数据够则建项目并写首版，回复带 `/projects/<id>`，点进去看到稿子（测试项目用完问用户是否删除）。
3. "最近数据怎么样"：没有已发布复盘时说数据不足，不编原因。
4. 当前模型为能当编导的 DeepSeek；若用户有只能聊天的模型，切过去验证降级提示（没有则说明未验证）。

实测写入 spec 末尾。

- [ ] **Step 3: 收尾**

```bash
npm test && npm run typecheck && (cd remotion && npx tsc --noEmit)
git add README.md docs/superpowers/specs/2026-09-29-assistant-design.md
git commit -m "docs: README 补总助手, spec 记录真机实测

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
