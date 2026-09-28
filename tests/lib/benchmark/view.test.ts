import { describe, expect, it } from 'vitest';
import { toVideoView, staleRunning } from '@/lib/benchmark/view';
import type { VideoRow } from '@/lib/benchmark/store';

const row: VideoRow = {
  id: 'v1', awemeId: '7', accountId: 'a1', desc: 'd', url: 'u', publishedAt: new Date('2026-09-20T00:00:00Z'), durationSec: 60,
  digg: 9000, comment: 1, collect: 2, share: 3, ratio: 4.5, isHit: true, hitAt: null, status: 'new',
  analysisStatus: 'running', analysisError: null, transcript: null, analysis: { bad: true }, analyzedAt: null, fetchedAt: new Date(),
};

describe('toVideoView', () => {
  it('marks a stale running analysis as failed', () => {
    expect(staleRunning(row, false)).toBe(true);
    expect(toVideoView(row, '园长说AI', false)).toMatchObject({ analysisStatus: 'failed', analysisError: '拆解被服务重启打断了，点重试。' });
  });
  it('keeps running while the queue has it, and drops invalid analysis', () => {
    const v = toVideoView(row, '园长说AI', true);
    expect(v).toMatchObject({ analysisStatus: 'running', author: '园长说AI', publishedAt: '2026-09-20T00:00:00.000Z' });
    expect(v.analysis).toBeNull();
  });
});

describe('listQuery', () => {
  it("'all' also includes older works that were analyzed (e.g. pasted links)", async () => {
    const { listQuery } = await import('@/lib/benchmark/view');
    const { createMemoryStore } = await import('../../helpers/benchmark-store');
    const store = createMemoryStore();
    const acc = await store.upsertAccount({ secUid: 'MS4wA', nickname: 'x', douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 }, { status: 'following', source: 'manual' });
    const now = new Date('2026-09-28T12:00:00Z');
    const mk = async (id: string, daysAgo: number, analysisStatus: string) => {
      const v = await store.upsertVideo(acc.id, { awemeId: id, desc: id, url: 'u', publishedAt: new Date(now.getTime() - daysAgo * 86400_000), durationSec: 1, digg: 1, comment: 0, collect: 0, share: 0, isTop: false, playUrls: [], authorSecUid: '', authorName: '' }, now);
      await store.updateVideo(v.id, { analysisStatus });
    };
    await mk('recent', 3, 'none');
    await mk('old-pasted', 40, 'done');
    await mk('old-plain', 40, 'none');
    const ids = (await store.listVideos(listQuery('all', now))).map((v) => v.awemeId);
    expect(ids).toEqual(['recent', 'old-pasted']);
  });
});
