import { describe, expect, it } from 'vitest';
import { currentStep, filterOf, nextActionText, stepsOf } from '@/lib/overview/steps';

const base = { stage: 'draft', hasBenchmark: false, hasScript: false, published: false, hasRetro: false };

describe('six steps', () => {
  it('marks done steps by stage, publish and retro', () => {
    const s = stepsOf({ ...base, stage: 'final', hasBenchmark: true, hasScript: true });
    expect(s.map((x) => [x.key, x.done])).toEqual([['topic', true], ['script', true], ['recording', true], ['film', true], ['publish', false], ['retro', false]]);
  });
  it('marks the first unfinished step as current', () => {
    expect(currentStep({ ...base })).toBe('topic');
    expect(currentStep({ ...base, hasScript: true })).toBe('script');
    expect(currentStep({ ...base, stage: 'published', hasScript: true, published: true })).toBe('retro');
    expect(currentStep({ ...base, stage: 'published', hasScript: true, published: true, hasRetro: true })).toBe('retro');
    expect(stepsOf({ ...base, hasScript: true }).filter((x) => x.current)).toHaveLength(1);
  });
  it('says what to do next', () => {
    expect(nextActionText('script')).toBe('下一步：磨稿并定稿');
    expect(nextActionText('publish')).toBe('下一步：发布并关联作品');
  });
  it('maps a card to a stage filter', () => {
    const card = (stage: string, published = false) => ({ id: 'x', title: 't', stage, steps: stepsOf({ ...base, stage, hasScript: true, published }), durationSec: null, center: null, views: null, updatedAt: '' });
    expect(filterOf(card('draft'))).toBe('draft');
    expect(filterOf(card('scripted'))).toBe('recording');
    expect(filterOf(card('recorded'))).toBe('film');
    expect(filterOf(card('final'))).toBe('film');
    expect(filterOf(card('final', true))).toBe('published');
  });
});
