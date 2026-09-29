import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { execute, parseArgv, needArg, CliError, agentFromEnv, type Command } from '@/lib/cli/registry';
import { EgoUnavailableError } from '@/lib/ego';

const db = {} as PrismaClient;
const cmds: Command[] = [
  { path: ['status'], tier: 'read', hermes: true, usage: 'mp status', summary: '概况', run: async () => ({ fans: 408 }), format: (d) => `粉丝 ${(d as { fans: number }).fans}` },
  { path: ['film', 'check'], tier: 'heavy', hermes: false, usage: 'mp film check <目录>', summary: '检查', run: async (ctx) => { ctx.progress('tsc 输出一大堆'); return { ok: 1 }; } },
  { path: ['chat'], tier: 'write', hermes: false, usage: 'mp chat <项目> <消息>', summary: '对话', run: async (_c, p) => ({ msg: needArg(p, 1, '消息') }) },
  { path: ['boom'], tier: 'read', hermes: true, usage: 'mp boom', summary: 'x', run: async () => { throw new Prisma.PrismaClientInitializationError("Can't reach database server", '5.22.0'); } },
  { path: ['ego'], tier: 'read', hermes: true, usage: 'mp ego', summary: 'x', run: async () => { throw new EgoUnavailableError('ego lite 没有响应'); } },
];
const run = (argv: string[], agent: 'hermes' | 'claude-code' = 'claude-code') => execute(cmds, argv, { agent }, { db });

describe('parseArgv', () => {
  it('reads flags and positionals', () => {
    expect(parseArgv(['p1', '--days', '7', '--json'])).toEqual({ positionals: ['p1'], flags: { days: '7', json: true } });
  });
  it('treats everything after -- as positionals', () => {
    expect(parseArgv(['p1', '--', '--别这样写', '好吗']).positionals).toEqual(['p1', '--别这样写', '好吗']);
  });
});

describe('execute', () => {
  it('formats in Chinese by default and JSON with --json', async () => {
    expect(await run(['status'])).toMatchObject({ exitCode: 0, stdout: '粉丝 408\n' });
    expect(JSON.parse((await run(['status', '--json'])).stdout)).toEqual({ ok: true, data: { fans: 408 } });
  });
  it('keeps stdout to one JSON line (progress goes to stderr)', async () => {
    const r = await run(['film', 'check', 'x', '--json']);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('tsc 输出一大堆');
  });
  it('forbids hermes from non-allowed commands with exit code 2', async () => {
    const r = await run(['film', 'check', 'x', '--json'], 'hermes');
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, error: { code: 'forbidden', message: 'Hermes 不能做「检查」，这个要回电脑上做。' } });
  });
  it('reports bad args with usage', async () => {
    const r = await run(['chat', 'p1']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('缺少参数：消息');
    expect(r.stderr).toContain('用法：mp chat <项目> <消息>');
  });
  it('maps a Prisma init error to db_down', async () => {
    const r = await run(['boom', '--json']);
    expect(JSON.parse(r.stdout).error).toEqual({ code: 'db_down', message: '连不上数据库：打开 Docker Desktop，然后在项目目录运行 docker compose up -d。' });
  });
  it('maps ego errors', async () => {
    expect(JSON.parse((await run(['ego', '--json'])).stdout).error.code).toBe('ego_unavailable');
  });
  it('help lists only allowed commands for hermes', async () => {
    const h = (await run(['help'], 'hermes')).stdout;
    expect(h).toContain('mp status');
    expect(h).not.toContain('mp film check');
    expect((await run(['help'])).stdout).toContain('mp film check');
  });
  it('unknown command is bad_args', async () => {
    expect((await run(['nope'])).exitCode).toBe(1);
  });
});

describe('agentFromEnv', () => {
  it('defaults to claude-code', () => {
    expect(agentFromEnv({})).toBe('claude-code');
    expect(agentFromEnv({ MP_AGENT: 'hermes' })).toBe('hermes');
  });
  it('CliError carries exit code', () => {
    expect(new CliError('forbidden', 'x', 2).exitCode).toBe(2);
  });
});
