import { describe, expect, it } from 'vitest';
import { captionEventsFromTranscript } from '@/lib/video-production/caption-events';

// 三十期 Task 3 预备提交：随 `captionEventsFromTranscript` 从
// `tests/lib/video-production/ass-captions.test.ts` 挪出。

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
