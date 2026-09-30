// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NightlyTasks } from '@/components/settings/nightly-tasks';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const task = (over: object) => ({ key: 'scan', label: '对标巡检', schedule: { enabled: false, hour: 20, minute: 30 }, running: false, state: 'ok', lastSuccessAt: '2026-09-28T12:30:00.000Z', lastMessage: '巡检完成: 账号 3 个', hint: '', manualLeft: 3, ...over });

describe('NightlyTasks', () => {
  it('disables the run button while running or out of quota, and shows the schedule', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: [task({ running: true }), task({ key: 'collect', label: '作品数据回采', manualLeft: 0, schedule: { enabled: true, hour: 20, minute: 0 } })] }) })));
    render(<NightlyTasks />);
    await waitFor(() => expect(screen.getByText('作品数据回采')).toBeTruthy());
    const buttons = screen.getAllByRole('button').filter((b) => /立即运行|正在跑/.test(b.textContent ?? ''));
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText('定时已开 · 每晚 20:00')).toBeTruthy();
    expect(screen.getByText('定时未开')).toBeTruthy();
  });
});
