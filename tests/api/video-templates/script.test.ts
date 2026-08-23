import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitInspiration: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: class { callStructured = llmMock.callStructured; },
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'key') }));
vi.mock('@/lib/script/style', () => ({ getStyleContext: vi.fn(async () => ({ hasProfile: false, samples: [] })) }));

// 模板出稿必须和 /scripts/generate 一样注入人设定位 + 人物志/经历, 否则模板写出来的
// 稿子没有人格 (task-9 brief 明确要求)。这三个模块与 /scripts/generate 消费的是同一套,
// 这里按同样的接口 mock, 与 style.ts 的 mock 风格一致(mock 到 lib 函数一层, 不下钻到 prisma)。
vi.mock('@/lib/persona/profile', () => ({ loadPersonaProfile: vi.fn(async () => null) }));
vi.mock('@/lib/persona/voice', () => ({
  loadCreatorVoice: vi.fn(async () => null),
  loadExperiences: vi.fn(async () => []),
}));
vi.mock('@/lib/persona/experience-match', () => ({ matchExperiences: vi.fn(() => []) }));

import { POST } from '@/app/api/v1/video-templates/[id]/script/route';

const RESULT = { acts: [], four_dims: {} };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration',
    scriptPrompt: { tone: '冷幽默', targetDurationSec: 60 },
  });
  llmMock.callStructured.mockResolvedValue({ result: RESULT });
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/v1/video-templates/[id]/script', () => {
  it('粘贴模式: 用粘贴的文本当主题写六幕稿, 返回但不落库', async () => {
    const res = await POST(req({ source: 'paste', text: '我想讲讲向量数据库为什么被高估了' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.data.script).toEqual(RESULT);
  });

  it('模板的写稿提示注入进 systemPrompt', async () => {
    await POST(req({ source: 'paste', text: '某个主题内容' }) as any, { params: { id: 't1' } });
    const call = llmMock.callStructured.mock.calls[0][0];
    expect(call.systemPrompt).toContain('冷幽默');
  });

  it('模板的目标时长驱动各幕秒数分配', async () => {
    await POST(req({ source: 'paste', text: '某个主题内容' }) as any, { params: { id: 't1' } });
    const call = llmMock.callStructured.mock.calls[0][0];
    const text = JSON.stringify(call.userMessage);
    expect(text).toContain('60');
  });

  it('灵感模式: 用灵感文本当主题', async () => {
    prismaMock.cockpitInspiration.findUnique.mockResolvedValue({ id: 'i1', userId: 'user1', text: '灵感原文' });

    const res = await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const text = JSON.stringify(llmMock.callStructured.mock.calls[0][0].userMessage);
    expect(text).toContain('灵感原文');
  });

  it('灵感归属别的用户 → 404', async () => {
    prismaMock.cockpitInspiration.findUnique.mockResolvedValue({ id: 'i1', userId: 'other', text: 'x' });
    const res = await POST(req({ source: 'inspiration', inspirationId: 'i1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('非法 source → 400', async () => {
    const res = await POST(req({ source: 'whatever' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  it('粘贴模式但文本太短 → 400', async () => {
    const res = await POST(req({ source: 'paste', text: '短' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });
});
