import { describe, expect, it } from 'vitest';
import { FEED_ACCESS_ERROR, parseFeed, skipSelfReply } from '@/lib/sources/x';

const feed = (extra: Record<string, unknown>) => JSON.stringify({ schema_version: 1, posts: [], hot_topics: [], reddit_hot: [], ...extra });

describe('parseFeed', () => {
  it('丢掉互动很小的自回，留下有浏览的回复和原创', () => {
    const items = parseFeed(
      feed({
        posts: [
          { id: '1', handle: 'a', text: '原创帖', likes: 10, views: 1000 },
          { id: '2', handle: 'a', text: '碎碎念', likes: 1, views: 40, is_reply: true, category: 'self' },
          { id: '3', handle: 'a', text: '这条回复很多人看', likes: 20, views: 80_000, is_reply: true, category: 'ai_blogger' },
        ],
      }),
      new Date(),
    );
    expect(items.map((i) => i.outerId)).toEqual(['x:1', 'x:3']);
    expect(skipSelfReply({ is_reply: true, category: 'self', views: 40, likes: 1 })).toBe(true);
  });

  it('热度用浏览数；没有浏览数字才退回点赞', () => {
    const items = parseFeed(
      feed({
        posts: [
          { id: '1', handle: 'a', text: '有浏览', likes: 9, views: 100 },
          { id: '2', handle: 'a', text: '只有赞', likes: 7 },
        ],
      }),
      new Date(),
    );
    expect(items.find((i) => i.outerId === 'x:1')?.heat).toBe(100);
    expect(items.find((i) => i.outerId === 'x:2')?.heat).toBe(7);
  });

  it('hot_topics 并进 X，和帖子重复时只留一条', () => {
    const items = parseFeed(
      feed({
        posts: [{ id: '9', handle: 'a', text: '帖子版', views: 10 }],
        hot_topics: [{ id: '9', handle: 'a', text: '热点版', views: 20 }, { id: '8', handle: 'b', text: '只在热点里', views: 5 }],
      }),
      new Date(),
    );
    const ids = items.map((i) => i.outerId).sort();
    expect(ids).toEqual(['x:8', 'x:9']);
    expect(items.find((i) => i.outerId === 'x:9')?.title).toBe('热点版');
    expect(items.every((i) => i.provider === 'x')).toBe(true);
  });

  it('Reddit 单独成源，热度是 0，因为快照没有分数', () => {
    const items = parseFeed(
      feed({
        reddit_hot: [{ id: 't3_abc', subreddit: 'SideProject', topic: 'ai_money', title: 'I built a teleprompter', url: 'https://www.reddit.com/r/SideProject/comments/abc', summary: 'It follows your voice.' }],
      }),
      new Date(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].provider).toBe('reddit');
    expect(items[0].outerId).toBe('reddit:t3_abc');
    expect(items[0].heat).toBe(0);
    expect(items[0].summary).toContain('话题 ai_money');
    expect(items[0].summary).toContain('r/SideProject');
  });

  it('标题取正文第一行前 80 字', () => {
    const text = `第一行标题\n\n${'正文'.repeat(200)}`;
    const items = parseFeed(feed({ posts: [{ id: '5', handle: 'a', text, views: 3, url: 'https://x.com/a/status/5' }] }), new Date());
    expect(items[0].title).toBe('第一行标题');
    expect(items[0].summary!.length).toBeLessThanOrEqual(500);
  });

  it('纯链接不入库，坏 JSON 会抛', () => {
    const items = parseFeed(feed({ posts: [{ id: '1', handle: 'a', text: 'https://t.co/AbCdEf1234', views: 9 }] }), new Date());
    expect(items).toEqual([]);
    expect(() => parseFeed('not json', new Date())).toThrow();
  });
});

describe('私有仓库报错', () => {
  it('点名要设置的环境变量，不带令牌', () => {
    expect(FEED_ACCESS_ERROR).toMatch(/私有仓库/);
    expect(FEED_ACCESS_ERROR).toMatch(/X_FEED_TOKEN/);
    expect(FEED_ACCESS_ERROR).toMatch(/GITHUB_TOKEN/);
    expect(FEED_ACCESS_ERROR).toMatch(/X_FEED_PATH/);
    expect(FEED_ACCESS_ERROR).not.toMatch(/ghp_|github_pat_/);
  });
});
