import { describe, expect, it } from 'vitest';
import { loadPools, pickCandidates, SEQUEL_HOOK, type Candidate, type CandidateStore } from '@/lib/topics/candidates';

const now = new Date('2026-10-09T15:00:00Z');
const c = (source: Candidate['source'], id: string): Candidate => ({ source, sourceId: id, material: id });

function store(over: Partial<CandidateStore> = {}): CandidateStore {
  return {
    usedKeys: async () => new Set<string>(),
    benchmarkHits: async () => [],
    ownWorks: async () => [],
    freshIdeas: async () => [],
    ...over,
  };
}

describe('pickCandidates', () => {
  it('takes one from each source first', () => {
    expect(pickCandidates({ benchmark: [c('benchmark', 'b1'), c('benchmark', 'b2')], sequel: [c('sequel', 's1')], idea: [c('idea', 'i1')] }).map((x) => x.sourceId)).toEqual(['b1', 's1', 'i1']);
  });
  it('fills from the other sources when one is empty', () => {
    expect(pickCandidates({ benchmark: [c('benchmark', 'b1'), c('benchmark', 'b2')], sequel: [], idea: [c('idea', 'i1'), c('idea', 'i2')] }).map((x) => x.sourceId)).toEqual(['b1', 'i1', 'b2']);
  });
  it('returns fewer than 3 or none when material runs out', () => {
    expect(pickCandidates({ benchmark: [], sequel: [c('sequel', 's1')], idea: [] })).toHaveLength(1);
    expect(pickCandidates({ benchmark: [], sequel: [], idea: [] })).toEqual([]);
  });
});

describe('loadPools', () => {
  it('ranks benchmark hits by ratio and drops used ones', async () => {
    const p = await loadPools(
      store({
        usedKeys: async () => new Set(['benchmark:b2']),
        benchmarkHits: async () => [
          { id: 'b1', ratio: 3, author: 'A', topic: 'AI 回消息', desc: 'x', transcript: '原文1' },
          { id: 'b2', ratio: 9, author: 'B', topic: '已用', desc: 'y', transcript: null },
          { id: 'b3', ratio: 5, author: 'C', topic: null, desc: '文案三', transcript: null },
        ],
      }),
      now,
    );
    expect(p.benchmark.map((x) => x.sourceId)).toEqual(['b3', 'b1']);
    expect(p.benchmark[1]).toMatchObject({ benchmarkVideoId: 'b1', reference: '原文1' });
  });
  it('picks sequels with a next-episode hook first, then strong performers', async () => {
    const p = await loadPools(
      store({
        ownWorks: async () => [
          { projectId: 'p1', title: '普通', lastText: '谢谢大家', play: 100 },
          { projectId: 'p2', title: '爆了', lastText: '谢谢', play: 900 },
          { projectId: 'p3', title: 'U盘', lastText: '值得单独来讲一期 账本我都给大家留着', play: 200 },
          { projectId: 'p4', title: '一般', lastText: '好', play: 150 },
        ],
      }),
      now,
    );
    expect(p.sequel.map((x) => x.sourceId)).toEqual(['p3', 'p2']);
  });
  it('ignores sequel projects with no script or transcript', async () => {
    const p = await loadPools(store({ ownWorks: async () => [{ projectId: 'p9', title: '空', lastText: null, play: 99999 }] }), now);
    expect(p.sequel).toEqual([]);
  });
  it('uses fresh ideas oldest first', async () => {
    const p = await loadPools(
      store({ freshIdeas: async () => [{ id: 'i2', text: '后写', createdAt: new Date('2026-10-08') }, { id: 'i1', text: '先写', createdAt: new Date('2026-10-01') }] }),
      now,
    );
    expect(p.idea.map((x) => x.material)).toEqual(['先写', '后写']);
  });
  it('recognises the hook words', () => {
    for (const t of ['下期讲', '下一期', '单独讲', '值得单独来讲一期', '下次说', '后面再说', '账本留着']) expect(SEQUEL_HOOK.test(t)).toBe(true);
    expect(SEQUEL_HOOK.test('谢谢大家')).toBe(false);
  });
  it('judges strong sequels against all recent works, not just the unused ones', async () => {
    const p = await loadPools(
      store({
        usedKeys: async () => new Set(['sequel:a', 'sequel:b']),
        ownWorks: async () => [
          { projectId: 'a', title: 'A', lastText: '好', play: 2000 },
          { projectId: 'b', title: 'B', lastText: '好', play: 2000 },
          { projectId: 'c', title: 'C', lastText: '好', play: 900 },
          { projectId: 'd', title: 'D', lastText: '好', play: 100 },
          { projectId: 'e', title: 'E', lastText: '好', play: 100 },
        ],
      }),
      now,
    );
    expect(p.sequel).toEqual([]);
  });
});
