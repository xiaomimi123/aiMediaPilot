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
  daily: { topics: [], reason: null },
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
  it('shows today\'s topics with source and prediction, linking to the topics page', () => {
    const { container } = render(<TodayPanel data={data({ daily: { topics: [{ id: 'd1', title: 'U盘生意的账本', sourceLabel: '续集', why: '片尾留了钩子', predictedCenter: 4500 }, { id: 'd2', title: 'AI 帮老板回消息', sourceLabel: '对标', why: '对标爆了', predictedCenter: null }], reason: null } })} />);
    expect(screen.getByText('今日选题')).toBeTruthy();
    expect(screen.getByText('U盘生意的账本')).toBeTruthy();
    expect(screen.getByText('续集')).toBeTruthy();
    expect(screen.getByText('预测 ~4,500')).toBeTruthy();
    expect(screen.getByText('片尾留了钩子')).toBeTruthy();
    expect(screen.getByText('预测没算出来')).toBeTruthy();
    expect(container.querySelector('a[href="/topics#daily"]')).toBeTruthy();
  });
  it('explains why there are no topics today, and hides the block when there is nothing to say', () => {
    render(<TodayPanel data={data({ daily: { topics: [], reason: '还没有可用的模型' } })} />);
    expect(screen.getByText('还没有可用的模型')).toBeTruthy();
    cleanup();
    render(<TodayPanel data={data()} />);
    expect(screen.queryByText('今日选题')).toBeNull();
  });
});

