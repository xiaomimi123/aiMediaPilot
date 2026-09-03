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

/*
 * NFKC 归一化回归(复审实测出的错位 bug)。
 *
 * python 侧对每个字符先 normalize("NFKC") 再判类别, 全角 "３" 被当 LATIN 消费一个
 * 词条; JS 侧若不做同样归一化, "３" 两个正则都不匹配、跳过且不消费词条 —— 游标
 * 从此错开, 该句后面每个字都错拿前一个字的时间戳(静默的系统性一位错位)。
 * 这条测试模拟 python 侧的消费顺序, 断言全角字符之后的汉字拿到**自己**的时间戳。
 */
describe('mapWordsToHanziChars 的 NFKC 归一化(经 buildWordsForEvents)', () => {
  it('全角数字被当 LATIN 消费一个词条, 其后汉字时间戳不错位', () => {
    const text = '价格３块钱';
    const fwEvents: CaptionEvent[] = [{ startMs: 0, endMs: 1000, text }];
    // numberToHanzi 不转全角(它只认 ASCII 数字), 参照文本 === 原文 —— 这正是
    // 触发场景: python 侧按 NFKC 后的类别消费, "价/格"(CJK)、"３"(LATIN)、
    // "块/钱"(CJK) 共 5 个词条, 逐个 100ms。
    const { hanzi } = numberToHanzi(text);
    expect(hanzi).toBe(text); // 前提自检: 全角数字不经过 numberToHanzi 转换
    // 用 0.25s 步长避开二进制浮点误差(0.1*3*1000 = 300.00000000000006 会让精确断言挂掉)
    const words = [0, 1, 2, 3, 4].map((i) => ({ text: '', start: i * 0.25, end: (i + 1) * 0.25 }));
    const timing: TimingPayload = {
      sr: 16000, total: 1,
      sentences: [{ i: 0, text: hanzi, start: 0, end: 0.5, match: 1, ok: true, words }],
    };
    const result = buildWordsForEvents(fwEvents, timing);
    const out = result.wordsPerEvent[0]!;
    // "块" 是第 4 个词条(750~1000ms) —— 若 JS 侧跳过 "３" 不消费, 它会错拿 500~750ms
    expect(out.find((w) => w.word === '块')).toEqual({ word: '块', startMs: 750, endMs: 1000 });
    expect(out.find((w) => w.word === '钱')).toEqual({ word: '钱', startMs: 1000, endMs: 1250 });
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
