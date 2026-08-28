import { describe, it, expect } from 'vitest';
import { extractAwemeId } from '@/lib/works/match';

describe('extractAwemeId', () => {
  it('抖音分享链接: 取路径里的 id', () => {
    expect(extractAwemeId('https://www.douyin.com/video/7678813842822871926')).toBe('7678813842822871926');
  });

  it('图文(note)链接同样认', () => {
    expect(extractAwemeId('https://www.iesdouyin.com/share/note/7678486298110291947/?region=')).toBe('7678486298110291947');
  });

  it('**不能认成 mid** —— 真实链接里 mid 是另一个 19 位 id, 抓错了会关联到别的作品', () => {
    const url = 'https://www.iesdouyin.com/share/video/7678813842822871926/?region=&mid=7678664601831017268&u_code=x';
    expect(extractAwemeId(url)).toBe('7678813842822871926');
  });

  it('带查询串和结尾斜杠都不影响', () => {
    expect(extractAwemeId('https://www.iesdouyin.com/share/video/7616215133471631721/?a=1&b=2')).toBe('7616215133471631721');
  });

  it('短链接抽不出 id —— 它要跳转才知道是哪条, 老实返回 null', () => {
    expect(extractAwemeId('https://v.douyin.com/iRNBho6/')).toBeNull();
  });

  it('不是链接、空串、乱七八糟的都返回 null, 不抛', () => {
    expect(extractAwemeId('')).toBeNull();
    expect(extractAwemeId('随便写点什么')).toBeNull();
    expect(extractAwemeId('https://example.com/')).toBeNull();
  });

  it('位数不够的数字不算作品 id —— 别把 /video/123 认成一条作品', () => {
    expect(extractAwemeId('https://www.douyin.com/video/123')).toBeNull();
  });

  it('直接给一串纯 id 也认 —— 从后台复制出来的常常就是 id', () => {
    expect(extractAwemeId('7678813842822871926')).toBe('7678813842822871926');
  });
});

import { linkWorkByAwemeId } from '@/lib/works/match';

function fakeDb(work: { id: string; scriptDraftId: string | null } | null) {
  const updates: unknown[] = [];
  return {
    updates,
    db: {
      publishedWork: {
        findFirst: async () => work,
        update: async (args: unknown) => { updates.push(args); return {}; },
      },
    },
  };
}

describe('linkWorkByAwemeId', () => {
  it('作品已回采且没认领过 → 关联上', async () => {
    const { db, updates } = fakeDb({ id: 'w1', scriptDraftId: null });
    expect(await linkWorkByAwemeId(db, 'u1', '7678813842822871926', 'd1')).toBe('linked');
    expect(updates).toHaveLength(1);
  });

  it('**不覆盖已有的关联** —— 自动匹配是便利, 不该悄悄改掉人手动做的判断', async () => {
    const { db, updates } = fakeDb({ id: 'w1', scriptDraftId: '别的稿子' });
    expect(await linkWorkByAwemeId(db, 'u1', '7678813842822871926', 'd1')).toBe('already-linked');
    expect(updates).toHaveLength(0);
  });

  it('还没回采到 → 如实说, 让调用方能提示「等今晚回采」', async () => {
    const { db, updates } = fakeDb(null);
    expect(await linkWorkByAwemeId(db, 'u1', '7678813842822871926', 'd1')).toBe('not-collected-yet');
    expect(updates).toHaveLength(0);
  });
});
