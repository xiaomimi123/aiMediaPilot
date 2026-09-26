import { describe, expect, it } from 'vitest';
import { encodeSse, parseSseBuffer } from '@/lib/agent/sse';

describe('sse', () => {
  it('round-trips events and keeps an incomplete tail', () => {
    const buf = encodeSse({ type: 'text', delta: '你好\n世界' }) + encodeSse({ type: 'done' }) + 'data: {"type":"te';
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([{ type: 'text', delta: '你好\n世界' }, { type: 'done' }]);
    expect(rest).toBe('data: {"type":"te');
  });
});
