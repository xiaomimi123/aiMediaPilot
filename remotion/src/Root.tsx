import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';

const DEFAULTS = {
  shots: [], audioSrc: null, bgm: null, captions: [], aspect: '16:9' as const,
  visualStyle: 'card' as const, // Studio 里默认预览用 card 风格
  sourceVideo: null, // 出镜视频层(二十九期 Task 3)——必填字段, Studio 预览默认不带出镜视频
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="landscape" component={Film} durationInFrames={300} fps={30}
      width={1920} height={1080} defaultProps={DEFAULTS}
    />
    <Composition
      id="portrait" component={Film} durationInFrames={300} fps={30}
      width={1080} height={1920} defaultProps={{...DEFAULTS, aspect: '9:16' as const}}
    />
  </>
);
