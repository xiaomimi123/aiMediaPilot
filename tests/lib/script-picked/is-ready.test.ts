import { describe, expect, it } from 'vitest';
import {
  isReady,
  checkedCount,
  totalRequiredCount,
  emptyPicked,
} from '@/lib/script-picked/types';

describe('isReady 抖音', () => {
  it('空 → false', () => {
    expect(isReady('douyin', emptyPicked())).toBe(false);
  });
  it('只选 title → false (还要 hook + cover)', () => {
    expect(isReady('douyin', { titleIdx: 0, reviewed: {} })).toBe(false);
  });
  it('title + hook 选, cover 未勾 → false', () => {
    expect(isReady('douyin', { titleIdx: 0, hookIdx: 1, reviewed: {} })).toBe(false);
  });
  it('全选 → true', () => {
    expect(isReady('douyin', { titleIdx: 0, hookIdx: 1, reviewed: { cover: true } })).toBe(true);
  });
});

describe('isReady 小红书', () => {
  it('空 → false', () => {
    expect(isReady('xiaohongshu', emptyPicked())).toBe(false);
  });
  it('选 title 但 sections 全空 → false', () => {
    expect(isReady('xiaohongshu', { titleIdx: 0, reviewed: {} })).toBe(false);
  });
  it('选 title + 部分 sections → false', () => {
    expect(
      isReady('xiaohongshu', {
        titleIdx: 0,
        reviewed: { coverText: true, intro: true, body: true }, // 缺 tags + shotIdeas
      })
    ).toBe(false);
  });
  it('全勾 → true (小红书无 hookIdx 要求)', () => {
    expect(
      isReady('xiaohongshu', {
        titleIdx: 0,
        reviewed: { coverText: true, intro: true, body: true, tags: true, shotIdeas: true },
      })
    ).toBe(true);
  });
});

describe('isReady 公众号', () => {
  it('全勾 → true', () => {
    expect(
      isReady('gongzhonghao', {
        titleIdx: 0,
        reviewed: { abstract: true, outline: true, body: true, cta: true },
      })
    ).toBe(true);
  });
  it('缺 cta → false', () => {
    expect(
      isReady('gongzhonghao', {
        titleIdx: 0,
        reviewed: { abstract: true, outline: true, body: true },
      })
    ).toBe(false);
  });
});

describe('counters', () => {
  it('douyin: 总需 5 (titleIdx + hookIdx + cover)', () => {
    expect(totalRequiredCount('douyin')).toBe(3);
  });
  it('xiaohongshu: 总需 6 (titleIdx + 5 sections)', () => {
    expect(totalRequiredCount('xiaohongshu')).toBe(6);
  });
  it('gongzhonghao: 总需 5 (titleIdx + 4 sections)', () => {
    expect(totalRequiredCount('gongzhonghao')).toBe(5);
  });
  it('checkedCount 累计正确', () => {
    expect(checkedCount('xiaohongshu', { titleIdx: 0, reviewed: { coverText: true, body: true } })).toBe(3);
  });
});
