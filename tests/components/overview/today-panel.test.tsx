// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
import { cleanup, render, screen } from '@testing-library/react';
import { TodayPanel } from '@/components/overview/today-panel';

afterEach(cleanup);

const data = (over = {}) => ({
  todos: [{ kind: 'task' as const, text: '回采从来没成功过', href: '/settings#tasks' }],
  inProgress: [],
  empty: false,
  hits: [{ author: '添叔AI雷达', ratio: 8.6, topic: '甩链接出广告片' }],
  following: 3,
  metrics: { fans: null, fansDelta: null, likes: null, works: 0, views: 0, calib: { count: 0, avgError: null } },
  trend: [],
  trendDays: 0,
  works: [],
  ...over,
});

describe('TodayPanel', () => {
  it('still invites a new project when nothing is in progress, even with todos', () => {
    render(<TodayPanel data={data()} />);
    expect(screen.getByText('回采从来没成功过 →')).toBeTruthy();
    expect(screen.getByText(/还没有在做的作品/)).toBeTruthy();
  });
  it('shows hits even on an otherwise empty day', () => {
    render(<TodayPanel data={data({ todos: [], empty: true })} />);
    expect(screen.getByText(/添叔AI雷达/)).toBeTruthy();
  });
});
