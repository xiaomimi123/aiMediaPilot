import React from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';

/**
 * 中性分隔件：一条对称的短线, 中间一个点。
 *
 * 二十八期推翻了这张卡原来的设计。原来中间画的是 `connector`
 * (`arrow`/`versus`/`plus` 三选一, 对应 →/VS/+), 由模型判断左右两边是什么关系。
 * 三轮真机实测(3 条真实六幕稿 × 3 遍, 每轮约 20 处 contrast)测出总正确率在
 * 61%~70% 之间来回摆, 且每轮现象一致——收紧规则让一个取值变准, 错误就整批
 * 迁移到另一个取值上, 是零和搬运不是判断力提升。选错连接符 = 画面断言了一个
 * 原文没有的因果或取舍关系, 比不断言更糟。所以拍板去掉这道判断, 改成渲染一个
 * 不表态的分隔件: 画面仍是"左右两组+中间有东西连着", 但不再断言具体是哪种关系。
 *
 * 形状约束(不能带方向性——箭头、渐变方向、大小不对称都算): 左右各一段等长的线,
 * 中间一个点。线段长度、粗细、颜色左右完全对称, 没有箭头、没有指向、没有从左到
 * 右或从右到左的视觉暗示。字号按短边缩放, 横竖屏都成立。
 */
const NeutralDivider: React.FC<{width: number; height: number; theme: CardTheme}> = ({
  width, height, theme,
}) => {
  const armLength = scaleFont(width, height, 40);
  const lineHeight = Math.max(2, Math.round(scaleFont(width, height, 2)));
  const dotSize = scaleFont(width, height, 10);
  // 分隔件是结构性元素而非文案, 沿用 theme.title 这个"墨色"角色(叠加透明度) ——
  // 不为它单独开一个 token, card/illustration 两套里它都该和标题同一色系。
  const arm = (
    <div style={{width: armLength, height: lineHeight, background: theme.title, opacity: 0.35}} />
  );
  return (
    <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}}>
      {arm}
      <div
        style={{
          width: dotSize, height: dotSize, borderRadius: '50%', background: theme.title, opacity: 0.55,
          margin: `0 ${scaleFont(width, height, 10)}px`,
        }}
      />
      {arm}
    </div>
  );
};

/**
 * 对照卡：左右两组东西 + 中间一个中性分隔件, 讲 A 与 B 的对照。
 *
 * 左右两列用 flex row 平分, 分隔件居中 —— 不用绝对坐标摆放三块内容。
 */
export const Contrast: React.FC<{
  slots: {
    leftLabel: string;
    leftText: string;
    rightLabel: string;
    rightText: string;
  };
  durationInFrames: number;
  theme: CardTheme;
}> = ({slots, theme}) => {
  const {width, height} = useVideoConfig();
  const box = safeBox(width, height);
  const leftText = assertContent(slots.leftText, 'contrast.leftText');
  const rightText = assertContent(slots.rightText, 'contrast.rightText');
  const leftLabel = assertContent(slots.leftLabel, 'contrast.leftLabel');
  const rightLabel = assertContent(slots.rightLabel, 'contrast.rightLabel');

  const column = (label: string, text: string, seed: number) => (
    <div
      style={{
        flex: 1,
        // flex:1 的子项默认 min-width:auto, 内容(尤其是不含空格的长文本)会撑破
        // 分配到的那一份宽度、把兄弟列挤到安全区外——这不是审查压力测试测出来的,
        // 是 flexbox 本身的已知坑, 顺手一起修了。minWidth:0 让它老实按分配宽度换行。
        minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}
    >
      <Live seed={seed} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 28), color: theme.accent, letterSpacing: '0.1em'}}>
        {label}
      </Live>
      <Live
        seed={seed + 1}
        style={{
          fontFamily: FONT_CN, fontWeight: 900, color: theme.title, marginTop: scaleFont(width, height, 14),
          fontSize: scaleFont(width, height, 56), lineHeight: 1.15,
        }}
      >
        {text}
      </Live>
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        padding: `${box.top}px ${box.right}px ${box.bottom}px ${box.left}px`,
        justifyContent: 'center',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        // 兜底(审查 Important #1): 压力样片(四个文本都取上限)实测没挤出安全区,
        // overflow:hidden 是防未来更极端输入的最后一道线。
        overflow: 'hidden',
      }}
    >
      {column(leftLabel, leftText, 1)}
      <Live
        seed={5}
        style={{padding: `0 ${scaleFont(width, height, 24)}px`}}
      >
        <NeutralDivider width={width} height={height} theme={theme} />
      </Live>
      {column(rightLabel, rightText, 3)}
    </AbsoluteFill>
  );
};
