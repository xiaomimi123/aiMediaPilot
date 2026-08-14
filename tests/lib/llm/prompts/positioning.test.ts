import { describe, expect, it } from 'vitest';
import { MARKET_RESEARCH, MarketInsightSchema } from '@/lib/llm/prompts/market-research';
import { PERSONA_SUMMARY, PersonaSummaryResponseSchema } from '@/lib/llm/prompts/persona-summary';
import type { PersonaProfileData } from '@/lib/persona/profile';

describe('MARKET_RESEARCH.buildSystemPrompt', () => {
  it('注入 niche (未知垂类走 generic fallback, 原样注入用户字符串)', () => {
    expect(MARKET_RESEARCH.buildSystemPrompt('my-custom-niche')).toContain('my-custom-niche');
  });

  it('点明四个输出字段: 赛道格局/主流玩法/未满足需求/机会点', () => {
    const prompt = MARKET_RESEARCH.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('赛道格局');
    expect(prompt).toContain('主流玩法');
    expect(prompt).toContain('未满足需求');
    expect(prompt).toContain('机会点');
  });

  it('要求字段结合搜索摘要作答, 拒绝空话', () => {
    const prompt = MARKET_RESEARCH.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('搜索摘要');
    expect(prompt).toMatch(/空话|放之四海皆准/);
  });
});

describe('MARKET_RESEARCH.buildUserMessage', () => {
  const baseInput = {
    audience: '25-35 岁互联网从业者',
    pillars: ['工具评测', '案例拆解'],
    searchDigest: '【https://a.example.com】\n某赛道现状正文……',
  };

  it('包含受众/支柱/搜索摘要', () => {
    const text = (MARKET_RESEARCH.buildUserMessage(baseInput)[0] as { text: string }).text;
    expect(text).toContain('25-35 岁互联网从业者');
    expect(text).toContain('工具评测');
    expect(text).toContain('案例拆解');
    expect(text).toContain('某赛道现状正文……');
  });

  it('pillars 为空数组时不报错, 给出占位文案', () => {
    const text = (
      MARKET_RESEARCH.buildUserMessage({ ...baseInput, pillars: [] })[0] as { text: string }
    ).text;
    expect(text).toBeTruthy();
  });

  it('searchDigest 为空串时不报错, 给出占位文案', () => {
    const text = (
      MARKET_RESEARCH.buildUserMessage({ ...baseInput, searchDigest: '' })[0] as { text: string }
    ).text;
    expect(text).toBeTruthy();
  });
});

describe('MarketInsightSchema', () => {
  const valid = {
    landscape: '同质化严重, 内容供给已经很饱和了',
    mainstream: '账号普遍在做工具测评合集类内容',
    unmet: '用户想要的是深度实操而非资讯搬运',
    opportunity: '结合实测翻车案例做差异化内容切入',
  };

  it('合法输入解析通过', () => {
    expect(() => MarketInsightSchema.parse(valid)).not.toThrow();
  });

  it('字段少于 10 字 → 拒绝', () => {
    expect(() => MarketInsightSchema.parse({ ...valid, landscape: '太短' })).toThrow();
  });

  it('字段恰好 10 字 → 解析通过', () => {
    const ten = '一'.repeat(10);
    expect(() => MarketInsightSchema.parse({ ...valid, landscape: ten })).not.toThrow();
  });

  it('字段超过 300 字 → 拒绝', () => {
    const tooLong = '一'.repeat(301);
    expect(() => MarketInsightSchema.parse({ ...valid, opportunity: tooLong })).toThrow();
  });

  it('字段恰好 300 字 → 解析通过', () => {
    const threeHundred = '一'.repeat(300);
    expect(() => MarketInsightSchema.parse({ ...valid, opportunity: threeHundred })).not.toThrow();
  });

  it('缺少必填字段 → 拒绝', () => {
    const { landscape, ...rest } = valid;
    void landscape;
    expect(() => MarketInsightSchema.parse(rest)).toThrow();
  });
});

describe('PERSONA_SUMMARY.buildSystemPrompt', () => {
  it('注入 niche', () => {
    expect(PERSONA_SUMMARY.buildSystemPrompt('ai-knowledge')).toContain('ai-knowledge');
  });

  it('点明「定位顾问」角色与 markdown 一页纸报告', () => {
    const prompt = PERSONA_SUMMARY.buildSystemPrompt('ai-knowledge');
    expect(prompt).toContain('定位顾问');
    expect(prompt).toContain('markdown');
  });

  it('要求拒绝空话', () => {
    const prompt = PERSONA_SUMMARY.buildSystemPrompt('ai-knowledge');
    expect(prompt).toMatch(/空话/);
  });
});

describe('PERSONA_SUMMARY.buildUserMessage', () => {
  const baseProfile: PersonaProfileData = {
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
    painPoints: [{ pain: '装了很多 AI 工具但不会用', evidence: '访谈原话' }],
    offerings: [
      { name: '工具选型咨询', type: 'service', description: '一对一帮忙选工具', targetPain: '不知道该学哪个工具' },
    ],
    productLogic: '刷到实测视频觉得敢说真话, 关注是为了追更, 建立信任后付费咨询。',
    marketInsight: null,
    systemSummary: '',
  };

  it('包含 profile 各字段内容', () => {
    const text = (PERSONA_SUMMARY.buildUserMessage({ profile: baseProfile })[0] as { text: string }).text;
    expect(text).toContain('25-35 岁互联网从业者');
    expect(text).toContain('工具评测');
    expect(text).toContain('只讲能落地的方法');
    expect(text).toContain('装了很多 AI 工具但不会用');
    expect(text).toContain('工具选型咨询');
    expect(text).toContain('刷到实测视频觉得敢说真话');
  });

  it('marketInsight 存在时包含在输入里', () => {
    const profile: PersonaProfileData = {
      ...baseProfile,
      marketInsight: {
        landscape: '同质化严重',
        mainstream: '搬运资讯',
        unmet: '缺乏可落地的实操',
        opportunity: '做深度实操内容',
        researchedAt: '2026-08-15T00:00:00.000Z',
      },
    };
    const text = (PERSONA_SUMMARY.buildUserMessage({ profile })[0] as { text: string }).text;
    expect(text).toContain('同质化严重');
    expect(text).toContain('做深度实操内容');
  });

  it('marketInsight 为 null 时不报错, 给出占位文案', () => {
    const text = (PERSONA_SUMMARY.buildUserMessage({ profile: baseProfile })[0] as { text: string }).text;
    expect(text).toBeTruthy();
  });

  it('painPoints/offerings 为空数组时不报错, 给出占位文案', () => {
    const profile: PersonaProfileData = { ...baseProfile, painPoints: [], offerings: [] };
    const text = (PERSONA_SUMMARY.buildUserMessage({ profile })[0] as { text: string }).text;
    expect(text).toBeTruthy();
  });
});

describe('PersonaSummaryResponseSchema', () => {
  it('合法长度 (100-2000 字) 解析通过', () => {
    const summary = '一'.repeat(100);
    expect(() => PersonaSummaryResponseSchema.parse({ summary })).not.toThrow();
  });

  it('少于 100 字 → 拒绝', () => {
    const summary = '一'.repeat(99);
    expect(() => PersonaSummaryResponseSchema.parse({ summary })).toThrow();
  });

  it('恰好 2000 字 → 解析通过', () => {
    const summary = '一'.repeat(2000);
    expect(() => PersonaSummaryResponseSchema.parse({ summary })).not.toThrow();
  });

  it('超过 2000 字 → 拒绝', () => {
    const summary = '一'.repeat(2001);
    expect(() => PersonaSummaryResponseSchema.parse({ summary })).toThrow();
  });
});
