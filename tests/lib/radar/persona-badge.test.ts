import { describe, expect, it } from 'vitest';
import { pickPersonaBadge } from '@/lib/radar/persona-badge';

/**
 * `pickPersonaBadge` — 雷达条目卡人设徽标的纯函数条件判断 (八期 T5)。
 * 四态 (spec §3 heatFactors 后处理约定):
 *   1. heatFactors 非对象 / 缺 pillarHit+personaAdjust 两键 (老条目, 零迁移) → null
 *   2. pillarHit 为非空字符串 (命中某支柱) → { type: 'pillar', name }
 *   3. pillarHit 为 null 且 personaAdjust < 0 (有档案但未命中, 降权) → { type: 'off' }
 *   4. 其余 (如无档案时 pillarHit=null 且 personaAdjust=0) → null
 */
describe('pickPersonaBadge', () => {
  it('命中支柱: pillarHit 非空字符串 → pillar 徽标', () => {
    expect(pickPersonaBadge({ pillarHit: '工具评测', personaAdjust: 8 })).toEqual({
      type: 'pillar',
      name: '工具评测',
    });
  });

  it('未命中支柱: pillarHit 为 null 且 personaAdjust < 0 → off 徽标', () => {
    expect(pickPersonaBadge({ pillarHit: null, personaAdjust: -3 })).toEqual({ type: 'off' });
  });

  it('无档案: pillarHit 为 null 且 personaAdjust 为 0 → null (不展示徽标)', () => {
    expect(pickPersonaBadge({ pillarHit: null, personaAdjust: 0 })).toBeNull();
  });

  it('老条目: heatFactors 缺 pillarHit/personaAdjust 两键 → null', () => {
    expect(
      pickPersonaBadge({ relevance: 80, freshness: 70, discussion: 60, feasibility: 90, cooccurrenceSources: 1 }),
    ).toBeNull();
  });

  it('heatFactors 为 null → null', () => {
    expect(pickPersonaBadge(null)).toBeNull();
  });

  it('heatFactors 非对象 (如字符串/数字) → null', () => {
    expect(pickPersonaBadge('not-an-object')).toBeNull();
    expect(pickPersonaBadge(42)).toBeNull();
  });

  it('pillarHit 为空字符串 → null (视为未命中但不算降权态)', () => {
    expect(pickPersonaBadge({ pillarHit: '', personaAdjust: -3 })).toBeNull();
  });

  it('只缺 pillarHit 一个键 (personaAdjust 仍在) → null (老条目防御)', () => {
    expect(pickPersonaBadge({ personaAdjust: -3 })).toBeNull();
  });

  it('只缺 personaAdjust 一个键 (pillarHit 仍在) → null (老条目防御)', () => {
    expect(pickPersonaBadge({ pillarHit: null })).toBeNull();
  });
});
