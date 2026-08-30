import { describe, it, expect } from 'vitest';
import { availableLayouts, SCENE_LAYOUTS } from '@/lib/video/scene-layout';

/**
 * 锁住一处「界面在撒谎」: 模板关掉 B-roll 时一个 B-roll 镜头都不会渲(实测 0 个),
 * 而编辑台照样给出「内容全屏」「左内容·右人物」这些选项 —— 选了也没有内容可放。
 */
describe('availableLayouts', () => {
  it('开着 B-roll 时五种版面都能选', () => {
    expect(availableLayouts(true)).toEqual([...SCENE_LAYOUTS]);
  });

  it('关掉 B-roll 时只剩人物全屏 —— 其余四种都需要内容画面', () => {
    expect(availableLayouts(false)).toEqual(['person-full']);
  });

  it('不知道开关状态时按开着算 —— 老任务零迁移', () => {
    expect(availableLayouts(undefined)).toEqual([...SCENE_LAYOUTS]);
  });
});
