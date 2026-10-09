// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IdeaPool } from '@/components/topics/idea-pool';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('IdeaPool', () => {
  it('saves an idea on enter, ignores blanks, shows status and deletes', async () => {
    let ideas = [{ id: 'i1', text: '老点子', status: 'used' }];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { text } = JSON.parse(String(init.body));
        ideas = [{ id: 'i2', text, status: 'fresh' }, ...ideas];
        return { json: async () => ({ success: true, data: ideas[0] }) };
      }
      if (init?.method === 'DELETE') {
        ideas = ideas.filter((i) => !url.endsWith(i.id));
        return { json: async () => ({ success: true, data: {} }) };
      }
      return { json: async () => ({ success: true, data: ideas }) };
    });
    vi.stubGlobal('fetch', f);
    render(<IdeaPool />);
    expect(await screen.findByText('老点子')).toBeTruthy();
    expect(screen.getByText('已出选题')).toBeTruthy();
    const input = screen.getByPlaceholderText('随手写一句点子，回车保存') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(f.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
    fireEvent.change(input, { target: { value: '讲讲 vibe coding 踩过的坑' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('讲讲 vibe coding 踩过的坑')).toBeTruthy();
    expect(input.value).toBe('');
    expect(screen.getByText('没用过')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]);
    await waitFor(() => expect(screen.queryByText('讲讲 vibe coding 踩过的坑')).toBeNull());
  });
});
