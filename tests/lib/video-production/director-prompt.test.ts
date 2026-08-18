import { describe, it, expect } from 'vitest';
import { DIRECTOR, DirectorResponseSchema, ShotSchema } from '@/lib/video-production/director-prompt';

describe('DIRECTOR.buildSystemPrompt', () => {
  it('包含"导演"、"微节拍"、"从简"相关字样', () => {
    const prompt = DIRECTOR.buildSystemPrompt();
    expect(prompt).toContain('导演');
    expect(prompt).toContain('微节拍');
    expect(prompt).toContain('从简');
  });
});

describe('DIRECTOR.buildUserMessage', () => {
  it('返回的 parts[0].text 包含传入的 SRT 原文', () => {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n这是一段测试字幕\n';
    const parts = DIRECTOR.buildUserMessage(srt);
    expect(parts[0].type).toBe('text');
    expect((parts[0] as { type: 'text'; text: string }).text).toContain(srt);
  });
});

describe('DirectorResponseSchema', () => {
  it('正例: 含 2 个镜头、每镜头 3 个 beats 的合法对象通过校验', () => {
    const valid = {
      concept: '简约文字卡片风',
      palette: ['#111111', '#ffffff', '#ff0000'],
      shots: [
        {
          shotId: 'shot-1',
          startMs: 0,
          endMs: 3000,
          claim: '开场主张',
          visualJob: 'clarify',
          beats: [
            { visibleState: '标题出现', development: '淡入' },
            { visibleState: '标题居中', development: '定格' },
            { visibleState: '标题高亮', development: '强调关键词' },
          ],
        },
        {
          shotId: 'shot-2',
          startMs: 3000,
          endMs: 6000,
          claim: '第二个主张',
          visualJob: 'reveal',
          beats: [
            { visibleState: '图表出现', development: '滑入' },
            { visibleState: '数据点亮起', development: '逐个高亮' },
            { visibleState: '结论文字出现', development: '淡入' },
          ],
        },
      ],
    };
    const result = DirectorResponseSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('反例: 镜头缺 claim 字段被拒', () => {
    const invalid = {
      concept: '简约文字卡片风',
      palette: ['#111111', '#ffffff', '#ff0000'],
      shots: [
        {
          shotId: 'shot-1',
          startMs: 0,
          endMs: 3000,
          visualJob: 'clarify',
          beats: [
            { visibleState: '标题出现', development: '淡入' },
            { visibleState: '标题居中', development: '定格' },
          ],
        },
      ],
    };
    const result = DirectorResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('反例: beats 只有 1 个被拒 (min 2)', () => {
    const invalid = {
      concept: '简约文字卡片风',
      palette: ['#111111', '#ffffff', '#ff0000'],
      shots: [
        {
          shotId: 'shot-1',
          startMs: 0,
          endMs: 3000,
          claim: '开场主张',
          visualJob: 'clarify',
          beats: [{ visibleState: '标题出现', development: '淡入' }],
        },
      ],
    };
    const result = DirectorResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('反例: shots 空数组被拒 (min 1)', () => {
    const invalid = {
      concept: '简约文字卡片风',
      palette: ['#111111', '#ffffff', '#ff0000'],
      shots: [],
    };
    const result = DirectorResponseSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('ShotSchema', () => {
  const baseShot = {
    shotId: 'shot-1',
    claim: '开场主张',
    visualJob: 'clarify',
    beats: [
      { visibleState: '标题出现', development: '淡入' },
      { visibleState: '标题居中', development: '定格' },
    ],
  };

  it('startMs 传负数被拒', () => {
    const result = ShotSchema.safeParse({ ...baseShot, startMs: -1, endMs: 1000 });
    expect(result.success).toBe(false);
  });

  it('endMs 传负数被拒', () => {
    const result = ShotSchema.safeParse({ ...baseShot, startMs: 0, endMs: -1 });
    expect(result.success).toBe(false);
  });
});
