import { describe, expect, it } from 'vitest';
import { toLessonView } from '@/lib/retro/view';

describe('toLessonView', () => {
  it('labels the stage and counts evidence', () => {
    expect(toLessonView({ id: 'L1', text: '第一句直接说结果', stage: 'hook', status: 'active', evidence: [{}, {}], contradicted: true, confirmedAt: new Date('2026-10-01T00:00:00Z') })).toEqual({
      id: 'L1', text: '第一句直接说结果', stage: 'hook', stageLabel: '开头钩子', status: 'active', evidenceCount: 2, contradicted: true, confirmedAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
