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
});
