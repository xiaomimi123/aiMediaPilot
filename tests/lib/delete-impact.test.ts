import { describe, it, expect } from 'vitest';
import { hasImpact, impactLines } from '@/lib/script/delete-impact';

const none = { distributions: 0, linkedWorks: 0, contents: 0, topicIdeas: 0 };

describe('hasImpact', () => {
  it('没有任何牵连时是 false', () => {
    expect(hasImpact(none)).toBe(false);
  });

  it('任意一项非零就是 true', () => {
    expect(hasImpact({ ...none, topicIdeas: 1 })).toBe(true);
    expect(hasImpact({ ...none, linkedWorks: 1 })).toBe(true);
  });
});

describe('impactLines', () => {
  it('**校准配对排最前** —— 那是最贵的, 攒够 30 条要几个月', () => {
    const lines = impactLines({ distributions: 2, linkedWorks: 1, contents: 3, topicIdeas: 1 });
    expect(lines[0]).toContain('校准');
  });

  it('说清楚配对会少几条, 不只说「会失去关联」', () => {
    expect(impactLines({ ...none, linkedWorks: 2 })[0]).toContain('少 2 条');
  });

  it('区分「会被删掉」和「只是断链接」—— 后果完全不同', () => {
    expect(impactLines({ ...none, distributions: 1 })[0]).toContain('删掉');
    expect(impactLines({ ...none, contents: 1 })[0]).toContain('本身还在');
  });

  it('没有牵连时返回空数组, 不返回「没有影响」这种话', () => {
    expect(impactLines(none)).toEqual([]);
  });
});
