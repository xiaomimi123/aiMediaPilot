import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitInspiration: { findUnique: vi.fn() },
  personaProfile: { findUnique: vi.fn(async () => null) },
  creatorVoice: { findUnique: vi.fn(async () => null) },
  creatorExperience: { findMany: vi.fn(async () => []) },
  styleProfile: { findUnique: vi.fn(async () => null) },
  styleSample: { findMany: vi.fn(async () => []) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class { callStructured = llmMock.callStructured; },
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'key') }));
vi.mock('@/lib/script/style', () => ({ getStyleContext: vi.fn(async () => ({ mode: 'none', description: '', samples: [] })) }));
vi.mock('@/lib/llm/prompts/persona-section', () => ({
  buildPersonaSection: vi.fn(() => ''),
  buildVoiceSection: vi.fn(() => ''),
}));

const researchMock = vi.hoisted(() => ({ runResearch: vi.fn() }));
vi.mock('@/lib/script/research', () => researchMock);

import { POST } from '@/app/api/v1/video-templates/[id]/script/route';

const BRIEF = {
  points: [
    { fact: 'DeepSeek V4 高峰时段单价为平时的 4 倍', source: 'https://wsj.com/x', usage: '澄清涨幅' },
  ],
};

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration',
    scriptPrompt: { targetDurationSec: 180 },
    researchEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue(template());
  llmMock.callStructured.mockResolvedValue({ result: { acts: [], four_dims: {} } });
  researchMock.runResearch.mockResolvedValue(BRIEF);
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('模板写稿的素材研究', () => {
  it('模板开了研究 → 先跑 runResearch, 简报喂给写稿', async () => {
    await POST(req({ source: 'paste', text: 'DeepSeek 涨价这事怎么看' }) as never, { params: { id: 't1' } });

    expect(researchMock.runResearch).toHaveBeenCalledTimes(1);
    const userMessage = JSON.stringify(llmMock.callStructured.mock.calls[0][0].userMessage);
    expect(userMessage).toContain('高峰时段单价为平时的 4 倍');
  });

  it('模板关了研究 → 不跑 runResearch(老行为, 也是省额度的那条路)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue(template({ researchEnabled: false }));
    await POST(req({ source: 'paste', text: 'DeepSeek 涨价这事怎么看' }) as never, { params: { id: 't1' } });
    expect(researchMock.runResearch).not.toHaveBeenCalled();
  });

  it('研究失败(返回 null)不阻断出稿 —— 降级成无素材写稿', async () => {
    researchMock.runResearch.mockResolvedValue(null);
    const res = await POST(req({ source: 'paste', text: '某个主题内容' }) as never, { params: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
  });

  it('简报随响应返回, 前端可展示"这稿子基于哪些素材"', async () => {
    const res = await POST(req({ source: 'paste', text: '某个主题内容' }) as never, { params: { id: 't1' } });
    const body = await res.json();
    expect(body.data.research).toEqual(BRIEF);
  });

  it('研究降级时响应里明确标出来, 不假装有素材', async () => {
    researchMock.runResearch.mockResolvedValue(null);
    const body = await (await POST(req({ source: 'paste', text: '某个主题内容' }) as never, { params: { id: 't1' } })).json();
    expect(body.data.research).toBeNull();
    expect(body.data.researchDegraded).toBe(true);
  });
});

describe('灵感文本的搜索词与素材拆分(真实出片踩过: 整段当搜索词导致研究降级)', () => {
  beforeEach(() => {
    prismaMock.cockpitInspiration.findUnique.mockResolvedValue({
      id: 'i1', userId: 'user1',
      text: 'DeepSeek将AI模型价格上调三倍\nDeepSeek涨价三倍，用户成本会大涨吗？\nDeepSeek将于8月16日上调旗舰V4系列价格，高峰时段达四倍多。公司刚融资74亿美元。\nhttps://cn.wsj.com/articles/xxx',
    });
  });

  it('搜索词只取首行标题, 不把整段灵感当查询词', async () => {
    await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as never, { params: { id: 't1' } });
    const arg = researchMock.runResearch.mock.calls[0][1];
    expect(arg.topic).toBe('DeepSeek将AI模型价格上调三倍');
    expect(arg.topic).not.toContain('\n');
  });

  it('灵感正文整段作为 userMaterials 喂进研究 —— 它本身就是带来源的真实素材', async () => {
    await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as never, { params: { id: 't1' } });
    const arg = researchMock.runResearch.mock.calls[0][1];
    expect(arg.userMaterials).toContain('74亿美元');
    expect(arg.userMaterials).toContain('wsj.com');
  });

  it('粘贴模式同样只取首行当搜索词', async () => {
    await POST(req({ source: 'paste', text: '标题这一行\n下面是很长的正文说明内容' }) as never, { params: { id: 't1' } });
    const arg = researchMock.runResearch.mock.calls[0][1];
    expect(arg.topic).toBe('标题这一行');
    expect(arg.userMaterials).toContain('下面是很长的正文');
  });

  it('单行输入时 topic 与 userMaterials 一致, 不出错', async () => {
    await POST(req({ source: 'paste', text: '就一行主题' }) as never, { params: { id: 't1' } });
    const arg = researchMock.runResearch.mock.calls[0][1];
    expect(arg.topic).toBe('就一行主题');
  });

  it('写稿用的仍是完整文本, 不因为拆分而丢失上下文', async () => {
    await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as never, { params: { id: 't1' } });
    const userMessage = JSON.stringify(llmMock.callStructured.mock.calls[0][0].userMessage);
    expect(userMessage).toContain('74亿美元');
  });
});
