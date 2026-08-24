// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProductionsView } from '@/components/cockpit/views/productions';

const READY = {
  id: 'vp-ready', status: 'preview_ready', mode: 'ppt-narration',
  masterPath: null, previewPath: '/x/preview.mp4', contentId: 'c1', templateId: 't1',
  createdAt: '2026-08-25T00:00:00.000Z', errorMessage: null,
  contentTitle: 'DeepSeek 涨价三倍', templateName: '图文口播',
};
const DONE = {
  // 交付模式与 READY 取不同值 —— 否则两张卡的 meta 行都含「图文口播」, 按文本查会命中多个元素
  ...READY, id: 'vp-done', status: 'done', masterPath: '/x/master.mp4', mode: 'illustration-tts',
  contentTitle: '成片一条', templateName: '插画配音',
};
const FAILED = {
  ...READY, id: 'vp-failed', status: 'failed', previewPath: null,
  errorMessage: "window.__timelines['shot'] 不存在，无法 seek",
  contentTitle: '失败的那条', templateName: null,
};

// 显式标注参数类型 —— 否则 vi.fn(async () => ...) 推出的调用记录是空元组 `[]`,
// 后面读 `calls[i][1]` 在本项目的 strict tsconfig 下过不了 tsc(同 packaging.test.ts 先例)。
function mockFetch(productions: unknown[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    ({ ok: true, json: async () => ({ success: true, data: { productions } }) }) as Response);
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ProductionsView 成片库', () => {
  it('列出每条片子的内容标题与模板名', async () => {
    vi.stubGlobal('fetch', mockFetch([READY, DONE]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByText('DeepSeek 涨价三倍')).toBeTruthy());
    expect(screen.getByText(/图文口播/)).toBeTruthy();
    expect(screen.getByText('成片一条')).toBeTruthy();
  });

  it('预览就绪的片子给「看预览」入口 —— 只认 masterPath 会让它没有任何可点的地方', async () => {
    vi.stubGlobal('fetch', mockFetch([READY]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '看预览' })).toBeTruthy());
  });

  it('已完成的片子给「看成片」与下载', async () => {
    vi.stubGlobal('fetch', mockFetch([DONE]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '看成片' })).toBeTruthy());
    expect(screen.getByRole('link', { name: '下载' })).toBeTruthy();
  });

  it('点「看预览」就地播放, 播放器指向该任务的预览流', async () => {
    vi.stubGlobal('fetch', mockFetch([READY]));
    const { container } = render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '看预览' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '看预览' }));

    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.getAttribute('src')).toContain('vp-ready');
    expect(video!.getAttribute('src')).toContain('type=preview');
  });

  it('失败的片子摊开失败原因, 且不给播放入口', async () => {
    vi.stubGlobal('fetch', mockFetch([FAILED]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByText(/__timelines/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: '看预览' })).toBeNull();
    expect(screen.queryByRole('button', { name: '看成片' })).toBeNull();
  });

  it('一条片子都没有时给空态, 不是空白页', async () => {
    vi.stubGlobal('fetch', mockFetch([]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByText(/还没有/)).toBeTruthy());
  });

  it('每条片子都有删除入口', async () => {
    vi.stubGlobal('fetch', mockFetch([READY]));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeTruthy());
  });

  it('删除前必须二次确认; 取消则不发请求', async () => {
    const fetchMock = mockFetch([READY]);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => false));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    // 只有最初那次列表拉取, 没有 DELETE
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit | undefined)?.method !== 'DELETE')).toBe(true);
  });

  it('确认后发 DELETE 到该任务, 并刷新列表', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return { ok: true, json: async () => ({ success: true, data: { deleted: true } }) } as Response;
      }
      return { ok: true, json: async () => ({ success: true, data: { productions: [READY] } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE');
      expect(del).toBeTruthy();
      expect(String(del![0])).toContain('vp-ready');
    });
    // 删完要重新拉列表, 否则页面上那条已经不存在的片子还杵在那儿
    await waitFor(() => {
      const listCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method !== 'DELETE');
      expect(listCalls.length).toBeGreaterThan(1);
    });
  });

  it('删除失败时给出可见提示, 不静默吞掉', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new Error('任务进行中');
      return { ok: true, json: async () => ({ success: true, data: { productions: [READY] } }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => expect(screen.getByText(/删除失败/)).toBeTruthy());
  });

  it('加载失败时给出可见提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('断网'); }));
    render(<ProductionsView />);
    await waitFor(() => expect(screen.getByText(/失败/)).toBeTruthy());
  });
});
