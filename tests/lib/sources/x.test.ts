import { describe, expect, it } from 'vitest';
import { parseFeed } from '@/lib/sources/x';

const makeFeed = (posts: Record<string, unknown>[]) => JSON.stringify({ schema_version: 1, posts });

describe('parseFeed（x-workbench-feed latest.json）', () => {
  it('滤掉回复帖, 只留原创', () => {
    const items = parseFeed(
      makeFeed([
        { id: '1', handle: 'a', text: '原创帖', likes: 10, views: 1000 },
        { id: '2', handle: 'a', text: '这是回复', likes: 9999, is_reply: true },
      ]),
      new Date(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].outerId).toBe('x:1');
  });

  it('热度用浏览数, 没浏览退回点赞, 并按热度降序取前 30', () => {
    const posts = Array.from({ length: 35 }, (_, i) => ({ id: String(i), handle: 'a', text: `帖子${i}`, likes: i, views: (i + 1) * 100 }));
    const items = parseFeed(makeFeed(posts), new Date());
    expect(items).toHaveLength(30);
    expect(items[0].heat).toBe(3500);
    expect(items[0].outerId).toBe('x:34');
  });

  it('没浏览也没点赞的帖子热度为 0 但保留', () => {
    const items = parseFeed(makeFeed([{ id: '9', handle: 'a', text: '没人看的帖' }]), new Date());
    expect(items).toHaveLength(1);
    expect(items[0].heat).toBe(0);
    expect(items[0].url).toBe('https://x.com/a/status/9');
  });

  it('标题取正文压缩空白后前 80 字, 全文进 summary', () => {
    const text = `第一行标题\n\n${'正文'.repeat(200)}`;
    const items = parseFeed(makeFeed([{ id: '5', handle: 'a', text, likes: 3, url: 'https://x.com/a/status/5' }]), new Date());
    expect(items[0].title).toBe('第一行标题');
    expect(items[0].summary!.length).toBeLessThanOrEqual(500);
    expect(items[0].summary).toContain('正文');
  });

  it('空 posts / 坏 JSON 的处理', () => {
    expect(parseFeed(makeFeed([]), new Date())).toEqual([]);
    expect(() => parseFeed('not json', new Date())).toThrow();
  });
});

describe('纯链接帖过滤', () => {
  it('正文只有链接的帖子不入库', () => {
    const items = parseFeed(
      makeFeed([
        { id: '1', handle: 'a', text: 'https://t.co/AbCdEf1234', likes: 500, views: 90000 },
        { id: '2', handle: 'a', text: '看看这个 https://t.co/xyz 链接前面有话', likes: 1 },
      ]),
      new Date(),
    );
    expect(items.map((i) => i.outerId)).toEqual(['x:2']);
  });
});
