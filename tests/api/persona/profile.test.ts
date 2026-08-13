import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  personaProfile: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET as getProfile, PUT as putProfile } from '@/app/api/v1/persona/profile/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/persona/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  audience: '25-35 岁互联网从业者',
  targetFans: '想转行做 AI 的人',
  pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
  angle: '只讲能落地的方法',
  avoid: '不做标题党',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.personaProfile.findUnique.mockResolvedValue(null);
  prismaMock.personaProfile.upsert.mockResolvedValue({ userId: 'user1', ...validBody });
});

describe('GET /api/v1/persona/profile', () => {
  it('无记录 → 全空默认对象 + established: false', async () => {
    const res = await getProfile();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      audience: '',
      targetFans: '',
      pillars: [],
      angle: '',
      avoid: '',
      established: false,
    });
  });

  it('有记录且已建立 → 返回字段 + established: true', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({ userId: 'user1', ...validBody });
    const res = await getProfile();
    const json = await res.json();
    expect(json.data).toEqual({ ...validBody, established: true });
  });

  it('有记录但未建立 (audience 空) → 返回实际字段值 + established: false', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({
      userId: 'user1',
      audience: '',
      targetFans: '想转行做 AI 的人',
      pillars: [],
      angle: '',
      avoid: '',
    });
    const res = await getProfile();
    const json = await res.json();
    expect(json.data).toEqual({
      audience: '',
      targetFans: '想转行做 AI 的人',
      pillars: [],
      angle: '',
      avoid: '',
      established: false,
    });
  });
});

describe('PUT /api/v1/persona/profile', () => {
  it('合法数据 → upsert 全量覆盖往返', async () => {
    const res = await putProfile(reqJSON(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ...validBody, established: true });
    expect(prismaMock.personaProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      update: validBody,
      create: { userId: 'user1', ...validBody },
    });
  });

  it('pillars 超过 5 条 → 400', async () => {
    const pillars = Array.from({ length: 6 }, (_, i) => ({ name: `支柱${i}`, description: '' }));
    const res = await putProfile(reqJSON({ ...validBody, pillars }));
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('pillar name 超过 10 字 → 400', async () => {
    const res = await putProfile(
      reqJSON({ ...validBody, pillars: [{ name: '一二三四五六七八九十一', description: '' }] }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('audience 超过 300 字 → 400', async () => {
    const res = await putProfile(reqJSON({ ...validBody, audience: 'a'.repeat(301) }));
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('缺字段 → 400', async () => {
    const res = await putProfile(reqJSON({ audience: '有受众' }));
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('请求体非法 JSON → 400', async () => {
    const res = await putProfile(
      new Request('http://t', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{bad' }),
    );
    expect(res.status).toBe(400);
  });
});
