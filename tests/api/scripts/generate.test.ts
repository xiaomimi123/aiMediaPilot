import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

import { POST } from '@/app/api/v1/scripts/generate/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/scripts/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validResponse = {
  hooks: [
    { text: '钩子一', rationale: '痛点反差' },
    { text: '钩子二', rationale: '数字承诺' },
    { text: '钩子三', rationale: '悬念展开' },
  ],
  retentionBeats: [
    { startSec: 0, endSec: 3, beat: '钩子开场' },
    { startSec: 3, endSec: 15, beat: '展示问题' },
    { startSec: 15, endSec: 50, beat: '解决方案' },
    { startSec: 50, endSec: 60, beat: 'CTA' },
  ],
  titles: [
    { text: '标题候选一', hookType: '数字' },
    { text: '标题候选二', hookType: '反差' },
    { text: '标题候选三', hookType: '问题' },
  ],
  cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写', colorTone: '白底红字' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  llmMock.callStructured.mockResolvedValue({
    result: validResponse,
    usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
  });
});

describe('POST /api/v1/scripts/generate', () => {
  it('正常 topic+niche → 200, data 通过 zod', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.hooks).toHaveLength(3);
    expect(json.data.titles).toHaveLength(3);
    expect(json.data.cover).toBeDefined();
  });

  it('topic 空 → 400', async () => {
    const res = await POST(makeReq({ topic: '', niche: 'ai-knowledge' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/LLM down|生成失败/);
  });
});
