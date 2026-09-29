// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { PublishPane } from '@/components/project/publish-pane';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const state = (publishedAt: string) => ({ kit: null, work: { id: 'w1', text: '作品', publishedAt, viewCount: 0, likeCount: 0 }, candidate: null, retro: null, lessons: [] });

describe('PublishPane', () => {
  it('says data is not out yet when it is past day 3 without a retro', async () => {
    const five = new Date(Date.now() - 5 * 86400_000).toISOString();
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: state(five) }) })));
    render(<PublishPane projectId="p1" />);
    await waitFor(() => expect(screen.getByText('已发布 5 天，抖音的数据还没出来，今晚回采后会再试。也可以点「现在复盘」。')).toBeTruthy());
  });
  it('explains the day-3 schedule before day 3', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, data: state(new Date().toISOString()) }) })));
    render(<PublishPane projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/发布后第 3 天会自动复盘/)).toBeTruthy());
  });
});
