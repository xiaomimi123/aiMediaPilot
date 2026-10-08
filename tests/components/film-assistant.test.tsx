// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FilmAssistant } from '@/components/project/film-assistant';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = (over = {}) => ({ current: null, history: [], busyElsewhere: null, claudeAvailable: true, versions: [], ...over });
const session = (over = {}) => ({ id: 'fs1', status: 'running', checkpoint: null, message: null, filmDir: 'remotion/films/p1-v3', version: null, createdAt: '2026-10-03T00:00:00.000Z', items: [{ kind: 'you', text: '给项目 p1 出一版' }, { kind: 'step', text: '读稿子和素材', ok: true }], shots: null, previewUrl: null, ...over });
const stub = (d: unknown) => {
  const f = vi.fn(async () => ({ json: async () => ({ success: true, data: d }) }));
  vi.stubGlobal('fetch', f);
  return f;
};
const posted = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST').map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));

describe('FilmAssistant', () => {
  it('starts a new film with an optional note', async () => {
    const f = stub(data());
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('出一版')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/要求/), { target: { value: '节奏快一点' } });
    fireEvent.click(screen.getByText('出一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'new', note: '节奏快一点' }]));
  });
  it('offers revising the latest version when films exist', async () => {
    const f = stub(data({ versions: [2, 1] }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('改这一版')).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/修改意见/), { target: { value: '第 3 镜太挤' } });
    fireEvent.click(screen.getByText('改这一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'revise', baseVersion: 2, note: '第 3 镜太挤' }]));
  });
  it('shows progress and a stop button while running', async () => {
    stub(data({ current: session() }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('✓ 读稿子和素材')).toBeTruthy());
    expect(screen.getByText('停止')).toBeTruthy();
  });
  it('asks to confirm the shot list', async () => {
    const f = stub(data({ current: session({ status: 'waiting', checkpoint: 'shots', message: '切了 2 镜', shots: [{ id: 'a', fromSec: 0, toSec: 4.5, intent: '开场', material: null }, { id: 'b', fromSec: 4.5, toSec: 9, intent: '截图', material: 'm1' }] }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('等你确认镜头表')).toBeTruthy());
    expect(screen.getByText('截图')).toBeTruthy();
    fireEvent.click(screen.getByText('可以，继续'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'reply', text: '可以，继续' }]));
  });
  it('previews the render and registers on confirm', async () => {
    const f = stub(data({ current: session({ status: 'waiting', checkpoint: 'render', message: '这一版用了截图', previewUrl: '/api/film-sessions/fs1/file?path=out/final.mp4' }) }));
    const { container } = render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('等你确认成片')).toBeTruthy());
    expect(container.querySelector('video')?.getAttribute('src')).toBe('/api/film-sessions/fs1/file?path=out/final.mp4');
    fireEvent.click(screen.getByText('登记为新版本'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'register' }]));
  });
  it('offers resume and abandon after a failure', async () => {
    stub(data({ current: session({ status: 'failed', message: 'usage limit reached' }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/usage limit reached/)).toBeTruthy());
    expect(screen.getByText('接着做')).toBeTruthy();
    expect(screen.getByText('放弃')).toBeTruthy();
  });
  it('is disabled while another project is filming or claude is missing', async () => {
    stub(data({ busyElsewhere: { projectId: 'p2', title: '另一个' } }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('「另一个」正在出片')).toBeTruthy());
    expect((screen.getByText('出一版') as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    stub(data({ claudeAvailable: false }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText(/本机没有可用的 Claude Code/)).toBeTruthy());
  });
  it('lets the user say something else after a failure', async () => {
    const f = stub(data({ current: session({ status: 'failed', message: '超时' }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    const input = await screen.findByPlaceholderText(/或者写你的意见/);
    fireEvent.change(input, { target: { value: '换个思路' } });
    fireEvent.click(screen.getByText('发送'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'reply', text: '换个思路' }]));
  });
  it('starts a landscape film when 横版 is picked', async () => {
    const f = stub(data());
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('出一版')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '横版' }));
    expect(screen.getByRole('button', { name: '横版' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('出一版'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'start', kind: 'new', orientation: 'landscape' }]));
  });
  it('offers a fresh conversation after a failure on an existing film dir', async () => {
    const f = stub(data({ current: session({ status: 'failed', message: 'API Error: 400 read body failed' }) }));
    render(<FilmAssistant projectId="p1" onChanged={() => {}} />);
    fireEvent.click(await screen.findByText('换个新对话接着做'));
    await waitFor(() => expect(posted(f)).toEqual([{ action: 'restart' }]));
  });
});
