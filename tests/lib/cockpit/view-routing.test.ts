import { describe, expect, it } from 'vitest';
import { resolveInitialMomentumTab, resolveInitialView } from '@/lib/cockpit/view-routing';

function paramsFrom(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe('resolveInitialView', () => {
  it('缺省 view → momentum', () => {
    expect(resolveInitialView(paramsFrom(''))).toBe('momentum');
  });

  it('legacy `?view=schedule` → momentum (schedule 已并入 momentum 档期 tab, 不再是独立 NavView)', () => {
    expect(resolveInitialView(paramsFrom('view=schedule'))).toBe('momentum');
  });

  it('非法 view → momentum', () => {
    expect(resolveInitialView(paramsFrom('view=not-a-real-view'))).toBe('momentum');
  });

  it('settings 单独放行', () => {
    expect(resolveInitialView(paramsFrom('view=settings'))).toBe('settings');
  });

  it('goals/review 过渡期 legacy id 放行', () => {
    expect(resolveInitialView(paramsFrom('view=goals'))).toBe('goals');
    expect(resolveInitialView(paramsFrom('view=review'))).toBe('review');
  });

  it('固定视图 id 放行', () => {
    expect(resolveInitialView(paramsFrom('view=inspirations'))).toBe('inspirations');
    expect(resolveInitialView(paramsFrom('view=momentum'))).toBe('momentum');
    expect(resolveInitialView(paramsFrom('view=pipeline'))).toBe('pipeline');
    expect(resolveInitialView(paramsFrom('view=analytics'))).toBe('analytics');
  });

  it('合法平台 id (platform-douyin) 放行', () => {
    expect(resolveInitialView(paramsFrom('view=platform-douyin'))).toBe('platform-douyin');
  });

  it('非法平台 id (platform-foo) → momentum', () => {
    expect(resolveInitialView(paramsFrom('view=platform-foo'))).toBe('momentum');
  });
});

describe('resolveInitialMomentumTab', () => {
  it('view=momentum&tab=schedule → schedule', () => {
    const params = paramsFrom('view=momentum&tab=schedule');
    expect(resolveInitialMomentumTab(params, resolveInitialView(params))).toBe('schedule');
  });

  it('view=momentum&tab=week → week', () => {
    const params = paramsFrom('view=momentum&tab=week');
    expect(resolveInitialMomentumTab(params, resolveInitialView(params))).toBe('week');
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

  it('legacy `?view=schedule&tab=schedule` → resolveInitialView 已回退 momentum, 但门控看的是 resolvedView 而非原始 view 参数, 故仍读取 tab', () => {
    const params = paramsFrom('view=schedule&tab=schedule');
    const resolvedView = resolveInitialView(params);
    expect(resolvedView).toBe('momentum');
    expect(resolveInitialMomentumTab(params, resolvedView)).toBe('schedule');
  });
});
