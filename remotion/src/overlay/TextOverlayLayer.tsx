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

  /*
   * 样式改版(2026-09-15, 用户对真实成片的样式否决): 原先 keyword 是蓝字白描边
   * 裸浮在画面上, 没有底衬, 观感廉价。改成"深字亮底色块"—— 亮黄圆角块 + 微倾斜,
   * 这是压在任意实拍画面上都清晰、又带综艺花字质感的做法; note 白字加细黑描边
   * (原来只有阴影, 亮背景上会糊)。箭头保持白色粗体。
   */
  const chip = isKeyword
    ? {
        background: '#ffd84d',
        color: '#141820',
        padding: `${scaleFont(width, height, 8)}px ${scaleFont(width, height, 20)}px`,
        borderRadius: scaleFont(width, height, 14),
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      }
    : null;

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
        // 那条坐标线而不是顶边。倾斜只给 keyword 色块(花字质感), 与锚点位移
        // 叠乘写在同一个 transform 里。
        transform: [
          pos.anchor === 'bottom' ? 'translateY(-100%)' : '',
          isKeyword ? 'rotate(-2deg)' : '',
        ].filter(Boolean).join(' ') || undefined,
        fontFamily: FONT_CN,
        fontSize,
        fontWeight: isKeyword ? 900 : kind === 'note' ? 600 : 700,
        color: '#ffffff',
        ...(chip ?? {}),
        ...(!isKeyword
          ? {
              WebkitTextStroke: `${scaleFont(width, height, 3)}px rgba(10,12,18,0.85)`,
              paintOrder: 'stroke' as const,
              textShadow: '0 2px 8px rgba(0,0,0,0.5)',
            }
          : {}),
        whiteSpace: 'pre-line',
        // keyword 色块带内边距, 0.42 屏宽会把 7 字标题挤换行(真机抓帧: "不懂技术
        // 的用户"折行且第二行压住下方注释)。色块放宽到 0.72 并按内容自适应宽,
        // 想要多行仍用显式 \n(pre-line 保留); note/arrow 维持 0.42。
        width: isKeyword ? ('max-content' as const) : undefined,
        maxWidth: width * (isKeyword ? 0.72 : 0.42),
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
            fontWeight: 600,
            color: 'rgba(255,255,255,0.92)',
            // 半透明胶囊底(2026-09-15 样式改版): 裸文字角标在浅色画面上会消失
            background: 'rgba(10,12,18,0.45)',
            padding: `${scaleFont(width, height, 6)}px ${scaleFont(width, height, 14)}px`,
            borderRadius: scaleFont(width, height, 999),
            letterSpacing: '0.08em',
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
