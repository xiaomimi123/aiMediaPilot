// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: () => {} }) }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OwnScript } from '@/components/topics/own-script';
import { splitOriginal } from '@/lib/script/polish';
import { checkDuration } from '@/lib/script/duration';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const original = '我是一名程序员。两年半前开始用AI写代码。做了个小工具。结果库存清空了。后来先写测试。我擅长描述问题。';
const polished = splitOriginal('我是程序员。两年半前开始用AI写代码。做了个小工具。库存清空了。后来先写测试。我擅长描述问题。');

function stub(polishOk = true) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      calls.push({ url, body });
      if (url === '/api/scripts/polish') return { json: async () => (polishOk ? { success: true, data: { title: '两年半', script: polished, report: checkDuration(polished, 75), changes: [{ kind: '删', what: '删了「一名」' }], questions: [], added: [] } } : { success: false, message: '还没有可用的模型' }) };
      if (url === '/api/projects') return { json: async () => ({ success: true, data: { id: 'p9' } }) };
      return { json: async () => ({ success: true, data: {} }) };
    }),
  );
  return calls;
}

async function fill() {
  fireEvent.click(screen.getByText('我自己写了一篇'));
  fireEvent.change(screen.getByPlaceholderText('标题（可不填）'), { target: { value: '两年半' } });
  fireEvent.change(screen.getByPlaceholderText(/贴上你写的口播稿/), { target: { value: original } });
}

describe('OwnScript', () => {
  it('polishes, then creates a project from the polished version and saves the original as a sample', async () => {
    const calls = stub();
    render(<OwnScript />);
    await fill();
    fireEvent.click(screen.getByText('润色'));
    await waitFor(() => expect(screen.getByText('删：删了「一名」')).toBeTruthy());
    expect(calls[0]).toEqual({ url: '/api/scripts/polish', body: { text: original, targetSec: 75 } });
    fireEvent.click(screen.getByText('用润色版建作品'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p9'));
    expect(calls.find((c) => c.url === '/api/projects')?.body).toEqual({ title: '两年半', script: polished, targetSec: 75, voiceSampleText: original });
    expect(calls.find((c) => c.url === '/api/projects/p9/predictions')?.body).toEqual({ kind: 'draft' });
  });
  it('creates a project from the original split into 6 beats without polishing', async () => {
    const calls = stub();
    render(<OwnScript />);
    await fill();
    fireEvent.click(screen.getByText('用原文建作品'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/projects/p9'));
    expect(calls.find((c) => c.url === '/api/projects')?.body).toEqual({ title: '两年半', script: splitOriginal(original), targetSec: 75, voiceSampleText: original });
  });
  it('keeps the original and shows why when polishing fails', async () => {
    stub(false);
    render(<OwnScript />);
    await fill();
    fireEvent.click(screen.getByText('润色'));
    await waitFor(() => expect(screen.getByText('还没有可用的模型')).toBeTruthy());
    expect((screen.getByPlaceholderText(/贴上你写的口播稿/) as HTMLTextAreaElement).value).toBe(original);
  });
});
