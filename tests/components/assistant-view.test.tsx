// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantView } from '@/components/assistant/assistant-view';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
});

describe('AssistantView', () => {
  it('lists threads and opens the latest one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      json: async () =>
        url === '/api/assistant/threads'
          ? { success: true, data: [{ id: 't1', title: '今天做什么', updatedAt: '2026-09-29T10:00:00.000Z' }] }
          : { success: true, data: { id: 't1', title: '今天做什么', messages: [{ id: 'm1', role: 'assistant', content: '去 /projects/p9 看看', toolName: null, ok: null, detail: null }] } },
    })));
    render(<AssistantView />);
    await waitFor(() => expect(screen.getAllByText('今天做什么').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByRole('link', { name: '/projects/p9' }).getAttribute('href')).toBe('/projects/p9'));
    expect(screen.getByText('新对话')).toBeTruthy();
  });
});

describe('AssistantView threads', () => {
  const thread = (id: string) => ({ id, title: id, updatedAt: '2026-09-29T10:00:00.000Z' });
  it('creates only one thread on a fresh start, even under StrictMode', async () => {
    const { StrictMode } = await import('react');
    const f = vi.fn(async (url: string, init?: RequestInit) => ({
      json: async () => (init?.method === 'POST' ? { success: true, data: thread('new') } : url === '/api/assistant/threads' ? { success: true, data: [] } : { success: true, data: { id: 'new', title: 'new', messages: [] } }),
    }));
    vi.stubGlobal('fetch', f);
    render(
      <StrictMode>
        <AssistantView />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByText('新对话')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(f.mock.calls.filter((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toHaveLength(1);
  });
  it('reuses the current thread when it has no messages yet', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => ({
      json: async () => (init?.method === 'POST' ? { success: true, data: thread('t2') } : url === '/api/assistant/threads' ? { success: true, data: [thread('t1')] } : { success: true, data: { id: 't1', title: 't1', messages: [] } }),
    }));
    vi.stubGlobal('fetch', f);
    render(<AssistantView />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/assistant/threads/t1'));
    fireEvent.click(screen.getByText('新对话'));
    await new Promise((r) => setTimeout(r, 50));
    expect(f.mock.calls.filter((c) => (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toHaveLength(0);
  });
  it('shows the last clicked thread even if an earlier one answers later', async () => {
    let releaseA: () => void = () => {};
    const f = vi.fn(async (url: string) => {
      if (url === '/api/assistant/threads') return { json: async () => ({ success: true, data: [thread('A'), thread('B')] }) };
      if (url === '/api/assistant/threads/A' && f.mock.calls.filter((c) => c[0] === url).length > 1) await new Promise<void>((r) => (releaseA = r));
      const id = url.split('/').pop()!;
      return { json: async () => ({ success: true, data: { id, title: id, messages: [{ id: `m${id}`, role: 'assistant', content: `内容${id}`, toolName: null, ok: null }] } }) };
    });
    vi.stubGlobal('fetch', f);
    render(<AssistantView />);
    await waitFor(() => expect(screen.getByText('内容A')).toBeTruthy());
    fireEvent.click(screen.getAllByText('A').find((e) => e.tagName === 'BUTTON')!);
    fireEvent.click(screen.getAllByText('B').find((e) => e.tagName === 'BUTTON')!);
    await waitFor(() => expect(screen.getByText('内容B')).toBeTruthy());
    releaseA();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('内容A')).toBeNull();
  });
  it('creates a new thread once the current one has been used', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: false,
      body: null,
      status: 500,
      json: async () =>
        init?.method === 'POST' && url === '/api/assistant/threads'
          ? { success: true, data: thread('t2') }
          : url === '/api/assistant/threads'
            ? { success: true, data: [thread('t1')] }
            : url.endsWith('/chat')
              ? { message: 'x' }
              : { success: true, data: { id: 't1', title: 't1', messages: [] } },
    }));
    vi.stubGlobal('fetch', f);
    render(<AssistantView />);
    await waitFor(() => expect(screen.getByText('今天做什么')).toBeTruthy());
    fireEvent.click(screen.getByText('今天做什么'));
    await waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).endsWith('/chat'))).toBe(true));
    fireEvent.click(screen.getByText('新对话'));
    await waitFor(() => expect(f.mock.calls.filter((c) => c[0] === '/api/assistant/threads' && (c as unknown as [string, RequestInit])[1]?.method === 'POST')).toHaveLength(1));
  });
});
