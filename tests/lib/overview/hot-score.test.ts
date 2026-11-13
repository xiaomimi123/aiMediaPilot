import { describe, expect, it } from 'vitest';
import { HOT_SCORE, scoreHot, type ScoreInput } from '@/lib/overview/hot-score';
import { parseFeedQuery, rankFeed, type FeedRow } from '@/lib/overview/feed';

const now = new Date(2026, 10, 13, 12, 0, 0);

const base = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  provider: 'github',
  title: 'deepseek agent tool',
  summary: null,
  url: 'https://github.com/a/b',
  heat: 100_000,
  seenAt: '2026-11-13',
  ...over,
});

describe('scoreHot', () => {
  it('uses only HOT_SCORE weights and they sum to 1', () => {
    const w = HOT_SCORE.weights;
    expect(w.heat + w.recency + w.fit + w.handsOn).toBeCloseTo(1);
  });

  it('matches the documented formula for a github repo at the star cap', () => {
    const s = scoreHot(base(), now);
    const recency = Math.round(100 * Math.exp((-Math.LN2 * 0.5) / HOT_SCORE.halfLifeDays) * 10) / 10;
    const w = HOT_SCORE.weights;
    const total = Math.round(100 * w.heat + recency * w.recency + 100 * w.fit + 100 * w.handsOn);
    expect(s.total).toBe(total);
    expect(s.parts.find((p) => p.key === 'heat')?.detail).toMatch(/不算增速/);
    expect(s.parts.find((p) => p.key === 'handsOn')?.value).toBe(100);
  });

  it('drops a missing heat field and renormalizes the other weights', () => {
    const s = scoreHot(base({ provider: 'sequel', heat: null, url: null, title: '下期讲定价' }), now);
    const heat = s.parts.find((p) => p.key === 'heat');
    expect(heat?.value).toBeNull();
    expect(heat?.applied).toBe(0);
    const present = s.parts.filter((p) => p.value != null);
    expect(present.reduce((sum, p) => sum + p.applied, 0)).toBeCloseTo(1);
    expect(s.parts.find((p) => p.key === 'heat')?.detail).toMatch(/不计入/);
  });

  it('scores a real zero instead of treating it as missing', () => {
    const s = scoreHot(base({ heat: 0, title: 'hello' }), now);
    expect(s.parts.find((p) => p.key === 'heat')?.value).toBe(0);
  });

  it('does not invent HN comments or X engagement', () => {
    const hn = scoreHot(base({ provider: 'hackernews', title: 'Show HN: a database', url: 'https://news.ycombinator.com/item?id=1', heat: 120 }), now);
    expect(hn.parts.find((p) => p.key === 'heat')?.detail).toMatch(/评论数没有入库/);
    const x = scoreHot(base({ provider: 'x', title: 'ship it', url: 'https://x.com/a/status/1', heat: 4000 }), now);
    expect(x.parts.find((p) => p.key === 'heat')?.detail).toMatch(/浏览/);
    expect(x.parts.find((p) => p.key === 'heat')?.detail).toMatch(/不算增速/);
    const reddit = scoreHot(base({ provider: 'reddit', title: 'ai tool for money', url: 'https://www.reddit.com/r/x', heat: 0 }), now);
    expect(reddit.parts.find((p) => p.key === 'heat')?.value).toBeNull();
    expect(reddit.parts.find((p) => p.key === 'heat')?.detail).toMatch(/没有赞/);
    expect(x.parts.find((p) => p.key === 'handsOn')?.value).toBe(0);
  });

  it('gives an older row a lower recency score', () => {
    const fresh = scoreHot(base(), now).parts.find((p) => p.key === 'recency')!.value!;
    const old = scoreHot(base({ seenAt: '2026-11-07' }), now).parts.find((p) => p.key === 'recency')!.value!;
    expect(old).toBeLessThan(fresh);
  });

  it('ranks an AI tool repo above an unrelated post with no track words', () => {
    const tool = scoreHot(base({ heat: 800, title: 'openai agent cli' }), now).total;
    const other = scoreHot(base({ provider: 'hackernews', heat: 400, title: 'city council minutes', url: 'https://example.com', seenAt: '2026-11-13' }), now).total;
    expect(tool).toBeGreaterThan(other);
  });
});

const row = (over: Partial<FeedRow> & Pick<FeedRow, 'key'>): FeedRow => ({
  kind: 'source',
  refId: over.key,
  dailyId: null,
  provider: 'github',
  sourceLabel: 'GitHub',
  title: over.key,
  why: null,
  url: null,
  heat: 10,
  heatLabel: '10 stars',
  seenAt: '2026-11-13',
  seenLabel: '今天',
  statusKey: 'fresh',
  status: '还没写',
  fit: '适合抖音口播',
  score: { total: 10, parts: [] },
  canAdopt: false,
  ...over,
});

describe('rankFeed', () => {
  const rows = [
    row({ key: 'new-gh', provider: 'github', heat: 100, score: { total: 40, parts: [] }, seenAt: '2026-11-13' }),
    row({ key: 'old-hn', provider: 'hackernews', heat: 3000, score: { total: 90, parts: [] }, seenAt: '2026-11-01', title: 'Show HN: robots' }),
    row({ key: 'used', provider: 'github', statusKey: 'used', heat: 50, score: { total: 70, parts: [] }, seenAt: '2026-11-13' }),
    row({ key: 'gone', provider: 'x', statusKey: 'dismissed', heat: 9, score: { total: 99, parts: [] }, seenAt: '2026-11-13' }),
  ];
  const q = parseFeedQuery({});

  it('keeps every row when no filter is set, including old and used ones', () => {
    expect(rankFeed(rows, q, now).map((r) => r.key)).toEqual(['gone', 'old-hn', 'used', 'new-gh']);
  });

  it('can hide dismissed rows without applying a day window or a take limit', () => {
    const open = rankFeed(rows, { ...q, status: 'open' }, now);
    expect(open.map((r) => r.key)).not.toContain('gone');
    expect(open).toHaveLength(3);
  });

  it('filters by source, search, and a time range', () => {
    expect(rankFeed(rows, { ...q, source: 'hackernews' }, now).map((r) => r.key)).toEqual(['old-hn']);
    expect(rankFeed(rows, { ...q, q: 'robots' }, now).map((r) => r.key)).toEqual(['old-hn']);
    expect(rankFeed(rows, { ...q, range: '3' }, now).map((r) => r.key)).not.toContain('old-hn');
  });

  it('sorts by raw heat without mixing that into a cutoff', () => {
    expect(rankFeed(rows, { ...q, sort: 'heat' }, now).map((r) => r.key)[0]).toBe('old-hn');
  });
});
