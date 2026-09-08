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
