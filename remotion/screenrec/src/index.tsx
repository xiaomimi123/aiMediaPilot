import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Film, FPS } from './Film';
registerRoot(() => (
  <Composition id="Film" component={Film as any} fps={FPS} width={1920} height={1080} durationInFrames={FPS}
    defaultProps={{ timeline: { durationSec: 1, cards: [], captions: [] }, project: { cards: [] } } as any}
    calculateMetadata={({ props }: any) => ({ durationInFrames: Math.ceil(props.timeline.durationSec * FPS) })} />
));
