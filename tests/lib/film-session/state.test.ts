import { describe, expect, it } from 'vitest';
import { deriveState, IDLE_TIMEOUT_MS, TURN_MAX_MS } from '@/lib/film-session/state';

const last = (over = {}) => ({ ended: true, isError: false, errorText: null, lastText: '要登记吗？', wroteShots: false, renderedFinal: false, registeredVersion: null, registeredSummary: null, ...over });
const now = new Date('2026-10-03T10:00:00Z');

describe('deriveState', () => {
  it('keeps running while the process lives', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: now, now })).toMatchObject({ status: 'running', timedOut: false });
  });
  it('keeps a long turn running while the log keeps moving', () => {
    const started = new Date(now.getTime() - 40 * 60_000);
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: started, lastActivity: new Date(now.getTime() - 60_000), now })).toMatchObject({ status: 'running', timedOut: false });
  });
  it('stops a turn that made no progress for 10 minutes', () => {
    const quiet = new Date(now.getTime() - IDLE_TIMEOUT_MS - 1);
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: quiet, lastActivity: quiet, now })).toMatchObject({ status: 'failed', message: '已经 10 分钟没有新进展，判定卡住，已停止', timedOut: true });
  });
  it('caps a single turn at 2 hours even if it keeps moving', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: new Date(now.getTime() - TURN_MAX_MS - 1), lastActivity: now, now })).toMatchObject({ status: 'failed', message: '这一轮超过 2 小时，已停止', timedOut: true });
  });
  it('maps the turn outcome to a status and checkpoint', () => {
    const d = (o: object) => deriveState({ last: last(o), alive: false, turnStartedAt: now, now });
    expect(d({ registeredVersion: 3 })).toMatchObject({ status: 'done', version: 3 });
    expect(d({ renderedFinal: true })).toMatchObject({ status: 'waiting', checkpoint: 'render' });
    expect(d({ wroteShots: true })).toMatchObject({ status: 'waiting', checkpoint: 'shots' });
    expect(d({})).toMatchObject({ status: 'waiting', checkpoint: 'question', message: '要登记吗？' });
    expect(d({ isError: true, errorText: 'usage limit reached' })).toMatchObject({ status: 'failed', message: 'usage limit reached' });
    expect(d({ ended: false })).toMatchObject({ status: 'failed', message: '出片进程意外退出' });
  });
});
