import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { PUT } from '@/app/api/v1/scripts/[id]/picked/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/scripts/abc/picked', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'abc' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'abc', userId: 'user1' });
  prismaMock.scriptDraft.update.mockResolvedValue({});
});

describe('PUT /api/v1/scripts/[id]/picked', () => {
  it('valid body → 200 + prisma.update 调用', async () => {
    const res = await PUT(
      reqJSON({ titleIdx: 1, hookIdx: 0, reviewed: { cover: true } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'abc' },
      data: expect.objectContaining({
        picked: expect.objectContaining({
          titleIdx: 1,
          hookIdx: 0,
          reviewed: { cover: true },
        }),
      }),
    });
  });

  it('script 不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'other' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(404);
  });

  it('reviewed 非 boolean 值过滤', async () => {
    await PUT(reqJSON({ reviewed: { cover: true, bad: 'not-bool' } }), ctx);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'abc' },
      data: expect.objectContaining({
        picked: expect.objectContaining({
          reviewed: { cover: true },
        }),
      }),
    });
  });
});
