import { describe, expect, it, vi } from 'vitest';
import { suggestTopics } from '@/lib/benchmark/suggest';
import { createMemoryStore } from '../../helpers/benchmark-store';
import type { StructuredLLM } from '@/lib/script/write';

const now = new Date('2026-09-28T12:00:00Z');

async function storeWithHits(n: number) {
  const store = createMemoryStore();
  const acc = await store.upsertAccount({ secUid: 'MS4wA', nickname: '园长说AI', douyinId: '', avatarUrl: '', bio: '', followers: 0, totalLikes: 0 }, { status: 'following', source: 'manual' });
  for (let i = 0; i < n; i++) {
    const v = await store.upsertVideo(acc.id, { awemeId: `7${i}00000000`, desc: `爆款${i}`, url: 'u', publishedAt: new Date(now.getTime() - (i + 1) * 86400_000), durationSec: 60, digg: 9000, comment: 0, collect: 0, share: 0, isTop: false, playUrls: [], authorSecUid: '', authorName: '' }, now);
    await store.updateVideo(v.id, { isHit: true, ratio: 4, hitAt: now });
  }
  return store;
}

describe('suggestTopics', () => {
  it('refuses without calling the model when there are fewer than 2 recent hits', async () => {
    const llm = { callStructured: vi.fn() } as unknown as StructuredLLM;
    const r = await suggestTopics({ store: await storeWithHits(1), llm, personaText: '', myTopTitles: [], now });
    expect(r).toEqual({ ok: false, reason: '近 14 天对标里只有 1 条爆款，数据太少挑不出靠谱的选题。先在「选题」页多关注几个对标账号，等巡检跑几晚再来。' });
    expect(llm.callStructured).not.toHaveBeenCalled();
  });
  it('drops topics whose sources are not in the input', async () => {
    const store = await storeWithHits(3);
    const ids = store.videos.map((v) => v.id);
    const llm = {
      callStructured: vi.fn(async () => ({
        result: {
          topics: [
            { topic: 'A', why: '对上效率革命', hook: '你还在手动…', sourceVideoIds: [ids[0]] },
            { topic: '编的热点', why: 'x', hook: 'y', sourceVideoIds: ['not-a-real-id'] },
            { topic: 'C', why: 'z', hook: 'w', sourceVideoIds: [ids[1], 'fake'] },
          ],
        },
        usage: {},
      })),
    } as unknown as StructuredLLM;
    const r = await suggestTopics({ store, llm, personaText: '支柱：效率革命', myTopTitles: ['我的爆款'], now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.topics.map((t) => t.topic)).toEqual(['A', 'C']);
    expect(r.topics[1].sources.map((s) => s.id)).toEqual([ids[1]]);
    expect(r.topics[0].sources[0]).toMatchObject({ author: '园长说AI', ratio: 4 });
  });
});
