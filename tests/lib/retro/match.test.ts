import { describe, expect, it } from 'vitest';
import { pickCandidate, scoreMatch } from '@/lib/retro/match';

const filmAt = new Date('2026-09-28T10:00:00Z');
const kitText = 'U盘干到品类第一 #AI工具 #副业';
const w = (id: string, hours: number, text: string, over: object = {}) => ({ id, publishedAt: new Date(filmAt.getTime() + hours * 3600_000), text, isPrivate: false, projectId: null, matchDismissed: false, ...over });

describe('match', () => {
  it('scores zero for works published before the film', () => {
    expect(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() - 60_000), text: kitText })).toBe(0);
  });
  it('prefers text overlap and recency', () => {
    expect(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() + 3600_000), text: kitText })).toBeGreaterThan(scoreMatch({ filmAt, kitText }, { publishedAt: new Date(filmAt.getTime() + 3600_000), text: '今天吃了火锅' }));
  });
  it('picks the best public, unlinked, not dismissed work above the threshold', () => {
    const works = [w('a', 2, '今天吃了火锅'), w('b', 5, 'U盘干到品类第一 就靠笨办法 #AI工具'), w('c', 1, kitText, { isPrivate: true }), w('d', 1, kitText, { projectId: 'other' })];
    expect(pickCandidate({ filmAt, kitText }, works)).toBe('b');
  });
  it('does not suggest an unrelated post just because it is recent', () => {
    const kit = 'U盘干到品类第一 #AI工具 #副业';
    expect(pickCandidate({ filmAt, kitText: kit }, [w('x', 48, '我曾9次打开新世界的大门。#地球online #游戏人生'), w('y', 24, '6小时用ai赚到100万？ 真实经验纯个人分享！#ai #ai工具 #信息差的重要性')])).toBeNull();
  });
  it('never suggests a dismissed work', () => {
    expect(pickCandidate({ filmAt, kitText }, [w('b', 5, kitText, { matchDismissed: true })])).toBeNull();
  });
});
