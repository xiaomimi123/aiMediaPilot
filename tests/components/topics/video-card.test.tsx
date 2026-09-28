// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoCard } from '@/components/topics/video-card';
import { goTo } from '@/components/topics/nav';
import type { VideoView } from '@/lib/benchmark/view';

vi.mock('@/components/topics/nav', () => ({ goTo: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: VideoView = {
  id: 'v1', author: '园长说AI', publishedAt: '2026-09-20T00:00:00.000Z', desc: '画面都交给AI了 #AI音乐', url: 'https://www.douyin.com/video/1',
  digg: 23417, comment: 10, collect: 20, share: 30, ratio: 4.5, isHit: true, status: 'new',
  analysisStatus: 'done', analysisError: null, transcript: '很多人对AI的印象还停留在聊天写代码',
  analysis: { topic: 'AI 帮听障摊主做生意', hook: { quote: '很多人对AI的印象还停留在聊天写代码', type: '反常识' }, titlePattern: '话题标签', fit: 'high', fitReason: '对上效率革命', myAngle: '讲你实测的工具' },
};

describe('VideoCard', () => {
  it('shows likes as a multiple of the usual, topic, hook and fit', () => {
    render(<VideoCard video={base} onChanged={() => {}} />);
    expect(screen.getByText('23,417 赞 · 平时的 4.5 倍')).toBeTruthy();
    expect(screen.getByText('AI 帮听障摊主做生意')).toBeTruthy();
    expect(screen.getByText('契合度高')).toBeTruthy();
    expect(screen.queryByText(/播放/)).toBeNull();
  });
  it('shows the failure reason with a retry button', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, data: { queued: true } }) }));
    vi.stubGlobal('fetch', fetchMock);
    const onChanged = vi.fn();
    render(<VideoCard video={{ ...base, analysisStatus: 'failed', analysisError: '下载视频时 ego lite 没有响应：打开 ego lite 重新登录一次，再点重试。', analysis: null }} onChanged={onChanged} />);
    expect(screen.getByText(/打开 ego lite 重新登录/)).toBeTruthy();
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/topics/videos/v1/analyze');
  });
  it('creates a project and navigates to it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: { projectId: 'p9' } }) })));
    render(<VideoCard video={base} onChanged={() => {}} />);
    fireEvent.click(screen.getByText('建项目'));
    await waitFor(() => expect(goTo).toHaveBeenCalledWith('/projects/p9'));
  });
});
