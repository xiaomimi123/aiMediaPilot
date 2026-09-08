import React from 'react';
import {Sequence, useVideoConfig, useCurrentFrame} from 'remotion';
import {FONT_CN} from '../motion/lib';
import {scaleFont} from '../layout/grid';
import {smashIn, fadeUp} from '../motion/anim';
import {overlayPosition, type OverlayAspect, type OverlayPersonSide} from './position';
import type {CardTheme} from '../theme';

/**
 * 文字叠加层(三十七期 Task 3)——真人口播链的关键词大字/注解/箭头 + 常驻角标。
 *
 * 与 `remotion/src/cards/*` 不是同一类东西, 刻意放在 `overlay/` 目录而不是
 * `cards/`: `card-registry.test.ts` 的"卡片里不许出现绝对定位"断言只扫
 * `remotion/src/cards/` 目录——这里是**画面内容层**(与字幕层 `Captions.tsx`
 * 同一类东西: 全片时间轴上独立于分镜卡片的常驻/间歇层), 天然需要绝对定位来
 * 落在 `overlayPosition` 算出的归一化坐标上, 不受卡片"版面必须走栅格"的约束。
 *
 * `overlayPosition`/`overlaySlotRect` 是这个组件与剪辑台拖拽层(Task 6)共用的
 * 唯一几何真源(见 `./position.ts` 顶部注释), 不在这里重新算坐标。
 */

/** 与主项目 `overlay-plan.ts` 的 `OverlayItem` 逐字段同形, **不 import**(独立子项目, 理由同 `CaptionItem`)。 */
export type TextOverlayItem = {
  kind: 'keyword' | 'note' | 'arrow';
  text: string;
  slot: string;
  startMs: number;
  endMs: number;
  /** 用户拖拽覆盖的坐标(0~1 归一化)——存在则 `overlayPosition` 优先用它。 */
  x?: number;
  y?: number;
};

/** 三种元素各自的基准字号(按短边缩放, 见 `scaleFont`)。 */
const KIND_FONT_BASE: Record<TextOverlayItem['kind'], number> = {
  keyword: 64,
  note: 36,
  arrow: 48,
};

/**
 * 单条叠加元素的渲染。**必须是 `<Sequence>` 的直接子组件**才能拿到相对于
 * 这条叠加自己时间窗归零的 `useCurrentFrame()`——与四张卡片组件读 frame 的
 * 方式完全一致(见 `cards/Statement.tsx` 等), 动效 atSec 因此可以从 0 起算,
 * 不需要额外做绝对时间换算。
 */
const OverlayItemView: React.FC<{
  item: TextOverlayItem;
  pos: {x: number; y: number; anchor: 'top' | 'bottom'};
  width: number;
  height: number;
  index: number;
}> = ({item, pos, width, height, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();

  const kind = item.kind;
  const text = kind === 'arrow' && item.text.trim().length === 0 ? '↓' : item.text;

  // keyword: smashIn(过冲砸落, 0.42s 内完成); note/arrow: fadeUp——两者都从 0s
  // 起跑(这条叠加自己的时间窗刚开始), 惯例与卡片组件的"所有 anim 调用的 atSec
  // 走同一套相对时间"一致。
  const entrance = kind === 'keyword' ? smashIn(frame, fps, 0) : fadeUp(frame, fps, 0);

  const isKeyword = kind === 'keyword';
  const fontSize = scaleFont(width, height, KIND_FONT_BASE[kind]);

  return (
    <div
      data-overlay-idx={index}
      style={{
        position: 'absolute',
        left: pos.x * width,
        top: pos.y * height,
        // 锚点按 anchor 决定 translate 方向: 'top' 时 (x,y) 就是元素左上角,
        // 不需要额外偏移; 'bottom'(目前只有 bottom-center 槽位)时 (x,y) 是
        // 元素左下角, 用 translateY(-100%) 把元素向上翻上去, 保证底边贴住
        // 那条坐标线而不是顶边。
        transform: pos.anchor === 'bottom' ? 'translateY(-100%)' : undefined,
        fontFamily: FONT_CN,
        fontSize,
        fontWeight: isKeyword ? 900 : kind === 'note' ? 500 : 700,
        color: isKeyword ? '#2f6bff' : '#ffffff',
        // 白描边只给 keyword 蓝大字用(参考 `cards/Stat.tsx` 主数字的描边写法)——
        // 白描边是为了蓝字压在各种背景(含出镜视频画面)上仍然清晰可辨, 与
        // `theme.stroke` 无关(那是给卡片数字配色用的, 各主题取值不同, 这里
        // 刻意写死白色)。
        WebkitTextStroke: isKeyword ? `${scaleFont(width, height, 3)}px #ffffff` : undefined,
        paintOrder: isKeyword ? 'stroke' : undefined,
        textShadow: !isKeyword ? '0 1px 4px rgba(0,0,0,0.55)' : undefined,
        whiteSpace: 'pre-line',
        maxWidth: width * 0.42,
        lineHeight: 1.25,
        ...entrance,
      }}
    >
      {text}
    </div>
  );
};

export const TextOverlayLayer: React.FC<{
  overlays: TextOverlayItem[];
  overlayPersonSide: OverlayPersonSide;
  /** `null`/缺省 = 不显示。 */
  cornerBadge: string | null;
  aspect: OverlayAspect;
  theme: CardTheme;
}> = ({overlays, overlayPersonSide, cornerBadge, aspect}) => {
  const {width, height, fps} = useVideoConfig();

  return (
    <>
      {overlays.map((item, i) => {
        const from = Math.round((item.startMs / 1000) * fps);
        const dur = Math.max(1, Math.round(((item.endMs - item.startMs) / 1000) * fps));
        const pos = overlayPosition(aspect, overlayPersonSide, item);
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <OverlayItemView item={item} pos={pos} width={width} height={height} index={i} />
          </Sequence>
        );
      })}
      {cornerBadge ? (
        // 常驻角标: 全片时长恒显, 不套 Sequence、不接入 anim.ts(brief: "无动效")。
        <div
          data-overlay-corner-badge
          style={{
            position: 'absolute',
            top: scaleFont(width, height, 28),
            right: scaleFont(width, height, 28),
            fontFamily: FONT_CN,
            fontSize: scaleFont(width, height, 20),
            fontWeight: 500,
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            whiteSpace: 'pre-line',
            textAlign: 'right',
            lineHeight: 1.4,
          }}
        >
          {cornerBadge}
        </div>
      ) : null}
    </>
  );
};
