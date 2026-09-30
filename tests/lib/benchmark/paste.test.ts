import { describe, expect, it, vi } from 'vitest';
import { handlePaste } from '@/lib/benchmark/paste';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { ParsedWork } from '@/lib/benchmark/parse';

const now = new Date('2026-09-28T12:00:00Z');
const work: ParsedWork = { awemeId: '7676819001574157481', desc: 'd', url: 'u', publishedAt: now, durationSec: 60, digg: 1, comment: 0, collect: 0, share: 0, isTop: false, playUrls: ['u'], authorSecUid: 'MS4wA', authorName: '园长说AI' };

function deps(store = createMemoryStore()) {
  return { store, client: { fetchDetail: vi.fn(async () => work), fetchAccount: vi.fn() }, enqueue: vi.fn(() => true), now: () => now };
}

describe('handlePaste', () => {
  it('fetches, stores and queues a new video', async () => {
    const d = deps();
    const r = await handlePaste(d, { kind: 'video', awemeId: work.awemeId });
    expect(r.kind).toBe('video');
    expect(d.client.fetchDetail).toHaveBeenCalledTimes(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
    expect(d.store.videos[0]).toMatchObject({ analysisStatus: 'running' });
  });
  it('does not touch douyin again for a video already analyzed or being analyzed', async () => {
    const d = deps();
    await handlePaste(d, { kind: 'video', awemeId: work.awemeId });
    await d.store.updateVideo(d.store.videos[0].id, { analysisStatus: 'done' });
    const r = await handlePaste(d, { kind: 'video', awemeId: work.awemeId });
    expect(r).toEqual({ kind: 'video', videoId: d.store.videos[0].id });
    expect(d.client.fetchDetail).toHaveBeenCalledTimes(1);
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });
  it('rejects a work without an author id', async () => {
    const d = deps();
    d.client.fetchDetail.mockResolvedValueOnce({ ...work, authorSecUid: '' });
    await expect(handlePaste(d, { kind: 'video', awemeId: work.awemeId })).rejects.toThrow('读不到这条作品的博主');
  });
});
