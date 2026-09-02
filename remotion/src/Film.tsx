import React from 'react';
import {AbsoluteFill, Audio, Sequence, staticFile, useVideoConfig} from 'remotion';
import {CARDS} from './cards';
import {C} from './motion/lib';
import {Ambient} from './motion/ambient';
import {CameraRig} from './motion/camera';
import {Captions} from './Captions';

/**
 * 每镜的单调推近幅度(二十六期, 补环境运动层缺口)。
 *
 * 用 `CameraRig` 给每一镜的画面套一段整镜时长内单调递增的缓慢放大——这是
 * "单调项"天然的来源(见 `motion/ambient.tsx` 顶部注释里的 A/B 结论: 只有 yoyo
 * 呼吸会在正弦折返点留洞, 需要一个恒定斜率的分量填住)。放在 Film 层而不是塞进
 * `Ambient` 本身, 是因为推近需要按"这一镜多长"归一化(`CameraRig` 的 `durationSec`
 * 参数本来就是这么设计的), 而 `Ambient` 是无镜头感知的全局叠加层。
 *
 * 实测(见 ambient-layer-report.md): 4.5%~5% 的放大量, 在 5 秒左右的镜头里
 * 肉眼几乎看不出"在推镜", 但已经是 freezedetect 能稳定测到的像素变化率;
 * 加到 8%+ 在 statement 这类长文字镜上开始能看出画面在慢慢变大, 观感变得
 * 不安分——所以没有再往上加。**镜与镜之间会跳变一次**(`CameraRig` 按
 * `durationSec` 归一化、每镜从 scale=1 重新起跑), 但那正是切镜本身的边界,
 * 不是无端的抖动, 抽帧检查过没有观感问题。
 */
const CAMERA_PUSH_IN = 0.045;

/** 一句字幕(二十八期)。startMs/endMs 是相对全片的绝对时间, 不是相对某一镜。 */
export type CaptionItem = {text: string; startMs: number; endMs: number};

export type FilmInput = {
  shots: {shotId: string; startMs: number; endMs: number; card: keyof typeof CARDS; slots: any}[];
  audioSrc: string | null; // 人声, staticFile 相对路径; renderFilm 负责填入
  bgm: {src: string; volume: number} | null; // BGM, loop 到片长; renderFilm 负责填入
  captions: CaptionItem[]; // 逐句字幕, 缺省 []
  aspect: '16:9' | '9:16';
};

/**
 * 顶层合成(Task 4 接入卡片; 二十八期接人声/BGM/字幕层)。画面不再是占位的
 * 宽高数字, 而是按 shots 时间轴挑卡片、把槽位喂给对应组件 —— 版面由卡片组件
 * 保证, Film 只负责排布时间轴。
 *
 * `bgm`/`captions` 给默认值——旧调用(含既有的 ambient-layer 测试)不传这两个
 * 字段也能跑, 不必逐个改老调用点。
 */
export const Film: React.FC<FilmInput> = ({shots, audioSrc, bgm = null, captions = []}) => {
  const {fps} = useVideoConfig();
  return (
    <AbsoluteFill style={{backgroundColor: C.paper}}>
      {shots.map((s) => {
        const Card = CARDS[s.card];
        const from = Math.round((s.startMs / 1000) * fps);
        const dur = Math.round(((s.endMs - s.startMs) / 1000) * fps);
        const durationSec = dur / fps;
        return (
          <Sequence key={s.shotId} from={from} durationInFrames={dur}>
            <CameraRig
              path={[
                {t: 0, scale: 1},
                {t: durationSec, scale: 1 + CAMERA_PUSH_IN},
              ]}
              durationSec={durationSec}
            >
              <Card slots={s.slots} durationInFrames={dur} />
            </CameraRig>
          </Sequence>
        );
      })}
      {/* 环境运动层(二十六期): 全片底噪, 保证没有一帧彻底静止。见 motion/ambient.tsx。 */}
      <Ambient />
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
      {bgm ? <Audio src={staticFile(bgm.src)} loop volume={bgm.volume} /> : null}
      <Captions items={captions} />
    </AbsoluteFill>
  );
};
