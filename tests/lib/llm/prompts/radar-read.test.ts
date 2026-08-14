import { describe, expect, it } from 'vitest';
import { RADAR_READ, RadarReadResponseSchema } from '@/lib/llm/prompts/radar-read';

describe('RADAR_READ.buildSystemPrompt', () => {
  it('点明「AI 知识类抖音创作者」视角', () => {
    expect(RADAR_READ.buildSystemPrompt()).toContain('AI 知识类抖音创作者');
  });

  it('四维定义均写清楚', () => {
    const prompt = RADAR_READ.buildSystemPrompt();
    expect(prompt).toMatch(/relevance/);
    expect(prompt).toMatch(/freshness/);
    expect(prompt).toMatch(/discussion/);
    expect(prompt).toMatch(/feasibility/);
    expect(prompt).toContain('相关度');
    expect(prompt).toContain('时效');
    expect(prompt).toMatch(/争议|讨论/);
    expect(prompt).toContain('可行性');
  });

  it('要求简体中文输出', () => {
    expect(RADAR_READ.buildSystemPrompt()).toContain('中文');
  });

  it('缺省 personaSection → 与无参数调用字符级一致', () => {
    expect(RADAR_READ.buildSystemPrompt(undefined)).toBe(RADAR_READ.buildSystemPrompt());
  });

  it('personaSection 为空串 → 与无参数调用字符级一致', () => {
    expect(RADAR_READ.buildSystemPrompt('')).toBe(RADAR_READ.buildSystemPrompt());
  });

  it('无 personaSection → 不提 pillarHit', () => {
    expect(RADAR_READ.buildSystemPrompt()).not.toContain('pillarHit');
  });

  it('personaSection 非空 → 拼入定位内容', () => {
    const prompt = RADAR_READ.buildSystemPrompt('目标受众: 25-35 岁互联网从业者\n内容支柱:\n- 工具评测: 拆解 AI 工具实际效果');
    expect(prompt).toContain('25-35 岁互联网从业者');
    expect(prompt).toContain('工具评测');
  });

  it('personaSection 非空 → relevance 语义句换为「对上述定位的价值」', () => {
    const prompt = RADAR_READ.buildSystemPrompt('目标受众: 测试受众');
    expect(prompt).toContain('对上述定位的价值');
    expect(prompt).not.toContain('与用户关注的关键词 / AI 知识赛道的相关程度');
  });

  it('personaSection 非空 → 要求输出命中的支柱名或 null (pillarHit)', () => {
    const prompt = RADAR_READ.buildSystemPrompt('目标受众: 测试受众');
    expect(prompt).toContain('pillarHit');
  });

  it('personaSection 含痛点段 (无痛点) → 不提 painHit/angleSuggestion, relevance 语义句不含「是否戳中上述痛点」', () => {
    const prompt = RADAR_READ.buildSystemPrompt('目标受众: 测试受众');
    expect(prompt).not.toContain('painHit');
    expect(prompt).not.toContain('angleSuggestion');
    expect(prompt).not.toContain('是否戳中上述痛点');
  });

  it('personaSection 含「用户痛点:」段 → relevance 语义句补「是否戳中上述痛点」', () => {
    const prompt = RADAR_READ.buildSystemPrompt(
      '目标受众: 测试受众\n用户痛点:\n- 不知道拍什么: 选题卡壳超过 1 小时',
    );
    expect(prompt).toContain('是否戳中上述痛点');
  });

  it('personaSection 含「用户痛点:」段 → 要求输出 painHit/angleSuggestion', () => {
    const prompt = RADAR_READ.buildSystemPrompt(
      '目标受众: 测试受众\n用户痛点:\n- 不知道拍什么: 选题卡壳超过 1 小时',
    );
    expect(prompt).toContain('painHit');
    expect(prompt).toContain('angleSuggestion');
  });

  it('personaSection 无「用户痛点:」段 (仅受众) → buildSystemPrompt 与不带痛点段的旧行为一致 (无 painHit/angleSuggestion 要求)', () => {
    const withPillarOnly = RADAR_READ.buildSystemPrompt('目标受众: 测试受众\n内容支柱:\n- 工具评测: 拆解 AI 工具实际效果');
    expect(withPillarOnly).not.toContain('painHit');
    expect(withPillarOnly).not.toContain('angleSuggestion');
  });
});

describe('RADAR_READ.buildUserMessage', () => {
  it('包含标题/来源/命中关键词/正文', () => {
    const parts = RADAR_READ.buildUserMessage({
      title: 'GPT-6 发布, 全面超越人类专家',
      content: '正文详情内容……',
      sourceSite: 'example.com',
      matchedKeywords: ['GPT-6', 'AI 模型'],
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('GPT-6 发布, 全面超越人类专家');
    expect(text).toContain('example.com');
    expect(text).toContain('GPT-6');
    expect(text).toContain('AI 模型');
    expect(text).toContain('正文详情内容……');
  });

  it('无命中关键词时不报错, 给出占位文案', () => {
    const parts = RADAR_READ.buildUserMessage({
      title: '标题',
      content: '内容',
      sourceSite: 'a.com',
      matchedKeywords: [],
    });
    expect((parts[0] as any).text).toBeTruthy();
  });
});

describe('RadarReadResponseSchema', () => {
  const valid = {
    summary: '这篇文章介绍了新模型的能力',
    angle: '可以做一期对比评测视频',
    relevance: 80,
    freshness: 90,
    discussion: 70,
    feasibility: 60,
    suggestedKeywords: ['关键词一', '关键词二'],
  };

  it('合法输入解析通过', () => {
    expect(() => RadarReadResponseSchema.parse(valid)).not.toThrow();
  });

  it('suggestedKeywords 允许空数组 (0 个)', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, suggestedKeywords: [] })
    ).not.toThrow();
  });

  it('summary 超过 120 字 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, summary: '字'.repeat(121) })
    ).toThrow();
  });

  it('summary 恰好 120 字 → 通过', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, summary: '字'.repeat(120) })
    ).not.toThrow();
  });

  it('angle 超过 80 字 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, angle: '字'.repeat(81) })
    ).toThrow();
  });

  it('angle 恰好 80 字 → 通过', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, angle: '字'.repeat(80) })
    ).not.toThrow();
  });

  it.each(['relevance', 'freshness', 'discussion', 'feasibility'] as const)(
    '%s 超过 100 → 拒绝',
    (field) => {
      expect(() => RadarReadResponseSchema.parse({ ...valid, [field]: 101 })).toThrow();
    }
  );

  it.each(['relevance', 'freshness', 'discussion', 'feasibility'] as const)(
    '%s 小于 0 → 拒绝',
    (field) => {
      expect(() => RadarReadResponseSchema.parse({ ...valid, [field]: -1 })).toThrow();
    }
  );

  it.each(['relevance', 'freshness', 'discussion', 'feasibility'] as const)(
    '%s 非整数 → 拒绝',
    (field) => {
      expect(() => RadarReadResponseSchema.parse({ ...valid, [field]: 50.5 })).toThrow();
    }
  );

  it('suggestedKeywords 超过 3 个 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({
        ...valid,
        suggestedKeywords: ['a', 'b', 'c', 'd'],
      })
    ).toThrow();
  });

  it('缺少必填字段 → 拒绝', () => {
    const { summary, ...rest } = valid;
    expect(() => RadarReadResponseSchema.parse(rest)).toThrow();
  });

  it('pillarHit 缺省 → 默认解析为 null', () => {
    const parsed = RadarReadResponseSchema.parse(valid);
    expect(parsed.pillarHit).toBeNull();
  });

  it('pillarHit 为 null → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, pillarHit: null });
    expect(parsed.pillarHit).toBeNull();
  });

  it('pillarHit 为合法字符串 (≤10 字) → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, pillarHit: '工具评测' });
    expect(parsed.pillarHit).toBe('工具评测');
  });

  it('pillarHit 超过 10 字 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, pillarHit: '一'.repeat(11) })
    ).toThrow();
  });

  it('painHit 缺省 → 默认解析为 null', () => {
    const parsed = RadarReadResponseSchema.parse(valid);
    expect(parsed.painHit).toBeNull();
  });

  it('painHit 为 null → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, painHit: null });
    expect(parsed.painHit).toBeNull();
  });

  it('painHit 为合法字符串 (≤30 字) → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, painHit: '不知道拍什么' });
    expect(parsed.painHit).toBe('不知道拍什么');
  });

  it('painHit 超过 30 字 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, painHit: '一'.repeat(31) })
    ).toThrow();
  });

  it('angleSuggestion 缺省 → 默认解析为 null', () => {
    const parsed = RadarReadResponseSchema.parse(valid);
    expect(parsed.angleSuggestion).toBeNull();
  });

  it('angleSuggestion 为 null → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, angleSuggestion: null });
    expect(parsed.angleSuggestion).toBeNull();
  });

  it('angleSuggestion 为合法字符串 (≤40 字) → 通过', () => {
    const parsed = RadarReadResponseSchema.parse({ ...valid, angleSuggestion: '从时间管理角度切入, 拍一期真实案例对比' });
    expect(parsed.angleSuggestion).toBe('从时间管理角度切入, 拍一期真实案例对比');
  });

  it('angleSuggestion 超过 40 字 → 拒绝', () => {
    expect(() =>
      RadarReadResponseSchema.parse({ ...valid, angleSuggestion: '一'.repeat(41) })
    ).toThrow();
  });
});
