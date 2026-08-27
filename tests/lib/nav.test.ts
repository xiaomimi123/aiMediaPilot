import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, SETTINGS_ITEM, activeNavHref } from '@/lib/nav';

describe('NAV_ITEMS', () => {
  it('只有三项, 顺序是 选题 → 写稿 → 稿库', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['选题', '写稿', '稿库']);
  });

  it('设置不在主导航里 —— 它是配置, 不是日常动作', () => {
    expect(NAV_ITEMS.some((i) => i.href === SETTINGS_ITEM.href)).toBe(false);
    expect(SETTINGS_ITEM.href).toBe('/settings');
  });

  it('每一项都有可跳转的 href', () => {
    for (const i of NAV_ITEMS) expect(i.href.startsWith('/')).toBe(true);
  });
});

describe('activeNavHref', () => {
  it('精确路径命中自己', () => {
    expect(activeNavHref('/scripts')).toBe('/scripts');
    expect(activeNavHref('/topics')).toBe('/topics');
  });

  it('子路径归属父项 —— 在 /write/abc 里写稿这一项要亮着', () => {
    expect(activeNavHref('/write/abc-123')).toBe('/write');
  });

  it('根路径不高亮任何一项 —— 它只是个跳转', () => {
    expect(activeNavHref('/')).toBeNull();
  });

  it('设置页也能被识别, 不会误判成主导航项', () => {
    expect(activeNavHref('/settings')).toBe('/settings');
  });

  it('不认识的路径返回 null, 不瞎猜', () => {
    expect(activeNavHref('/nope')).toBeNull();
  });

  it('/writeup 这类前缀相同但不同段的路径不算命中 —— 按路径段比较, 不是字符串前缀', () => {
    expect(activeNavHref('/writeup')).toBeNull();
  });
});
