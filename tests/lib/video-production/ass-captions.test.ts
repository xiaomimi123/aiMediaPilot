import { describe, expect, it } from 'vitest';
import {
  hexToAssColor,
  formatAssTimestamp,
  buildAssCaptions,
  captionEventsFromTranscript,
  captionEventsFromAlignedActs,
  captionEventsFromSrt,
} from '@/lib/video-production/ass-captions';
import { defaultCaptionStyle } from '@/lib/video-template/model';

describe('hexToAssColor', () => {
  it('#RRGGBB 转成 ASS 的 &H00BBGGRR (BGR 逆序)', () => {
    expect(hexToAssColor('#FFFFFF')).toBe('&H00FFFFFF');
    expect(hexToAssColor('#FF0000')).toBe('&H000000FF'); // 纯红: R=FF 落在最后两位
    expect(hexToAssColor('#00FF00')).toBe('&H0000FF00');
    expect(hexToAssColor('#123456')).toBe('&H00563412');
  });

  it('小写十六进制也能转', () => {
    expect(hexToAssColor('#abcdef')).toBe('&H00EFCDAB');
  });
});

describe('formatAssTimestamp', () => {
  it('毫秒转 H:MM:SS.cc (百分秒)', () => {
    expect(formatAssTimestamp(0)).toBe('0:00:00.00');
    expect(formatAssTimestamp(1500)).toBe('0:00:01.50');
    expect(formatAssTimestamp(61230)).toBe('0:01:01.23');
    expect(formatAssTimestamp(3661000)).toBe('1:01:01.00');
  });
});

describe('buildAssCaptions', () => {
  const style = defaultCaptionStyle();

  it('产出含 Script Info / V4+ Styles / Events 三段的合法 .ass', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: '测试字幕' }], style);
    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Dialogue: ');
  });

  it('样式字段写进 Style 行: 字体/字号/主色/描边色/描边宽/底边距', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: 'x' }], {
      fontFamily: 'PingFang SC',
      fontSize: 48,
      primaryColor: '#FF0000',
      outlineColor: '#000000',
      outlineWidth: 2,
      marginV: 80,
    });
    const styleLine = ass.split('\n').find((l) => l.startsWith('Style: '))!;
    expect(styleLine).toContain('PingFang SC');
    expect(styleLine).toContain('48');
    expect(styleLine).toContain('&H000000FF'); // 主色 红
    expect(styleLine).toContain('&H00000000'); // 描边色 黑
    expect(styleLine).toContain('80');         // marginV
  });

  it('每个事件一行 Dialogue, 时间戳正确', () => {
    const ass = buildAssCaptions(
      [
        { startMs: 0, endMs: 1500, text: '第一句' },
        { startMs: 1500, endMs: 3000, text: '第二句' },
      ],
      style,
    );
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '));
    expect(dialogues).toHaveLength(2);
    expect(dialogues[0]).toContain('0:00:00.00');
    expect(dialogues[0]).toContain('0:00:01.50');
    expect(dialogues[0]).toContain('第一句');
    expect(dialogues[1]).toContain('第二句');
  });

  it('文本里的换行转成 ASS 的 \\N, 不破坏 Dialogue 行结构', () => {
    const ass = buildAssCaptions([{ startMs: 0, endMs: 1000, text: '上一行\n下一行' }], style);
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: '));
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0]).toContain('上一行\\N下一行');
  });

  it('零事件时仍产出合法头部(不抛错)', () => {
    const ass = buildAssCaptions([], style);
    expect(ass).toContain('[Events]');
    expect(ass.split('\n').filter((l) => l.startsWith('Dialogue: '))).toHaveLength(0);
  });
});

describe('captionEventsFromTranscript', () => {
  it('ASR segments 的秒转毫秒, 文本原样(真人出镜=真实原话)', () => {
    const events = captionEventsFromTranscript([
      { startSec: 0, endSec: 1.5, text: ' 大家看这个 ' },
      { startSec: 1.5, endSec: 3.25, text: '其实不对' },
    ] as any);
    expect(events).toEqual([
      { startMs: 0, endMs: 1500, text: '大家看这个' },
      { startMs: 1500, endMs: 3250, text: '其实不对' },
    ]);
  });

  it('丢弃空文本 segment', () => {
    const events = captionEventsFromTranscript([
      { startSec: 0, endSec: 1, text: '   ' },
      { startSec: 1, endSec: 2, text: '有内容' },
    ] as any);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('有内容');
  });
});

describe('captionEventsFromAlignedActs', () => {
  it('按幕边界铺文案, 一幕一条事件', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'hook', startMs: 0, endMs: 2000 },
        { act: 'concept_a', startMs: 2000, endMs: 5000 },
      ] as any,
      { hook: '钩子台词', concept_a: '概念A台词' },
    );
    expect(events).toEqual([
      { startMs: 0, endMs: 2000, text: '钩子台词' },
      { startMs: 2000, endMs: 5000, text: '概念A台词' },
    ]);
  });

  it('缺失 narration 的幕被跳过而不是产出 undefined 文本', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'hook', startMs: 0, endMs: 2000 },
        { act: 'trivia', startMs: 2000, endMs: 4000 },
      ] as any,
      { hook: '有台词' },
    );
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('有台词');
  });

  it('乱序输入按 startMs 排序后输出', () => {
    const events = captionEventsFromAlignedActs(
      [
        { act: 'concept_a', startMs: 2000, endMs: 5000 },
        { act: 'hook', startMs: 0, endMs: 2000 },
      ] as any,
      { hook: 'A', concept_a: 'B' },
    );
    expect(events.map((e) => e.text)).toEqual(['A', 'B']);
  });
});

describe('captionEventsFromSrt', () => {
  it('解析标准多块 SRT: 序号行/时间戳行/文本行/空行分隔', () => {
    const srt =
      '1\n00:00:00,000 --> 00:00:01,500\n第一句\n\n2\n00:00:01,500 --> 00:00:03,250\n第二句\n\n';
    expect(captionEventsFromSrt(srt)).toEqual([
      { startMs: 0, endMs: 1500, text: '第一句' },
      { startMs: 1500, endMs: 3250, text: '第二句' },
    ]);
  });

  it('多行文本合并保留换行(交给 buildAssCaptions 转 \\N)', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n上一行\n下一行\n\n';
    const events = captionEventsFromSrt(srt);
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('上一行\n下一行');
  });

  it('空串输入返回空数组', () => {
    expect(captionEventsFromSrt('')).toEqual([]);
  });

  it('畸形块(时间戳行缺失/格式不对)整块跳过, 不抛错', () => {
    const srt =
      '1\n这不是时间戳\n坏块文本\n\n2\n00:00:00,000 --> 00:00:01,000\n好块文本\n\n';
    const events = captionEventsFromSrt(srt);
    expect(events).toEqual([{ startMs: 0, endMs: 1000, text: '好块文本' }]);
  });

  it('时间戳跨分钟/跨小时正确换算成毫秒', () => {
    const srt = '1\n01:02:03,004 --> 01:02:05,500\n跨界文本\n\n';
    const events = captionEventsFromSrt(srt);
    // 1h2m3.004s = 3723004ms; 1h2m5.5s = 3725500ms
    expect(events).toEqual([{ startMs: 3723004, endMs: 3725500, text: '跨界文本' }]);
  });
});
