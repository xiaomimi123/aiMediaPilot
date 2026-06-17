import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PUT } from '@/app/api/v1/content/analyses/[id]/checklist/route';

const validBody = {
  reviewedHook: true,
  reviewedRetention: false,
  reviewedTitleCaption: false,
  reviewedCover: false,
  finalTitle: '',
  finalCoverNote: '',
  actionItemsAdopted: [],
};

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/content/analyses/abc/checklist', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findUnique.mockResolvedValue({ id: 'abc', userId: 'user1' });
  prismaMock.contentAnalysis.update.mockResolvedValue({});
});

describe('PUT /api/v1/content/analyses/[id]/checklist', () => {
  const ctx = { params: Promise.resolve({ id: 'abc' }) };

  it('valid body → 200 + prisma.update 调用', async () => {
    const res = await PUT(reqJSON(validBody), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'abc' },
      data: expect.objectContaining({
        publishChecklist: expect.objectContaining({ reviewedHook: true }),
      }),
    });
  });

  it('analysis 不存在 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce(null);
    const res = await PUT(reqJSON(validBody), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.contentAnalysis.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'other-user' });
    const res = await PUT(reqJSON(validBody), ctx);
    expect(res.status).toBe(404);
  });

  it('非 JSON body → 400', async () => {
    const badReq = new Request('http://t/api/v1/content/analyses/abc/checklist', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    const res = await PUT(badReq, ctx);
    expect(res.status).toBe(400);
  });
});
