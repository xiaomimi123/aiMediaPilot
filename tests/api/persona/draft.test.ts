import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

vi.mock('@/lib/llm/resolve-key', () => ({
  resolveDeepSeekApiKey: vi.fn(async () => process.env.DEEPSEEK_API_KEY ?? null),
}));

const prismaMock = vi.hoisted(() => ({
  styleProfile: { findUnique: vi.fn() },
  styleSample: { findMany: vi.fn() },
  radarKeyword: { findMany: vi.fn() },
  personaProfile: { upsert: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from '@/app/api/v1/persona/draft/route';
import { __resetLLMClientsForTest } from '@/lib/llm/clients';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/persona/draft', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validAnswers = [
  { q: '你是谁/账号做什么', a: '我是做 AI 工具评测的' },
  { q: '最想吸引什么样的人关注', a: '' },
];

const validDraft = {
  audience: '25-35 岁互联网从业者',
  targetFans: '想转行做 AI 的人',
  pillars: [
    { name: '工具评测', description: '拆解 AI 工具实际效果' },
    { name: '案例拆解', description: '拆真实翻车案例' },
    { name: '行业观察', description: '聊行业里的新动向' },
  ],
  angle: '只讲能落地的方法',
  avoid: '不做标题党',
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetLLMClientsForTest();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.styleProfile.findUnique.mockResolvedValue({ userId: 'user1', description: '语速快, 口语化' });
  prismaMock.styleSample.findMany.mockResolvedValue([
    { content: 'a'.repeat(300), createdAt: new Date() },
    { content: '第二篇样本', createdAt: new Date() },
  ]);
  prismaMock.radarKeyword.findMany.mockResolvedValue([{ text: 'GPT-6' }, { text: 'AI 眼镜' }]);
  llmMock.callStructured.mockResolvedValue({
    result: validDraft,
    usage: { model: 'deepseek', promptTokens: 50, completionTokens: 80, estCostUSD: 0.0005 },
  });
});

describe('POST /api/v1/persona/draft', () => {
  it('合法 answers → 200, 返回 draft, 不落库', async () => {
    const res = await POST(reqJSON({ answers: validAnswers }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.draft).toEqual(validDraft);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
    expect(prismaMock.personaProfile.update).not.toHaveBeenCalled();
  });

  it('answers 为空数组 → 400', async () => {
    const res = await POST(reqJSON({ answers: [] }));
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('answers 超过 8 条 → 400', async () => {
    const answers = Array.from({ length: 9 }, (_, i) => ({ q: `问题${i}`, a: '答案' }));
    const res = await POST(reqJSON({ answers }));
    expect(res.status).toBe(400);
  });

  it('answers 缺失 → 400', async () => {
    const res = await POST(reqJSON({}));
    expect(res.status).toBe(400);
  });

  it('answer.a 为空串 (跳过某问) → 视为合法, 不 400', async () => {
    const res = await POST(reqJSON({ answers: [{ q: '问题', a: '' }] }));
    expect(res.status).toBe(200);
  });

  it('answer.q 为空串 → 400', async () => {
    const res = await POST(reqJSON({ answers: [{ q: '', a: '答案' }] }));
    expect(res.status).toBe(400);
  });

  it('请求体非法 JSON → 400', async () => {
    const res = await POST(
      new Request('http://t', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' }),
    );
    expect(res.status).toBe(400);
  });

  it('无 DEEPSEEK_API_KEY → 503', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await POST(reqJSON({ answers: validAnswers }));
    expect(res.status).toBe(503);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqJSON({ answers: validAnswers }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('输入组装: userMessage 包含 answers/风格说明/样本节选(截前 200 字)/雷达关键词', async () => {
    await POST(reqJSON({ answers: validAnswers }));
    const call = llmMock.callStructured.mock.calls[0][0];
    const text = (call.userMessage[0] as { text: string }).text;
    expect(text).toContain('我是做 AI 工具评测的');
    expect(text).toContain('语速快, 口语化');
    expect(text).toContain('第二篇样本');
    expect(text).toContain('GPT-6');
    expect(text).toContain('AI 眼镜');
    // 第一篇样本是 300 个 'a', 截前 200 字后不应包含第 201 个字符往后的完整 300 长度串
    const firstSampleOccurrence = text.match(/a{201,}/);
    expect(firstSampleOccurrence).toBeNull();
  });

  it('输入组装: StyleProfile 无行时风格说明按空串处理', async () => {
    prismaMock.styleProfile.findUnique.mockResolvedValueOnce(null);
    const res = await POST(reqJSON({ answers: validAnswers }));
    expect(res.status).toBe(200);
  });

  it('组装 RadarKeyword 查询限定 status=active', async () => {
    await POST(reqJSON({ answers: validAnswers }));
    expect(prismaMock.radarKeyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'active' }) }),
    );
  });

  it('StyleSample 查询取最近 3 篇', async () => {
    await POST(reqJSON({ answers: validAnswers }));
    expect(prismaMock.styleSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );
  });
});
