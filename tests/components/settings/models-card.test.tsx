// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ModelsCard } from '@/components/settings/models-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const models = [
  { id: 'a', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyMasked: '…abcd', isActive: true, lastTest: { grade: 'able_agent', message: '能当编导：连通、工具调用、结构化输出都正常。', at: '', reachable: true, tools: true, json: true } },
  { id: 'b', name: 'Ollama（本地）', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5', keyMasked: '（无）', isActive: false, lastTest: { grade: 'analysis_only', message: '只能做分析：…', at: '', reachable: true, tools: false, json: true } },
];

function stub(extra: (url: string, init?: { method?: string }) => unknown = () => null) {
  const f = vi.fn(async (url: string, init?: { method?: string }) => ({ json: async () => extra(url, init) ?? { success: true, data: { models, presets: [{ key: 'claude', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }] } } }));
  vi.stubGlobal('fetch', f);
  return f;
}

describe('ModelsCard', () => {
  it('lists models with masked keys, the active mark and test grade', async () => {
    stub();
    render(<ModelsCard />);
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy());
    expect(screen.getByText('当前使用')).toBeTruthy();
    expect(screen.getByText('能当编导')).toBeTruthy();
    expect(screen.getByText('只能做分析')).toBeTruthy();
    expect(screen.getByText(/…abcd/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('sk-');
  });
  it('asks before activating a model that cannot be the director', async () => {
    const f = stub();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<ModelsCard />);
    await waitFor(() => expect(screen.getByText('Ollama（本地）')).toBeTruthy());
    fireEvent.click(screen.getAllByText('设为当前')[0]);
    expect(confirm).toHaveBeenCalledWith('这个模型写稿改稿会失败（只能做分析），确定切换吗？');
    expect(f.mock.calls.some((c) => String(c[0]).includes('/activate'))).toBe(false);
  });
  it('lets the film model be switched between Opus and Sonnet', async () => {
    const f = stub((url, init) => (url === '/api/settings/film-model' ? { success: true, data: { model: init?.method === 'PUT' ? 'sonnet' : 'opus' } } : null));
    render(<ModelsCard />);
    const sel = (await screen.findByLabelText('出片模型')) as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe('opus'));
    fireEvent.change(sel, { target: { value: 'sonnet' } });
    await waitFor(() => expect(f.mock.calls.some((c) => c[0] === '/api/settings/film-model' && (c[1] as { method?: string; body?: string })?.method === 'PUT' && (c[1] as { body?: string }).body === JSON.stringify({ model: 'sonnet' }))).toBe(true));
    await waitFor(() => expect(sel.value).toBe('sonnet'));
  });
});

