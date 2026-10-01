// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
import { AppNav, isActive, NAV_ITEMS } from '@/components/app-nav';

afterEach(cleanup);

describe('AppNav', () => {
  it('has the five entries in order', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['总览', '作品', '选题', '助手', '设置']);
  });
  it('treats project pages as part of 作品', () => {
    expect(isActive('/projects/abc', '/works')).toBe(true);
    expect(isActive('/works', '/')).toBe(false);
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/settings', '/settings')).toBe(true);
  });
  it('renders a sidebar and a bottom tab bar, marking the current page', () => {
    pathname = '/topics';
    render(<AppNav />);
    const current = screen.getAllByRole('link', { current: 'page' });
    expect(current).toHaveLength(2);
    expect(current.every((a) => a.textContent?.includes('选题'))).toBe(true);
    expect(screen.getByTestId('tabbar').className).toContain('md:hidden');
    expect(screen.getByTestId('sidebar').className).toContain('hidden md:flex');
  });
  it('reserves space for the bottom tab bar', () => {
    render(<AppNav />);
    expect(screen.getByTestId('tabbar-spacer').className).toContain('md:hidden');
  });
});
