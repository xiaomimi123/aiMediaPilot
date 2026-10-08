import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { C, FONT } from './tokens';
import { useLayout } from './layout';
import { Captions, type CaptionLine } from './Captions';

const GRID = 70;

/**
 * 固定画框: 方格纸底 + 左上标题区 + 内容区(overflow hidden, 内容不可能压到小窗与字幕)
 * + 右上角人物小窗(口播原片, 带原声) + 底部字幕。每条片子只往 children(内容区)里放东西。
 */
export const Frame: React.FC<{
  video: string;
  pipFocus?: string;
  captions: CaptionLine[];
  highlights?: string[];
  title?: React.ReactNode;
  children: React.ReactNode;
}> = ({ video, pipFocus = '50% 20%', captions, highlights, title, children }) => {
  const { ZONE: Z } = useLayout();
  return (
    <AbsoluteFill
      style={{
        // 画框统一字体与字色: 没被组件包起来的文字也不会回退到衬线体
        fontFamily: FONT,
        color: C.ink,
        background: C.bg,
        backgroundImage: `linear-gradient(${C.grid} 2px, transparent 2px), linear-gradient(90deg, ${C.grid} 2px, transparent 2px)`,
        backgroundSize: `${GRID}px ${GRID}px`,
      }}
    >
      {title && (
        <div
          style={{
            position: 'absolute',
            ...Z.title,
            // 标题太长时裁掉, 不压到小窗/内容区(横版标题区只有 336 宽)
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          {title}
        </div>
      )}
      <div style={{ position: 'absolute', ...Z.content, overflow: 'hidden' }}>{children}</div>
      <div
        style={{
          position: 'absolute',
          ...Z.pip,
          borderRadius: 36,
          border: '12px solid #fff',
          boxShadow: '0 20px 60px rgba(15,23,42,0.18)',
          overflow: 'hidden',
          background: C.ink,
        }}
      >
        <OffthreadVideo
          src={staticFile(video)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: pipFocus,
          }}
        />
      </div>
      <Captions lines={captions} highlights={highlights} />
    </AbsoluteFill>
  );
};
