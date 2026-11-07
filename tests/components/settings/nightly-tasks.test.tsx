// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { NightlyTasks } from '@/components/settings/nightly-tasks';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const task = (over: object) => ({ key: 'scan', label: '对标巡检', schedule: { enabled: false, hour: 20, minute: 30 }, running: false, state: 'ok', lastSuccessAt: '2026-09-28T12:30:00.000Z', lastMessage: '巡检完成: 账号 3 个', hint: '', manualLeft: 3, retryAfterMin: true, ...over });

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
  it('tells that failed nightly tasks are retried later (only when the schedule is on), sources task never retries', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: [task({ key: 'collect', label: '作品数据回采', schedule: { enabled: true, hour: 20, minute: 0 } }), task({ schedule: { enabled: false, hour: 20, minute: 30 } }), task({ key: 'sources', label: '信息源抓取', schedule: { enabled: true, hour: 19, minute: 0 }, retryAfterMin: false })] }) })));
    render(<NightlyTasks />);
    expect(await screen.findAllByText(/失败会自动补跑/)).toHaveLength(1);
    // 开关: 每个 task 有一个 switch, 回采/信息源开着, 巡检关着
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    const checked = switches.filter((s) => s.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(2);
  });
});

