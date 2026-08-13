import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * research.ts 单测 — house mock 约定 (vi.hoisted + 模块级 vi.mock), 学
 * tests/lib/radar/run.test.ts 先例。
 */

const prismaMock = vi.hoisted(() => ({
  radarItem: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const configMock = vi.hoisted(() => ({ getDecryptedTavilyKey: vi.fn() }));
vi.mock('@/lib/radar/config', () => configMock);

const searchProviderMock = vi.hoisted(() => ({ search: vi.fn() }));
const getSearchProviderMock = vi.hoisted(() => vi.fn(() => searchProviderMock));
vi.mock('@/lib/radar/search', () => ({ getSearchProvider: getSearchProviderMock }));

const resolveDeepSeekApiKeyMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: resolveDeepSeekApiKeyMock }));

const llmCallMock = vi.hoisted(() => vi.fn());
const getDeepSeekTextLLMMock = vi.hoisted(() => vi.fn(() => ({ callStructured: llmCallMock })));
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: getDeepSeekTextLLMMock }));

import { runResearch, composeRawMaterials } from '@/lib/script/research';

function fakeBrief() {
  return {
    points: [{ fact: '某数字 42', source: 'https://a.example.com', usage: '开场引用' }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.radarItem.findFirst.mockResolvedValue(null);
  configMock.getDecryptedTavilyKey.mockResolvedValue(null);
  searchProviderMock.search.mockResolvedValue([]);
  resolveDeepSeekApiKeyMock.mockResolvedValue('ds-fake');
  llmCallMock.mockResolvedValue({ result: fakeBrief(), usage: {} });
});

describe('composeRawMaterials', () => {
  it('按序拼接 【label】\\ntext', () => {
    const out = composeRawMaterials(
      [
        { label: 'A', text: '第一段' },
        { label: 'B', text: '第二段' },
      ],
      8000
    );
    expect(out).toBe('【A】\n第一段\n\n【B】\n第二段');
  });

  it('未超长 → 原样返回', () => {
    const out = composeRawMaterials([{ label: 'X', text: 'short' }], 8000);
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out).toBe('【X】\nshort');
  });

  it('超长截断到 maxLen', () => {
    const longText = 'x'.repeat(10000);
    const out = composeRawMaterials([{ label: 'X', text: longText }], 8000);
    expect(out.length).toBe(8000);
  });

  it('空数组 → 空字符串', () => {
    expect(composeRawMaterials([], 8000)).toBe('');
  });
});

describe('runResearch', () => {
  it('无 key 无素材 → 返回 null, 不调用 DeepSeek', async () => {
    // 无雷达种子命中, 无 tavily key, 无 userMaterials
    const out = await runResearch('u1', { topic: '减脂饮食', niche: '健康' });

    expect(out).toBeNull();
    expect(resolveDeepSeekApiKeyMock).not.toHaveBeenCalled();
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('仅用户素材 → 跳过搜索 (无 tavily key) 仍出简报', async () => {
    configMock.getDecryptedTavilyKey.mockResolvedValue(null);

    const out = await runResearch('u1', {
      topic: '减脂饮食',
      niche: '健康',
      userMaterials: '我自己整理的素材要点',
    });

    expect(getSearchProviderMock).not.toHaveBeenCalled();
    expect(out).toEqual(fakeBrief());
    expect(llmCallMock).toHaveBeenCalledTimes(1);
    const userMessage = llmCallMock.mock.calls[0][0].userMessage;
    const text = JSON.stringify(userMessage);
    expect(text).toContain('我自己整理的素材要点');
  });

  it('搜索单次失败不断流: 一次失败一次成功, 仍出简报', async () => {
    configMock.getDecryptedTavilyKey.mockResolvedValue('tvly-fake');
    searchProviderMock.search
      .mockRejectedValueOnce(new Error('Tavily 超时'))
      .mockResolvedValueOnce([
        { url: 'https://b.example.com/1', title: '标题', content: '案例正文数据', sourceSite: 'b.example.com' },
      ]);

    const out = await runResearch('u1', { topic: '减脂饮食', niche: '健康' });

    expect(searchProviderMock.search).toHaveBeenCalledTimes(2);
    expect(out).toEqual(fakeBrief());
    const userMessage = llmCallMock.mock.calls[0][0].userMessage;
    expect(JSON.stringify(userMessage)).toContain('案例正文数据');
  });

  it('两次搜索都失败且无其它素材 → 返回 null', async () => {
    configMock.getDecryptedTavilyKey.mockResolvedValue('tvly-fake');
    searchProviderMock.search.mockRejectedValue(new Error('Tavily 401'));

    const out = await runResearch('u1', { topic: '减脂饮食', niche: '健康' });

    expect(out).toBeNull();
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('雷达种子命中 → aiSummary/aiAngle/url 注入素材池', async () => {
    prismaMock.radarItem.findFirst.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      url: 'https://radar.example.com/seed',
      title: '减脂饮食热点',
      aiSummary: '摘要内容XYZ',
      aiAngle: '切入角度ABC',
      status: 'adopted',
    });

    const out = await runResearch('u1', { topic: '减脂饮食', niche: '健康' });

    expect(prismaMock.radarItem.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        status: 'adopted',
        OR: [{ title: { contains: '减脂饮食' } }],
      },
    });
    expect(out).toEqual(fakeBrief());
    const userMessage = llmCallMock.mock.calls[0][0].userMessage;
    const text = JSON.stringify(userMessage);
    expect(text).toContain('摘要内容XYZ');
    expect(text).toContain('切入角度ABC');
    expect(text).toContain('https://radar.example.com/seed');
  });

  it('雷达种子查询异常 → 静默跳过, 不影响后续素材来源', async () => {
    prismaMock.radarItem.findFirst.mockRejectedValue(new Error('db down'));

    const out = await runResearch('u1', {
      topic: '减脂饮食',
      niche: '健康',
      userMaterials: '用户素材内容',
    });

    expect(out).toEqual(fakeBrief());
  });

  it('DeepSeek key 缺失 → 降级返回 null', async () => {
    resolveDeepSeekApiKeyMock.mockResolvedValue(null);

    const out = await runResearch('u1', {
      topic: '减脂饮食',
      niche: '健康',
      userMaterials: '用户素材内容',
    });

    expect(out).toBeNull();
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('callStructured 异常 → catch 降级返回 null (不 throw)', async () => {
    llmCallMock.mockRejectedValue(new Error('LLM 挂了'));

    const out = await runResearch('u1', {
      topic: '减脂饮食',
      niche: '健康',
      userMaterials: '用户素材内容',
    });

    expect(out).toBeNull();
  });

  it('素材超长 → 拼接后截断至 8000 字再传给 callStructured', async () => {
    const out = await runResearch('u1', {
      topic: '减脂饮食',
      niche: '健康',
      userMaterials: 'x'.repeat(20000),
    });

    expect(out).toEqual(fakeBrief());
    const rawMaterials = llmCallMock.mock.calls[0][0];
    // buildUserMessage 拼进 ContentPart text 里, 找到那段文本长度受控
    const text = JSON.stringify(rawMaterials.userMessage);
    // 原始 20000 字不应该整段原样出现 (已被截断)
    expect(text.includes('x'.repeat(20000))).toBe(false);
  });
});
