import { describe, expect, it } from 'vitest';
import { commandToTool, buildAssistantTools, ASSISTANT_EXCLUDED } from '@/lib/assistant/tools';
import { CliError, needArg, type Command } from '@/lib/cli/registry';
import { ALL_COMMANDS } from '@/lib/cli';

const ctx = { projectId: '', db: {} as never, llm: {} as never };
const cmd = (over: Partial<Command>): Command => ({
  path: ['topics', 'hits'],
  tier: 'read',
  hermes: true,
  usage: 'mp topics hits [--days 14]',
  summary: '近期对标爆款',
  run: async (_c, p) => ({ days: p.flags.days ?? 14 }),
  format: (d) => `近 ${(d as { days: unknown }).days} 天`,
  ...over,
});

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
  it('accepts numeric flag values', async () => {
    const t = commandToTool(cmd({}));
    const parsed = t.input.safeParse({ flags: { days: 1 } });
    expect(parsed.success).toBe(true);
    const r = await t.execute(ctx, parsed.success ? parsed.data : {});
    expect(r.data).toMatchObject({ json: { days: '1' } });
  });
  it('uses the reply when the command prints nothing (mp chat streams it)', async () => {
    const r = await commandToTool(cmd({ run: async () => ({ reply: '稿子写好了\n第二行', tools: [] }), format: () => '' })).execute(ctx, {});
    expect(r).toMatchObject({ ok: true, summary: '近期对标爆款：稿子写好了', data: { text: '稿子写好了\n第二行' } });
  });
  it('does not dump JSON when an empty-format command has an empty reply', async () => {
    const r = await commandToTool(cmd({ run: async () => ({ reply: '', tools: ['write_script'] }), format: () => '' })).execute(ctx, {});
    expect(r).toMatchObject({ ok: true, summary: '近期对标爆款：完成', data: { text: '' } });
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
  it('never exposes heavy-tier or agents commands, even new ones', () => {
    const extra = [cmd({ path: ['film', 'preview'], tier: 'heavy' }), cmd({ path: ['agents', 'install-foo'], tier: 'write' })];
    const names = buildAssistantTools([...ALL_COMMANDS, ...extra], '/nonexistent').map((t) => t.name);
    expect(names).not.toContain('film_preview');
    expect(names).not.toContain('agents_install-foo');
    for (const c of ALL_COMMANDS.filter((c) => c.tier === 'heavy')) expect(names).not.toContain(c.path.join('_'));
  });
});
