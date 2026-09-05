import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {Live} from '../motion/life';
import {safeBox, scaleFont} from '../layout/grid';
import {assertContent} from './guard';
import {CardTheme} from '../theme';
import {drawLine, slideIn} from '../motion/anim';
import {resolveAccent, scaleStyle, speedT, ShotStyle} from './style';

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
 *
 * 动效(三十二期 Task 3): `drawLine` 描画两臂, 但**不能直接把同一个 `drawLine`
 * 结果原样套两遍**——它的 `clipPath: inset(0 R% 0 0)` 是从左边缘向右描画,
 * 两条臂原样用同一个值会变成"整条分隔件从左到右扫过去"(一个方向), 违反
 * 上面这条"不能带方向性"的约束。改成让两臂**从中间的点向两侧对称长出**:
 * 右臂(在点右侧)直接用 `drawLine` 的结果(从左描到右, 恰好是"从点向右长");
 * 左臂(在点左侧)把同一个进度镜像成从右边缘向左描画(`inset(0 0 0 R%)`),
 * 这样两臂在任意时刻的可见长度相等、都以点为起点——形状约束仍然成立,
 * 只是复用同一个 `drawLine` 的输出、不重新实现它的时间/缓动逻辑。
 */
const NeutralDivider: React.FC<{
  width: number; height: number; theme: CardTheme;
  leftDraw: React.CSSProperties; rightDraw: React.CSSProperties;
}> = ({width, height, theme, leftDraw, rightDraw}) => {
  const armLength = scaleFont(width, height, 40);
  const lineHeight = Math.max(2, Math.round(scaleFont(width, height, 2)));
  const dotSize = scaleFont(width, height, 10);
  const armBase: React.CSSProperties = {width: armLength, height: lineHeight, background: theme.title, opacity: 0.35};
  // 分隔件是结构性元素而非文案, 沿用 theme.title 这个"墨色"角色(叠加透明度) ——
  // 不为它单独开一个 token, card/illustration 两套里它都该和标题同一色系。
  return (
    <div style={{display: 'flex', flexDirection: 'row', alignItems: 'center'}}>
      <div style={{...armBase, ...leftDraw}} />
      <div
        style={{
          width: dotSize, height: dotSize, borderRadius: '50%', background: theme.title, opacity: 0.55,
          margin: `0 ${scaleFont(width, height, 10)}px`,
        }}
      />
      <div style={{...armBase, ...rightDraw}} />
    </div>
  );
};

/**
 * 对照卡：左右两组东西 + 中间一个中性分隔件, 讲 A 与 B 的对照。
 *
 * 左右两列用 flex row 平分, 分隔件居中 —— 不用绝对坐标摆放三块内容。
 *
 * 动效(三十二期 Task 3): 左右两组各自 `slideIn('left'|'right')` 整组一起滑入
 * (套在 column 外层, 不是 label/text 分开滑, 两者步调一致才像"一组")，
 * 中间分隔件的两条臂用 `drawLine` 描画。`Live` 只接管到位之后的 idle,
 * `from` 设成对应 anim 结束的时刻。
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
  style?: ShotStyle;
}> = ({slots, theme, style}) => {
  const {width, height, fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const box = safeBox(width, height);
  const leftText = assertContent(slots.leftText, 'contrast.leftText');
  const rightText = assertContent(slots.rightText, 'contrast.rightText');
  const leftLabel = assertContent(slots.leftLabel, 'contrast.leftLabel');
  const rightLabel = assertContent(slots.rightLabel, 'contrast.rightLabel');
  const t = speedT(style);
  const accentColor = resolveAccent(style?.accent, theme.accent);

  const slideAtSec = t(0.15);
  const slideArriveAt = slideAtSec + 0.5;
  const leftSlide = slideIn(frame, fps, slideAtSec, 'left');
  const rightSlide = slideIn(frame, fps, slideAtSec, 'right');

  const drawAtSec = t(0.5);
  const drawArriveAt = drawAtSec + 0.5;
  const rightDraw = drawLine(frame, fps, drawAtSec);
  // 镜像成从右边缘向左描画, 让左臂"从点向左长"——见 NeutralDivider 顶部注释。
  const drawPct = String(rightDraw.clipPath).match(/inset\(0 (\d+(?:\.\d+)?)% 0 0\)/)?.[1] ?? '0';
  const leftDraw: React.CSSProperties = {clipPath: `inset(0 0 0 ${drawPct}%)`};

  const column = (label: string, text: string, seed: number, slide: React.CSSProperties) => (
    <div
      style={{
        flex: 1,
        // flex:1 的子项默认 min-width:auto, 内容(尤其是不含空格的长文本)会撑破
        // 分配到的那一份宽度、把兄弟列挤到安全区外——这不是审查压力测试测出来的,
        // 是 flexbox 本身的已知坑, 顺手一起修了。minWidth:0 让它老实按分配宽度换行。
        minWidth: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        ...slide,
      }}
    >
      <Live seed={seed} from={slideArriveAt} style={{fontFamily: FONT_CN, fontSize: scaleFont(width, height, 28), color: accentColor, letterSpacing: '0.1em'}}>
        {label}
      </Live>
      <Live
        seed={seed + 1}
        from={slideArriveAt}
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
        ...scaleStyle(style),
      }}
    >
      {column(leftLabel, leftText, 1, leftSlide)}
      <Live
        seed={5}
        from={drawArriveAt}
        style={{padding: `0 ${scaleFont(width, height, 24)}px`}}
      >
        <NeutralDivider width={width} height={height} theme={theme} leftDraw={leftDraw} rightDraw={rightDraw} />
      </Live>
      {column(rightLabel, rightText, 3, rightSlide)}
    </AbsoluteFill>
  );
};
