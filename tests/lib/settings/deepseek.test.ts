import { describe, expect, it } from 'vitest';
import { isValidDeepSeekKey, maskKey, testDeepSeekKey } from '@/lib/settings/deepseek';

const res = (status: number) => (async () => ({ status, ok: status >= 200 && status < 300 })) as unknown as typeof fetch;

describe('deepseek key helpers', () => {
  it('validates the key format', () => {
    expect(isValidDeepSeekKey('sk-' + 'a'.repeat(32))).toBe(true);
    expect(isValidDeepSeekKey('sk-short')).toBe(false);
    expect(isValidDeepSeekKey('abc')).toBe(false);
  });
  it('masks all but the last 4 characters', () => {
    expect(maskKey('sk-abcdefghijklmnopqrstuvwx1234')).toBe('sk-…1234');
    expect(maskKey(null)).toBeNull();
  });
  it('explains test results in plain Chinese', async () => {
    expect(await testDeepSeekKey('sk-x', res(200))).toEqual({ ok: true, message: '连接成功，这个 key 可以用。' });
    expect((await testDeepSeekKey('sk-x', res(401))).message).toBe('DeepSeek 说这个 key 无效，检查是否复制完整或已被删除。');
    const down = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const slow = (async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }) as unknown as typeof fetch;
    expect((await testDeepSeekKey('sk-x', slow)).message).toBe('连接 DeepSeek 超时（10 秒），检查网络后再试。');
    expect((await testDeepSeekKey('sk-x', down)).message).toBe('连不上 DeepSeek（ENOTFOUND），检查网络后再试。');
  });
});
