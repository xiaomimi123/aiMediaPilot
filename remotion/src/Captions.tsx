import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {safeBox, scaleFont} from './layout/grid';
import {pickCurrentCaption, splitCaptionIntoChunks, isWordActive} from './caption-logic';
import type {CaptionItem} from './Film';

/**
 * 字幕层(二十八期; 二十九期 Task 5 加逐词高亮)。
 *
 * 真实签名核对(brief 里的示例代码写错了, 这里按 `layout/grid.ts` 的实际签名改):
 * `safeBox(width, height)` 返回的是 `{left, right, top, bottom, innerWidth,
 * innerHeight}` 这套像素值——不是 `{x, y, w, h}`; `scaleFont` 的参数顺序是
 * `(width, height, base)`。只改这里的调用方式, 不碰 grid.ts。
 *
 * 逐词高亮只在 `current.words` 存在时生效(`splitCaptionIntoChunks` 在没有
 * `words` 时原样返回整句一个 chunk, 渲染结果与二十八期整句显示零差异)——
 * 只有 ppt-narration/illustration-tts 两条 TTS 链会填 `words`
 * (`src/lib/video-production/align-captions.ts`), talking-head-broll 没有,
 * 这里不需要关心调用方是谁, 有数据就高亮、没有就保持老行为。
 */

// 给字幕文字预留的框高(按短边缩放), 留够最多两行不越界。
const CAPTION_BOX_HEIGHT_BASE = 120;
const CAPTION_FONT_SIZE_BASE = 44;

export const Captions: React.FC<{items: CaptionItem[]; highlightColor?: string}> = ({
  items,
  // 默认值只是防御性兜底(理论上所有调用点都会显式传 theme.highlight),
  // 与四张卡片组件的"必填但仍给防御性默认值"同一惯例(见 Film.tsx 顶部注释)。
  highlightColor = '#f2c744',
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const current = pickCurrentCaption(items, nowMs);
  if (!current) return null;

  const box = safeBox(width, height);
  const captionBoxHeight = scaleFont(width, height, CAPTION_BOX_HEIGHT_BASE);
  const chunks = splitCaptionIntoChunks(current.text, current.words);

  return (
    <div
      style={{
        position: 'absolute',
        left: box.left,
        width: box.innerWidth,
        // 贴着底部安全区上沿: box.bottom 之下是平台 UI 遮挡带(见 grid.ts 顶部
        // 注释), 字幕框自身再留出 captionBoxHeight, 保证文字本身不会探进去。
        top: height - box.bottom - captionBoxHeight,
        height: captionBoxHeight,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: scaleFont(width, height, CAPTION_FONT_SIZE_BASE),
        fontWeight: 700,
        color: 'rgba(20,24,32,0.92)',
        textShadow: '0 1px 2px rgba(255,255,255,0.8)',
        lineHeight: 1.4,
      }}
    >
      {chunks.map((chunk, i) => {
        const active = isWordActive(chunk.word, nowMs);
        return (
          <span
            key={i}
            style={
              active
                ? {color: highlightColor, fontWeight: 900, textShadow: '0 1px 3px rgba(0,0,0,0.35)'}
                : undefined
            }
          >
            {chunk.text}
          </span>
        );
      })}
    </div>
  );
};
