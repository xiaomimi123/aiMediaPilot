// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PersonaEditor } from '@/components/persona/persona-editor';
import { EMPTY_PERSONA } from '@/lib/persona/schema';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PersonaEditor', () => {
  it('adds a pillar and saves the whole persona', async () => {
    const fetchMock = vi.fn(async (_u: string, init?: { body: string }) => ({ json: async () => ({ success: true, data: JSON.parse(init!.body) }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PersonaEditor initial={{ ...EMPTY_PERSONA, audience: '职场人' }} />);
    fireEvent.click(screen.getByText('＋ 加一个内容支柱'));
    fireEvent.change(screen.getByPlaceholderText('支柱名称，如：效率革命'), { target: { value: '翻车实测' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('已保存。之后新建的项目会用这份定位。')).toBeTruthy());
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body);
    expect(body).toMatchObject({ audience: '职场人', pillars: [{ name: '翻车实测', description: '' }] });
  });
  it('shows the server message when saving fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false, message: '内容支柱要有名称' }) })));
    render(<PersonaEditor initial={EMPTY_PERSONA} />);
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(screen.getByText('内容支柱要有名称')).toBeTruthy());
  });
});
