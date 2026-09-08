import { describe, expect, it } from 'vitest';
import { templateDemoHash } from '../../scripts/generate-template-demos';

/**
 * 三十六期 Task 4: `defaultShotStyle` 必须算进演示指纹, 否则改了默认样式、
 * 保存后, 详情页仍然显示改之前的旧演示且不会提示"该重新生成"。
 *
 * 编辑器块(Choice/滑杆)是纯展示绑定, jsdom 测不出对错——照三十二期定的取舍,
 * 只测指纹这一条真正有分支的逻辑, 不测组件渲染。
 */
describe('templateDemoHash — defaultShotStyle', () => {
  const base = {
    deliveryMode: 'ppt-narration',
    visualStyle: 'card' as string | null,
    aspect: '9:16' as string | null,
    talkingHeadLayout: 'cutaway' as string | null,
    pipPosition: 'br' as string | null,
    pipScale: 0.25 as number | null,
    pipMargin: 40 as number | null,
  };

  it('defaultShotStyle 从 null 变为 {accent: "red"} 时, 指纹变化', () => {
    const before = templateDemoHash({ ...base, defaultShotStyle: null });
    const after = templateDemoHash({ ...base, defaultShotStyle: { accent: 'red' } });
    expect(before).not.toBe(after);
  });

  it('其余字段全同、defaultShotStyle 也相同时, 指纹不变(回归)', () => {
    const a = templateDemoHash({ ...base, defaultShotStyle: { speed: 1.5, scale: 1.1 } });
    const b = templateDemoHash({ ...base, defaultShotStyle: { speed: 1.5, scale: 1.1 } });
    expect(a).toBe(b);
  });
});

describe('指纹对 key 顺序不敏感(终审补钉)', () => {
  /*
   * 编辑器按操作顺序往 defaultShotStyle 里追加字段 —— 先设 speed 再设 accent
   * 与反过来, 是同一份配置的两种对象字面量。指纹若对 key 顺序敏感, 语义相同的
   * 配置会被误判"该重渲演示", 白花 20 秒×N。原回归测试用两次相同字面量,
   * 只验证了函数确定性, 没钉住这个真实风险点。
   */
  const base = {
    deliveryMode: 'ppt-narration', visualStyle: 'card', aspect: '9:16',
    talkingHeadLayout: null, pipPosition: null, pipScale: null, pipMargin: null,
  };
  it('同值不同 key 顺序 → 同 hash', () => {
    const a = templateDemoHash({ ...base, defaultShotStyle: { accent: 'red', speed: 1.3 } });
    const b = templateDemoHash({ ...base, defaultShotStyle: { speed: 1.3, accent: 'red' } });
    expect(a).toBe(b);
  });
});

/**
 * 三十七期 Task 4: `textOverlayEnabled`/`personSide`/`cornerBadge` 三字段从
 * 「旧版遗留」区搬回真人形象与文字叠加节 —— 现在 Remotion 渲染层真的读它们
 * (TextOverlayLayer)。三者任一变都必须让演示指纹变, 否则改了叠加层配置、
 * 保存后, 详情页仍显示改之前(叠加层不一样)的旧演示。
 */
describe('templateDemoHash — 文字叠加层三字段', () => {
  const base = {
    deliveryMode: 'talking-head-broll',
    visualStyle: 'card' as string | null,
    aspect: '9:16' as string | null,
    talkingHeadLayout: 'cutaway' as string | null,
    pipPosition: 'br' as string | null,
    pipScale: 0.25 as number | null,
    pipMargin: 40 as number | null,
    defaultShotStyle: null,
    textOverlayEnabled: false,
    personSide: 'right',
    cornerBadge: null as string | null,
  };

  it('textOverlayEnabled 变化 → 指纹变', () => {
    const before = templateDemoHash({ ...base, textOverlayEnabled: false });
    const after = templateDemoHash({ ...base, textOverlayEnabled: true });
    expect(before).not.toBe(after);
  });

  it('personSide 变化 → 指纹变', () => {
    const before = templateDemoHash({ ...base, personSide: 'right' });
    const after = templateDemoHash({ ...base, personSide: 'left' });
    expect(before).not.toBe(after);
  });

  it('cornerBadge 变化 → 指纹变', () => {
    const before = templateDemoHash({ ...base, cornerBadge: null });
    const after = templateDemoHash({ ...base, cornerBadge: '纯知识经验分享' });
    expect(before).not.toBe(after);
  });

  it('三字段全同 → 指纹不变', () => {
    const a = templateDemoHash({ ...base, textOverlayEnabled: true, personSide: 'left', cornerBadge: '角标' });
    const b = templateDemoHash({ ...base, textOverlayEnabled: true, personSide: 'left', cornerBadge: '角标' });
    expect(a).toBe(b);
  });
});

