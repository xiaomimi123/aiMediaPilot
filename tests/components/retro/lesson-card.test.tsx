// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LessonCard } from '@/components/retro/lesson-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lesson = { id: 'L1', text: '第一句直接说结果', stage: 'hook', stageLabel: '开头钩子', status: 'candidate', evidenceCount: 1, contradicted: false, confirmedAt: null };

describe('LessonCard', () => {
  it('adopts a candidate', async () => {
    const f = vi.fn(async () => ({ json: async () => ({ success: true, data: {} }) }));
    vi.stubGlobal('fetch', f);
    const onChanged = vi.fn();
    render(<LessonCard lesson={lesson} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('采纳'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ status: 'active' });
  });
  it('asks to retire an active lesson the latest retro contradicted', () => {
    render(<LessonCard lesson={{ ...lesson, status: 'active', contradicted: true }} onChanged={() => {}} />);
    expect(screen.getByText('最近一次复盘没应验，要不要停用？')).toBeTruthy();
    expect(screen.getByText('证据少：1 条作品')).toBeTruthy();
  });
});
