import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findUnique: vi.fn() },
  distribution: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST, GET } from '@/app/api/v1/scripts/[id]/distributions/route';
import { DELETE } from '@/app/api/v1/distributions/[id]/route';

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'draft1', userId: 'user1' });
  prismaMock.distribution.create.mockResolvedValue({ id: 'dist1' });
  prismaMock.distribution.findMany.mockResolvedValue([]);
  prismaMock.distribution.findUnique.mockResolvedValue(null);
  prismaMock.distribution.delete.mockResolvedValue({});
});

describe('Distribution CRUD', () => {
  it('POST 登记 → 200', async () => {
    const res = await POST(
      reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1' }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.distribution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scriptDraftId: 'draft1', platform: 'bilibili' }),
      }),
    );
  });

  it('POST url 非 http(s) → 400 (spec §6: 只做基本格式校验)', async () => {
    const res = await POST(reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'BV1xxx' }), ctx);
    expect(res.status).toBe(400);
    expect(prismaMock.distribution.create).not.toHaveBeenCalled();
  });

  it('POST 别人的 draft → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'other' });
    const res = await POST(
      reqJSON('http://t', 'POST', { platform: 'bilibili', url: 'https://b23.tv/x' }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('GET 列表 scope 到该 draft', async () => {
    prismaMock.distribution.findMany.mockResolvedValueOnce([
      { id: 'd1', platform: 'youtube', url: 'https://youtu.be/x', publishedAt: new Date(), note: null },
    ]);
    const res = await GET(new Request('http://t'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(prismaMock.distribution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scriptDraftId: 'draft1' } }),
    );
  });

  it('DELETE 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.distribution.findUnique.mockResolvedValueOnce({
      id: 'dist1',
      scriptDraft: { userId: 'user1' },
    });
    const res1 = await DELETE(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'dist1' }),
    });
    expect(res1.status).toBe(200);
    expect(prismaMock.distribution.delete).toHaveBeenCalledWith({ where: { id: 'dist1' } });

    prismaMock.distribution.findUnique.mockResolvedValueOnce({
      id: 'dist1',
      scriptDraft: { userId: 'other' },
    });
    const res2 = await DELETE(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'dist1' }),
    });
    expect(res2.status).toBe(404);
  });
});
