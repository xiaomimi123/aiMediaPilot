import React from 'react';
import {Composition} from 'remotion';
import {Film} from './Film';

const DEFAULTS = {shots: [], audioSrc: null, aspect: '16:9' as const};

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
