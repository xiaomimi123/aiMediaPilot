import { describe, expect, it } from 'vitest';
import { parseRange } from '@/lib/files/range';

describe('parseRange', () => {
  it('returns null without a header (serve whole file)', () => {
    expect(parseRange(null, 1000)).toBeNull();
  });
  it('parses open-ended and closed ranges, clamping the end', () => {
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });
  it('parses suffix ranges', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });
  it('flags ranges starting past the end as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable');
  });
  it('ignores malformed headers', () => {
    expect(parseRange('items=0-1', 1000)).toBeNull();
    expect(parseRange('bytes=5-2', 1000)).toBeNull();
  });
});
