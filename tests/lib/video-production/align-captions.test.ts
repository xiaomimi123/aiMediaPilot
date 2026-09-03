import { describe, expect, it } from 'vitest';
import {
  buildWordsForEvents,
  mapSegmentsToWords,
  parseTimingPayload,
  type TimingPayload,
} from '@/lib/video-production/align-captions';
import { numberToHanzi } from '@/lib/tts/number-to-hanzi';
import type { CaptionEvent } from '@/lib/video-production/ass-captions';

describe('parseTimingPayload', () => {
  it('解析合法的 timing.json', () => {
    const raw = JSON.stringify({
      sr: 16000,
      total: 1.2,
      sentences: [{ i: 0, text: '你好', start: 0, end: 1, match: 1, ok: true, words: [] }],
    });
    const parsed = parseTimingPayload(raw);
    expect(parsed?.sentences.length).toBe(1);
  });

  it('损坏的 JSON 返回 null (降级路径)', () => {
    expect(parseTimingPayload('{not valid json')).toBeNull();
  });

  it('形状不对(缺 sentences)返回 null', () => {
    expect(parseTimingPayload(JSON.stringify({ sr: 16000, total: 1 }))).toBeNull();
  });

  it('sentences 里缺 words 数组返回 null', () => {
    const raw = JSON.stringify({
      sr: 16000,
      total: 1,
      sentences: [{ i: 0, text: 'x', start: 0, end: 1, match: 1, ok: true }],
    });
    expect(parseTimingPayload(raw)).toBeNull();
  });
});

describe('mapSegmentsToWords', () => {
  it('字面段逐字成词, 数字转换段合并成一个词(取时间戳并集)', () => {
    const { segments, hanzi } = numberToHanzi('调用成本3000元。');
    expect(hanzi).toBe('调用成本三千元。'); // 确认测试前置假设没跑偏
    // hanzi 里参与对齐的字符按顺序: 调 用 成 本 三 千 元 (句号被跳过)
    const charTimes = [
      { startMs: 0, endMs: 100 }, // 调
      { startMs: 100, endMs: 200 }, // 用
      { startMs: 200, endMs: 300 }, // 成
      { startMs: 300, endMs: 400 }, // 本
      { startMs: 400, endMs: 500 }, // 三
      { startMs: 500, endMs: 650 }, // 千
      { startMs: 650, endMs: 750 }, // 元
      null, // 。 不参与对齐
    ];
    const words = mapSegmentsToWords(segments, charTimes);
    expect(words).toEqual([
      { word: '调', startMs: 0, endMs: 100 },
      { word: '用', startMs: 100, endMs: 200 },
      { word: '成', startMs: 200, endMs: 300 },
      { word: '本', startMs: 300, endMs: 400 },
      // "3000" 是原文里的数字串, 合并成一个词, 时间取"三千"两字的并集
      { word: '3000', startMs: 400, endMs: 650 },
      { word: '元', startMs: 650, endMs: 750 },
    ]);
  });

  it('某数字段完全没拿到时间戳时整体跳过, 不伪造时间', () => {
    const { segments } = numberToHanzi('涨幅32.2%');
    const charTimes = new Array('百分之三十二点二'.length).fill(null);
    expect(mapSegmentsToWords(segments, charTimes)).toEqual([]);
  });
});

describe('buildWordsForEvents', () => {
  const events: CaptionEvent[] = [{ startMs: 0, endMs: 1000, text: '调用成本3000元。' }];

  function timingFor(text: string, hanzi: string, ok = true): TimingPayload {
    const words = hanzi
      .split('')
      .filter((ch) => /[一-鿿]/.test(ch))
      .map((_, i) => ({ text: '', start: i * 0.1, end: (i + 1) * 0.1 }));
    return {
      sr: 16000,
      total: 1,
      sentences: [{ i: 0, text: hanzi, start: 0, end: 1, match: ok ? 1 : 0.5, ok, words }],
    };
  }

  it('对得上时产出词级数据, 且质量统计正确', () => {
    const { hanzi } = numberToHanzi(events[0].text);
    const timing = timingFor(events[0].text, hanzi, true);
    const result = buildWordsForEvents(events, timing);
    expect(result.wordsPerEvent[0]?.length).toBeGreaterThan(0);
    expect(result.quality).toEqual({ lowMatchCount: 0, totalSentences: 1 });
  });

  it('match<0.90(ok=false) 计入 lowMatchCount, 但仍然产词(只报不拦)', () => {
    const { hanzi } = numberToHanzi(events[0].text);
    const timing = timingFor(events[0].text, hanzi, false);
    const result = buildWordsForEvents(events, timing);
    expect(result.quality).toEqual({ lowMatchCount: 1, totalSentences: 1 });
    expect(result.wordsPerEvent[0]?.length).toBeGreaterThan(0);
  });

  it('timing 为 null (对齐器缺失/超时/崩溃) 整体降级为逐句字幕', () => {
    const result = buildWordsForEvents(events, null);
    expect(result.wordsPerEvent).toEqual([undefined]);
    expect(result.quality).toEqual({ lowMatchCount: 0, totalSentences: 1 });
  });

  it('timing.json 句数与字幕句数不一致时整体降级', () => {
    const timing: TimingPayload = { sr: 16000, total: 1, sentences: [] };
    const result = buildWordsForEvents(events, timing);
    expect(result.wordsPerEvent).toEqual([undefined]);
  });

  it('某句参照文本与 timing.json 记录的文本不一致(数据损坏)时该句降级', () => {
    const timing = timingFor(events[0].text, '完全对不上的参照文本', true);
    const result = buildWordsForEvents(events, timing);
    expect(result.wordsPerEvent).toEqual([undefined]);
  });
});
