// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HomeDesk } from '@/components/overview/home-desk';
import { accountLine, type HotCard, type IdeaCard } from '@/lib/overview/home';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

afterEach(cleanup);

const hot = (over: Partial<HotCard> = {}): HotCard => ({
  id: 'h1',
  kind: 'source',
  title: 'D4Vinci/Scrapling',
  source: 'GitHub',
  heat: '101,876 stars',
  why: '抓网页的库，自适应选择器。',
  fit: '适合抖音口播，录操作时用横版',
  status: '还没写',
  url: 'https://github.com/D4Vinci/Scrapling',
  ...over,
});

const idea = (over: Partial<IdeaCard> = {}): IdeaCard => ({ id: 'i1', text: '用一行命令讲清安装', status: '待写', draftId: null, ...over });

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
    render(<HomeDesk hot={[]} moreHot={0} ideas={[]} writing={[]} account={null} />);
    expect(screen.getByRole('heading', { name: '热点选题' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '待写的点子' })).toBeTruthy();
    expect(screen.getByText(/每天 19:00 会从 GitHub/)).toBeTruthy();
    expect(screen.getByText(/点子池是空的/)).toBeTruthy();
    expect(screen.queryByText('粉丝')).toBeNull();
    expect(screen.queryByText(/每晚任务/)).toBeNull();
    expect(screen.queryByText(/定时没开/)).toBeNull();
  });

  it('shows source, heat, why, fit, status, and the write action', () => {
    render(<HomeDesk hot={[hot(), hot({ id: 'd1', kind: 'daily', title: '安装只要一行', source: '点子', heat: null, why: '片尾留了钩子', fit: '适合抖音口播', status: '有初稿' })]} moreHot={2} ideas={[idea()]} writing={[{ id: 'p1', title: '未完成的那条' }]} account="粉丝 12" />);
    expect(screen.getByText('D4Vinci/Scrapling')).toBeTruthy();
    expect(screen.getByText(/GitHub · 101,876 stars · 还没写/)).toBeTruthy();
    expect(screen.getByText('抓网页的库，自适应选择器。')).toBeTruthy();
    expect(screen.getByText('适合抖音口播，录操作时用横版')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '开始写' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: '做成作品' })).toBeTruthy();
    expect(screen.getByText('用一行命令讲清安装')).toBeTruthy();
    expect(screen.getByText('待写')).toBeTruthy();
    expect(screen.getByRole('link', { name: '选题页还有 2 条' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '未完成的那条' })).toBeTruthy();
    expect(screen.getByText('粉丝 12')).toBeTruthy();
  });
});
