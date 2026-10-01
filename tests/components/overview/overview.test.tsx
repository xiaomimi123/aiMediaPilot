// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetricCards } from '@/components/overview/metric-cards';
import { TrendChart } from '@/components/overview/trend-chart';
import { WorksTable } from '@/components/overview/works-table';

afterEach(cleanup);

describe('overview widgets', () => {
  it('handles missing account numbers', () => {
    render(<MetricCards m={{ fans: null, fansDelta: null, likes: null, works: 0, views: 0, calib: { count: 0, avgError: null } }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });
  it('shows the calibration line once checked', () => {
    render(<MetricCards m={{ fans: 410, fansDelta: 1, likes: 2452, works: 5, views: 32890, calib: { count: 3, avgError: 1.6 } }} />);
    expect(screen.getByText('410')).toBeTruthy();
    expect(screen.getByText('较上次回采 +1')).toBeTruthy();
    expect(screen.getByText('对过 3 次账 · 平均偏差 1.6 倍')).toBeTruthy();
  });
  it('waits for 7 days before drawing the trend', () => {
    render(<TrendChart trend={[{ day: '2026-10-01', fans: 410, likes: 2452, views: 32890 }]} recordedDays={1} />);
    expect(screen.getByText('已记录 1 天，满 7 天显示曲线')).toBeTruthy();
  });
  it('draws a line once there are 7 days and switches series', () => {
    const trend = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-0${i + 1}`, fans: 400 + i, likes: 2400 + i, views: 30000 + i * 100 }));
    const { container } = render(<TrendChart trend={trend} recordedDays={7} />);
    expect(container.querySelector('svg path')).toBeTruthy();
    fireEvent.click(screen.getByText('播放'));
    expect(screen.getByText('30,600')).toBeTruthy();
  });
  it('sorts the works table by a column', () => {
    const row = (id: string, views: number) => ({ id, title: id, href: `/projects/${id}`, external: false, views, hook5s: 0.4, avgViewSec: 10, likeRate: 0.02, verdicts: { views: 'even', hook5s: 'even', middle: 'even', like: 'even' } as const });
    render(<WorksTable rows={[row('小', 100), row('大', 9000)]} />);
    fireEvent.click(screen.getByText('播放'));
    const links = screen.getAllByRole('link').map((a) => a.textContent);
    expect(links[0]).toContain('大');
  });
  it('labels the fan change as since the last collection', () => {
    render(<MetricCards m={{ fans: 410, fansDelta: 1, likes: 2452, works: 5, views: 32890, calib: { count: 0, avgError: null } }} />);
    expect(screen.getByText('较上次回采 +1')).toBeTruthy();
  });
});
