import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  cockpitInspiration: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const bumpCockpitRevMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cockpit/server-store', () => ({ bumpCockpitRev: bumpCockpitRevMock }));

import { POST } from '@/app/api/v1/cockpit/inspirations/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/cockpit/inspirations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function reqRaw(rawBody: string): Request {
  return new Request('http://t/api/v1/cockpit/inspirations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitInspiration.create.mockResolvedValue({ id: 'insp1' });
  bumpCockpitRevMock.mockResolvedValue(undefined);
});

describe('POST /api/v1/cockpit/inspirations', () => {
  it('正常写入 → 200 + id, 并写入 CockpitInspiration + bump rev', async () => {
    const res = await POST(req({ text: '一条灵感文字' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('insp1');

    expect(prismaMock.cockpitInspiration.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.cockpitInspiration.create.mock.calls[0][0];
    expect(createArgs.data).toEqual(
      expect.objectContaining({
        userId: 'user1',
        text: '一条灵感文字',
        convertedContentIds: [],
      }),
    );
    expect(typeof createArgs.data.id).toBe('string');
    expect(createArgs.data.id.length).toBeGreaterThan(0);
    expect(typeof createArgs.data.createdAt).toBe('string');
    expect(typeof createArgs.data.updatedAt).toBe('string');

    // bump 必须在写入成功之后被调用 — 一阶段教训 I1: 不得跳过
    expect(bumpCockpitRevMock).toHaveBeenCalledTimes(1);
    expect(bumpCockpitRevMock).toHaveBeenCalledWith('user1');
  });

  it('text 为空 → 400, 不写库, 不 bump', async () => {
    const res = await POST(req({ text: '' }));
    expect(res.status).toBe(400);
    expect(prismaMock.cockpitInspiration.create).not.toHaveBeenCalled();
    expect(bumpCockpitRevMock).not.toHaveBeenCalled();
  });

  it('text 缺失 → 400', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(prismaMock.cockpitInspiration.create).not.toHaveBeenCalled();
  });

  it('text 超过 2000 字 → 400, 不写库, 不 bump', async () => {
    const res = await POST(req({ text: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(prismaMock.cockpitInspiration.create).not.toHaveBeenCalled();
    expect(bumpCockpitRevMock).not.toHaveBeenCalled();
  });

  it('text 恰好 2000 字 → 200 (边界通过)', async () => {
    const res = await POST(req({ text: 'a'.repeat(2000) }));
    expect(res.status).toBe(200);
  });

  it('非法 JSON → 400', async () => {
    const res = await POST(reqRaw('{not json'));
    expect(res.status).toBe(400);
    expect(prismaMock.cockpitInspiration.create).not.toHaveBeenCalled();
    expect(bumpCockpitRevMock).not.toHaveBeenCalled();
  });
});
