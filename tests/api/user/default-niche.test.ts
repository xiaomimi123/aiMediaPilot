import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/user/default-niche/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/user/default-niche', () => {
  it('无脚本 → fallback ai-knowledge', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.niche).toBe('ai-knowledge');
    expect(json.data.source).toBe('fallback');
  });

  it('多个 niche 选最频繁的', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValue([
      { niche: 'food' },
      { niche: 'ai-knowledge' },
      { niche: 'food' },
      { niche: 'food' },
      { niche: 'lifestyle' },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.niche).toBe('food');
    expect(json.data.source).toBe('most-frequent');
    expect(json.data.matched).toBe(3);
    expect(json.data.total).toBe(5);
  });

  it('返回的查询限定 userId + take=100', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValue([]);
    await GET();
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
        take: 100,
      }),
    );
  });
});
