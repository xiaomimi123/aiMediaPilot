import { describe, expect, it } from 'vitest';
import { READ_COMMANDS, formatStatus, formatHits, formatRetro } from '@/lib/cli/commands/read';

describe('read commands', () => {
  it('are all allowed for hermes', () => {
    expect(READ_COMMANDS.map((c) => [c.path.join(' '), c.tier, c.hermes])).toEqual([
      ['status', 'read', true], ['topics hits', 'read', true], ['topics show', 'read', true], ['topics accounts', 'read', true], ['topics suggest', 'read', true],
      ['project show', 'read', true], ['publish candidates', 'read', true], ['retro show', 'read', true], ['lessons list', 'read', true], ['tasks status', 'read', true],
    ]);
  });
  it('formats status briefly', () => {
    expect(formatStatus({ fans: 408, fansDelta: 3, likes: 2453, hits24h: 2, collect: '正常（09-29 20:03）', scan: '失败：ego lite 没有响应', pendingLinks: 1, lessonCandidates: 2 })).toBe(
      ['粉丝 408（+3）· 获赞 2,453', '今天对标爆款 2 条', '回采：正常（09-29 20:03）', '巡检：失败：ego lite 没有响应', '待确认：1 条作品关联，2 条写法经验'].join('\n'),
    );
  });
  it('formats hits with ids for follow-up commands', () => {
    const t = formatHits([{ id: 'v1', author: '添叔AI雷达', ratio: 8.6, digg: 4008, analysis: { topic: '甩商品链接出广告片' }, desc: 'x' } as never]);
    expect(t).toBe('[v1] 添叔AI雷达 · 平时的 8.6 倍 · 甩商品链接出广告片');
  });
  it('formats a retro with bad stages first', () => {
    const t = formatRetro({
      kit: null, candidate: null, lessons: [{ id: 'L1', text: '第一句直接说结果', status: 'candidate' }],
      work: { id: 'w', text: '作品', publishedAt: '2026-09-29T00:00:00.000Z', viewCount: 900, likeCount: 18 },
      retro: { dayN: 3, narrative: '开头掉人多。', narrativeError: null, dataAsOf: null, updatedAt: '', diagnosis: { stages: [
        { key: 'hook2s', label: '开头 2 秒（跳出率）', verdict: 'bad', note: '40.0%；平时 30.0%' },
        { key: 'ending', label: '收尾（完播率）', verdict: 'good', note: '20.0%；平时 10.0%' },
      ] } },
    } as never);
    expect(t).toContain('第 3 天复盘 · 播放 900 · 点赞 18');
    expect(t.indexOf('开头 2 秒')).toBeLessThan(t.indexOf('收尾'));
    expect(t).toContain('编导：开头掉人多。');
    expect(t).toContain('[L1] 第一句直接说结果（待你决定）');
  });
});
