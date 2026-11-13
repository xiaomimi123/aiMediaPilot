// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeDesk } from '@/components/overview/home-desk';
import { accountLine, type IdeaCard } from '@/lib/overview/home';
import type { TopicCluster } from '@/lib/overview/cluster';
import type { FeedRow } from '@/lib/overview/feed';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

afterEach(cleanup);

const hot = (over: Partial<FeedRow> = {}): FeedRow => ({
  key: 'source:h1',
  kind: 'source',
  refId: 'h1',
  dailyId: null,
  provider: 'github',
  sourceLabel: 'GitHub',
  title: 'D4Vinci/Scrapling',
  why: '抓网页的库，自适应选择器。',
  url: 'https://github.com/D4Vinci/Scrapling',
  heat: 101876,
  heatLabel: '101,876 stars',
  seenAt: '2026-11-13',
  seenLabel: '今天',
  statusKey: 'fresh',
  status: '还没写',
  fit: '抖音口播 · 录操作用横版',
  score: {
    total: 84,
    parts: [
      { key: 'heat', label: '热度', value: 90, weight: 0.45, applied: 0.45, detail: '当前 101,876 stars，按 100,000 封顶取对数。库里没有上一次的 star，不算增速。' },
      { key: 'recency', label: '新旧', value: 90, weight: 0.25, applied: 0.25, detail: '距今 0.3 天，半衰期 3 天。' },
      { key: 'fit', label: '赛道', value: 60, weight: 0.2, applied: 0.2, detail: '命中工具。' },
      { key: 'handsOn', label: '亲测', value: 100, weight: 0.1, applied: 0.1, detail: 'GitHub 仓库，可以录操作做成亲测。' },
    ],
  },
  canAdopt: false,
  ...over,
});

const idea = (over: Partial<IdeaCard> = {}): IdeaCard => ({ id: 'i1', text: '用一行命令讲清安装', status: '待写', draftId: null, ...over });
const pick = (item: FeedRow, related: FeedRow[] = []): TopicCluster => ({ id: item.key, lead: item, related });

describe('accountLine', () => {
  it('hides a row of zeros', () => {
    expect(accountLine({ fans: null, likes: null, works: 0, views: 0 })).toBeNull();
  });
  it('keeps a real count', () => {
    expect(accountLine({ fans: 410, likes: null, works: 2, views: 900 })).toBe('粉丝 410 · 公开 2 条，播放 900');
  });
});

describe('HomeDesk', () => {
  it('puts hot topics and the idea backlog first, and explains an empty desk', () => {
    render(<HomeDesk picks={[]} totalHot={0} ideas={[]} writing={[]} sources={[]} fetchLine="没有抓取日志。" account={null} />);
    expect(screen.getByRole('heading', { name: '今天最值得写' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '待写的点子' })).toBeTruthy();
    expect(screen.getByText(/每天 19:00 会从 GitHub/)).toBeTruthy();
    expect(screen.getByText(/点子池是空的/)).toBeTruthy();
    expect(screen.queryByText('粉丝')).toBeNull();
    expect(screen.queryByText(/每晚任务/)).toBeNull();
    expect(screen.queryByText(/定时没开/)).toBeNull();
  });

  it('shows score, source, heat, why, fit, status, and the write action', () => {
    render(
      <HomeDesk
        picks={[
          pick(hot()),
          pick(hot({ key: 'daily:d1', refId: 'd1', dailyId: 'd1', provider: 'idea', sourceLabel: '点子', title: '安装只要一行', heat: null, heatLabel: null, why: '片尾留了钩子', fit: '适合抖音口播', status: '有初稿', statusKey: 'draft', canAdopt: true, score: { total: 61, parts: hot().score.parts } })),
        ]}
        totalHot={70}
        ideas={[idea()]}
        writing={[{ id: 'p1', title: '未完成的那条' }]}
        sources={[{ label: 'GitHub', count: 40, newest: '今天' }, { label: 'X', count: 0, newest: null }]}
        fetchLine="没有抓取日志。"
        account="粉丝 12"
      />,
    );
    expect(screen.getByText('D4Vinci/Scrapling')).toBeTruthy();
    expect(screen.getByText('84')).toBeTruthy();
    expect(screen.getByText(/101,876 stars/)).toBeTruthy();
    expect(screen.getByText(/还没写/)).toBeTruthy();
    expect(screen.getByText(/抓网页的库，自适应选择器/)).toBeTruthy();
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '开始写' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '做成作品' })).toBeTruthy();
    expect(screen.getByText('用一行命令讲清安装')).toBeTruthy();
    expect(screen.getByText('待写')).toBeTruthy();
    expect(screen.getByRole('link', { name: '全部 70 条' }).getAttribute('href')).toBe('/feed');
    expect(screen.getByRole('link', { name: '未完成的那条' })).toBeTruthy();
    expect(screen.getByText('粉丝 12')).toBeTruthy();
    expect(screen.queryByText(/没有历史热度/)).toBeNull();
  });
});
