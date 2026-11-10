import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Film, FilmProps, FPS } from './Film';
import './fonts';

const empty: FilmProps = {
  project: null as unknown as FilmProps['project'],
  timeline: { durationSec: 1, cards: [], captions: [] },
};

registerRoot(() => (
  <Composition
    id="Film"
    component={Film}
    fps={FPS}
    width={1920}
    height={1080}
    durationInFrames={FPS}
    defaultProps={empty}
    calculateMetadata={({ props }) => ({ durationInFrames: Math.ceil(props.timeline.durationSec * FPS) })}
  />
));
