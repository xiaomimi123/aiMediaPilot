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
  personaProfile: { findUnique: vi.fn(), update: vi.fn() },
  creatorVoice: { findUnique: vi.fn(async () => null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from '@/app/api/v1/persona/summary/route';
import { __resetLLMClientsForTest } from '@/lib/llm/clients';

const establishedRow = {
  userId: 'user1',
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
  marketInsight: {
    landscape: '同质化严重', mainstream: '搬运资讯', unmet: '缺乏可落地的实操',
    opportunity: '做深度实操内容', researchedAt: '2026-08-15T00:00:00.000Z',
  },
  systemSummary: '',
};

const validSummary = '一'.repeat(150);

beforeEach(() => {
  vi.clearAllMocks();
  __resetLLMClientsForTest();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.personaProfile.findUnique.mockResolvedValue(establishedRow);
  llmMock.callStructured.mockResolvedValue({
    result: { summary: validSummary },
    usage: { model: 'deepseek', promptTokens: 50, completionTokens: 200, estCostUSD: 0.0008 },
  });
});

describe('POST /api/v1/persona/summary', () => {
  it('档案未建立 (personaProfile.findUnique → null) → 400, 不调用 LLM', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('档案存在但未建立 (audience 为空) → 400', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue({ ...establishedRow, audience: '', pillars: [] });
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it('无 DEEPSEEK_API_KEY → 503, 不调用 LLM, 不落库', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await POST();
    expect(res.status).toBe(503);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.personaProfile.update).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('成功 → 200, 落库 systemSummary, 只 spread 该字段不整行覆盖', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.summary).toBe(validSummary);

    expect(prismaMock.personaProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      data: { systemSummary: validSummary },
    });
    const call = prismaMock.personaProfile.update.mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(['systemSummary']);
  });

  it('userMessage 组装含完整 profile (受众/支柱/痛点/产品供给/转化路径/市场调研)', async () => {
    await POST();
    const call = llmMock.callStructured.mock.calls[0][0];
    const text = (call.userMessage[0] as { text: string }).text;
    expect(text).toContain('25-35 岁互联网从业者');
    expect(text).toContain('工具评测');
    expect(text).toContain('装了很多 AI 工具但不会用');
    expect(text).toContain('工具选型咨询');
    expect(text).toContain('刷到实测视频觉得敢说真话');
    expect(text).toContain('同质化严重');
  });
});
