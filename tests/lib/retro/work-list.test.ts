import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { pairWorkListPage } from '@/lib/retro/work-list';

// 用 JSON.parse 读: 与浏览器里一样, items[].id 这个大数字会丢精度
const page = JSON.parse(fs.readFileSync('tests/fixtures/douyin/work-list.json', 'utf8'));

describe('pairWorkListPage', () => {
  it('pairs items with aweme_list by index and ignores the broken numeric id', () => {
    const r = pairWorkListPage(page);
    expect(r.skipped).toBe(0);
    expect(r.hasMore).toBe(true);
    expect(r.rows[0].awemeId).toBe('7537605160290684170');
    expect(r.rows[0].metrics).toMatchObject({ viewCount: 2908, likeCount: 66, completionRate: 0.093687, completionRate5s: 0.502216, bounceRate2s: 0.265879, avgViewSec: 10.378139 });
    expect(r.rows[0].metrics.metricsUpdatedAt?.toISOString()).toBe('2025-11-09T16:00:00.000Z');
  });
  it('skips rows whose create_time does not match', () => {
    const broken = { ...page, items: page.items.map((it: { create_time: number }, i: number) => (i === 1 ? { ...it, create_time: 1 } : it)) };
    const r = pairWorkListPage(broken);
    expect(r.skipped).toBe(1);
    expect(r.rows.map((x) => x.awemeId)).not.toContain('7678813842822871926');
  });
  it('stores null (not 0) for missing or non-numeric metrics', () => {
    const p = { ...page, items: [{ ...page.items[0], metrics: { view_count: '-', like_count: '' } }], aweme_list: [page.aweme_list[0]] };
    expect(pairWorkListPage(p).rows[0].metrics).toMatchObject({ viewCount: null, likeCount: null, completionRate: null });
  });
});

describe('fixture privacy (public repo)', () => {
  it('keeps no captions of private works', () => {
    const priv = page.aweme_list.filter((a: { status: { is_private: boolean; self_see: boolean } }) => a.status.is_private || a.status.self_see);
    expect(priv.length).toBeGreaterThan(0);
    for (const a of priv) expect(a.desc).toBe('（私密作品）');
    for (const it of page.items) expect(['（私密作品）', ...page.aweme_list.map((a: { desc: string }) => a.desc)]).toContain(it.description);
  });
});
