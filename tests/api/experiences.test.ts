import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    creatorExperience: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'sk-test') }));
const callStructured = vi.fn();
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: vi.fn(() => ({ callStructured })) }));

const { prisma } = await import('@/lib/prisma');
const { resolveDeepSeekApiKey } = await import('@/lib/llm/resolve-key');
const { GET, POST } = await import('@/app/api/v1/experiences/route');
const { PATCH, DELETE } = await import('@/app/api/v1/experiences/[id]/route');

const CONTENT = '上周用某工具做小红书封面, 连续翻车三次才发现是尺寸参数问题';
const TAG = { topic: 'AI 配图', kind: 'failure', keywords: ['封面', '尺寸', '翻车'] };

function post(body: unknown) {
  return new Request('http://localhost/api/v1/experiences', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function patch(body: unknown) {
  return new Request('http://localhost/api/v1/experiences/e1', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    userId: 'u1',
    content: CONTENT,
    topic: TAG.topic,
    kind: TAG.kind,
    keywords: TAG.keywords,
    usedCount: 0,
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveDeepSeekApiKey).mockResolvedValue('sk-test');
  callStructured.mockResolvedValue({ result: TAG, usage: {} });
  vi.mocked(prisma.creatorExperience.create).mockResolvedValue(row() as never);
});

describe('POST /api/v1/experiences —— 随手记', () => {
  it('正常: 打标签成功, 原文原样入库, tagged:true', async () => {
    const json = await (await POST(post({ content: CONTENT }))).json();
    expect(json.success).toBe(true);
    expect(json.data.tagged).toBe(true);
    const call = vi.mocked(prisma.creatorExperience.create).mock.calls[0][0];
    expect(call.data.content).toBe(CONTENT); // 原文未被改写
    expect(call.data.topic).toBe(TAG.topic);
    expect(call.data.keywords).toEqual(TAG.keywords);
  });

  it('**打标签失败仍落库**且 tagged:false —— 不因 LLM 挂了丢掉用户记的内容', async () => {
    callStructured.mockRejectedValue(new Error('llm down'));
    const res = await POST(post({ content: CONTENT }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.tagged).toBe(false);
    const call = vi.mocked(prisma.creatorExperience.create).mock.calls[0][0];
    expect(call.data.content).toBe(CONTENT); // 内容照常入库
    expect(call.data.topic).toBe('');
    expect(call.data.kind).toBe('');
    expect(call.data.keywords).toEqual([]);
  });

  it('空内容 / 超 500 字 → 400 且不写库', async () => {
    expect((await POST(post({ content: '' }))).status).toBe(400);
    expect((await POST(post({ content: '  ' }))).status).toBe(400);
    expect((await POST(post({ content: 'a'.repeat(501) }))).status).toBe(400);
    expect(prisma.creatorExperience.create).not.toHaveBeenCalled();
  });

  it('非法 JSON → 400; 无 key → 503 且不写库', async () => {
    expect((await POST(post('{bad'))).status).toBe(400);
    vi.mocked(resolveDeepSeekApiKey).mockResolvedValue(null);
    expect((await POST(post({ content: CONTENT }))).status).toBe(503);
    expect(prisma.creatorExperience.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/experiences', () => {
  it('返回列表(经 loadExperiences 防御解析)', async () => {
    vi.mocked(prisma.creatorExperience.findMany).mockResolvedValue([
      row({ keywords: ['a', 1, ''], kind: 'BAD' }),
    ] as never);
    const json = await (await GET()).json();
    expect(json.data.experiences[0].keywords).toEqual(['a']);
    expect(json.data.experiences[0].kind).toBe('');
  });
});

describe('PATCH /api/v1/experiences/[id]', () => {
  beforeEach(() => {
    vi.mocked(prisma.creatorExperience.findFirst).mockResolvedValue({ id: 'e1' } as never);
    vi.mocked(prisma.creatorExperience.update).mockResolvedValue(row() as never);
  });

  it('可改 keywords(人工修正检索词)', async () => {
    await PATCH(patch({ keywords: ['新词1', '新词2'] }), { params: { id: 'e1' } });
    const call = vi.mocked(prisma.creatorExperience.update).mock.calls[0][0];
    expect(call.data).toEqual({ keywords: ['新词1', '新词2'] });
  });

  it('非法 kind 降为空串而非报错(宽进严出)', async () => {
    await PATCH(patch({ kind: 'WEIRD' }), { params: { id: 'e1' } });
    expect(vi.mocked(prisma.creatorExperience.update).mock.calls[0][0].data).toEqual({ kind: '' });
  });

  it('只传未定义字段 → 400 没有可更新的字段', async () => {
    const res = await PATCH(patch({}), { params: { id: 'e1' } });
    expect(res.status).toBe(400);
    expect(prisma.creatorExperience.update).not.toHaveBeenCalled();
  });

  it('他人条目 → 404 且不更新', async () => {
    vi.mocked(prisma.creatorExperience.findFirst).mockResolvedValue(null as never);
    const res = await PATCH(patch({ topic: 'x' }), { params: { id: 'e1' } });
    expect(res.status).toBe(404);
    expect(prisma.creatorExperience.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/v1/experiences/[id]', () => {
  it('本人 → 删除', async () => {
    vi.mocked(prisma.creatorExperience.findFirst).mockResolvedValue({ id: 'e1' } as never);
    vi.mocked(prisma.creatorExperience.delete).mockResolvedValue(row() as never);
    const json = await (
      await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
        params: { id: 'e1' },
      })
    ).json();
    expect(json.data.deleted).toBe(true);
  });

  it('他人 → 404 且不删', async () => {
    vi.mocked(prisma.creatorExperience.findFirst).mockResolvedValue(null as never);
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: { id: 'e1' },
    });
    expect(res.status).toBe(404);
    expect(prisma.creatorExperience.delete).not.toHaveBeenCalled();
  });
});
