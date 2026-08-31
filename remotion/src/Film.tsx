import React from 'react';
import {AbsoluteFill, Audio, staticFile, useVideoConfig} from 'remotion';

export type FilmInput = {
  shots: unknown[];
  audioSrc: string | null;
  aspect: '16:9' | '9:16';
};

/**
 * 顶层合成。本任务只验通路: 拿到 inputProps、画一块底、挂上音频。
 * 真正的画面在 Task 4 由卡片组件接管。
 */
export const Film: React.FC<FilmInput> = ({audioSrc}) => {
  const {width, height} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: '#f3eeeb', justifyContent: 'center', alignItems: 'center'}}>
      <div style={{fontFamily: 'sans-serif', fontSize: 48, color: '#1a1a2e'}}>
        {width}×{height}
      </div>
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
