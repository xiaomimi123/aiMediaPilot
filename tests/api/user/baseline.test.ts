import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  user: { update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PUT } from '@/app/api/v1/user/baseline/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/user/baseline', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.update.mockResolvedValue({ baselinePlays: 800n });
});

describe('PUT /api/v1/user/baseline', () => {
  it('value=800 → 200 success, baselinePlays="800"', async () => {
    const res = await PUT(makeReq({ value: 800 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.baselinePlays).toBe('800');
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { baselinePlays: 800n },
    });
  });

  it('value=null → 200, clears baseline', async () => {
    prismaMock.user.update.mockResolvedValueOnce({ baselinePlays: null });
    const res = await PUT(makeReq({ value: null }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.baselinePlays).toBeNull();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { baselinePlays: null },
    });
  });

  it('value=0 → 400', async () => {
    const res = await PUT(makeReq({ value: 0 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('value=-1 → 400', async () => {
    const res = await PUT(makeReq({ value: -1 }));
    expect(res.status).toBe(400);
  });

  it('value=1e9 (>1e8 上限) → 400', async () => {
    const res = await PUT(makeReq({ value: 1e9 }));
    expect(res.status).toBe(400);
  });

  it('value="abc" (非数字) → 400', async () => {
    const res = await PUT(makeReq({ value: 'abc' }));
    expect(res.status).toBe(400);
  });

  it('prisma update 抛错 → 500', async () => {
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));
    const res = await PUT(makeReq({ value: 800 }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/db down|保存失败/);
  });
});
