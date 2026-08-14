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

const configMock = vi.hoisted(() => ({ getDecryptedTavilyKey: vi.fn() }));
vi.mock('@/lib/radar/config', () => configMock);

const searchProviderMock = vi.hoisted(() => ({ search: vi.fn() }));
const getSearchProviderMock = vi.hoisted(() => vi.fn(() => searchProviderMock));
vi.mock('@/lib/radar/search', () => ({ getSearchProvider: getSearchProviderMock }));

const prismaMock = vi.hoisted(() => ({
  personaProfile: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from '@/app/api/v1/persona/market-research/route';
import { __resetLLMClientsForTest } from '@/lib/llm/clients';

const establishedRow = {
  userId: 'user1',
  audience: '25-35 岁互联网从业者',
  targetFans: '想转行做 AI 的人',
  pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
  angle: '只讲能落地的方法',
  avoid: '不做标题党',
  painPoints: [],
  offerings: [],
  productLogic: '',
  marketInsight: null,
  systemSummary: '',
};

const validMarketInsight = {
  landscape: '同质化严重, 内容供给已经很饱和了',
  mainstream: '账号普遍在做工具测评合集类内容',
  unmet: '用户想要的是深度实操而非资讯搬运',
  opportunity: '结合实测翻车案例做差异化内容切入',
};

function fakeSearchResults() {
  return [{ url: 'https://a.example.com', title: '标题', content: '搜索正文内容', sourceSite: 'a.example.com' }];
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetLLMClientsForTest();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.personaProfile.findUnique.mockResolvedValue(establishedRow);
  configMock.getDecryptedTavilyKey.mockResolvedValue('tvly-fake');
  searchProviderMock.search.mockResolvedValue(fakeSearchResults());
  llmMock.callStructured.mockResolvedValue({
    result: validMarketInsight,
    usage: { model: 'deepseek', promptTokens: 50, completionTokens: 80, estCostUSD: 0.0005 },
  });
});

describe('POST /api/v1/persona/market-research', () => {
  it('档案未建立 (personaProfile.findUnique → null) → 400, 不调用 Tavily/LLM', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
    expect(configMock.getDecryptedTavilyKey).not.toHaveBeenCalled();
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('档案存在但未建立 (audience 为空) → 400', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue({ ...establishedRow, audience: '', pillars: [] });
    const res = await POST();
    expect(res.status).toBe(400);
  });

  it('无 Tavily key → 400, 不调用搜索/LLM', async () => {
    configMock.getDecryptedTavilyKey.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain('未配置 Tavily key');
    expect(searchProviderMock.search).not.toHaveBeenCalled();
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('两条搜索全部失败 → 502, 不调用 LLM, 不落库', async () => {
    searchProviderMock.search.mockRejectedValue(new Error('Tavily 挂了'));
    const res = await POST();
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.message).toContain('市场搜索失败');
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.personaProfile.update).not.toHaveBeenCalled();
  });

  it('单条搜索失败, 另一条成功 → 不 502, 继续走 LLM', async () => {
    searchProviderMock.search
      .mockRejectedValueOnce(new Error('第一条挂了'))
      .mockResolvedValueOnce(fakeSearchResults());
    const res = await POST();
    expect(res.status).toBe(200);
    expect(llmMock.callStructured).toHaveBeenCalled();
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
  });

  it('成功 → 200, 落库 marketInsight 含 researchedAt (ISO 字符串)', async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.marketInsight).toMatchObject(validMarketInsight);
    expect(typeof json.data.marketInsight.researchedAt).toBe('string');
    expect(() => new Date(json.data.marketInsight.researchedAt).toISOString()).not.toThrow();

    expect(prismaMock.personaProfile.update).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      data: { marketInsight: expect.objectContaining({ ...validMarketInsight, researchedAt: expect.any(String) }) },
    });
  });

  it('落库只 spread marketInsight 一个字段, 不整行覆盖其余字段', async () => {
    await POST();
    const call = prismaMock.personaProfile.update.mock.calls[0][0];
    expect(Object.keys(call.data)).toEqual(['marketInsight']);
  });

  // 注: pillars 为空退化为只发第二条查询的分支在代码里保留 (裁决要求的防御性写法),
  // 但 isProfileEstablished 要求 pillars.length>=1 才算档案已建立, 该分支在
  // loadPersonaProfile 网关之后实际不可达, 因此不通过路由层测试覆盖 (无法在不绕过
  // 400 档案门槛的前提下让 profile.pillars 为空)。

  it('pillars 非空时发两条查询: 赛道现状 + 受众相关', async () => {
    await POST();
    expect(searchProviderMock.search).toHaveBeenCalledTimes(2);
    expect(searchProviderMock.search).toHaveBeenNthCalledWith(1, '工具评测 赛道 现状', expect.anything());
    expect(searchProviderMock.search).toHaveBeenNthCalledWith(2, '25-35 岁互联网从业者 内容 账号', expect.anything());
  });

  it('userMessage 组装含受众/支柱/搜索摘要', async () => {
    await POST();
    const call = llmMock.callStructured.mock.calls[0][0];
    const text = (call.userMessage[0] as { text: string }).text;
    expect(text).toContain('25-35 岁互联网从业者');
    expect(text).toContain('工具评测');
    expect(text).toContain('搜索正文内容');
  });
});
