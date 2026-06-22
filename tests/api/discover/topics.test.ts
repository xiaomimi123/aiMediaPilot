import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from '@/app/api/v1/discover/topics/route';

function reqJSON(body: unknown): Request {
  return new Request('http://t/api/v1/discover/topics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validResult = {
  topics: Array.from({ length: 5 }, (_, i) => ({
    title: `示例标题 ${i + 1}`,
    hookType: '数字',
    hookLine: `这是钩子句 ${i + 1}`,
    rationale: `这是流量理由 ${i + 1} 长度够长够长够长够长`,
    difficulty: 'low' as const,
    targetAudience: `新人创作者 ${i + 1}`,
  })),
  summary: '本批选题偏 AI 实操入门 — 总结测试用',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.scriptDraft.findMany.mockResolvedValue([]);
  llmMock.callStructured.mockResolvedValue({
    result: validResult,
    usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
  });
});

describe('POST /api/v1/discover/topics', () => {
  it('niche 必填 → 400', async () => {
    const res = await POST(reqJSON({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('niche');
  });

  it('正常调用 → 200, 返 topics + summary + niche + generatedAt', async () => {
    const res = await POST(reqJSON({ niche: 'ai-knowledge', count: 5 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.niche).toBe('ai-knowledge');
    expect(json.data.topics).toHaveLength(5);
    expect(json.data.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('count 默认 12, 超过 20 自动 clamp', async () => {
    await POST(reqJSON({ niche: 'food', count: 100 }));
    const userMessageText = (llmMock.callStructured.mock.calls[0][0].userMessage[0] as {
      text: string;
    }).text;
    expect(userMessageText).toContain('20 个');
  });

  it('count 小于 5 自动 clamp 到 5', async () => {
    await POST(reqJSON({ niche: 'food', count: 1 }));
    const userMessageText = (llmMock.callStructured.mock.calls[0][0].userMessage[0] as {
      text: string;
    }).text;
    expect(userMessageText).toContain('5 个');
  });

  it('用户最近脚本被传入 prompt 用于去重', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValue([
      { topic: 'ChatGPT 写周报' },
      { topic: 'Claude 提示词工程' },
    ]);
    const res = await POST(reqJSON({ niche: 'ai-knowledge', count: 8 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.dedupSampleSize).toBe(2);

    const userText = (llmMock.callStructured.mock.calls[0][0].userMessage[0] as { text: string }).text;
    expect(userText).toContain('避免重复');
    expect(userText).toContain('ChatGPT 写周报');
    expect(userText).toContain('Claude 提示词工程');

    // 查询应该按 niche + userId 过滤
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1', niche: 'ai-knowledge' },
        take: 30,
      }),
    );
  });

  it('extraHint 透传到 prompt', async () => {
    await POST(reqJSON({ niche: 'ai-knowledge', extraHint: '想要偏新人入门方向' }));
    const userText = (llmMock.callStructured.mock.calls[0][0].userMessage[0] as { text: string }).text;
    expect(userText).toContain('想要偏新人入门方向');
  });

  it('LLM 报错 → 500 含错误消息', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM 5xx'));
    const res = await POST(reqJSON({ niche: 'ai-knowledge' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toContain('选题生成失败');
  });

  it('niche 超长 → 400', async () => {
    const longNiche = 'x'.repeat(100);
    const res = await POST(reqJSON({ niche: longNiche }));
    expect(res.status).toBe(400);
  });

  it('DEEPSEEK_API_KEY 缺失 → 500', async () => {
    const old = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const res = await POST(reqJSON({ niche: 'ai-knowledge' }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.message).toContain('DEEPSEEK_API_KEY');
    } finally {
      process.env.DEEPSEEK_API_KEY = old;
    }
  });
});
