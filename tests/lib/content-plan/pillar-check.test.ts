import { describe, expect, it } from 'vitest';
import { pillarCoverageWarnings } from '@/lib/content-plan/pillar-check';

describe('pillarCoverageWarnings', () => {
  const pillars = [{ name: '工具评测' }, { name: '避坑' }];

  it('全部支柱都出现过 → 空数组', () => {
    const days = [{ pillarName: '工具评测' }, { pillarName: '避坑' }, { pillarName: '工具评测' }];
    expect(pillarCoverageWarnings(pillars, days)).toEqual([]);
  });

  it('某支柱一次都没出现 → 一条警告文案', () => {
    const days = [{ pillarName: '工具评测' }, { pillarName: '工具评测' }];
    const warnings = pillarCoverageWarnings(pillars, days);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('避坑');
  });

  it('未挂支柱的天(pillarName 为空)不影响判断', () => {
    const days = [{ pillarName: '' }, { pillarName: '工具评测' }, { pillarName: '避坑' }];
    expect(pillarCoverageWarnings(pillars, days)).toEqual([]);
  });
});
