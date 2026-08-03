import { describe, expect, it } from 'vitest';
import { DISTRIBUTION_PLATFORMS, distributionPlatformMeta } from '@/lib/pipeline/platforms';

describe('distribution platforms registry', () => {
  it('注册表非空, key 全小写且唯一', () => {
    expect(DISTRIBUTION_PLATFORMS.length).toBeGreaterThanOrEqual(8);
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toBe(k.toLowerCase());
  });

  it('已知 key → 中文 label', () => {
    expect(distributionPlatformMeta('bilibili').label).toBe('B站');
    expect(distributionPlatformMeta('youtube').label).toBe('YouTube');
  });

  it('未知 key → 原样显示不崩 (spec §2.4)', () => {
    const meta = distributionPlatformMeta('tiktok');
    expect(meta.key).toBe('tiktok');
    expect(meta.label).toBe('tiktok');
    expect(meta.badgeClass).toBeTruthy();
  });
});
