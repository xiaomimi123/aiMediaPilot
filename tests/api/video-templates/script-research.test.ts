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
