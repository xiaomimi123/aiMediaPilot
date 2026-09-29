import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runChat } from '@/lib/cli/commands/chat';
import type { CommandCtx } from '@/lib/cli/registry';

let noModel = false;
vi.mock('@/lib/llm/provider', async (orig) => ({
  ...(await orig<object>()),
  getActiveModel: vi.fn(async () => (noModel ? null : { chat: { label: 'X', streamTurn: vi.fn() }, llm: {}, label: 'X', config: {} })),
}));

function ctx(): CommandCtx & { out: string; err: string } {
  const c = { out: '', err: '' } as CommandCtx & { out: string; err: string };
  Object.assign(c, {
    db: { project: { findUnique: async () => ({ id: 'p1' }) } } as unknown as PrismaClient,
    agent: 'claude-code',
    now: new Date(),
    write: (s: string) => void (c.out += s),
    progress: (s: string) => void (c.err += `${s}\n`),
  });
  return c;
}

describe('runChat', () => {
  it('streams the reply and reports tool results', async () => {
    noModel = false;
    const turn = vi.fn(async (o: { emit: (e: unknown) => void }) => {
      o.emit({ type: 'tool', name: 'write_script', ok: true, summary: '写稿：6 段，约 58 秒', segmentIds: [] });
      o.emit({ type: 'text', delta: '写好了，' });
      o.emit({ type: 'text', delta: '开头借了钩子写法。' });
      o.emit({ type: 'done' });
    });
    const c = ctx();
    const r = await runChat(c, 'p1', '按这个选题写一版', { turn: turn as never });
    expect(r).toEqual({ reply: '写好了，开头借了钩子写法。', tools: [{ name: 'write_script', ok: true, summary: '写稿：6 段，约 58 秒' }] });
    expect(c.out).toBe('写好了，开头借了钩子写法。');
    expect(c.err).toContain('✓ 写稿：6 段，约 58 秒');
  });
  it('fails when the agent reports an error', async () => {
    noModel = false;
    const turn = vi.fn(async (o: { emit: (e: unknown) => void }) => o.emit({ type: 'error', message: '连不上 DeepSeek' }));
    await expect(runChat(ctx(), 'p1', 'x', { turn: turn as never })).rejects.toThrow('连不上 DeepSeek');
  });
  it('needs an active model', async () => {
    noModel = true;
    await expect(runChat(ctx(), 'p1', 'x')).rejects.toMatchObject({ code: 'no_model' });
  });
});
