import { describe, expect, it } from 'vitest';
import post from '../../fixtures/douyin/post.json';
import profile from '../../fixtures/douyin/profile.json';
import detail from '../../fixtures/douyin/detail.json';
import search from '../../fixtures/douyin/search.json';
import { parseWorks, parseDetail, parseProfile, parseUserSearch, DouyinRejectedError } from '@/lib/benchmark/parse';

describe('parseWorks', () => {
  it('parses stats, dates and play urls', () => {
    const { works, hasMore } = parseWorks(post);
    expect(hasMore).toBe(true);
    const w = works.find((x) => x.awemeId === '7686854197597293859')!;
    expect(w).toMatchObject({ digg: 28149, durationSec: 179, isTop: false, url: 'https://www.douyin.com/video/7686854197597293859', authorName: '园长说AI' });
    expect(w.publishedAt.toISOString()).toBe('2026-09-19T04:01:57.000Z');
    expect(w.playUrls).toHaveLength(2);
  });
  it('skips image posts', () => {
    expect(parseWorks(post).works.map((w) => w.awemeId)).not.toContain('7690000000000000002');
  });
  it('keeps a pinned work but marks it', () => {
    expect(parseWorks(post).works.find((w) => w.awemeId === '7600000000000000001')?.isTop).toBe(true);
  });
  it('rejects a non-zero status_code', () => {
    expect(() => parseWorks({ status_code: 8, aweme_list: [] })).toThrow(DouyinRejectedError);
    expect(() => parseWorks('<html>')).toThrow(DouyinRejectedError);
  });
});

describe('parseProfile / parseDetail / parseUserSearch', () => {
  it('reads followers and likes from the profile', () => {
    expect(parseProfile(profile)).toMatchObject({ nickname: '园长说AI', douyinId: 'Sq19980929', followers: 989815, totalLikes: 22437371 });
  });
  it('reads a single work', () => {
    expect(parseDetail(detail)).toMatchObject({ awemeId: '7676819001574157481', digg: 23417, authorName: '园长说AI' });
  });
  it('reads search results, using short_id when unique_id is empty', () => {
    const users = parseUserSearch(search);
    expect(users).toHaveLength(3);
    expect(users[0]).toMatchObject({ nickname: 'AI课代表小明', followers: 2182666 });
    expect(users[0].secUid).toMatch(/^MS4w/);
  });
});
