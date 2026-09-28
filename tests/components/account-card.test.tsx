// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccountCard } from '@/components/home/account-card';
import type { AccountSummary } from '@/lib/account/summary';

afterEach(cleanup);
const base: AccountSummary = {
  fans: 2847, fansDelta: -2, works: 101, publicWorks: 5, totalPlay: 257890, lastPublishedAt: '2026-08-20T08:00:00.000Z',
  recent90: null, hasOverview: true, dataAt: '2026-09-26T18:50:00.000Z',
  collect: { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' },
  hits24h: 0,
  scan: { state: 'ok', lastRun: null, lastSuccessAt: '2026-09-28T12:00:00.000Z', consecutiveFailures: 0, hint: '' },
};

describe('AccountCard', () => {
  it('shows real numbers and says plainly when there were no recent submissions', () => {
    render(<AccountCard summary={base} />);
    expect(screen.getByText('2,847')).toBeTruthy();
    expect(screen.getByText('较上期 -2')).toBeTruthy();
    expect(screen.getByText('101 条（公开 5 条）')).toBeTruthy();
    expect(screen.getByText('257,890')).toBeTruthy();
    expect(screen.getByText('近 90 天没有公开投稿，投稿分析暂无数据')).toBeTruthy();
  });
  it('shows a warning banner with the reason when collection is failing', () => {
    render(<AccountCard summary={{ ...base, collect: { ...base.collect, state: 'failing', consecutiveFailures: 2, hint: '连续 2 次回采失败：ego lite 没在运行' } }} />);
    expect(screen.getByRole('alert').textContent).toContain('连续 2 次回采失败：ego lite 没在运行');
  });
  it('does not claim zero submissions when the overview was never collected', () => {
    render(<AccountCard summary={{ ...base, hasOverview: false }} />);
    expect(screen.getByText('还没回采到投稿分析')).toBeTruthy();
    expect(screen.queryByText(/没有公开投稿/)).toBeNull();
  });
  it("links to today's benchmark hits", () => {
    render(<AccountCard summary={{ ...base, hits24h: 3 }} />);
    expect(screen.getByRole('link', { name: '今天对标里有 3 条爆款 →' }).getAttribute('href')).toBe('/topics');
  });
  it('warns when the benchmark scan fails', () => {
    render(<AccountCard summary={{ ...base, scan: { ...base.scan, state: 'failing', hint: '连续 1 次对标巡检失败：ego lite 没有响应' } }} />);
    expect(screen.getAllByRole('alert').map((a) => a.textContent).join()).toContain('对标巡检失败');
  });
  it('shows placeholders instead of zeros when fans are unknown', () => {
    render(<AccountCard summary={{ ...base, fans: null, fansDelta: null }} />);
    expect(screen.getByText('还没回采到')).toBeTruthy();
  });
});
