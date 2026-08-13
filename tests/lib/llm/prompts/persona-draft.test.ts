import { describe, expect, it } from 'vitest';
import { PERSONA_DRAFT, PersonaDraftResponseSchema } from '@/lib/llm/prompts/persona-draft';

describe('PERSONA_DRAFT.buildSystemPrompt', () => {
  it('注入 niche', () => {
    expect(PERSONA_DRAFT.buildSystemPrompt('ai-knowledge')).toContain('ai-knowledge');
  });

  it('点明「定位教练」角色', () => {
    expect(PERSONA_DRAFT.buildSystemPrompt('ai-knowledge')).toContain('定位教练');
  });

  it('要求支柱具体可选题', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('支柱');
    expect(prompt).toContain('具体');
    expect(prompt).toMatch(/选题/);
  });

  it('明确拒绝「分享干货」「AI 知识」这类空泛支柱', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('分享干货');
    expect(prompt).toContain('AI 知识');
  });

  it('要求 3-5 条支柱', () => {
    expect(PERSONA_DRAFT.buildSystemPrompt('ai-knowledge')).toMatch(/3\s*-\s*5/);
  });
});

describe('PERSONA_DRAFT.buildUserMessage', () => {
  const baseInput = {
    answers: [
      { q: '你是谁/账号做什么', a: '我是做 AI 工具评测的' },
      { q: '最想吸引什么样的人关注', a: '' },
    ],
    styleDescription: '语速快, 口语化, 爱用反问',
    sampleExcerpts: ['这是第一篇样本节选……', '这是第二篇样本节选……'],
    radarKeywords: ['GPT-6', 'AI 眼镜'],
  };

  it('包含问答对 (含空答案不报错)', () => {
    const text = (PERSONA_DRAFT.buildUserMessage(baseInput)[0] as { text: string }).text;
    expect(text).toContain('你是谁/账号做什么');
    expect(text).toContain('我是做 AI 工具评测的');
    expect(text).toContain('最想吸引什么样的人关注');
  });

  it('包含风格说明', () => {
    const text = (PERSONA_DRAFT.buildUserMessage(baseInput)[0] as { text: string }).text;
    expect(text).toContain('语速快, 口语化, 爱用反问');
  });

  it('包含样本节选', () => {
    const text = (PERSONA_DRAFT.buildUserMessage(baseInput)[0] as { text: string }).text;
    expect(text).toContain('这是第一篇样本节选……');
    expect(text).toContain('这是第二篇样本节选……');
  });

  it('包含雷达关键词', () => {
    const text = (PERSONA_DRAFT.buildUserMessage(baseInput)[0] as { text: string }).text;
    expect(text).toContain('GPT-6');
    expect(text).toContain('AI 眼镜');
  });

  it('风格说明为空串时不报错, 给出占位文案', () => {
    const text = (
      PERSONA_DRAFT.buildUserMessage({ ...baseInput, styleDescription: '' })[0] as { text: string }
    ).text;
    expect(text).toBeTruthy();
  });

  it('样本节选/雷达关键词为空数组时不报错, 给出占位文案', () => {
    const text = (
      PERSONA_DRAFT.buildUserMessage({ ...baseInput, sampleExcerpts: [], radarKeywords: [] })[0] as {
        text: string;
      }
    ).text;
    expect(text).toBeTruthy();
  });
});

describe('PersonaDraftResponseSchema', () => {
  const valid = {
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [
      { name: '工具评测', description: '拆解 AI 工具实际效果' },
      { name: '案例拆解', description: '拆真实翻车案例' },
      { name: '行业观察', description: '聊行业里的新动向' },
    ],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
  };

  it('合法输入 (3 条支柱) 解析通过', () => {
    expect(() => PersonaDraftResponseSchema.parse(valid)).not.toThrow();
  });

  it('5 条支柱解析通过', () => {
    const pillars = Array.from({ length: 5 }, (_, i) => ({ name: `支柱${i}`, description: '具体描述' }));
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, pillars })).not.toThrow();
  });

  it('少于 3 条支柱 → 拒绝', () => {
    expect(() =>
      PersonaDraftResponseSchema.parse({ ...valid, pillars: valid.pillars.slice(0, 2) }),
    ).toThrow();
  });

  it('超过 5 条支柱 → 拒绝', () => {
    const pillars = Array.from({ length: 6 }, (_, i) => ({ name: `支柱${i}`, description: '具体描述' }));
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, pillars })).toThrow();
  });

  it('pillar description 为空串 → 拒绝 (起草不允许空描述)', () => {
    const pillars = [...valid.pillars.slice(0, 2), { name: '案例', description: '' }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, pillars })).toThrow();
  });

  it('pillar name 超过 10 字 → 拒绝', () => {
    const pillars = [...valid.pillars.slice(0, 2), { name: '一二三四五六七八九十一', description: '够' }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, pillars })).toThrow();
  });

  it('缺少必填字段 → 拒绝', () => {
    const { audience, ...rest } = valid;
    expect(() => PersonaDraftResponseSchema.parse(rest)).toThrow();
  });
});
