import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/image/provider', () => ({
  getImageProvider: vi.fn(() => ({ generate: generateMock })),
}));

vi.mock('@/lib/llm/resolve-image-key', () => ({
  resolveImageApiKey: vi.fn(async () => process.env.IMAGE_API_KEY ?? null),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const mkdirMock = vi.hoisted(() => vi.fn(async () => undefined));
const writeFileMock = vi.hoisted(() => vi.fn(async (_path: unknown, _data: unknown) => undefined));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: mkdirMock, writeFile: writeFileMock };
});

import { POST } from '@/app/api/v1/scripts/[id]/images/route';

function reqPOST(body: unknown, url = 'http://t/api/v1/scripts/draft1/images') {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

const validPlan = {
  style: 'minimalist flat illustration, warm pastel palette, soft shadow',
  images: [
    { idx: 0, prompt: 'render the Chinese headline text as bold poster-style large text overlay, portrait 3:4' },
    { idx: 1, prompt: 'a screenshot mockup of a poster with big Chinese cover text, portrait 3:4 composition' },
    { idx: 2, prompt: 'a close-up of a ChatGPT input box showing a prompt example, portrait 3:4 composition' },
  ],
};

function baseXhsDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    platform: 'xiaohongshu',
    output: { coverText: 'x', imagePlan: validPlan },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.IMAGE_API_KEY = 'sk-test';
  prismaMock.scriptDraft.findUnique.mockResolvedValue(baseXhsDraft());
  prismaMock.scriptDraft.update.mockResolvedValue({});
  generateMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
});

describe('POST /api/v1/scripts/[id]/images — 成功', () => {
  it('生成成功: 写盘路径正确, output.images 形状正确, ok 响应 { idx, path }', async () => {
    const res = await POST(reqPOST({ idx: 1 }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ idx: 1, path: '/generated/draft1/1.png' });

    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringContaining(`${['public', 'generated', 'draft1'].join('/')}`),
      { recursive: true },
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBuf] = writeFileMock.mock.calls[0];
    expect(String(writtenPath)).toMatch(/1\.png$/);
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);

    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          coverText: 'x',
          imagePlan: validPlan,
          images: {
            1: {
              path: '/generated/draft1/1.png',
              prompt: validPlan.images[1].prompt,
              createdAt: expect.any(String),
            },
          },
        }),
      },
    });
  });

  it('quality 透传给 provider.generate; 未传时默认 medium', async () => {
    await POST(reqPOST({ idx: 0, quality: 'high' }), ctx);
    expect(generateMock).toHaveBeenCalledWith({
      prompt: validPlan.images[0].prompt,
      size: '1024x1536',
      quality: 'high',
    });

    generateMock.mockClear();
    await POST(reqPOST({ idx: 0 }), ctx);
    expect(generateMock).toHaveBeenCalledWith({
      prompt: validPlan.images[0].prompt,
      size: '1024x1536',
      quality: 'medium',
    });
  });

  it('单张覆盖不动其他 idx: output.images 已有其他 idx 时 spread 保留', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({
        output: {
          coverText: 'x',
          imagePlan: validPlan,
          images: {
            0: { path: '/generated/draft1/0.png', prompt: 'old prompt', createdAt: '2026-01-01T00:00:00.000Z' },
          },
        },
      }),
    );
    await POST(reqPOST({ idx: 1 }), ctx);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          images: {
            0: { path: '/generated/draft1/0.png', prompt: 'old prompt', createdAt: '2026-01-01T00:00:00.000Z' },
            1: {
              path: '/generated/draft1/1.png',
              prompt: validPlan.images[1].prompt,
              createdAt: expect.any(String),
            },
          },
        }),
      },
    });
  });

  it('output 其余键 spread 保留', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { coverText: 'x', tags: ['#a'], imagePlan: validPlan } }),
    );
    await POST(reqPOST({ idx: 0 }), ctx);
    const call = prismaMock.scriptDraft.update.mock.calls[0][0];
    expect(call.data.output).toMatchObject({ coverText: 'x', tags: ['#a'] });
  });

  it('覆盖写: 同 idx 再次生成覆盖旧记录', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({
        output: {
          coverText: 'x',
          imagePlan: validPlan,
          images: {
            1: { path: '/generated/draft1/1.png', prompt: 'stale prompt', createdAt: '2020-01-01T00:00:00.000Z' },
          },
        },
      }),
    );
    await POST(reqPOST({ idx: 1 }), ctx);
    const call = prismaMock.scriptDraft.update.mock.calls[0][0];
    expect(call.data.output.images[1].prompt).toBe(validPlan.images[1].prompt);
    expect(call.data.output.images[1].createdAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('POST /api/v1/scripts/[id]/images — 校验', () => {
  it('body idx 缺失/非法类型 → 400, 不调 provider', async () => {
    const res = await POST(reqPOST({}), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('idx 非整数 → 400', async () => {
    const res = await POST(reqPOST({ idx: 1.5 }), ctx);
    expect(res.status).toBe(400);
  });

  it('quality 非法值 → 400, 不调 provider', async () => {
    const res = await POST(reqPOST({ idx: 0, quality: 'ultra' }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await POST(new Request('http://t/api/v1/scripts/draft1/images', { method: 'POST', body: '{bad' }), ctx);
    expect(res.status).toBe(400);
  });

  it('脚本不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ userId: 'other' }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(404);
  });

  it('非小红书平台 → 400, 不调 provider', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ platform: 'douyin' }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('无 imagePlan → 400, 不调 provider', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ output: { coverText: 'x' } }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('idx 越界 (>= plan.images.length) → 400, 不调 provider', async () => {
    const res = await POST(reqPOST({ idx: 99 }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('无 key → 503 文案「OpenAI 生图 key 未配置」, 不调 provider, 不写库', async () => {
    delete process.env.IMAGE_API_KEY;
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.message).toBe('OpenAI 生图 key 未配置');
    expect(generateMock).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/images — provider 失败', () => {
  it('provider throw → 502 文案含「第 <idx+1> 张生成失败」, 不写库, 不写盘记录', async () => {
    generateMock.mockRejectedValueOnce(new Error('rate limited'));
    const res = await POST(reqPOST({ idx: 1 }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('第 2 张生成失败');
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});
