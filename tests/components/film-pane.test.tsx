// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      { id: 'f2', version: 2, url: '/f2', createdAt: '2026-09-28T02:00:00Z', summary: '冷知识段换成录屏', usage: [{ materialName: 'rec.mov', atSec: 35, durSec: 8, clipFromSec: 10, clipToSec: 22, speed: 1.5 }], orientation: 'portrait' as const },
      { id: 'f1', version: 1, url: '/f1', createdAt: '2026-09-28T01:00:00Z', summary: '首版', usage: [], orientation: 'portrait' as const },
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
  it('marks landscape films and plays them full width', () => {
    const films = [
      { id: 'f4', version: 4, url: '/f4', createdAt: '2026-10-04T02:00:00Z', summary: '录屏版', usage: [], orientation: 'landscape' as const },
      { id: 'f3', version: 3, url: '/f3', createdAt: '2026-10-04T01:00:00Z', summary: '口播版', usage: [], orientation: 'portrait' as const },
    ];
    const { container } = render(<FilmPane projectId="p1" materials={[]} films={films} onChanged={vi.fn()} />);
    expect(screen.getAllByText('横版')).toHaveLength(1);
    const videos = container.querySelectorAll('li.card video');
    expect(videos[0].className).toContain('w-full');
    expect(videos[1].className).toContain('max-h-[60vh]');
  });
  it('deletes a film version only after confirming in the page (no native dialog)', async () => {
    const films = [{ id: 'f1', version: 1, url: '/f1', createdAt: '2026-09-28T01:00:00Z', summary: '首版', usage: [], orientation: 'portrait' as const }];
    const onChanged = vi.fn();
    // 出片助手也会读状态: 按地址分别返回, 否则它拿到删除接口的数据会报错
    const fetchMock = vi.fn(async (url: string, _init?: { method?: string }) => ({
      json: async () => ({ success: true, data: url.endsWith('/film-session') ? { current: null, history: [], busyElsewhere: null, claudeAvailable: true, versions: [] } : { version: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<FilmPane projectId="p1" materials={[]} films={films} onChanged={onChanged} />);
    const deletes = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'DELETE');
    fireEvent.click(screen.getByRole('button', { name: '删除成片 v1' }));
    expect(screen.getByText('删除 v1？视频和片子目录都会删掉，不能恢复。')).toBeTruthy();
    fireEvent.click(screen.getByText('取消'));
    expect(screen.queryByText('确定删除')).toBeNull();
    expect(deletes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '删除成片 v1' }));
    fireEvent.click(screen.getByText('确定删除'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(deletes().map((c) => c[0])).toEqual(['/api/projects/p1/films/f1']);
    expect(confirm).not.toHaveBeenCalled();
  });
});
