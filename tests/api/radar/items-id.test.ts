import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  radarItem: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  cockpitInspiration: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const bumpCockpitRevMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cockpit/server-store', () => ({ bumpCockpitRev: bumpCockpitRevMock }));

import { PATCH } from '@/app/api/v1/radar/items/[id]/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/radar/items/item1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctx(id = 'item1') {
  return { params: Promise.resolve({ id }) };
}

const ITEM = {
  id: 'item1',
  userId: 'user1',
  title: '标题A',
  aiAngle: '角度A',
  aiSummary: '摘要A',
  url: 'https://example.com/a',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.radarItem.findUnique.mockResolvedValue(ITEM);
  prismaMock.radarItem.update.mockResolvedValue({ id: 'item1' });
  prismaMock.cockpitInspiration.create.mockResolvedValue({ id: 'insp1' });
  bumpCockpitRevMock.mockResolvedValue(undefined);
  // house pattern: $transaction 默认直接把 prismaMock 自身当 tx 传给回调
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
});

describe('PATCH /api/v1/radar/items/:id', () => {
  it('ignore → 200, 仅更新 status, 不走事务/不碰 cockpit', async () => {
    const res = await PATCH(req({ action: 'ignore' }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ id: 'item1', status: 'ignored' });
    expect(prismaMock.radarItem.update).toHaveBeenCalledWith({
      where: { id: 'item1' },
      data: { status: 'ignored' },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.cockpitInspiration.create).not.toHaveBeenCalled();
    expect(bumpCockpitRevMock).not.toHaveBeenCalled();
  });

  it('adopt → 单事务内 create + bump(tx) + update(status=adopted, inspirationId), text 按 title/angle/summary/url 拼接', async () => {
    const res = await PATCH(req({ action: 'adopt' }), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('adopted');
    expect(typeof json.data.inspirationId).toBe('string');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    expect(prismaMock.cockpitInspiration.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.cockpitInspiration.create.mock.calls[0][0];
    expect(createArgs.data.userId).toBe('user1');
    expect(createArgs.data.text).toBe('标题A\n角度A\n摘要A\nhttps://example.com/a');
    expect(createArgs.data.convertedContentIds).toEqual([]);
    expect(typeof createArgs.data.createdAt).toBe('string');
    expect(typeof createArgs.data.updatedAt).toBe('string');

    expect(bumpCockpitRevMock).toHaveBeenCalledTimes(1);
    expect(bumpCockpitRevMock).toHaveBeenCalledWith('user1', prismaMock);

    expect(prismaMock.radarItem.update).toHaveBeenCalledTimes(1);
    const updateArgs = prismaMock.radarItem.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'item1' });
    expect(updateArgs.data.status).toBe('adopted');
    expect(updateArgs.data.inspirationId).toBe(json.data.inspirationId);
  });

  it('adopt 时事务内抛错 → 500, 不返回成功', async () => {
    bumpCockpitRevMock.mockRejectedValueOnce(new Error('bump failed'));
    const res = await PATCH(req({ action: 'adopt' }), ctx());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('非本人条目 → 404, 不做任何写入', async () => {
    prismaMock.radarItem.findUnique.mockResolvedValueOnce({ ...ITEM, userId: 'other' });
    const res = await PATCH(req({ action: 'adopt' }), ctx());
    expect(res.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.radarItem.update).not.toHaveBeenCalled();
  });

  it('条目不存在 → 404', async () => {
    prismaMock.radarItem.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(req({ action: 'ignore' }), ctx());
    expect(res.status).toBe(404);
  });

  it('action 非法 → 400', async () => {
    const res = await PATCH(req({ action: 'delete' }), ctx());
    expect(res.status).toBe(400);
    expect(prismaMock.radarItem.findUnique).not.toHaveBeenCalled();
  });

  it('非法 JSON → 400', async () => {
    const badReq = new Request('http://t/api/v1/radar/items/item1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await PATCH(badReq, ctx());
    expect(res.status).toBe(400);
  });
});
