// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ObsidianCard } from '@/components/settings/obsidian-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = { vault: '/v', detected: true, vaultProblem: null, readFolders: ['5-灵感', '旧文件夹'], topFolders: ['1-项目', '5-灵感'], missing: ['旧文件夹'], writeFolder: 'MediaPilot', noteCount: 42 };

describe('ObsidianCard', () => {
  it('shows the vault, folders, missing ones and saves toggles', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => ({ json: async () => ({ success: true, data: init?.method === 'PUT' ? { ...data, readFolders: ['5-灵感', '旧文件夹', '1-项目'] } : data }) }));
    vi.stubGlobal('fetch', f);
    render(<ObsidianCard />);
    await waitFor(() => expect(screen.getByDisplayValue('/v')).toBeTruthy());
    expect(screen.getByText('可读 42 篇笔记')).toBeTruthy();
    expect(screen.getByText(/旧文件夹.*找不到/)).toBeTruthy();
    expect(screen.getByText('写入文件夹：MediaPilot/（总是可读）')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('1-项目'));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ readFolders: ['5-灵感', '旧文件夹', '1-项目'] });
  });
});
