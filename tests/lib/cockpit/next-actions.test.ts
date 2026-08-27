import { describe, expect, it } from 'vitest';
import { buildNextActions } from '@/lib/cockpit/next-actions';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1', title: '一条内容', stage: 'recording', platform: 'douyin',
    scriptDraftId: 'd1', updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  } as never;
}

describe('buildNextActions', () => {
  it('没有内容时返回空', () => {
    expect(buildNextActions([])).toEqual([]);
  });

  it('按阶段给出「下一步该做什么」的动作名, 而不是只报阶段', () => {
    // 用户要的是"我现在该干什么", 不是"这张卡处于 recording 阶段"
    const [a] = buildNextActions([card({ stage: 'recording' })]);
    expect(a.action).toMatch(/拍/);
  });

  it('每条都带可直接跳转的详情页链接', () => {
    const [a] = buildNextActions([card({ id: 'abc' })]);
    expect(a.href).toBe('/content/detail/abc');
  });

  it('已归档与已发布的不出现 —— 它们不需要推进', () => {
    const rows = buildNextActions([
      card({ id: 'a', stage: 'archived' }),
      card({ id: 'b', stage: 'publishing', publicationStatus: 'published' }),
      card({ id: 'c', stage: 'recording' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['c']);
  });

  it('越靠后的阶段排越前 —— 快完成的先收掉, 而不是让它一直挂着', () => {
    const rows = buildNextActions([
      card({ id: 'early', stage: 'topic' }),
      card({ id: 'late', stage: 'publishing' }),
      card({ id: 'mid', stage: 'editing' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['late', 'mid', 'early']);
  });

  it('同阶段内按最近更新排序', () => {
    const rows = buildNextActions([
      card({ id: 'old', stage: 'recording', updatedAt: '2026-08-01T00:00:00.000Z' }),
      card({ id: 'new', stage: 'recording', updatedAt: '2026-08-27T00:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('写稿阶段但还没有稿子 → 动作是「写稿」', () => {
    const [a] = buildNextActions([card({ stage: 'script', scriptDraftId: null })]);
    expect(a.action).toMatch(/写稿|写/);
  });

  it('写稿阶段且已有稿子 → 提示可以去拍了, 不让人卡在这一步', () => {
    // 真实踩过: 稿子写完了卡还停在 script, 用户不知道下一步该干嘛
    const [a] = buildNextActions([card({ stage: 'script', scriptDraftId: 'd1' })]);
    expect(a.action).toMatch(/拍|录/);
  });

  it('带上平台, 多平台时能一眼区分', () => {
    const [a] = buildNextActions([card({ platform: 'xiaohongshu' })]);
    expect(a.platform).toBe('xiaohongshu');
  });

  it('超过上限时截断, 首页不被几十条淹没', () => {
    const many = Array.from({ length: 30 }, (_, i) => card({ id: `c${i}` }));
    expect(buildNextActions(many).length).toBeLessThanOrEqual(8);
  });
});
