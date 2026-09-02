import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {safeBox, scaleFont} from './layout/grid';
import {pickCurrentCaption} from './caption-logic';
import type {CaptionItem} from './Film';

/**
 * 字幕层(二十八期)。
 *
 * 真实签名核对(brief 里的示例代码写错了, 这里按 `layout/grid.ts` 的实际签名改):
 * `safeBox(width, height)` 返回的是 `{left, right, top, bottom, innerWidth,
 * innerHeight}` 这套像素值——不是 `{x, y, w, h}`; `scaleFont` 的参数顺序是
 * `(width, height, base)`。只改这里的调用方式, 不碰 grid.ts。
 *
 * 只显示当前句, 不做逐词卡拉OK(那要字级对齐, 二十九期)。
 */

// 给字幕文字预留的框高(按短边缩放), 留够最多两行不越界。
const CAPTION_BOX_HEIGHT_BASE = 120;
const CAPTION_FONT_SIZE_BASE = 44;

export const Captions: React.FC<{items: CaptionItem[]}> = ({items}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const current = pickCurrentCaption(items, nowMs);
  if (!current) return null;

  const box = safeBox(width, height);
  const captionBoxHeight = scaleFont(width, height, CAPTION_BOX_HEIGHT_BASE);

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
      {current.text}
    </div>
  );
};
