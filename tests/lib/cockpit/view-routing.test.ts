import { describe, expect, it } from 'vitest';
import {
  resolveInitialAnalyticsTab,
  resolveInitialHomePlatform,
  resolveInitialMomentumTab,
  resolveInitialView,
} from '@/lib/cockpit/view-routing';

function paramsFrom(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('resolveInitialView', () => {
  it('缺省 view → home', () => {
    expect(resolveInitialView(paramsFrom(''))).toBe('home');
  });

  it('legacy `?view=schedule` → home (schedule 已并入首页, 不再是独立 NavView)', () => {
    expect(resolveInitialView(paramsFrom('view=schedule'))).toBe('home');
  });

  it('非法 view → home', () => {
    expect(resolveInitialView(paramsFrom('view=not-a-real-view'))).toBe('home');
  });

  it('settings 单独放行', () => {
    expect(resolveInitialView(paramsFrom('view=settings'))).toBe('settings');
  });

  it('legacy `?view=goals`/`?view=review` → analytics (T4 起合并进内容数据分析, 不再是独立 NavView; 精确 tab 见 resolveInitialAnalyticsTab)', () => {
    expect(resolveInitialView(paramsFrom('view=goals'))).toBe('analytics');
    expect(resolveInitialView(paramsFrom('view=review'))).toBe('analytics');
  });

  it('固定视图 id 放行', () => {
    expect(resolveInitialView(paramsFrom('view=inspirations'))).toBe('inspirations');
    expect(resolveInitialView(paramsFrom('view=momentum'))).toBe('home');
    expect(resolveInitialView(paramsFrom('view=pipeline'))).toBe('home');
    expect(resolveInitialView(paramsFrom('view=analytics'))).toBe('analytics');
  });

  it('四期新增 `radar` 固定视图放行 (T6)', () => {
    expect(resolveInitialView(paramsFrom('view=radar'))).toBe('radar');
  });

  it('十一期新增 `positioning` 固定视图放行 (T1)', () => {
    expect(resolveInitialView(paramsFrom('view=positioning'))).toBe('positioning');
  });

  it('合法平台 id (platform-douyin) → home (精确到平台 tab 见 resolveInitialHomePlatform)', () => {
    expect(resolveInitialView(paramsFrom('view=platform-douyin'))).toBe('home');
  });

  it('非法平台 id (platform-foo) → home', () => {
    expect(resolveInitialView(paramsFrom('view=platform-foo'))).toBe('home');
  });
});

describe('resolveInitialMomentumTab', () => {
  it('resolvedView 显式传入 momentum（十六期后 resolveInitialView 不再产出该值, 此处直接验证函数自身的 tab 解析逻辑）: tab=schedule → schedule', () => {
    const params = paramsFrom('tab=schedule');
    expect(resolveInitialMomentumTab(params, 'momentum')).toBe('schedule');
  });

  it('resolvedView 显式传入 momentum: tab=week → week', () => {
    const params = paramsFrom('tab=week');
    expect(resolveInitialMomentumTab(params, 'momentum')).toBe('week');
  });

  it('view=momentum 缺省 tab → today', () => {
    const params = paramsFrom('view=momentum');
    expect(resolveInitialMomentumTab(params, resolveInitialView(params))).toBe('today');
  });

  it('非法 tab → today', () => {
    const params = paramsFrom('view=momentum&tab=not-a-real-tab');
    expect(resolveInitialMomentumTab(params, resolveInitialView(params))).toBe('today');
  });

  it('门控: view=inspirations&tab=schedule → today (tab 只在 view=momentum 时生效)', () => {
    const params = paramsFrom('view=inspirations&tab=schedule');
    expect(resolveInitialMomentumTab(params, resolveInitialView(params))).toBe('today');
  });

  it('门控: resolvedView 直接传入非 momentum 值时同样忽略 tab', () => {
    expect(resolveInitialMomentumTab(paramsFrom('tab=schedule'), 'platform-douyin')).toBe('today');
    expect(resolveInitialMomentumTab(paramsFrom('tab=week'), 'settings')).toBe('today');
  });

  it('legacy `?view=schedule&tab=schedule` → 十六期起 resolveInitialView 折叠成 home（不再是 momentum), 门控不匹配, 落回 today', () => {
    const params = paramsFrom('view=schedule&tab=schedule');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('home');
    expect(resolveInitialMomentumTab(params, resolvedView)).toBe('today');
  });

  it('legacy `?view=schedule`（无 tab）→ 十六期起 resolveInitialView 折叠成 home, 门控不匹配, 落回 today', () => {
    const params = paramsFrom('view=schedule');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('home');
    expect(resolveInitialMomentumTab(params, resolvedView)).toBe('today');
  });

  it('legacy `?view=schedule&tab=week` → 十六期起同样折叠成 home, 落回 today', () => {
    const params = paramsFrom('view=schedule&tab=week');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('home');
    expect(resolveInitialMomentumTab(params, resolvedView)).toBe('today');
  });
});

describe('resolveInitialAnalyticsTab', () => {
  it('view=analytics&tab=review → review', () => {
    const params = paramsFrom('view=analytics&tab=review');
    expect(resolveInitialAnalyticsTab(params, resolveInitialView(params))).toBe('review');
  });

  it('view=analytics&tab=goals → goals', () => {
    const params = paramsFrom('view=analytics&tab=goals');
    expect(resolveInitialAnalyticsTab(params, resolveInitialView(params))).toBe('goals');
  });

  it('view=analytics 缺省 tab → goals', () => {
    const params = paramsFrom('view=analytics');
    expect(resolveInitialAnalyticsTab(params, resolveInitialView(params))).toBe('goals');
  });

  it('非法 tab → goals', () => {
    const params = paramsFrom('view=analytics&tab=not-a-real-tab');
    expect(resolveInitialAnalyticsTab(params, resolveInitialView(params))).toBe('goals');
  });

  it('legacy `?view=goals` → resolveInitialView 折叠成 analytics, 精确 tab 落在 goals', () => {
    const params = paramsFrom('view=goals');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('analytics');
    expect(resolveInitialAnalyticsTab(params, resolvedView)).toBe('goals');
  });

  it('legacy `?view=review` → resolveInitialView 折叠成 analytics, 精确 tab 落在 review', () => {
    const params = paramsFrom('view=review');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('analytics');
    expect(resolveInitialAnalyticsTab(params, resolvedView)).toBe('review');
  });

  it('legacy `?view=goals&tab=review` → 原始 view 参数优先于 tab, 仍落在 goals', () => {
    const params = paramsFrom('view=goals&tab=review');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('analytics');
    expect(resolveInitialAnalyticsTab(params, resolvedView)).toBe('goals');
  });

  it('门控: view=inspirations&tab=review → goals (tab 只在 view=analytics 时生效)', () => {
    const params = paramsFrom('view=inspirations&tab=review');
    expect(resolveInitialAnalyticsTab(params, resolveInitialView(params))).toBe('goals');
  });

  it('门控: resolvedView 直接传入非 analytics 值时同样忽略 tab', () => {
    expect(resolveInitialAnalyticsTab(paramsFrom('tab=review'), 'momentum')).toBe('goals');
    expect(resolveInitialAnalyticsTab(paramsFrom('view=review&tab=review'), 'settings')).toBe('goals');
  });
});

describe('resolveInitialHomePlatform', () => {
  it('非 home 视图 → undefined（即便 view 参数看起来像平台）', () => {
    const params = paramsFrom('view=inspirations');
    expect(resolveInitialHomePlatform(params, 'inspirations')).toBeUndefined();
  });

  it('view=platform-douyin → home 视图下解析出 douyin', () => {
    const params = paramsFrom('view=platform-douyin');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBe('douyin');
  });

  it('view=platform-foo（非法平台）→ undefined', () => {
    const params = paramsFrom('view=platform-foo');
    const view = resolveInitialView(params);
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('view=momentum → home 视图下解析出 undefined（全部 tab，非某个平台）', () => {
    const params = paramsFrom('view=momentum');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('view=pipeline → home 视图下解析出 undefined', () => {
    const params = paramsFrom('view=pipeline');
    const view = resolveInitialView(params);
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });

  it('缺省 view → home 视图下解析出 undefined', () => {
    const params = paramsFrom('');
    const view = resolveInitialView(params);
    expect(view).toBe('home');
    expect(resolveInitialHomePlatform(params, view)).toBeUndefined();
  });
});
