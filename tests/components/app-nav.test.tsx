// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
import { AppNav, isActive, NAV_ITEMS } from '@/components/app-nav';

afterEach(cleanup);

describe('AppNav', () => {
  it('has the six entries in order', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['总览', '作品', '写稿', '选题', '助手', '设置']);
  });
  it('treats project pages as part of 作品', () => {
    expect(isActive('/projects/abc', '/works')).toBe(true);
    expect(isActive('/works', '/')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/settings', '/settings')).toBe(true);
  });
  it('renders a sidebar and marks the current page', () => {
    pathname = '/topics';
    render(<AppNav />);
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('选题');
    expect(screen.getByTestId('sidebar')).toBeTruthy();
    expect(screen.queryByTestId('tabbar')).toBeNull();
  });
});
