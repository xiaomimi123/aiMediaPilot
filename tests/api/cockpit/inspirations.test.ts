import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  cockpitInspiration: { create: vi.fn() },
  $transaction: vi.fn(),
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
  // 事务默认直接把 prismaMock 自身当 tx 传给回调 (house pattern, 见 workspace.test.ts)
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
});

describe('POST /api/v1/cockpit/inspirations', () => {
  it('正常写入 → 200 + id, 并在同一事务内写入 CockpitInspiration + bump rev', async () => {
    const res = await POST(req({ text: '一条灵感文字' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.data.id).toBe('string');
    expect(json.data.id.length).toBeGreaterThan(0);

    // create + bump 必须走同一个 $transaction (主写路由不 fail-soft)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    expect(prismaMock.cockpitInspiration.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.cockpitInspiration.create.mock.calls[0][0];
    expect(createArgs.data).toEqual(
      expect.objectContaining({
        id: json.data.id,
        userId: 'user1',
        text: '一条灵感文字',
        convertedContentIds: [],
      }),
    );
    expect(typeof createArgs.data.createdAt).toBe('string');
    expect(typeof createArgs.data.updatedAt).toBe('string');

    // bump 必须在写入成功之后、在 tx 客户端上被调用 — 一阶段教训 I1: 不得跳过
    expect(bumpCockpitRevMock).toHaveBeenCalledTimes(1);
    expect(bumpCockpitRevMock).toHaveBeenCalledWith('user1', prismaMock);
  });

  it('事务内 bumpCockpitRev 抛错 → 500, 不返回成功 (事务语义下主写入随之回滚)', async () => {
    bumpCockpitRevMock.mockRejectedValueOnce(new Error('bump failed'));
    const res = await POST(req({ text: '一条灵感文字' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    // create 在 bump 之前已被调用 (mock 层不模拟真实回滚, 真实 DB 由 $transaction 保证原子性)
    expect(prismaMock.cockpitInspiration.create).toHaveBeenCalledTimes(1);
    expect(bumpCockpitRevMock).toHaveBeenCalledTimes(1);
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
