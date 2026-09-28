import { describe, expect, it } from 'vitest';
import { applyAccountWorks } from '@/lib/benchmark/scan';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { ParsedProfile, ParsedWork } from '@/lib/benchmark/parse';

const now = new Date('2026-09-28T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400_000);
const profile: ParsedProfile = { secUid: 'MS4wA', nickname: '园长说AI', douyinId: 'x', avatarUrl: '', bio: '', followers: 1, totalLikes: 2 };
const work = (id: string, digg: number, d: number): ParsedWork => ({
  awemeId: id, desc: `作品${id}`, url: `https://www.douyin.com/video/${id}`, publishedAt: daysAgo(d), durationSec: 60,
  digg, comment: 1, collect: 1, share: 1, isTop: false, playUrls: ['u'], authorSecUid: 'MS4wA', authorName: '园长说AI',
});

describe('applyAccountWorks', () => {
  it('stores works, computes the baseline and reports new hits once', async () => {
    const store = createMemoryStore();
    const acc = await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    const works = [work('1', 1000, 1), work('2', 1200, 5), work('3', 900, 9), work('4', 5000, 2)];
    const r1 = await applyAccountWorks(store, acc, profile, works, now);
    expect(r1.newWorks).toBe(4);
    expect(r1.newHits.map((v) => v.awemeId)).toEqual(['4']);
    expect(store.accounts[0].baselineDigg).toBe(1100);
    expect(store.accounts[0].lastCheckedAt).toEqual(now);
    const hit = store.videos.find((v) => v.awemeId === '4')!;
    expect(hit).toMatchObject({ isHit: true, ratio: 4.5, hitAt: now });
    const r2 = await applyAccountWorks(store, acc, profile, works, new Date(now.getTime() + 86400_000));
    expect(r2.newWorks).toBe(0);
    expect(r2.newHits).toEqual([]);
    expect(store.videos.find((v) => v.awemeId === '4')!.hitAt).toEqual(now);
  });
  it('upsertAccount keeps an existing status', async () => {
    const store = createMemoryStore();
    await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    const again = await store.upsertAccount({ ...profile, followers: 99 }, { status: 'candidate', source: 'search', searchKeyword: 'AI' });
    expect(again).toMatchObject({ status: 'following', source: 'manual', followers: 99 });
    expect(store.accounts).toHaveLength(1);
  });
  it('upsertAccount does not wipe known profile fields with empty ones (pasted video link)', async () => {
    const store = createMemoryStore();
    await store.upsertAccount(profile, { status: 'following', source: 'manual' });
    await store.upsertAccount({ ...profile, followers: 0, totalLikes: 0, avatarUrl: '', bio: '', douyinId: '' }, { status: 'candidate', source: 'link' });
    expect(store.accounts[0]).toMatchObject({ followers: 1, totalLikes: 2, douyinId: 'x' });
  });
});
