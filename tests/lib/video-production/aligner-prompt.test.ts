import { describe, it, expect } from 'vitest';
import { ALIGNER, AlignerResponseSchema, AlignedActSchema } from '@/lib/video-production/aligner-prompt';
import type { TranscriptSegment } from '@/lib/llm/whisper';
import type { ScriptAct } from '@/lib/script/six-act';

describe('ALIGNER.buildSystemPrompt', () => {
  it('包含"语义匹配"、"自由发挥"相关字样', () => {
    const prompt = ALIGNER.buildSystemPrompt();
    expect(prompt).toContain('语义匹配');
    expect(prompt).toContain('自由发挥');
  });
});

describe('ALIGNER.buildUserMessage', () => {
  const transcript: TranscriptSegment[] = [
    { startSec: 0, endSec: 2.5, text: '大家好今天讲一个冷知识' },
    { startSec: 2.5, endSec: 6, text: '先说说这个概念是什么' },
  ];
  const acts: ScriptAct[] = [
    {
      act: 'hook',
      title: '开场',
      narration: '你知道吗，这个现象其实很反直觉',
      visual: '',
      note: '',
      targetSec: 5,
      beats: [{ keyword: '反直觉' }, { keyword: '悬念' }],
      facts: [],
    },
    {
      act: 'concept_a',
      title: '概念A',
      narration: '概念A的核心是……',
      visual: '',
      note: '',
      targetSec: 10,
      beats: [{ keyword: '定义' }, { keyword: '例子' }],
      facts: [],
    },
  ] as ScriptAct[];

  it('返回的 text 含转写文本的真实时间戳格式化结果', () => {
    const parts = ALIGNER.buildUserMessage(transcript, acts);
    expect(parts[0].type).toBe('text');
    const text = (parts[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('[0ms-2500ms]');
    expect(text).toContain('大家好今天讲一个冷知识');
  });

  it('返回的 text 含六幕的关键词', () => {
    const parts = ALIGNER.buildUserMessage(transcript, acts);
    const text = (parts[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('反直觉');
    expect(text).toContain('定义');
  });
});

describe('AlignerResponseSchema', () => {
  const makeAct = (act: string, startMs: number, endMs: number) => ({ act, startMs, endMs });

  it('正例: 6 个 act 通过校验 (顺序不限)', () => {
    const valid = {
      acts: [
        makeAct('punchline', 50000, 60000),
        makeAct('hook', 0, 5000),
        makeAct('concept_a', 5000, 20000),
        makeAct('concept_b', 20000, 35000),
        makeAct('trivia', 35000, 45000),
        makeAct('synthesis', 45000, 50000),
      ],
    };
    const result = AlignerResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('反例: acts 长度不是 6 被拒', () => {
    const invalid = {
      acts: [makeAct('hook', 0, 5000)],
    };
    const result = AlignerResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('反例: act 不在 ACT_KEYS 里被拒', () => {
    const invalid = {
      acts: [
        makeAct('not_a_real_act', 0, 5000),
        makeAct('concept_a', 5000, 20000),
        makeAct('concept_b', 20000, 35000),
        makeAct('trivia', 35000, 45000),
        makeAct('synthesis', 45000, 50000),
        makeAct('punchline', 50000, 60000),
      ],
    };
    const result = AlignerResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('AlignedActSchema', () => {
  it('startMs/endMs 相等 (零时长) 仍合法', () => {
    const result = AlignedActSchema.safeParse({ act: 'hook', startMs: 1000, endMs: 1000 });
    expect(result.success).toBe(true);
  });
});
