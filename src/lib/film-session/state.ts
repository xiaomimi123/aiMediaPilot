import type { TurnResult } from './parse';

export type FilmStatus = 'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'abandoned';
export type Checkpoint = 'shots' | 'render' | 'question';
/** 日志 10 分钟没有任何新内容 = 卡住(如机器休眠); 一直在动的轮次最长 2 小时 */
export const IDLE_TIMEOUT_MS = 10 * 60_000;
export const TURN_MAX_MS = 2 * 60 * 60_000;

export function deriveState(i: { last: TurnResult; alive: boolean; turnStartedAt: Date | null; lastActivity?: Date | null; now: Date }) {
  const base = { checkpoint: null as Checkpoint | null, message: null as string | null, version: null as number | null, timedOut: false };
  if (i.alive) {
    const t = i.now.getTime();
    if (i.turnStartedAt && t - i.turnStartedAt.getTime() > TURN_MAX_MS) return { ...base, status: 'failed' as const, message: '这一轮超过 2 小时，已停止', timedOut: true };
    const active = Math.max(i.turnStartedAt?.getTime() ?? t, i.lastActivity?.getTime() ?? 0);
    if (t - active > IDLE_TIMEOUT_MS) return { ...base, status: 'failed' as const, message: '已经 10 分钟没有新进展，判定卡住，已停止', timedOut: true };
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
