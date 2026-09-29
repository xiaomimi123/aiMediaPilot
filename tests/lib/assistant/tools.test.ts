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
