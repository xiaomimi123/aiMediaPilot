// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilmPane } from '@/components/project/film-pane';

// 出片助手卡片会读出片状态; 各用例需要别的返回值时自己再 stub
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { current: null, history: [], busyElsewhere: null, claudeAvailable: true, versions: [] } }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const materials = [{ id: 'fm', url: '/api/projects/p1/files/fm', mediaType: 'video' as const, note: '讲安装那段', originalName: 'rec.mov', durationSec: 40 }];

describe('FilmPane', () => {
  it('explains how to get a film when there is none yet', async () => {
    render(<FilmPane projectId="p1" materials={[]} films={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('还没有成片。在上面「出片助手」里点「出一版」。')).toBeTruthy();
    expect(await screen.findByText('出片助手')).toBeTruthy();
    expect(screen.getByText('把录屏、视频、截图、图片拖到这里，或点击选择')).toBeTruthy();
  });
  it('lists materials with their notes', () => {
    render(<FilmPane projectId="p1" materials={materials} films={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('rec.mov')).toBeTruthy();
    expect(screen.getByDisplayValue('讲安装那段')).toBeTruthy();
  });
  it('shows films newest first with summary and usage table', () => {
    const films = [
      { id: 'f2', version: 2, url: '/f2', createdAt: '2026-09-28T02:00:00Z', summary: '冷知识段换成录屏', usage: [{ materialName: 'rec.mov', atSec: 35, durSec: 8, clipFromSec: 10, clipToSec: 22, speed: 1.5 }] },
      { id: 'f1', version: 1, url: '/f1', createdAt: '2026-09-28T01:00:00Z', summary: '首版', usage: [] },
    ];
    render(<FilmPane projectId="p1" materials={materials} films={films} onChanged={vi.fn()} />);
    const titles = screen.getAllByText(/^成片 v\d$/).map((e) => e.textContent);
    expect(titles).toEqual(['成片 v2', '成片 v1']);
    expect(screen.getByText('冷知识段换成录屏')).toBeTruthy();
    expect(screen.getByText('0:35 起 8 秒 · rec.mov 0:10–0:22 · 1.5 倍速')).toBeTruthy();
    expect(document.body.textContent).not.toContain('在 Claude Code 里说');
  });

  it('saves clearing a note that was just saved (compares with the last saved value)', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: { body: string }) => ({ json: async () => ({ success: true, data: url.endsWith('/film-session') ? { current: null, history: [], busyElsewhere: null, claudeAvailable: true, versions: [] } : {} }) }));
    vi.stubGlobal('fetch', fetchMock);
    const blank = [{ ...materials[0], note: '' }];
    render(<FilmPane projectId="p1" materials={blank} films={[]} onChanged={vi.fn()} />);
    const input = screen.getByPlaceholderText(/一句说明/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '讲安装' } });
    fireEvent.blur(input);
    await Promise.resolve();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    await Promise.resolve();
    const bodies = fetchMock.mock.calls.filter((c) => c[1]?.body).map((c) => JSON.parse(c[1]!.body).note);
    expect(bodies).toEqual(['讲安装', '']);
  });
});
