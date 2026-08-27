// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const pathnameMock = vi.hoisted(() => ({ value: '/scripts' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathnameMock.value }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { Sidebar } from '@/components/layout/sidebar';

afterEach(cleanup);

describe('Sidebar', () => {
  it('渲染三项主导航 + 设置, 不多不少', () => {
    render(<Sidebar />);
    for (const label of ['选题', '写稿', '稿库', '设置']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // 旧版那些侧栏项不该复活
    for (const gone of ['热点雷达', '模板', '成片', '内容数据分析', '账号定位']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it('当前页那一项标 aria-current', () => {
    pathnameMock.value = '/scripts';
    render(<Sidebar />);
    expect(screen.getByText('稿库').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('写稿').getAttribute('aria-current')).toBeNull();
  });

  it('在稿子详情页里「写稿」保持高亮 —— 子路径归属父项', () => {
    pathnameMock.value = '/write/abc-123';
    render(<Sidebar />);
    expect(screen.getByText('写稿').getAttribute('aria-current')).toBe('page');
  });
});
