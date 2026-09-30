// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
