import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {CARDS} from './cards';
import {C} from './motion/lib';

export type FilmInput = {
  shots: {shotId: string; startMs: number; endMs: number; card: keyof typeof CARDS; slots: any}[];
  audioSrc: string | null;
  aspect: '16:9' | '9:16';
};

/**
 * 顶层合成(Task 4 接入卡片)。画面不再是占位的宽高数字, 而是按 shots 时间轴
 * 挑卡片、把槽位喂给对应组件 —— 版面由卡片组件保证, Film 只负责排布时间轴。
 */
export const Film: React.FC<FilmInput> = ({shots, audioSrc}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: C.paper}}>
      {shots.map((s) => {
        const Card = CARDS[s.card];
        const from = Math.round((s.startMs / 1000) * fps);
        const dur = Math.round(((s.endMs - s.startMs) / 1000) * fps);
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur}>
            <Card slots={s.slots} durationInFrames={dur} />
          </Sequence>
        );
      })}
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
    </AbsoluteFill>
  );
};
