import { describe, expect, it } from 'vitest';
import { parseLog } from '@/lib/film-session/parse';

const j = (o: unknown) => JSON.stringify(o);
const use = (id: string, name: string, input: unknown) => j({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const res = (id: string, content: string, is_error = false) => j({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const say = (text: string) => j({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const turn = (n: number, message: string) => j({ type: 'mp_turn', n, message, at: '2026-10-03T00:00:00.000Z' });
const done = (is_error = false, result = '') => j({ type: 'result', subtype: is_error ? 'error_during_execution' : 'success', is_error, result });

describe('parseLog', () => {
  it('turns tool calls into readable steps and finds the film dir', () => {
    const p = parseLog([
      turn(1, '给项目 p1（U盘）出一版成片。'),
      use('a', 'Bash', { command: 'npm run -s mp -- project export p1' }),
      res('a', '{...}'),
      use('b', 'Bash', { command: 'npm run -s mp -- film new p1' }),
      res('b', '/Users/me/repo/remotion/films/p1-v3'),
      use('c', 'Write', { file_path: '/Users/me/repo/remotion/films/p1-v3/shots.json', content: '{}' }),
      res('c', 'ok'),
      say('镜头表可以吗？可以就回复继续'),
      done(),
    ]);
    expect(p.items).toEqual([
      { kind: 'you', text: '给项目 p1（U盘）出一版成片。' },
      { kind: 'step', text: '读稿子和素材', ok: true },
      { kind: 'step', text: '建片子目录 v3', ok: true },
      { kind: 'step', text: '排镜头表', ok: true },
      { kind: 'say', text: '镜头表可以吗？可以就回复继续' },
    ]);
    expect(p.filmDir).toBe('remotion/films/p1-v3');
    expect(p.last).toMatchObject({ ended: true, isError: false, wroteShots: true, renderedFinal: false, registeredVersion: null, lastText: '镜头表可以吗？可以就回复继续' });
  });
  it('judges only the last turn', () => {
    const p = parseLog([
      turn(1, 'go'),
      use('c', 'Write', { file_path: 'remotion/films/p1-v3/shots.json', content: '{}' }),
      res('c', 'ok'),
      done(),
      turn(2, '可以，继续'),
      use('d', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3 --stills' }),
      res('d', '渲染完成'),
      use('e', 'Read', { file_path: '/Users/me/repo/remotion/films/p1-v3/stills/1.2.png' }),
      res('e', '[image]'),
      use('f', 'Bash', { command: 'npm run -s mp -- film render remotion/films/p1-v3' }),
      res('f', '渲染完成'),
      say('要登记为新版本吗？'),
      done(),
    ]);
    expect(p.turns).toBe(2);
    expect(p.last).toMatchObject({ wroteShots: false, renderedFinal: true, registeredVersion: null });
    expect(p.items).toContainEqual({ kind: 'still', path: 'stills/1.2.png' });
    expect(p.items).toContainEqual({ kind: 'step', text: '渲染关键帧', ok: true });
    expect(p.items).toContainEqual({ kind: 'step', text: '渲染成片（约 2 分钟）', ok: true });
  });
  it('reads the registered version and denied tools', () => {
    const p = parseLog([
      turn(1, '可以，登记'),
      use('g', 'Bash', { command: 'git status' }),
      res('g', "Claude requested permissions to use Bash, but you haven't granted it yet.", true),
      use('h', 'Bash', { command: 'npm run -s mp -- film register remotion/films/p1-v3 --summary "x"' }),
      res('h', '已登记成片 v3'),
      done(),
    ]);
    expect(p.items).toContainEqual({ kind: 'denied', text: 'Bash：git status' });
    expect(p.last.registeredVersion).toBe(3);
    expect(p.last.registeredSummary).toBe('x');
  });
  it('reports a failed check and a failed result', () => {
    const p = parseLog([turn(1, 'go'), use('i', 'Bash', { command: 'npm run -s mp -- film check remotion/films/p1-v3' }), res('i', '✗ a\n✗ b', true), done(true, 'usage limit reached')]);
    expect(p.items).toContainEqual({ kind: 'step', text: '检查：有 2 处问题', ok: false });
    expect(p.last).toMatchObject({ ended: true, isError: true, errorText: 'usage limit reached' });
  });
  it('skips partial and non-json lines', () => {
    const p = parseLog([turn(1, 'go'), 'npm WARN something', '{"type":"assistant","message":{"con']);
    expect(p.items).toEqual([{ kind: 'you', text: 'go' }]);
    expect(p.last.ended).toBe(false);
  });
  it('skips null lines and null content items', () => {
    const p = parseLog([turn(1, 'go'), 'null', j({ type: 'assistant', message: { content: [null] } }), j({ type: 'user', message: null })]);
    expect(p.items).toEqual([{ kind: 'you', text: 'go' }]);
  });
});
