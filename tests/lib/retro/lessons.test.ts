import { describe, expect, it } from 'vitest';
import { formatLessons } from '@/lib/retro/lessons';

describe('formatLessons', () => {
  it('lists lessons and marks thin evidence', () => {
    expect(formatLessons([{ text: '第一句直接说结果', evidenceCount: 1 }, { text: '结尾别拖', evidenceCount: 3 }])).toBe('- 第一句直接说结果（证据少：1 条作品）\n- 结尾别拖（3 条作品）');
  });
  it('is empty without lessons', () => {
    expect(formatLessons([])).toBe('');
  });
});
