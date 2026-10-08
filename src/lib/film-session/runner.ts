import { execFileSync, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FilmSession, PrismaClient } from '@prisma/client';
import { buildClaudeArgs, childEnv, firstMessage, resolveClaudeBin, restartMessage } from './args';
import { parseLog, type ParsedLog } from './parse';
import type { FilmOrientation } from '@/lib/film/orientation';
import { deriveState } from './state';
import { registerFilm } from '@/lib/film/register';

export class FilmBusy extends Error {}
const NO_CLAUDE = '本机没有可用的 Claude Code：安装后在终端运行 claude 登录，再回来点出片';
const OPEN = ['running', 'waiting', 'failed', 'stopped'];
const RESUMABLE = ['waiting', 'failed', 'stopped'];
/** 刚占位、子进程还没写入 pid 的这几秒内不判死 */
const START_GRACE_MS = 15_000;

export interface RunnerDeps {
  claudeBin: string | null;
  cwd: string;
  logDir: string;
  spawn(bin: string, args: string[], logPath: string, onExit: () => void): number;
  /** since: 本轮开始时间; 刚开始的一分钟内只看进程在不在(子进程 exec 之前命令行还是父进程的) */
  isAlive(pid: number, since?: Date | null): boolean;
  killGroup(pid: number): void;
  readLines(p: string): Promise<string[]>;
  /** 日志最后写入时间(判断是否卡住); 文件不在 = null */
  lastWrite(p: string): Date | null;
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
      // 启动不了(没有执行权限、坏链接): 写一条错误结果, 不让网页服务因未处理的 error 事件崩掉
      child.on('error', (e) => {
        fs.appendFileSync(logPath, JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: `启动 claude 失败：${e.message}` }) + '\n');
        onExit();
      });
      child.unref();
      fs.closeSync(out);
      fs.closeSync(err);
      return child.pid ?? 0;
    },
    /** pid 可能被系统复用(隔了很久才查): 久了还要确认它确实是我们启动的 claude(参数里带 stream-json) */
    isAlive(pid, since) {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      if (since && Date.now() - since.getTime() < 60_000) return true;
      try {
        return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).includes('stream-json');
      } catch {
        return false;
      }
    },
    /** 先 SIGTERM, 3 秒后还在就 SIGKILL 整个进程组 */
    killGroup(pid) {
      const sig = (s: NodeJS.Signals) => {
        try {
          process.kill(-pid, s);
        } catch {
          // 已经不在了
        }
      };
      sig('SIGTERM');
      setTimeout(() => sig('SIGKILL'), 3000).unref();
    },
    lastWrite(p) {
      try {
        return fs.statSync(p).mtime;
      } catch {
        return null;
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

/** 别的项目正在跑的出片; 先按日志和进程刷新一次, 服务重启后已结束的不会一直挡着 */
export async function runningElsewhere(db: PrismaClient, deps: RunnerDeps, projectId: string, exceptId?: string) {
  const found = await db.filmSession.findFirst({ where: { status: 'running', projectId: { not: projectId } } });
  if (!found) return null;
  const s = (await refreshFilm(db, deps, found.id)).session;
  if (s.status !== 'running' || s.id === exceptId) return null;
  const p = await db.project.findUnique({ where: { id: s.projectId } });
  return { sessionId: s.id, projectId: s.projectId, title: p?.title ?? s.projectId };
}

/** 调用前会话已被占为 running(pid 为空): 写本轮分隔行, 启动子进程, 再写 pid */
async function launch(db: PrismaClient, deps: RunnerDeps, s: FilmSession, message: string, resume: boolean, model: string) {
  await deps.append(s.logPath, JSON.stringify({ type: 'mp_turn', n: Date.now(), message, at: deps.now().toISOString() }));
  const pid = deps.spawn(deps.claudeBin!, buildClaudeArgs({ message, sessionId: s.claudeSessionId, resume, model, root: deps.cwd }), s.logPath, () => {
    void refreshFilm(db, deps, s.id).catch(() => {});
  });
  // 只在仍是本轮占位时写 pid: 进程秒退已被判定时不把状态改回 running
  await db.filmSession.updateMany({ where: { id: s.id, status: 'running', pid: null }, data: { pid } });
  return (await db.filmSession.findUnique({ where: { id: s.id } }))!;
}

/** 占位之后再查一次: 同时有别的会话也占了 running(并发开始/回复), 先占的赢(占位时间早, 同时则 id 小) */
async function lostRace(db: PrismaClient, s: FilmSession) {
  const mine = (await db.filmSession.findUnique({ where: { id: s.id } }))!;
  const other = await db.filmSession.findFirst({ where: { status: 'running', id: { not: s.id } } });
  if (!other) return null;
  const a = other.turnStartedAt?.getTime() ?? 0;
  const b = mine.turnStartedAt?.getTime() ?? 0;
  if (a > b || (a === b && other.id > mine.id)) return null;
  const p = await db.project.findUnique({ where: { id: other.projectId } });
  return p?.title ?? other.projectId;
}

export async function startFilm(db: PrismaClient, deps: RunnerDeps, i: { projectId: string; kind: 'new' | 'revise'; baseVersion?: number; note?: string; model: string; orientation?: FilmOrientation }): Promise<FilmSession> {
  if (!deps.claudeBin) throw new FilmBusy(NO_CLAUDE);
  const other = await runningElsewhere(db, deps, i.projectId);
  if (other) throw new FilmBusy(`「${other.title}」正在出片，等它做完再开始`);
  if (await currentFilm(db, i.projectId)) throw new FilmBusy('这个项目还有一次出片没结束：先接着做或放弃');
  const p = await db.project.findUnique({ where: { id: i.projectId } });
  if (!p) throw new Error('项目不存在或已删除');
  const baseFilmDir = i.kind === 'revise' && i.baseVersion ? `remotion/films/${p.id}-v${i.baseVersion}` : null;
  // 改片沿用基础版本的版式(读它的 data.json, 没写 = 竖版); 新出按选择
  let orientation: FilmOrientation = i.orientation === 'landscape' ? 'landscape' : 'portrait';
  if (baseFilmDir) {
    const raw = (await deps.readLines(path.join(deps.cwd, baseFilmDir, 'data.json'))).join('\n');
    try {
      orientation = (JSON.parse(raw) as { orientation?: unknown }).orientation === 'landscape' ? 'landscape' : 'portrait';
    } catch {
      orientation = 'portrait';
    }
  }
  const id = deps.uuid();
  const s = await db.filmSession.create({
    data: { projectId: p.id, kind: i.kind, baseFilmDir, orientation, claudeSessionId: id, status: 'running', turnStartedAt: deps.now(), logPath: path.join(deps.logDir, `${id}.jsonl`) },
  });
  const lost = await lostRace(db, s);
  if (lost) {
    await db.filmSession.update({ where: { id: s.id }, data: { status: 'abandoned', message: '同时开始了两次，这次已取消' } });
    throw new FilmBusy(`「${lost}」正在出片，等它做完再开始`);
  }
  return launch(db, deps, s, firstMessage({ kind: i.kind, projectId: p.id, title: p.title, baseFilmDir: baseFilmDir ?? undefined, baseVersion: i.baseVersion, note: i.note, orientation }), false, i.model);
}

/** 上一轮进程还在: 已写出结果(只是在收尾)就等它最多 5 秒, 还不退就结束它; 没有结果(停止中)的不许续 */
async function waitOldTurnExit(deps: RunnerDeps, s: FilmSession, parsed: ParsedLog) {
  if (!s.pid || !deps.isAlive(s.pid, s.turnStartedAt)) return;
  if (!parsed.last.ended) throw new FilmBusy('上一轮还没完全停下，等几秒再试');
  for (let i = 0; i < 25 && deps.isAlive(s.pid, s.turnStartedAt); i++) await new Promise((r) => setTimeout(r, 200));
  if (deps.isAlive(s.pid, s.turnStartedAt)) deps.killGroup(s.pid);
}

export async function replyFilm(db: PrismaClient, deps: RunnerDeps, id: string, text: string, model: string): Promise<FilmSession> {
  if (!deps.claudeBin) throw new FilmBusy(NO_CLAUDE);
  const { session: s, parsed } = await refreshFilm(db, deps, id);
  if (s.status === 'running') throw new FilmBusy('还在做，等这一步停下来再回复');
  if (!OPEN.includes(s.status)) throw new FilmBusy('这次出片已经结束');
  if (!text.trim()) throw new FilmBusy('回复是空的');
  await waitOldTurnExit(deps, s, parsed);
  const other = await runningElsewhere(db, deps, s.projectId);
  if (other) throw new FilmBusy(`「${other.title}」正在出片，等它做完再继续`);
  // 条件更新占位: 两次同时回复只有一次能占到
  const claimed = await db.filmSession.updateMany({ where: { id, status: { in: RESUMABLE } }, data: { status: 'running', checkpoint: null, message: null, pid: null, turnStartedAt: deps.now() } });
  if (!claimed.count) throw new FilmBusy('还在做，等这一步停下来再回复');
  const lost = await lostRace(db, s);
  if (lost) {
    await db.filmSession.update({ where: { id }, data: { status: s.status, checkpoint: s.checkpoint, message: s.message, pid: s.pid, turnStartedAt: s.turnStartedAt } });
    throw new FilmBusy(`「${lost}」正在出片，等它做完再继续`);
  }
  return launch(db, deps, (await db.filmSession.findUnique({ where: { id } }))!, text.trim(), true, model);
}

/** 换个新对话接着做: 旧对话太长(模型服务拒收)时, 用新的 Claude 会话继续同一个片子目录 */
export async function restartFilm(db: PrismaClient, deps: RunnerDeps, id: string, model: string): Promise<FilmSession> {
  if (!deps.claudeBin) throw new FilmBusy(NO_CLAUDE);
  const { session: s, parsed } = await refreshFilm(db, deps, id);
  if (s.status !== 'failed' && s.status !== 'stopped') throw new FilmBusy('只有停了的出片才能换新对话接着做');
  if (!s.filmDir) throw new FilmBusy('这次出片还没有片子目录，直接「接着做」');
  await waitOldTurnExit(deps, s, parsed);
  const other = await runningElsewhere(db, deps, s.projectId);
  if (other) throw new FilmBusy(`「${other.title}」正在出片，等它做完再继续`);
  const claimed = await db.filmSession.updateMany({
    where: { id, status: { in: ['failed', 'stopped'] } },
    data: { status: 'running', checkpoint: null, message: null, pid: null, turnStartedAt: deps.now(), claudeSessionId: deps.uuid() },
  });
  if (!claimed.count) throw new FilmBusy('还在做，等这一步停下来再说');
  const fresh = (await db.filmSession.findUnique({ where: { id } }))!;
  const p = await db.project.findUnique({ where: { id: s.projectId } });
  const orientation: FilmOrientation = s.orientation === 'landscape' ? 'landscape' : 'portrait';
  return launch(db, deps, fresh, restartMessage({ projectId: s.projectId, title: p?.title ?? s.projectId, filmDir: s.filmDir, orientation }), false, model);
}

/**
 * 渲染完那段话 → 登记摘要: 有「这一版做了什么」就只取它之后的内容; 去掉"渲染完成/还没登记"这类状态行、
 * 文件路径、markdown 记号和末尾的"要登记吗"提问, 压成一段, 最长 300 字
 */
export function summaryFromMessage(message: string | null): string {
  let lines = (message ?? '').split('\n');
  const head = lines.findIndex((l) => /这一版做了什么/.test(l));
  if (head >= 0) lines = lines.slice(head + 1);
  const text = lines
    .filter((l) => !/要登记为新版本吗|可以就回复|可以，登记|渲染完成|还没登记/.test(l))
    .join(' ')
    .replace(/`[^`]*remotion\/films[^`]*`/g, '')
    .replace(/\*\*|`|^#+\s*/g, '')
    .replace(/\s*-\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || '网页里出片登记').slice(0, 300);
}

/**
 * 登记: 网页服务直接执行(不再开一轮 Claude) —— 那一轮只是跑一条命令, 却要把整段长对话重发一遍,
 * 实测每次 1–2 分钟、$1–4。摘要取它渲染完时「这一版做了什么」那段。
 */
export async function registerFilmSession(
  db: PrismaClient,
  deps: RunnerDeps,
  id: string,
  register: (filmDirAbs: string, summary: string) => Promise<{ version: number }> = (dir, summary) => registerFilm(db, dir, summary),
): Promise<FilmSession> {
  const { session: s, parsed } = await refreshFilm(db, deps, id);
  if (s.status !== 'waiting' || s.checkpoint !== 'render' || !s.filmDir) throw new FilmBusy('只有渲染好、等你确认的成片才能登记');
  await waitOldTurnExit(deps, s, parsed);
  const summary = summaryFromMessage(s.message);
  const { version } = await register(path.join(deps.cwd, s.filmDir), summary);
  await deps.append(s.logPath, JSON.stringify({ type: 'mp_turn', n: Date.now(), message: '登记为新版本', at: deps.now().toISOString() }));
  await deps.append(s.logPath, JSON.stringify({ type: 'mp_note', text: `登记 v${version}` }));
  return db.filmSession.update({ where: { id }, data: { status: 'done', checkpoint: null, version, summary } });
}

export async function stopFilm(db: PrismaClient, deps: RunnerDeps, id: string): Promise<FilmSession> {
  const s = await db.filmSession.findUnique({ where: { id } });
  if (!s) throw new Error('找不到这次出片');
  // 先改状态再结束进程: 进程退出时的刷新看到已不是 running, 不会再报"意外退出"
  const claimed = await db.filmSession.updateMany({ where: { id, status: 'running' }, data: { status: 'stopped', message: '已停止' } });
  if (claimed.count && s.pid && deps.isAlive(s.pid, s.turnStartedAt)) deps.killGroup(s.pid);
  return (await db.filmSession.findUnique({ where: { id } }))!;
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
  // 刚占位还没 pid 的几秒算在跑(此时日志里最后一轮还是上一轮, 不能按它判); 本轮已有结果事件就算结束(不看 pid)
  const starting = s.pid === null && !!s.turnStartedAt && deps.now().getTime() - s.turnStartedAt.getTime() < START_GRACE_MS;
  const alive = starting || (!!s.pid && !parsed.last.ended && deps.isAlive(s.pid, s.turnStartedAt));
  const st = deriveState({ last: parsed.last, alive, turnStartedAt: s.turnStartedAt, lastActivity: deps.lastWrite(s.logPath), now: deps.now() });
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
