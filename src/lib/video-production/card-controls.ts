/**
 * 参数控件声明(三十二期), 抄自 overlay-studio 的 Control[] 形态: 面板遍历这份
 * 声明生成 UI, 加新参数不用改面板代码。
 *
 * **放主项目而不是 remotion/**: 参数面板是 Next 组件, 卡片组件在 remotion 子项目,
 * 两边不能互相 import(二十五期 Ruling-1)。这份是纯数据无 React, 放主项目侧;
 * remotion 侧只消费 style 的值, 不需要知道控件长什么样。
 * 范围值必须与 shot-plan.ts 的 ShotStyleSchema 一致 —— 有测试钉住。
 */
export type Control =
  | { key: string; label: string; type: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { label: string; value: string }[] };

export const SHOT_STYLE_CONTROLS: Control[] = [
  { key: 'speed', label: '动画快慢', type: 'range', min: 0.3, max: 3, step: 0.1, unit: '×' },
  { key: 'accent', label: '强调色', type: 'select', options: [
    { label: '默认', value: 'default' }, { label: '蓝', value: 'blue' },
    { label: '黄', value: 'yellow' }, { label: '红', value: 'red' },
  ] },
  { key: 'scale', label: '卡片大小', type: 'range', min: 0.6, max: 1.6, step: 0.05, unit: '×' },
];
