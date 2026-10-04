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
