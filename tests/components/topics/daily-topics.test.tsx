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
  script: { segments: [{ id: 'a', role: 'hook', text: `开头${id}` }, { id: 'b', role: 'context', text: `背景${id}` }] }, copied: 0, predictedCenter: 4500, questions: [], answers: [], answered: false, ...over,
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
  it('shows the questions and writes from the answers', async () => {
    const qs = ['你收藏了多少个？', '最后留下哪几个？'];
    const f = stub({ topics: [card('1', { questions: qs, answers: ['一百多个', ''] })], lastRun: null }, () => ({ success: true, data: {} }));
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('要问你的（2 个）'));
    expect(screen.getByText('你收藏了多少个？')).toBeTruthy();
    const inputs = screen.getAllByPlaceholderText('用你自己的话答，几句就行') as HTMLTextAreaElement[];
    expect(inputs[0].value).toBe('一百多个');
    fireEvent.change(inputs[1], { target: { value: '就留了三个' } });
    fireEvent.click(screen.getByText('按我的话写'));
    await waitFor(() => expect(posts(f)).toEqual([['/api/topics/daily/1', { action: 'answer', answers: ['一百多个', '就留了三个'] }]]));
  });
  it('does not offer writing until a question is answered, and hides the block without questions', async () => {
    stub({ topics: [card('1', { questions: ['a'], answers: [] }), card('2')], lastRun: null });
    render(<DailyTopics />);
    fireEvent.click(await screen.findByText('要问你的（1 个）'));
    expect((screen.getByText('按我的话写') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/要问你的/)).toHaveLength(1);
  });
  it('labels the draft as a reference until it is written from your answers', async () => {
    stub({ topics: [card('1', { questions: ['a'] }), card('2', { questions: ['a'], answers: ['b'], answered: true })], lastRun: null });
    render(<DailyTopics />);
    expect(await screen.findByText('参考稿')).toBeTruthy();
    expect(screen.getByText('按你的话写的')).toBeTruthy();
  });
});

