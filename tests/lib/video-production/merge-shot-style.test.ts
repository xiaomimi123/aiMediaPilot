import { describe, it, expect } from 'vitest';
import { mergeShotStyle } from '../../../remotion/src/cards/style';

describe('mergeShotStyle: 模板默认与逐镜覆盖的合并', () => {
  it('逐字段合并: 镜只覆盖了 accent, speed 仍跟模板', () => {
    expect(mergeShotStyle({ accent: 'blue', speed: 2 }, { accent: 'red' }))
      .toEqual({ accent: 'red', speed: 2 });
  });

  it('undefined 不覆盖 —— {...a,...b} 的展开语义里 b 存在但为 undefined 的键会盖掉 a, 这里必须剔除', () => {
    expect(mergeShotStyle({ accent: 'blue' }, { accent: undefined, speed: 1.5 }))
      .toEqual({ accent: 'blue', speed: 1.5 });
  });

  it('两侧都空返回空对象; null 与 undefined 同义', () => {
    expect(mergeShotStyle(null, undefined)).toEqual({});
    expect(mergeShotStyle(undefined, null)).toEqual({});
  });

  it('模板为空时镜上值原样通过', () => {
    expect(mergeShotStyle(null, { scale: 1.2 })).toEqual({ scale: 1.2 });
  });
});
