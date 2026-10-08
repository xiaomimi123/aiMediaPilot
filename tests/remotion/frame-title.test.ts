import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Frame title zone', () => {
  it('clips an over-long section title instead of spilling into other zones', () => {
    const src = fs.readFileSync('remotion/kit/Frame.tsx', 'utf8');
    const title = src.slice(src.indexOf('...Z.title'), src.indexOf('{title}'));
    expect(title).toContain("overflow: 'hidden'");
  });
});
