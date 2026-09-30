// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteProposalCard } from '@/components/project/note-proposal-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const view = (over = {}) => ({ id: 'np1', projectId: 'p1', trigger: 'finalize', path: 'MediaPilot/项目/测试.md', content: '# 测试\n\n## 定稿', status: 'pending', error: null, createdAt: '2026-09-30T00:00:00.000Z', ...over });

describe('NoteProposalCard', () => {
  it('previews and writes on confirm', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'POST' ? view({ status: 'written' }) : view() }) }));
    vi.stubGlobal('fetch', f);
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText('MediaPilot/项目/测试.md')).toBeTruthy());
    fireEvent.click(screen.getByText('预览'));
    expect(screen.getByText(/## 定稿/)).toBeTruthy();
    fireEvent.click(screen.getByText('存进 Obsidian'));
    await waitFor(() => expect(screen.getByText('已存进 Obsidian')).toBeTruthy());
    expect(JSON.parse(String((f.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body))).toEqual({ action: 'accept' });
  });
  it('shows the failure reason and keeps the buttons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: view({ error: '没找到 Obsidian 库：去设置页填库路径' }) }) })));
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText(/没找到 Obsidian 库/)).toBeTruthy());
    expect(screen.getByText('存进 Obsidian')).toBeTruthy();
  });
  it('disables handled proposals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: view({ status: 'expired' }) }) })));
    render(<NoteProposalCard proposalId="np1" />);
    await waitFor(() => expect(screen.getByText('已过期')).toBeTruthy());
    expect(screen.queryByText('存进 Obsidian')).toBeNull();
  });
});
