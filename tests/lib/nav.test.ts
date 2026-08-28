import { describe, it, expect } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, HOME_ITEM, SETTINGS_ITEM, activeNavHref } from '@/lib/nav';

describe('NAV_GROUPS', () => {
  it('三组: 工作区 / 生产 / 分析', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['工作区', '生产', '分析']);
  });

  it('总览独立在最上面, 不属于任何一组', () => {
    expect(HOME_ITEM.href).toBe('/');
    expect(NAV_GROUPS.some((g) => g.items.some((i) => i.href === '/'))).toBe(false);
  });

  it('加上总览与设置一共 12 项 —— 与设计稿一致', () => {
    expect(NAV_ITEMS.length + 2).toBe(12);
  });

  it('每一项都标了它依赖的数据通没通 —— 空的要如实说, 不是藏起来', () => {
    for (const i of NAV_ITEMS) {
      expect(typeof i.ready).toBe('boolean');
    }
    // 回采链路通了(每晚 20:00 的 launchd 任务在跑, 101 条作品), 所以 /data 是 true。
    // 这条断言原本钉的是 false, 注释写着「复盘链路一条都没有」—— 链路通了就得改,
    // 否则这个标记会变成一个骗人的红点。
    expect(NAV_ITEMS.find((i) => i.href === '/data')!.ready).toBe(true);
    expect(NAV_ITEMS.find((i) => i.href === '/scripts')!.ready).toBe(true);

    // 仍然是 false 的三项, 各自卡在不同的地方 —— 都不是代码没写完:
    // 校准等配对样本、钩子库等发布后的真实留存、素材库等你自己录。
    for (const href of ['/calibration', '/hooks', '/materials']) {
      expect(NAV_ITEMS.find((i) => i.href === href)!.ready).toBe(false);
    }
  });
});

describe('NAV_ITEMS', () => {
  it('工作区四项, 顺序是 选题 → 写稿 → 稿库 → 素材库', () => {
    const workbench = NAV_GROUPS.find((g) => g.label === '工作区')!;
    expect(workbench.items.map((i) => i.label)).toEqual(['选题', '写稿', '稿库', '素材库']);
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

  it('根路径高亮「总览」—— 它现在是一个真页面, 不再是跳转', () => {
    expect(activeNavHref('/')).toBe('/');
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
