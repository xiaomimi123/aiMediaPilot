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

  it('要求痛点具体可验证, 拒绝空泛表述', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('痛点');
    expect(prompt).toContain('具体');
    expect(prompt).toContain('可验证');
    expect(prompt).toContain('想变得更好');
  });

  it('给出痛点的反例 → 正例对照示例', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toMatch(/反例\s*→\s*正例/);
  });

  it('要求 offerings 每项对应到 painPoints 中的某一条', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('targetPain');
    expect(prompt).toContain('painPoints');
  });

  it('要求 productLogic 写清刷到→关注→信任→付费的路径, 而非一句口号', () => {
    const prompt = PERSONA_DRAFT.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('路径');
    expect(prompt).toContain('刷到');
    expect(prompt).toContain('关注');
    expect(prompt).toContain('信任');
    expect(prompt).toContain('付费');
    expect(prompt).toContain('口号');
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
    painPoints: [
      { pain: '装了很多 AI 工具但不会用', evidence: '访谈原话' },
      { pain: '刷资讯拼不成判断', evidence: '访谈原话' },
      { pain: '不知道该学哪个工具', evidence: '私信高频问题' },
    ],
    offerings: [
      { name: '工具选型咨询', type: 'service', description: '一对一帮忙选工具', targetPain: '不知道该学哪个工具' },
    ],
    productLogic: '刷到实测视频觉得敢说真话, 关注是为了追更, 连续验证准确后建立信任, 遇到选型难题时付费咨询。',
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

  it('painPoints 少于 3 条 → 拒绝', () => {
    const painPoints = valid.painPoints.slice(0, 2);
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, painPoints })).toThrow();
  });

  it('painPoints 超过 6 条 → 拒绝', () => {
    const painPoints = Array.from({ length: 7 }, (_, i) => ({ pain: `痛点${i}`, evidence: '证据' }));
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, painPoints })).toThrow();
  });

  it('painPoints 3-6 条区间内解析通过', () => {
    const painPoints = Array.from({ length: 6 }, (_, i) => ({ pain: `痛点${i}`, evidence: '证据' }));
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, painPoints })).not.toThrow();
  });

  it('offerings 为空数组 → 拒绝', () => {
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, offerings: [] })).toThrow();
  });

  it('offerings 超过 5 条 → 拒绝', () => {
    const offerings = Array.from({ length: 6 }, (_, i) => ({
      name: `产品${i}`,
      type: 'tool' as const,
      description: '描述',
      targetPain: '装了很多 AI 工具但不会用',
    }));
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, offerings })).toThrow();
  });

  it('offerings type 非法枚举 → 拒绝', () => {
    const offerings = [{ name: '产品', type: 'subscription', description: '描述', targetPain: '痛点' }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, offerings })).toThrow();
  });

  it('productLogic 少于 20 字 → 拒绝', () => {
    expect(() =>
      PersonaDraftResponseSchema.parse({ ...valid, productLogic: '一二三四五六七八九十一二三四五六七八九' }),
    ).toThrow();
  });

  it('productLogic 恰好 20 字 → 解析通过', () => {
    const productLogic = '一'.repeat(20);
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, productLogic })).not.toThrow();
  });

  /**
   * 十期 T6 修复轮 1: 说明性字段 (pillars[].description / painPoints[].evidence /
   * offerings[].description) 宽进严出——放宽到 300 字接住 DeepSeek 偶尔多写的输出,
   * transform 截断回原展示上限 (60/60/80), 不再直接 500。主键性字段 (pain/offering
   * name/pillar name) 维持严格 `.max()` 拒绝, 未被这次改动放宽。
   */
  it('pillar description 超过原 60 字上限但 ≤300 字 → 解析通过, 且被截断到 60 字', () => {
    const longDescription = '够'.repeat(120); // 120 字, 超 60 但 ≤300
    const pillars = [...valid.pillars.slice(0, 2), { name: '案例', description: longDescription }];
    const result = PersonaDraftResponseSchema.parse({ ...valid, pillars });
    expect(result.pillars[2].description.length).toBe(60);
    expect(result.pillars[2].description).toBe(longDescription.slice(0, 60));
  });

  it('pillar description 超过 300 字宽收上限 → 仍拒绝 (不是无限宽容)', () => {
    const pillars = [...valid.pillars.slice(0, 2), { name: '案例', description: '够'.repeat(301) }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, pillars })).toThrow();
  });

  it('painPoints evidence 超过原 60 字上限但 ≤300 字 → 解析通过, 且被截断到 60 字', () => {
    const longEvidence = '证'.repeat(100);
    const painPoints = [...valid.painPoints.slice(0, 2), { pain: '第三个痛点', evidence: longEvidence }];
    const result = PersonaDraftResponseSchema.parse({ ...valid, painPoints });
    expect(result.painPoints[2].evidence.length).toBe(60);
    expect(result.painPoints[2].evidence).toBe(longEvidence.slice(0, 60));
  });

  it('offerings description 超过原 80 字上限但 ≤300 字 → 解析通过, 且被截断到 80 字', () => {
    const longDescription = '描'.repeat(150);
    const offerings = [{ ...valid.offerings[0], description: longDescription }];
    const result = PersonaDraftResponseSchema.parse({ ...valid, offerings });
    expect(result.offerings[0].description.length).toBe(80);
    expect(result.offerings[0].description).toBe(longDescription.slice(0, 80));
  });

  it('pain 超过 30 字 (主键性字段) → 仍严格拒绝, 不做截断', () => {
    const painPoints = [...valid.painPoints.slice(0, 2), { pain: '痛'.repeat(31), evidence: '证据' }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, painPoints })).toThrow();
  });

  it('offering name 超过 20 字 (主键性字段) → 仍严格拒绝, 不做截断', () => {
    const offerings = [{ ...valid.offerings[0], name: '品'.repeat(21) }];
    expect(() => PersonaDraftResponseSchema.parse({ ...valid, offerings })).toThrow();
  });

  it('说明性字段在原上限内 (未触发截断) → 原样保留, 不多截一个字', () => {
    const pillars = [...valid.pillars.slice(0, 2), { name: '案例', description: '刚好在限内的描述' }];
    const result = PersonaDraftResponseSchema.parse({ ...valid, pillars });
    expect(result.pillars[2].description).toBe('刚好在限内的描述');
  });
});
