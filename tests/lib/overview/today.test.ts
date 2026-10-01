import { describe, expect, it } from 'vitest';
import { buildToday } from '@/lib/overview/today';
import { stepsOf } from '@/lib/overview/steps';

const card = (id: string, stage: string, center: number | null, published = false) => ({ id, title: id, stage, steps: stepsOf({ stage, hasBenchmark: false, hasScript: true, published, hasRetro: false }), durationSec: 60, center, views: null, updatedAt: '' });
const none = { failingTasks: [], pendingLinks: [], lessonCandidates: 0, pendingNotes: [], lagging: [], formulaProposed: false, works: [] };

describe('today', () => {
  it('lists every kind of todo with a link', () => {
    const t = buildToday({
      ...none,
      failingTasks: [{ hint: '超过 36 小时没有成功对标巡检' }],
      pendingLinks: [{ projectId: 'p1', title: 'U盘' }],
      lessonCandidates: 2,
      pendingNotes: [{ projectId: 'p2', title: 'AI 剪辑' }],
      lagging: [{ projectId: 'p3', title: '新作品' }],
      formulaProposed: true,
    });
    expect(t.todos.map((x) => [x.kind, x.href])).toEqual([
      ['task', '/settings#tasks'],
      ['link', '/projects/p1'],
      ['lesson', '/settings#lessons'],
      ['note', '/projects/p2'],
      ['lag', '/projects/p3'],
      ['formula', '/settings#formula'],
    ]);
    expect(t.todos[2].text).toBe('2 条写法经验等你决定');
  });
  it('orders works in progress by prediction and marks the first only with two or more predictions', () => {
    const one = buildToday({ ...none, works: [card('a', 'final', 3000), card('b', 'draft', null)] });
    expect(one.inProgress.map((x) => [x.id, x.first])).toEqual([['a', false], ['b', false]]);
    const two = buildToday({ ...none, works: [card('a', 'final', 3000), card('b', 'scripted', 5000), card('c', 'final', null, true)] });
    expect(two.inProgress.map((x) => [x.id, x.first])).toEqual([['b', true], ['a', false]]);
  });
  it('shows the empty day prompt when there is nothing to do', () => {
    expect(buildToday(none)).toMatchObject({ todos: [], inProgress: [], empty: true });
  });
});
