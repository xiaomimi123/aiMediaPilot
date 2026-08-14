import { describe, expect, it } from 'vitest';
import type { ResearchBrief } from '@/lib/llm/prompts/research-brief';
import { XHSScriptResponseSchema } from '@/lib/llm/prompts/script-generate-xiaohongshu';
import { SCRIPT_WRITE_XHS } from '@/lib/llm/prompts/script-write-xhs';
import { XHS_REFINE } from '@/lib/llm/prompts/xhs-refine';
import type { StyleContext } from '@/lib/llm/prompts/script-write-douyin';
import { buildPersonaSection } from '@/lib/llm/prompts/persona-section';
import type { PersonaProfileData } from '@/lib/persona/profile';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBrief: ResearchBrief = {
  points: [
    {
      fact: 'GPT-5 发布后 3 个月内相关论文引用量增长了 240%',
      source: 'https://example.com/report',
      usage: '作为 intro 部分的数据反差',
    },
    {
      fact: '某电商团队用 AI 客服后, 人工客服工时下降了 62%',
      source: '用户素材',
      usage: 'body 部分举例佐证',
    },
  ],
};

const descStyle: StyleContext = {
  mode: 'description',
  description: '语气亲切, 喜欢用第一人称分享经历, 句子短, 常用 emoji',
  samples: [],
};

const sampleText1 = '姐妹们谁懂啊, 这个功能我发现晚了简直亏死, 今天必须分享给你们';
const samplesStyle: StyleContext = {
  mode: 'samples',
  description: '',
  samples: [sampleText1, '上次发的那篇笔记好多人问细节, 今天来更新一下'],
};

const validIntro = '你是不是也总在深夜刷手机的时候突然emo, 今天想跟你聊聊我最近发现的一个小方法';
const validBody =
  '**先说结论**: 这个方法真的救了我。\n\n上周我状态很差, 试着做了这三件小事:\n1. 早起十分钟晒太阳\n2. 睡前不刷手机\n3. 每天写三句感恩日记\n\n没想到坚持一周, 整个人明显轻松了很多。你也可以试试看, **改变真的没有想象中难**, 从今天开始吧, 不用一次做到完美, 慢慢来就好。评论区告诉我你的小方法, 我们一起互相监督打卡～';

// ---------------------------------------------------------------------------
// XHSScriptResponseSchema — intro/body 边界 (复用现有 schema, 不复制)
// ---------------------------------------------------------------------------

function makeValidXhsResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    titles: [
      { text: '✨这个方法我藏不住了', hookType: '秘密' },
      { text: '亲测有效 | 打工人自救指南', hookType: '痛点' },
      { text: 'emo 星人看过来💡', hookType: '情感' },
    ],
    coverText: '亲测有效的自救法',
    intro: validIntro,
    body: validBody,
    tags: ['自我成长', '打工人', '情绪管理'],
    shotIdeas: [
      { idx: 1, description: '手写清单特写' },
      { idx: 2, description: '窗边晒太阳的画面' },
      { idx: 3, description: '感恩日记本内页' },
    ],
    ...overrides,
  };
}

describe('XHSScriptResponseSchema — intro/body 边界', () => {
  it('intro 19 字 → 拒绝 (min 20)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ intro: 'a'.repeat(19) }))
    ).toThrow();
  });

  it('intro 150 字 → 通过 (max 150)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ intro: 'a'.repeat(150) }))
    ).not.toThrow();
  });

  it('intro 151 字 → 拒绝 (max 150)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ intro: 'a'.repeat(151) }))
    ).toThrow();
  });

  it('body 149 字 → 拒绝 (min 150)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ body: 'a'.repeat(149) }))
    ).toThrow();
  });

  it('body 800 字 → 通过 (max 800)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ body: 'a'.repeat(800) }))
    ).not.toThrow();
  });

  it('body 801 字 → 拒绝 (max 800)', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ body: 'a'.repeat(801) }))
    ).toThrow();
  });

  it('suggestedIntent 缺省 → 默认解析为 null', () => {
    const parsed = XHSScriptResponseSchema.parse(makeValidXhsResponse());
    expect(parsed.suggestedIntent).toBeNull();
  });

  it('suggestedIntent 为 null → 通过', () => {
    const parsed = XHSScriptResponseSchema.parse(makeValidXhsResponse({ suggestedIntent: null }));
    expect(parsed.suggestedIntent).toBeNull();
  });

  it.each(['reach', 'trust', 'convert'] as const)('suggestedIntent=%s → 通过', (intent) => {
    const parsed = XHSScriptResponseSchema.parse(makeValidXhsResponse({ suggestedIntent: intent }));
    expect(parsed.suggestedIntent).toBe(intent);
  });

  it('suggestedIntent 非法枚举值 → 拒绝', () => {
    expect(() =>
      XHSScriptResponseSchema.parse(makeValidXhsResponse({ suggestedIntent: 'unknown' }))
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SCRIPT_WRITE_XHS.buildSystemPrompt
// ---------------------------------------------------------------------------

describe('SCRIPT_WRITE_XHS.buildSystemPrompt', () => {
  it('包含「图文笔记」', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('图文笔记');
  });

  it('包含「加粗」要求', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('加粗');
  });

  it('要求小红书语感: 情感化 / 短段落 / 比抖音更温', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/情感化/);
    expect(p).toMatch(/短段落/);
    expect(p).toMatch(/比抖音.*温|更温/);
  });

  it('包含 niche persona', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/AI 知识/);
  });

  it('要求素材简报 fact 引进 intro 或 body', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/fact/);
    expect(p).toMatch(/intro/);
    expect(p).toMatch(/body/);
  });

  it('保留 titles 含 emoji 惯例', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/emoji/);
  });

  it('要求产出 suggestedIntent (reach/trust/convert 三选一或 null)', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('suggestedIntent');
    expect(p).toContain('reach');
    expect(p).toContain('trust');
    expect(p).toContain('convert');
  });

  it('mode=description 时嵌入风格说明段', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain(descStyle.description);
  });

  it('mode=samples 时真实嵌入样本文本, 且提示模仿口吻/句式/用词', () => {
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', samplesStyle);
    expect(p).toContain(sampleText1);
    expect(p).toContain(samplesStyle.samples[1]);
    expect(p).toMatch(/口吻|句式|用词/);
    expect(p).toMatch(/博主本人最近定稿笔记/);
  });

  it('缺省 personaSection → 与无参数调用字符级一致', () => {
    expect(SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle, undefined)).toBe(
      SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle),
    );
  });

  it('personaSection 为空串 → 与无参数调用字符级一致', () => {
    expect(SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle, '')).toBe(
      SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle),
    );
  });

  it('personaSection 非空 → 拼在 getExpertPersona 之后、任务描述之前, 且含受众文本', () => {
    const persona = '目标受众: 25-35 岁互联网从业者\n内容支柱:\n- 工具评测: 拆解 AI 工具实际效果';
    const p = SCRIPT_WRITE_XHS.buildSystemPrompt('ai-knowledge', descStyle, persona);
    expect(p).toContain('25-35 岁互联网从业者');
    expect(p).toContain('工具评测');
    const personaIdx = p.indexOf('25-35 岁互联网从业者');
    const taskIdx = p.indexOf('任务: 为这条小红书 图文笔记 写一份可以直接发布的完整内容');
    expect(personaIdx).toBeGreaterThan(-1);
    expect(taskIdx).toBeGreaterThan(-1);
    expect(personaIdx).toBeLessThan(taskIdx);
  });

  it('三种 intent 的 CTA 段透传进 system prompt, 且互不串场; convert 段含 offerings 名称', () => {
    const profile: PersonaProfileData = {
      audience: '25-35 岁互联网从业者',
      targetFans: '',
      pillars: [],
      angle: '',
      avoid: '',
      painPoints: [],
      offerings: [{ name: 'AI 选题工具', type: 'tool', description: '自动生成选题', targetPain: '' }],
      productLogic: '',
      marketInsight: null,
      systemSummary: '',
    };

    const reachPrompt = SCRIPT_WRITE_XHS.buildSystemPrompt(
      'ai-knowledge', descStyle, buildPersonaSection(profile, 'write', 'reach'),
    );
    const trustPrompt = SCRIPT_WRITE_XHS.buildSystemPrompt(
      'ai-knowledge', descStyle, buildPersonaSection(profile, 'write', 'trust'),
    );
    const convertPrompt = SCRIPT_WRITE_XHS.buildSystemPrompt(
      'ai-knowledge', descStyle, buildPersonaSection(profile, 'write', 'convert'),
    );

    expect(reachPrompt).toContain('CTA 指引 (引流)');
    expect(reachPrompt).not.toContain('CTA 指引 (建立信任)');
    expect(reachPrompt).not.toContain('CTA 指引 (转化)');

    expect(trustPrompt).toContain('CTA 指引 (建立信任)');
    expect(trustPrompt).not.toContain('CTA 指引 (引流)');

    expect(convertPrompt).toContain('CTA 指引 (转化)');
    expect(convertPrompt).toContain('AI 选题工具');
    expect(convertPrompt).not.toContain('CTA 指引 (引流)');
  });
});

// ---------------------------------------------------------------------------
// SCRIPT_WRITE_XHS.buildUserMessage
// ---------------------------------------------------------------------------

describe('SCRIPT_WRITE_XHS.buildUserMessage', () => {
  it('包含 topic', () => {
    const parts = SCRIPT_WRITE_XHS.buildUserMessage({ topic: 'AI 写周报', brief: null });
    const text = (parts[0] as any).text;
    expect(text).toContain('AI 写周报');
  });

  it('brief 为 null 时不出现素材简报段落', () => {
    const parts = SCRIPT_WRITE_XHS.buildUserMessage({ topic: 'AI 写周报', brief: null });
    const text = (parts[0] as any).text;
    expect(text).not.toContain('素材简报');
  });

  it('brief 非空时素材 fact 出现在正文, 且带引用指令', () => {
    const parts = SCRIPT_WRITE_XHS.buildUserMessage({ topic: 'AI 写周报', brief: validBrief });
    const text = (parts[0] as any).text;
    expect(text).toContain('素材简报');
    expect(text).toContain(validBrief.points[0].fact);
    expect(text).toContain(validBrief.points[1].fact);
  });
});

// ---------------------------------------------------------------------------
// XHS_REFINE
// ---------------------------------------------------------------------------

describe('XHS_REFINE.buildSystemPrompt', () => {
  it('含「只重写」或等义约束词', () => {
    const p = XHS_REFINE.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/只重写/);
  });

  it('提及 intro 和 body, 且其余区块不输出', () => {
    const p = XHS_REFINE.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('intro');
    expect(p).toContain('body');
    expect(p).toMatch(/titles/);
    expect(p).toMatch(/不输出|保持不变/);
  });

  it('包含 niche persona', () => {
    const p = XHS_REFINE.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toMatch(/AI 知识/);
  });

  it('mode=samples 时嵌入样本文本', () => {
    const p = XHS_REFINE.buildSystemPrompt('ai-knowledge', samplesStyle);
    expect(p).toContain(sampleText1);
  });

  it('要求小红书语感 (加粗 / 比抖音更温)', () => {
    const p = XHS_REFINE.buildSystemPrompt('ai-knowledge', descStyle);
    expect(p).toContain('加粗');
    expect(p).toMatch(/比抖音.*温|更温/);
  });
});

describe('XHS_REFINE.buildUserMessage', () => {
  it('包含当前 intro/body 与 instruction', () => {
    const parts = XHS_REFINE.buildUserMessage({
      intro: validIntro,
      body: validBody,
      instruction: '把 intro 改得更有反差感',
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain(validIntro);
    expect(text).toContain(validBody);
    expect(text).toContain('把 intro 改得更有反差感');
  });

  it('brief 为 null 时不出现素材简报段落', () => {
    const parts = XHS_REFINE.buildUserMessage({
      intro: validIntro,
      body: validBody,
      instruction: '改一下',
      brief: null,
    });
    const text = (parts[0] as any).text;
    expect(text).not.toContain('素材简报');
  });

  it('brief 非空时素材 fact 出现在正文', () => {
    const parts = XHS_REFINE.buildUserMessage({
      intro: validIntro,
      body: validBody,
      instruction: '改一下',
      brief: validBrief,
    });
    const text = (parts[0] as any).text;
    expect(text).toContain('素材简报');
    expect(text).toContain(validBrief.points[0].fact);
  });
});

describe('XHS_REFINE.responseSchema — intro/body 边界', () => {
  it('合法 intro/body 通过', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: validIntro, body: validBody })
    ).not.toThrow();
  });

  it('intro 19 字 → 拒绝 (min 20)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: 'a'.repeat(19), body: validBody })
    ).toThrow();
  });

  it('intro 150 字 → 通过 (max 150)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: 'a'.repeat(150), body: validBody })
    ).not.toThrow();
  });

  it('intro 151 字 → 拒绝 (max 150)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: 'a'.repeat(151), body: validBody })
    ).toThrow();
  });

  it('body 149 字 → 拒绝 (min 150)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: validIntro, body: 'a'.repeat(149) })
    ).toThrow();
  });

  it('body 800 字 → 通过 (max 800)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: validIntro, body: 'a'.repeat(800) })
    ).not.toThrow();
  });

  it('body 801 字 → 拒绝 (max 800)', () => {
    expect(() =>
      XHS_REFINE.responseSchema.parse({ intro: validIntro, body: 'a'.repeat(801) })
    ).toThrow();
  });

  it('缺少 intro → 拒绝', () => {
    expect(() => XHS_REFINE.responseSchema.parse({ body: validBody })).toThrow();
  });

  it('缺少 body → 拒绝', () => {
    expect(() => XHS_REFINE.responseSchema.parse({ intro: validIntro })).toThrow();
  });

  it('不含 titles/coverText/tags/shotIdeas 也能通过 (只关心 intro/body)', () => {
    const parsed = XHS_REFINE.responseSchema.parse({ intro: validIntro, body: validBody });
    expect(Object.keys(parsed).sort()).toEqual(['body', 'intro']);
  });
});
