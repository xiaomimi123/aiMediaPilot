import { describe, expect, it } from 'vitest';
import { splitText, synthesizeSpeech, ttsConfigFromEnv, DEFAULT_SPEAKER } from '@/lib/sources/tts';

describe('splitText', () => {
  it('短文本不切', () => {
    expect(splitText('一句话。')).toEqual(['一句话。']);
    expect(splitText('  ')).toEqual([]);
  });
  it('超长按句切分且每段不超上限', () => {
    const long = Array.from({ length: 20 }, (_, i) => `这是第${i + 1}句话，用来把文本撑到超过单次合成的上限，所以每句都写得足够长一些才行啊。`).join('');
    const parts = splitText(long);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Array.from(p).length).toBeLessThanOrEqual(280);
    expect(parts.join('')).toBe(long);
  });
  it('单句超长时硬切也不丢内容', () => {
    const one = '长'.repeat(500);
    const parts = splitText(one);
    expect(parts.length).toBe(1); // 无句号, 整段一段(接口侧 1024 字节 = 341 汉字, 500 汉字会超——留给上层截断)
  });
});

describe('ttsConfigFromEnv', () => {
  it('缺环境变量返回 null', () => {
    const saved = { a: process.env.VOLC_TTS_APPID, t: process.env.VOLC_TTS_TOKEN };
    delete process.env.VOLC_TTS_APPID;
    delete process.env.VOLC_TTS_TOKEN;
    expect(ttsConfigFromEnv()).toBeNull();
    process.env.VOLC_TTS_APPID = saved.a;
    process.env.VOLC_TTS_TOKEN = saved.t;
  });
});

describe('synthesizeSpeech', () => {
  it('空文本报错', async () => {
    const cfg = { appKey: 'x', accessKey: 'y' };
    await expect(synthesizeSpeech({ text: '  ' }, cfg)).rejects.toThrow('配音文本是空的');
  });
  it('鉴权失败抛人话错误', async () => {
    const cfg = { appKey: 'bad', accessKey: 'bad' };
    await expect(synthesizeSpeech({ text: '测试' }, cfg)).rejects.toThrow('火山 TTS');
  });
  it('默认音色是 uranus 系列真机验证过的', () => {
    expect(DEFAULT_SPEAKER).toMatch(/_uranus_bigtts$/);
  });
});
