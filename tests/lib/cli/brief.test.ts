import { describe, expect, it } from 'vitest';
import { buildBrief, type BriefInput } from '@/lib/cli/brief';

const ok = { state: 'ok' as const, lastRun: null, lastSuccessAt: '2026-09-29T12:00:00.000Z', consecutiveFailures: 0, hint: '' };
const base: BriefInput = { collect: ok, scan: ok, hits: [], retros: [], pendingLinks: 0, lessonCandidates: 0, fans: 408, fansDelta: 3 };

describe('buildBrief', () => {
  it('is one line when nothing happened', () => {
    expect(buildBrief(base)).toBe('昨晚一切正常，没有新爆款。粉丝 408（+3）');
  });
  it('lists failures, hits, retros and pending items', () => {
    const t = buildBrief({
      ...base,
      scan: { ...ok, state: 'failing', hint: '连续 1 次对标巡检失败：ego lite 没有响应' },
      hits: [1, 2, 3, 4].map((i) => ({ author: `博主${i}`, ratio: 3 + i, topic: `选题${i}` })),
      retros: [{ title: 'U盘干到第一', line: '开头 2 秒掉人比平时多' }],
      pendingLinks: 1,
      lessonCandidates: 2,
    });
    expect(t).toBe(
      [
        'MediaPilot 早报',
        '⚠ 连续 1 次对标巡检失败：ego lite 没有响应',
        '对标爆款 4 条：',
        '· 博主1（平时 4 倍）选题1',
        '· 博主2（平时 5 倍）选题2',
        '· 博主3（平时 6 倍）选题3',
        '复盘：',
        '· U盘干到第一：开头 2 秒掉人比平时多',
        '待你确认：1 条作品关联，2 条写法经验（回电脑上看）',
        '粉丝 408（+3）',
      ].join('\n'),
    );
  });
  it('never says all is well when a task failed', () => {
    const t = buildBrief({ ...base, collect: { ...ok, state: 'failing', hint: '连续 2 次回采失败：数据库没启动' } });
    expect(t).not.toContain('一切正常');
    expect(t).toContain('⚠ 连续 2 次回采失败');
  });
});
