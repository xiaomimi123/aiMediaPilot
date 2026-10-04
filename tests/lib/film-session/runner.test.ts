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
        const r = { createdAt: new Date(), updatedAt: new Date(), orientation: 'portrait', checkpoint: null, message: null, filmDir: null, version: null, summary: null, pid: null, turnStartedAt: null, ...data, id: `fs${++seq}` } as Row;
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
  it('lets only one of two simultaneous replies start a turn', async () => {
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await settle(db, deps, s.id);
    process.env.FAKE_SCENARIO = 'slow';
    const r = await Promise.allSettled([replyFilm(db, deps, s.id, '可以，继续', 'opus'), replyFilm(db, deps, s.id, '可以，继续', 'opus')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await deps.readLines(s.logPath)).filter((l) => l.includes('mp_turn'))).toHaveLength(2);
    await stopFilm(db, deps, s.id);
  });
  it('lets only one of two simultaneous starts run', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const { db } = fakeDb();
    const deps = realDeps();
    const r = await Promise.allSettled([startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' }), startFilm(db, deps, { projectId: 'p2', kind: 'new', model: 'opus' })]);
    const won = r.filter((x): x is PromiseFulfilledResult<Awaited<ReturnType<typeof startFilm>>> => x.status === 'fulfilled');
    expect(won).toHaveLength(1);
    await stopFilm(db, deps, won[0].value.id);
  });
  it('does not let a finished-but-unrefreshed session block other projects', async () => {
    const { db } = fakeDb();
    const deps = realDeps({ spawn: (bin, args, log) => createRunnerDeps().spawn.call(realDeps(), bin, args, log, () => {}) });
    const s1 = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    // 等 p1 的假 claude 跑完(日志出现结果), 但不刷新它 —— 模拟服务重启后没人看过 p1
    for (let i = 0; i < 100 && !(await deps.readLines(s1.logPath)).some((l) => l.includes('"type":"result"')); i++) await new Promise((x) => setTimeout(x, 50));
    process.env.FAKE_SCENARIO = 'slow';
    const s2 = await startFilm(db, deps, { projectId: 'p2', kind: 'new', model: 'opus' });
    expect(s2.status).toBe('running');
    await stopFilm(db, deps, s2.id);
  });
  it('treats a turn with a result event as finished even if the pid looks alive', async () => {
    const { db } = fakeDb();
    const deps = realDeps({ isAlive: () => true });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    expect((await settle(db, deps, s.id)).session.status).toBe('waiting');
  });
  it('stopping does not also report an unexpected exit', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const { db, chat } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await stopFilm(db, deps, s.id);
    await new Promise((x) => setTimeout(x, 300));
    expect((await refreshFilm(db, deps, s.id)).session.status).toBe('stopped');
    expect(chat).toEqual([]);
  });
  it('refuses to resume while the stopped process is still alive', async () => {
    process.env.FAKE_SCENARIO = 'slow';
    const { db } = fakeDb();
    const deps = realDeps({ killGroup: () => {} });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    const stopped = await stopFilm(db, deps, s.id);
    await expect(replyFilm(db, deps, s.id, '接着做', 'opus')).rejects.toThrow('上一轮还没完全停下');
    createRunnerDeps().killGroup(stopped.pid!);
  });
  it('turns a claude that cannot be started into a failed turn', async () => {
    const { db } = fakeDb();
    const broken = path.join(dir, 'not-executable');
    fs.writeFileSync(broken, 'x');
    const deps = realDeps({ claudeBin: broken });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    const r = await settle(db, deps, s.id);
    expect(r.session.status).toBe('failed');
    expect(r.session.message).toContain('启动 claude 失败');
  });
  it('trusts a just-started pid before its command line switches to claude', () => {
    const deps = createRunnerDeps();
    // 本测试进程的命令行里没有 stream-json: 刚启动时只看进程在不在, 久了才核对命令行
    expect(deps.isAlive(process.pid, new Date())).toBe(true);
    expect(deps.isAlive(process.pid, new Date(Date.now() - 10 * 60_000))).toBe(false);
  });
  it('lets a reply through right after the result while the old process is still exiting', async () => {
    const { db } = fakeDb();
    let alive = true;
    const killed: number[] = [];
    const deps = realDeps({ isAlive: (pid) => (pid === 4242 ? alive : createRunnerDeps().isAlive(pid)), killGroup: (pid) => void killed.push(pid) });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus' });
    await settle(db, deps, s.id);
    await db.filmSession.update({ where: { id: s.id }, data: { pid: 4242 } });
    setTimeout(() => (alive = false), 300);
    expect((await replyFilm(db, deps, s.id, '可以，继续', 'opus')).status).toBe('running');
    expect(killed).toEqual([]);
    await settle(db, deps, s.id);
  });
  it('starts a landscape film and records the orientation', async () => {
    const { db } = fakeDb();
    const deps = realDeps();
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'new', model: 'opus', orientation: 'landscape' });
    expect(s.orientation).toBe('landscape');
    expect((await deps.readLines(s.logPath))[0]).toContain('横版成片');
    await settle(db, deps, s.id);
  });
  it('revise follows the base version orientation', async () => {
    const { db } = fakeDb();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cwd-'));
    fs.mkdirSync(path.join(cwd, 'remotion/films/p1-v4'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'remotion/films/p1-v4/data.json'), JSON.stringify({ orientation: 'landscape' }));
    const deps = realDeps({ cwd });
    const s = await startFilm(db, deps, { projectId: 'p1', kind: 'revise', baseVersion: 4, note: 'x', model: 'opus', orientation: 'portrait' });
    expect(s.orientation).toBe('landscape');
    expect((await deps.readLines(s.logPath))[0]).toContain('横版');
    await settle(db, deps, s.id);
  });
});
