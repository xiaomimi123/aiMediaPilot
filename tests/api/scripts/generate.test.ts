import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

// resolveDeepSeekApiKey 内部查 AIConfig(+decrypt); 单测已在别处覆盖, 这里只关心
// route 是否正确消费其返回值 — 直接代理 env, 保留既有 `process.env.DEEPSEEK_API_KEY`
// 测试模式 (设置/删除 env 即可控制 key 有无), 不需要额外 mock prisma.aIConfig。
vi.mock('@/lib/llm/resolve-key', () => ({
  resolveDeepSeekApiKey: vi.fn(async () => process.env.DEEPSEEK_API_KEY ?? null),
}));

const prismaMock = vi.hoisted(() => ({
  inspirationInsight: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

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
  prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
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

  describe('inspirationId 透传', () => {
    it('inspirationId 存在 → LLM userMessage 含 hookTypes/titlePatterns 文本片段', async () => {
      prismaMock.inspirationInsight.findFirst.mockResolvedValue({
        output: {
          hookTypes: ['数字', '反差'],
          titlePatterns: ['以数字开头', '含 emoji'],
          durationInsight: '45-60s 最优',
        },
      });
      const res = await POST(
        makeReq({
          topic: '主题示例',
          niche: 'ai-knowledge',
          inspirationId: 'insight1',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.inspirationApplied).toBe(true);

      // 查 LLM call 的 userMessage 应该含 style hints
      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).toContain('钩子类型: 数字 / 反差');
      expect(userText).toContain('标题模式: 以数字开头 / 含 emoji');
      expect(userText).toContain('时长规律: 45-60s 最优');
      expect(userText).toContain('参考下面对标爆款的共性');

      // findFirst 应该用 (id, userId) 双 where (ownership check)
      expect(prismaMock.inspirationInsight.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'insight1', userId: 'user1' },
        }),
      );
    });

    it('inspirationId 不存在或不属于自己 → 跑下去 + inspirationApplied=false', async () => {
      prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
      const res = await POST(
        makeReq({
          topic: '主题示例',
          niche: 'ai-knowledge',
          inspirationId: 'not-mine',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.inspirationApplied).toBe(false);

      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).not.toContain('参考下面对标爆款');
    });

    it('不传 inspirationId → 不查 Prisma, 不带 styleHints', async () => {
      const res = await POST(
        makeReq({ topic: '主题示例', niche: 'ai-knowledge' }),
      );
      expect(res.status).toBe(200);
      expect(prismaMock.inspirationInsight.findFirst).not.toHaveBeenCalled();
      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).not.toContain('参考下面对标爆款');
    });
  });
});
