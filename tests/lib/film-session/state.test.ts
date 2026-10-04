import { describe, expect, it } from 'vitest';
import { deriveState, TURN_TIMEOUT_MS } from '@/lib/film-session/state';

const last = (over = {}) => ({ ended: true, isError: false, errorText: null, lastText: '要登记吗？', wroteShots: false, renderedFinal: false, registeredVersion: null, registeredSummary: null, ...over });
const now = new Date('2026-10-03T10:00:00Z');

describe('deriveState', () => {
  it('keeps running while the process lives', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: now, now })).toMatchObject({ status: 'running', timedOut: false });
  });
  it('times out after 30 minutes', () => {
    expect(deriveState({ last: last({ ended: false }), alive: true, turnStartedAt: new Date(now.getTime() - TURN_TIMEOUT_MS - 1), now })).toMatchObject({ status: 'failed', message: '这一轮超过 30 分钟，已停止', timedOut: true });
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
