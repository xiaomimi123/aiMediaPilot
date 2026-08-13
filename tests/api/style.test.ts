import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  styleProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  styleSample: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET as getProfile, PUT as putProfile } from '@/app/api/v1/style/profile/route';
import { GET as getSamples } from '@/app/api/v1/style/samples/route';
import { DELETE as deleteSample } from '@/app/api/v1/style/samples/[id]/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/style/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.styleProfile.findUnique.mockResolvedValue(null);
  prismaMock.styleProfile.upsert.mockResolvedValue({ userId: 'user1', description: '' });
  prismaMock.styleSample.findMany.mockResolvedValue([]);
  prismaMock.styleSample.findUnique.mockResolvedValue(null);
  prismaMock.styleSample.delete.mockResolvedValue({});
});

describe('GET /api/v1/style/profile', () => {
  it('无记录 → description 默认空串', async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ description: '' });
  });

  it('有记录 → 返回 description', async () => {
    prismaMock.styleProfile.findUnique.mockResolvedValueOnce({ userId: 'user1', description: '偏爱短句' });
    const res = await getProfile();
    const json = await res.json();
    expect(json.data).toEqual({ description: '偏爱短句' });
  });
});

describe('PUT /api/v1/style/profile', () => {
  it('合法 description → upsert 往返', async () => {
    prismaMock.styleProfile.upsert.mockResolvedValueOnce({ userId: 'user1', description: '口语化,少用书面语' });
    const res = await putProfile(reqJSON({ description: '口语化,少用书面语' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ description: '口语化,少用书面语' });
    expect(prismaMock.styleProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      update: { description: '口语化,少用书面语' },
      create: { userId: 'user1', description: '口语化,少用书面语' },
    });
  });

  it('description 非字符串 → 400', async () => {
    const res = await putProfile(reqJSON({ description: 123 }));
    expect(res.status).toBe(400);
    expect(prismaMock.styleProfile.upsert).not.toHaveBeenCalled();
  });

  it('description 超过 2000 字 → 400', async () => {
    const res = await putProfile(reqJSON({ description: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(prismaMock.styleProfile.upsert).not.toHaveBeenCalled();
  });

  it('description 恰好 2000 字 → 通过', async () => {
    const desc = 'a'.repeat(2000);
    prismaMock.styleProfile.upsert.mockResolvedValueOnce({ userId: 'user1', description: desc });
    const res = await putProfile(reqJSON({ description: desc }));
    expect(res.status).toBe(200);
  });

  it('请求体非法 JSON → 400', async () => {
    const res = await putProfile(
      new Request('http://t', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{bad' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/style/samples', () => {
  it('按 createdAt 降序, preview 截取前 200 字', async () => {
    const longContent = 'x'.repeat(250);
    prismaMock.styleSample.findMany.mockResolvedValueOnce([
      { id: 's1', platform: 'douyin', content: longContent, createdAt: new Date('2026-08-13') },
      { id: 's2', platform: 'douyin', content: '短内容', createdAt: new Date('2026-08-01') },
    ]);
    const res = await getSamples();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(prismaMock.styleSample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(json.data.samples).toHaveLength(2);
    expect(json.data.samples[0]).toEqual(
      expect.objectContaining({ id: 's1', platform: 'douyin', preview: longContent.slice(0, 200) }),
    );
    expect(json.data.samples[0].preview.length).toBe(200);
    expect(json.data.samples[1]).toEqual(
      expect.objectContaining({ id: 's2', platform: 'douyin', preview: '短内容' }),
    );
  });

  it('无样本 → 空数组', async () => {
    const res = await getSamples();
    const json = await res.json();
    expect(json.data.samples).toEqual([]);
  });
});

describe('DELETE /api/v1/style/samples/[id]', () => {
  it('本人样本 → 200 + delete 调用', async () => {
    prismaMock.styleSample.findUnique.mockResolvedValueOnce({ id: 's1', userId: 'user1' });
    const res = await deleteSample(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 's1' }),
    });
    expect(res.status).toBe(200);
    expect(prismaMock.styleSample.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('不存在 → 404', async () => {
    prismaMock.styleSample.findUnique.mockResolvedValueOnce(null);
    const res = await deleteSample(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
    expect(prismaMock.styleSample.delete).not.toHaveBeenCalled();
  });

  it('他人样本 → 404', async () => {
    prismaMock.styleSample.findUnique.mockResolvedValueOnce({ id: 's1', userId: 'other' });
    const res = await deleteSample(new Request('http://t', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 's1' }),
    });
    expect(res.status).toBe(404);
    expect(prismaMock.styleSample.delete).not.toHaveBeenCalled();
  });
});
