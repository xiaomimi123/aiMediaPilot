// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceSamplesCard } from '@/components/settings/voice-samples-card';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sample = { id: 'v1', title: '两年半', text: '我是一名 vibe coding 的程序员'.repeat(5), source: 'own_script', createdAt: '2026-10-09T00:00:00Z' };

function stub(list: unknown[]) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return { json: async () => ({ success: true, data: method === 'GET' ? list : {} }) };
    }),
  );
  return calls;
}

describe('VoiceSamplesCard', () => {
  it('lists title, source and the first 60 characters', async () => {
    stub([sample]);
    render(<VoiceSamplesCard />);
    await waitFor(() => expect(screen.getByText('两年半')).toBeTruthy());
    expect(screen.getByText('自己写的')).toBeTruthy();
    expect(screen.getByText(`${sample.text.slice(0, 60)}…`)).toBeTruthy();
  });

  it('adds a sample', async () => {
    const calls = stub([]);
    render(<VoiceSamplesCard />);
    await waitFor(() => expect(screen.getByText(/还没有说话样本/)).toBeTruthy());
    fireEvent.click(screen.getByText('加一篇'));
    fireEvent.change(screen.getByPlaceholderText('标题（可不填）'), { target: { value: '标题' } });
    fireEvent.change(screen.getByPlaceholderText(/贴一篇你自己写的口播/), { target: { value: '正文' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/voice-samples', body: { title: '标题', text: '正文' } });
  });

  it('confirms in the page before deleting', async () => {
    const calls = stub([sample]);
    render(<VoiceSamplesCard />);
    await waitFor(() => expect(screen.getByText('两年半')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('删除样本 两年半'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByText('确定删除'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/voice-samples/v1')).toBe(true));
  });
});
