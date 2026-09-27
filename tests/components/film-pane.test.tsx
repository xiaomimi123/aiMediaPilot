// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FilmPane } from '@/components/project/film-pane';

afterEach(cleanup);
const materials = [{ id: 'fm', url: '/api/projects/p1/files/fm', mediaType: 'video' as const, note: '讲安装那段', originalName: 'rec.mov', durationSec: 40 }];

describe('FilmPane', () => {
  it('explains how to get a film when there is none yet', () => {
    render(<FilmPane projectId="p1" materials={[]} films={[]} onChanged={vi.fn()} />);
    expect(screen.getByText('还没有成片。在 Claude Code 里说「给这个项目出片」，出好的成片会出现在这里。')).toBeTruthy();
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
    expect(screen.getByText('修改成片：在 Claude Code 里说「改这个项目的成片：……」')).toBeTruthy();
  });
});
