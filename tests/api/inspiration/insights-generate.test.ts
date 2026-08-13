import { describe, expect, it, vi, beforeEach } from 'vitest';

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
  inspirationVideo: {
    findMany: vi.fn(),
  },
  inspirationInsight: {
    create: vi.fn(async () => ({ id: 'insight1' })),
  },
  personaProfile: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

const buildUserMessageSpy = vi.hoisted(() => vi.fn(() => [{ type: 'text', text: '' }]));
vi.mock('@/lib/llm/prompts', async (orig) => {
  const actual = await (orig as any)();
  return {
    ...actual,
    INSPIRATION_INSIGHT: {
      ...actual.INSPIRATION_INSIGHT,
      buildUserMessage: buildUserMessageSpy,
    },
  };
});

import { POST } from '@/app/api/v1/inspiration/insights/generate/route';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.personaProfile.findUnique.mockResolvedValue(null);
  llmMock.callStructured.mockResolvedValue({
    result: {
      titlePatterns: ['数字'],
      hookTypes: ['反差'],
      durationInsight: '45s',
      topicClusters: ['AI'],
      recommendedTopics: [{ title: 't', rationale: 'r' }],
      summary: 's'.repeat(30),
    },
    usage: { model: 'deepseek', promptTokens: 50, completionTokens: 50, estCostUSD: 0.0005 },
  });
});

function req(body: unknown) {
  return new Request('http://t/api/v1/inspiration/insights/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/inspiration/insights/generate — BigInt 0n 语义保留', () => {
  it('playCount=0n 应传给 LLM 为 0 而非 null (回归 truthy check bug)', async () => {
    prismaMock.inspirationVideo.findMany.mockResolvedValueOnce([
      {
        id: 'v1',
        title: '零播视频',
        authorName: 'a',
        platform: 'douyin',
        playCount: 0n,
        likeCount: 0n,
        commentCount: 0n,
        duration: 45,
        userNote: null,
      },
      {
        id: 'v2',
        title: '爆款',
        authorName: 'b',
        platform: 'douyin',
        playCount: 999999n,
        likeCount: 50000n,
        commentCount: 3000n,
        duration: 30,
        userNote: null,
      },
    ]);

    const res = await POST(req({ videoIds: ['v1', 'v2'], niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);

    // 验证 buildUserMessage 被调用时 v1 的 count 是 0 不是 null
    const [call] = buildUserMessageSpy.mock.calls;
    const passedVideos = (call as any)[0].videos;
    expect(passedVideos[0].playCount).toBe(0);
    expect(passedVideos[0].likeCount).toBe(0);
    expect(passedVideos[0].commentCount).toBe(0);
    expect(passedVideos[1].playCount).toBe(999999);
  });

  it('playCount=null 仍传 null (区别于 0)', async () => {
    prismaMock.inspirationVideo.findMany.mockResolvedValueOnce([
      {
        id: 'v1',
        title: 'x',
        authorName: 'a',
        platform: 'douyin',
        playCount: null,
        likeCount: null,
        commentCount: null,
        duration: null,
        userNote: null,
      },
      {
        id: 'v2',
        title: 'y',
        authorName: 'b',
        platform: 'douyin',
        playCount: 100n,
        likeCount: 10n,
        commentCount: 2n,
        duration: 30,
        userNote: null,
      },
    ]);
    await POST(req({ videoIds: ['v1', 'v2'], niche: 'ai-knowledge' }));
    const passedVideos = (buildUserMessageSpy.mock.calls[0] as any)[0].videos;
    expect(passedVideos[0].playCount).toBeNull();
    expect(passedVideos[1].playCount).toBe(100);
  });
});

describe('POST /api/v1/inspiration/insights/generate — 人设定位注入 (T4)', () => {
  const twoVideos = [
    { id: 'v1', title: '标题一', authorName: 'a', platform: 'douyin', playCount: 100n, likeCount: 10n, commentCount: 2n, duration: 30, userNote: null },
    { id: 'v2', title: '标题二', authorName: 'b', platform: 'douyin', playCount: 200n, likeCount: 20n, commentCount: 4n, duration: 45, userNote: null },
  ];

  it('无档案 (personaProfile.findUnique → null) → systemPrompt 不含人设定位段', async () => {
    prismaMock.inspirationVideo.findMany.mockResolvedValueOnce(twoVideos);
    prismaMock.personaProfile.findUnique.mockResolvedValue(null);
    const res = await POST(req({ videoIds: ['v1', 'v2'], niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).not.toContain('你的定位');
  });

  it('有档案 → systemPrompt 含人设定位内容 (受众/支柱)', async () => {
    prismaMock.inspirationVideo.findMany.mockResolvedValueOnce(twoVideos);
    prismaMock.personaProfile.findUnique.mockResolvedValue({
      userId: 'user1',
      audience: '25-35 岁互联网从业者',
      targetFans: '想转行做 AI 的人',
      pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
      angle: '只讲能落地的方法',
      avoid: '不做标题党',
    });
    const res = await POST(req({ videoIds: ['v1', 'v2'], niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('25-35 岁互联网从业者');
    expect(systemPrompt).toContain('工具评测');
    expect(prismaMock.personaProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user1' } });
  });
});
