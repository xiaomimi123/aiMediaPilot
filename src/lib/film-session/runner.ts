import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FilmSession, PrismaClient } from '@prisma/client';
import { buildClaudeArgs, childEnv, firstMessage, resolveClaudeBin } from './args';
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
      const child = nodeSpawn(bin, args, { cwd: this.cwd, detached: true, stdio: ['ignore', out, err], env: childEnv(process.env) as NodeJS.ProcessEnv });
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
