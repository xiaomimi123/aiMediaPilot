import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

/** 按秒放置一个镜头, 入场 0.3 秒(淡入 / 上移 / 左移) */
export const Shot: React.FC<{ from: number; to: number; enter?: 'fade' | 'up' | 'left'; children: React.ReactNode }> = ({
  from,
  to,
  enter = 'up',
  children,
}) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.round(from * fps)} durationInFrames={Math.max(1, Math.round((to - from) * fps))} layout="none">
      <Enter kind={enter}>{children}</Enter>
    </Sequence>
  );
};

const Enter: React.FC<{ kind: 'fade' | 'up' | 'left'; children: React.ReactNode }> = ({ kind, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = interpolate(frame, [0, 0.3 * fps], [0, 1], { extrapolateRight: 'clamp' });
  const offset = (1 - p) * 60;
  const transform = kind === 'up' ? `translateY(${offset}px)` : kind === 'left' ? `translateX(${offset}px)` : undefined;
  // 默认在内容区里垂直居中(否则内容堆在顶部, 下方与字幕之间大片空白)
  return (
    <AbsoluteFill style={{ opacity: p, transform, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>{children}</AbsoluteFill>
  );
};
