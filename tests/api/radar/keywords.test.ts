import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  radarKeyword: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET, POST } from '@/app/api/v1/radar/keywords/route';
import { PATCH } from '@/app/api/v1/radar/keywords/[id]/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/radar/keywords', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown): Request {
  return new Request('http://t/api/v1/radar/keywords/kw1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function ctx(id = 'kw1') {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.radarKeyword.findMany.mockResolvedValue([]);
  prismaMock.radarKeyword.findFirst.mockResolvedValue(null);
  prismaMock.radarKeyword.findUnique.mockResolvedValue(null);
  prismaMock.radarKeyword.create.mockResolvedValue({ id: 'kw1' });
  prismaMock.radarKeyword.update.mockResolvedValue({ id: 'kw1' });
});

describe('GET /api/v1/radar/keywords', () => {
  it('按 status 分组返回 (active/candidate/ignored 三组, 即使为空也存在)', async () => {
    prismaMock.radarKeyword.findMany.mockResolvedValue([
      { id: 'a', userId: 'user1', text: 'AI绘画', status: 'active', source: 'manual' },
      { id: 'b', userId: 'user1', text: '短视频', status: 'candidate', source: 'ai' },
      { id: 'c', userId: 'user1', text: '旧词', status: 'ignored', source: 'manual' },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.active.map((k: { id: string }) => k.id)).toEqual(['a']);
    expect(json.data.candidate.map((k: { id: string }) => k.id)).toEqual(['b']);
    expect(json.data.ignored.map((k: { id: string }) => k.id)).toEqual(['c']);
    expect(prismaMock.radarKeyword.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user1' } }),
    );
  });

  it('无数据 → 三组均为空数组', async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.data).toEqual({ active: [], candidate: [], ignored: [] });
  });
});

describe('POST /api/v1/radar/keywords', () => {
  it('新增成功 → 200, status=active, source=manual', async () => {
    const res = await POST(req({ text: '新关键词' }));
    expect(res.status).toBe(200);
    expect(prismaMock.radarKeyword.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user1', text: '新关键词', status: 'active', source: 'manual' },
      }),
    );
  });

  it('text 为空 → 400, 不写库', async () => {
    const res = await POST(req({ text: '   ' }));
    expect(res.status).toBe(400);
    expect(prismaMock.radarKeyword.create).not.toHaveBeenCalled();
  });

  it('重复 text (同 user, 任意 status) → 409', async () => {
    prismaMock.radarKeyword.findFirst.mockResolvedValueOnce({ id: 'existing' });
    const res = await POST(req({ text: '已存在的词' }));
    expect(res.status).toBe(409);
    expect(prismaMock.radarKeyword.create).not.toHaveBeenCalled();
  });

  it('TOCTOU 竞态: findFirst 预检查未命中, 但 create 撞上唯一约束 (P2002) → 同样 409', async () => {
    const { Prisma } = await import('@prisma/client');
    prismaMock.radarKeyword.findFirst.mockResolvedValueOnce(null);
    prismaMock.radarKeyword.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      }),
    );
    const res = await POST(req({ text: '并发提交的词' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toBe('该关键词已存在');
  });

  it('非法 JSON → 400', async () => {
    const badReq = new Request('http://t/api/v1/radar/keywords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/radar/keywords/:id — 状态机', () => {
  it('candidate → active 合法', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'candidate' });
    const res = await PATCH(patchReq({ status: 'active' }), ctx());
    expect(res.status).toBe(200);
    expect(prismaMock.radarKeyword.update).toHaveBeenCalledWith({
      where: { id: 'kw1' },
      data: { status: 'active' },
    });
  });

  it('candidate → ignored 合法', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'candidate' });
    const res = await PATCH(patchReq({ status: 'ignored' }), ctx());
    expect(res.status).toBe(200);
  });

  it('active → ignored 合法', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'active' });
    const res = await PATCH(patchReq({ status: 'ignored' }), ctx());
    expect(res.status).toBe(200);
  });

  it('ignored → active 合法', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'ignored' });
    const res = await PATCH(patchReq({ status: 'active' }), ctx());
    expect(res.status).toBe(200);
  });

  it('active → candidate 非法迁移 → 400, 不写库', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'active' });
    const res = await PATCH(patchReq({ status: 'candidate' }), ctx());
    expect(res.status).toBe(400);
    expect(prismaMock.radarKeyword.update).not.toHaveBeenCalled();
  });

  it('ignored → candidate 非法迁移 → 400', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'user1', status: 'ignored' });
    const res = await PATCH(patchReq({ status: 'candidate' }), ctx());
    expect(res.status).toBe(400);
  });

  it('status 取值不在枚举内 → 400, 不写库', async () => {
    const res = await PATCH(patchReq({ status: 'bogus' }), ctx());
    expect(res.status).toBe(400);
    expect(prismaMock.radarKeyword.update).not.toHaveBeenCalled();
  });

  it('非本人关键词 → 404', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce({ id: 'kw1', userId: 'other', status: 'active' });
    const res = await PATCH(patchReq({ status: 'ignored' }), ctx());
    expect(res.status).toBe(404);
  });

  it('关键词不存在 → 404', async () => {
    prismaMock.radarKeyword.findUnique.mockResolvedValueOnce(null);
    const res = await PATCH(patchReq({ status: 'active' }), ctx());
    expect(res.status).toBe(404);
  });
});
