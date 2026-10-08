import { describe, expect, it } from 'vitest';
import { stillSecs, type ShotsFile } from '@/lib/film/shots';

const file: ShotsFile = {
  version: 1,
  shots: [
    { id: 'hook', fromSec: 0, toSec: 4.7, intent: '开场' },
    { id: 'stuck', fromSec: 4.7, toSec: 6.1, intent: '卡住' },
    { id: 'proof', fromSec: 35.1, toSec: 40.1, intent: '实证' },
  ],
};

describe('stillSecs', () => {
  it('picks one keyframe second per shot', () => {
    expect(stillSecs(file)).toEqual([1.2, 5.4, 36.3]);
  });
  it('renders only the named shots when re-checking', () => {
    expect(stillSecs(file, ['proof', 'hook'])).toEqual([1.2, 36.3]);
  });
  it('rejects an unknown shot id with the ids that exist', () => {
    expect(() => stillSecs(file, ['hok'])).toThrow('镜头表里没有：hok（有：hook、stuck、proof）');
  });
});
