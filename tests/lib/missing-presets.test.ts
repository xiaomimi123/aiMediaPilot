import { describe, it, expect } from 'vitest';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';
import { missingPresets } from '@/lib/video-template/store';

describe('missingPresets —— 找出用户还没有的内置预设', () => {
  it('一个都没有时全都算缺', () => {
    expect(missingPresets([]).length).toBe(PRESET_TEMPLATES.length);
  });

  it('已有的按名字排除', () => {
    const have = PRESET_TEMPLATES.slice(0, 2).map((p) => p.name);
    const missing = missingPresets(have);
    expect(missing.length).toBe(PRESET_TEMPLATES.length - 2);
    expect(missing.some((p) => have.includes(p.name))).toBe(false);
  });

  /*
   * 这条锁住一个真实事故: 对标参考片的「真人口播 · 文字叠加」预设一直在代码里, 但
   * 从没进过用户的数据库 —— 播种只在「0 条模板」时发生, 而用户早就有 4 条。
   * 结果是十几轮出片全跑在错的模板上(带 B-roll), 而参考片一帧 B-roll 都没有。
   */
  it('用户手上那 4 个模板不包含「真人口播 · 文字叠加」→ 它必须被判为缺', () => {
    const have = ['图文口播', '插画配音', '知识长视频(横屏)', '真人出镜 + B-roll'];
    expect(missingPresets(have).map((p) => p.name)).toContain('真人口播 · 文字叠加');
  });

  it('全都有了就返回空', () => {
    expect(missingPresets(PRESET_TEMPLATES.map((p) => p.name))).toEqual([]);
  });
});
