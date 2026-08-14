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

// 八期字段
const legacyBody = {
  audience: '25-35 岁互联网从业者',
  targetFans: '想转行做 AI 的人',
  pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
  angle: '只讲能落地的方法',
  avoid: '不做标题党',
};

// 十期: 账号定位体系扩展字段全部为空默认值 — 与路由缺省补齐逻辑一致
const emptyExtension = {
  painPoints: [] as unknown[],
  offerings: [] as unknown[],
  productLogic: '',
  marketInsight: null,
  systemSummary: '',
};

// 十期字段齐全的完整 body
const fullBody = {
  ...legacyBody,
  painPoints: [{ pain: '不知道拍什么', evidence: '选题卡壳' }],
  offerings: [{ name: 'AI 选题工具', type: 'tool', description: '自动生成选题', targetPain: '不知道拍什么' }],
  productLogic: '先用免费工具建立信任, 再转化到付费课程',
  marketInsight: {
    landscape: '同质化严重', mainstream: '搬运资讯', unmet: '缺乏可落地的实操',
    opportunity: '做深度实操内容', researchedAt: '2026-08-15',
  },
  systemSummary: '面向转行者的实操型 AI 知识账号',
};

const validBody = legacyBody;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.personaProfile.findUnique.mockResolvedValue(null);
  prismaMock.personaProfile.upsert.mockResolvedValue({ userId: 'user1', ...legacyBody, ...emptyExtension });
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
      ...emptyExtension,
      established: false,
    });
  });

  it('有记录且已建立 (八期存量行, 新字段缺失) → 返回字段 + 新字段防御回退空值 + established: true', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({ userId: 'user1', ...legacyBody });
    const res = await getProfile();
    const json = await res.json();
    expect(json.data).toEqual({ ...legacyBody, ...emptyExtension, established: true });
  });

  it('有记录且新字段齐全 → 原样返回', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValueOnce({ userId: 'user1', ...fullBody });
    const res = await getProfile();
    const json = await res.json();
    expect(json.data).toEqual({ ...fullBody, established: true });
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
      ...emptyExtension,
      established: false,
    });
  });
});

describe('PUT /api/v1/persona/profile', () => {
  it('合法数据 (十期新字段齐全) → upsert 全量覆盖往返', async () => {
    prismaMock.personaProfile.upsert.mockResolvedValueOnce({ userId: 'user1', ...fullBody });
    const res = await putProfile(reqJSON(fullBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ...fullBody, established: true });
    expect(prismaMock.personaProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      update: fullBody,
      create: { userId: 'user1', ...fullBody },
    });
  });

  it('八期旧调用方只发 5 个原始字段 → 缺省新字段自动补空值, 通过校验并落库', async () => {
    const res = await putProfile(reqJSON(legacyBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ...legacyBody, ...emptyExtension, established: true });
    const upsertArgs = prismaMock.personaProfile.upsert.mock.calls[0][0];
    // marketInsight null → Prisma.JsonNull (可空 Json 字段写入约定), 其余新字段照原样落库
    expect(upsertArgs).toEqual({
      where: { userId: 'user1' },
      update: { ...legacyBody, ...emptyExtension, marketInsight: upsertArgs.update.marketInsight },
      create: { userId: 'user1', ...legacyBody, ...emptyExtension, marketInsight: upsertArgs.create.marketInsight },
    });
    expect(upsertArgs.update.marketInsight).not.toBeNull();
    expect(upsertArgs.create.marketInsight).not.toBeNull();
  });

  it('marketInsight 显式传 null → 写入 Prisma.JsonNull (可空 Json 字段约定)', async () => {
    const res = await putProfile(reqJSON({ ...fullBody, marketInsight: null }));
    expect(res.status).toBe(200);
    const upsertArgs = prismaMock.personaProfile.upsert.mock.calls[0][0];
    // Prisma.JsonNull 是一个带 _getNamespace 方法的特殊标记对象, 不是字面 null
    expect(upsertArgs.update.marketInsight).not.toBeNull();
    expect(upsertArgs.create.marketInsight).not.toBeNull();
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

  it('productLogic 超过 500 字 → 400', async () => {
    const res = await putProfile(reqJSON({ ...fullBody, productLogic: 'a'.repeat(501) }));
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('offering type 非枚举 → 400', async () => {
    const res = await putProfile(
      reqJSON({ ...fullBody, offerings: [{ name: 'x', type: 'saas', description: '', targetPain: '' }] }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.personaProfile.upsert).not.toHaveBeenCalled();
  });

  it('缺字段 (八期原始字段都缺) → 400', async () => {
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
