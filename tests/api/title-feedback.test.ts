import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

import { POST } from '@/app/api/v1/checklist/title-feedback/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/checklist/title-feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validResponse = {
  lengthVerdict: 'good' as const,
  hookTypes: ['数字'],
  suggestions: ['在开头加反差词', '把"技巧"改成"秘诀"'],
  overallScore: 75,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  llmMock.callStructured.mockResolvedValue({
    result: validResponse,
    usage: { model: 'deepseek', promptTokens: 50, completionTokens: 80, estCostUSD: 0.0005 },
  });
});

describe('POST /api/v1/checklist/title-feedback', () => {
  it('正常 title+niche → 200, data 完整', async () => {
    const res = await POST(reqJSON({ title: 'ChatGPT 5 个技巧让效率翻倍', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.lengthVerdict).toBe('good');
    expect(json.data.overallScore).toBe(75);
  });

  it('title 过短 (<3) → 400', async () => {
    const res = await POST(reqJSON({ title: 'AI', niche: 'ai-knowledge' }));
    expect(res.status).toBe(400);
  });

  it('niche 空 → 400', async () => {
    const res = await POST(reqJSON({ title: '正常标题', niche: '' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqJSON({ title: '正常标题', niche: 'ai-knowledge' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/LLM down|评估失败/);
  });
});
