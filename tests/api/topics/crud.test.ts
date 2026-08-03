import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  topicIdea: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST, GET } from '@/app/api/v1/topics/route';
import { PATCH } from '@/app/api/v1/topics/[id]/route';

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.topicIdea.create.mockResolvedValue({ id: 'idea1' });
  prismaMock.topicIdea.findMany.mockResolvedValue([]);
  prismaMock.topicIdea.findFirst.mockResolvedValue(null);
  prismaMock.topicIdea.findUnique.mockResolvedValue(null);
  prismaMock.topicIdea.update.mockResolvedValue({ id: 'idea1' });
});

describe('TopicIdea CRUD', () => {
  it('POST 入池 → 200, source 默认 manual', async () => {
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: 'AI 提效 10 招' }));
    expect(res.status).toBe(200);
    expect(prismaMock.topicIdea.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user1', title: 'AI 提效 10 招', source: 'manual' }),
      }),
    );
  });

  it('POST 空 title → 400', async () => {
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: '  ' }));
    expect(res.status).toBe(400);
  });

  it('POST 同 title 已在 POOL → 409 不重复创建 (spec §6)', async () => {
    prismaMock.topicIdea.findFirst.mockResolvedValueOnce({ id: 'existing' });
    const res = await POST(reqJSON('http://t/api/v1/topics', 'POST', { title: '重复选题' }));
    expect(res.status).toBe(409);
    expect(prismaMock.topicIdea.create).not.toHaveBeenCalled();
  });

  it('GET 默认只回 POOL, scope userId', async () => {
    const res = await GET(new Request('http://t/api/v1/topics'));
    expect(res.status).toBe(200);
    expect(prismaMock.topicIdea.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user1', status: 'POOL' } }),
    );
  });

  it('PATCH 采纳: status + scriptDraftId; 别人的 → 404', async () => {
    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'user1' });
    const res1 = await PATCH(
      reqJSON('http://t', 'PATCH', { status: 'ADOPTED', scriptDraftId: 'draft9' }),
      { params: Promise.resolve({ id: 'idea1' }) },
    );
    expect(res1.status).toBe(200);
    expect(prismaMock.topicIdea.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'idea1' },
        data: expect.objectContaining({ status: 'ADOPTED', scriptDraftId: 'draft9' }),
      }),
    );

    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'other' });
    const res2 = await PATCH(reqJSON('http://t', 'PATCH', { status: 'DISCARDED' }), {
      params: Promise.resolve({ id: 'idea1' }),
    });
    expect(res2.status).toBe(404);
  });

  it('PATCH 非法 status → 400', async () => {
    prismaMock.topicIdea.findUnique.mockResolvedValueOnce({ id: 'idea1', userId: 'user1' });
    const res = await PATCH(reqJSON('http://t', 'PATCH', { status: 'WHATEVER' }), {
      params: Promise.resolve({ id: 'idea1' }),
    });
    expect(res.status).toBe(400);
  });
});
