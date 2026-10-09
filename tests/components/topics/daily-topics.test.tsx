// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: () => {} }) }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DailyTopics } from '@/components/topics/daily-topics';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const card = (id: string, over = {}) => ({
  id, day: '2026-10-09', source: 'idea', sourceLabel: '点子', title: `题${id}`, why: `理由${id}`, hook: `钩子${id}`, status: 'new',
  script: { segments: [{ id: 'a', role: 'hook', text: `开头${id}` }, { id: 'b', role: 'context', text: `背景${id}` }] }, copied: 0, predictedCenter: 4500, checklist: [], results: [], ...over,
});
function stub(data: unknown, post: (url: string, body: unknown) => unknown = () => ({ success: true, data: { projectId: 'p9' } })) {
  const f = vi.fn(async (url: string, init?: RequestInit) => ({ json: async () => (init?.method === 'POST' ? post(url, JSON.parse(String(init.body))) : { success: true, data }) }));
  vi.stubGlobal('fetch', f);
  return f;
}
const posts = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST').map((c) => [c[0], JSON.parse(String((c as unknown as [string, RequestInit])[1].body))]);

describe('DailyTopics', () => {
  it('lists cards with source, reason and prediction', async () => {
    stub({ topics: [card('1'), card('2', { sourceLabel: '对标', predictedCenter: null, copied: 2 })], lastRun: null });
    render(<DailyTopics />);
    expect(await screen.findByText('题1')).toBeTruthy();
    expect(screen.getByText('理由1')).toBeTruthy();
    expect(screen.getByText('预测 ~4,500')).toBeTruthy();
    expect(screen.getByText('预测没算出来')).toBeTruthy();
    expect(screen.getByText('有 2 处和对标原文太像，改写后再用')).toBeTruthy();
  });
  it('expands the draft with its hook', async () => {
    stub({ topics: [card('1')], lastRun: null });
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('展开初稿'));
    expect(screen.getByText('开头钩子：钩子1')).toBeTruthy();
    expect(screen.getByText('开头1')).toBeTruthy();
    expect(screen.getByText('背景1')).toBeTruthy();
  });
  it('adopts a topic and opens the new project', async () => {
    const f = stub({ topics: [card('1')], lastRun: null });
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('就做这个'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p9'));
    expect(posts(f)).toEqual([['/api/topics/daily/1', { action: 'adopt' }]]);
  });
  it('dismisses a topic', async () => {
    const f = stub({ topics: [card('1')], lastRun: null }, () => ({ success: true, data: {} }));
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('不要'));
    await waitFor(() => expect(posts(f)).toEqual([['/api/topics/daily/1', { action: 'dismiss' }]]));
  });
  it('explains an empty day', async () => {
    stub({ topics: [], lastRun: { day: '2026-10-09', created: 0, reasons: ['还没有可用的模型'] } });
    render(<DailyTopics />);
    expect(await screen.findByText('还没有可用的模型')).toBeTruthy();
    cleanup();
    stub({ topics: [], lastRun: { day: '2026-10-09', created: 2, reasons: ['写稿失败：x'] } });
    render(<DailyTopics />);
    expect(await screen.findByText('今晚 23:00 会自动生成；也可以在「设置 · 每晚任务」立即运行')).toBeTruthy();
  });
  it('shows the test checklist and rewrites from filled results', async () => {
    const list = [{ test: '低中高三档各问一次', record: '各自用时' }, { test: '对比答案', record: '有没有要点' }];
    const f = stub({ topics: [card('1', { checklist: list, results: ['3 秒', ''] })], lastRun: null }, () => ({ success: true, data: {} }));
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('实测清单（2 项）'));
    expect(screen.getByText('低中高三档各问一次')).toBeTruthy();
    expect(screen.getByText('记下：各自用时')).toBeTruthy();
    const inputs = screen.getAllByPlaceholderText('填你实测的结果') as HTMLInputElement[];
    expect(inputs[0].value).toBe('3 秒');
    fireEvent.change(inputs[1], { target: { value: '高档才有全部要点' } });
    fireEvent.click(screen.getByText('按实测结果重写'));
    await waitFor(() => expect(posts(f)).toEqual([['/api/topics/daily/1', { action: 'rewrite', results: ['3 秒', '高档才有全部要点'] }]]));
  });
  it('does not offer a rewrite until at least one result is filled, and hides the checklist for talk topics', async () => {
    stub({ topics: [card('1', { checklist: [{ test: 'a', record: 'b' }], results: [] }), card('2')], lastRun: null });
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('实测清单（1 项）'));
    expect((screen.getByText('按实测结果重写') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/实测清单/)).toHaveLength(1);
  });
});

