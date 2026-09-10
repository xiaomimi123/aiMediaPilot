import { describe, expect, it } from 'vitest';
import { planDayStatusLabel, nextAction } from '@/lib/content-plan/status-label';

describe('planDayStatusLabel', () => {
  it('pending → 待写', () => {
    expect(planDayStatusLabel('pending')).toBe('待写');
  });
  it('scripted → 脚本已好', () => {
    expect(planDayStatusLabel('scripted')).toBe('脚本已好');
  });
  it('produced → 已出片', () => {
    expect(planDayStatusLabel('produced')).toBe('已出片');
  });
});

describe('nextAction', () => {
  it('pending → generate-script', () => {
    expect(nextAction('pending', {})).toEqual({ kind: 'generate-script' });
  });

  it('scripted → produce, 带 scriptDraftId', () => {
    expect(nextAction('scripted', { scriptDraftId: 'sd1' })).toEqual({
      kind: 'produce',
      scriptDraftId: 'sd1',
    });
  });

  it('produced → done, 带 videoProductionId', () => {
    expect(nextAction('produced', { videoProductionId: 'vp1' })).toEqual({
      kind: 'done',
      videoProductionId: 'vp1',
    });
  });
});
