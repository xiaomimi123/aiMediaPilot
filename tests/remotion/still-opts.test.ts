import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { STILL_RENDER_OPTS, stillPath } from '../../remotion/scripts/still-opts';

describe('keyframe stills', () => {
  it('renders small jpegs so many review rounds do not bloat the conversation', () => {
    expect(STILL_RENDER_OPTS).toEqual({ imageFormat: 'jpeg', jpegQuality: 80, scale: 0.5 });
    expect(stillPath('/f/stills', 12.2)).toBe(path.join('/f/stills', '12.2.jpg'));
  });
});
