// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const pathnameMock = vi.hoisted(() => ({ value: '/scripts' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }));

// 侧栏底部的 worker 卡要读 health; 这里默认健康, 单独的用例再覆盖不健康的情形
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { Sidebar } from '@/components/layout/sidebar';

beforeEach(() => {
  fetchMock.mockResolvedValue({
    json: async () => ({ data: { ready: true, redis: 'up', workers: { online: 1 }, queues: {}, hint: null } }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Sidebar', () => {
  it('渲染 13 项(总览 + 三组 + 设置), 分组标题也在', () => {
    render(<Sidebar />);
    for (const label of ['总览', '规划', '选题', '写稿', '稿库', '素材库', '模板', '成片',
                         '拆解', '钩子库', '校准', '数据', '设置']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    for (const group of ['工作区', '生产', '分析']) {
      expect(screen.getByText(group)).toBeTruthy();
    }
  });

  it('worker 不在时底部常驻一张说明卡 —— 你可能在任何一页发起异步任务', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        data: {
          ready: false, redis: 'up', workers: { online: 0 },
          queues: { 'video-production': { waiting: 9, failed: 0 } },
          hint: '后台处理进程没在运行，任务会排队但没人处理。在项目目录执行 npm run worker:dev。',
        },
      }),
    });
    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('出片 worker 未运行')).toBeTruthy());
    expect(screen.getByText(/9 个任务在队列里等待/)).toBeTruthy();
  });

  it('worker 正常时不显示那张卡 —— 一切正常就别占地方', async () => {
    render(<Sidebar />);
    await waitFor(() => expect(screen.getByText('总览')).toBeTruthy());
    expect(screen.queryByText('出片 worker 未运行')).toBeNull();
  });

  it('当前页那一项标 aria-current', () => {
    pathnameMock.value = '/scripts';
    render(<Sidebar />);
    // 文字在内层 span 里, aria-current 挂在外层链接上
    expect(screen.getByText('稿库').closest('a')!.getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('写稿').closest('a')!.getAttribute('aria-current')).toBeNull();
  });

  it('在稿子详情页里「写稿」保持高亮 —— 子路径归属父项', () => {
    pathnameMock.value = '/write/abc-123';
    render(<Sidebar />);
    expect(screen.getByText('写稿').closest('a')!.getAttribute('aria-current')).toBe('page');
  });
});
