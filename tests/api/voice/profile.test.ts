import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: { creatorVoice: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

const { prisma } = await import('@/lib/prisma');
const { GET, PUT } = await import('@/app/api/v1/voice/profile/route');

const VALID = {
  origin: '三年前被裁, 开始用 AI 自救',
  identity: '一个靠 AI 提高认知的普通人',
  notIdentity: '不是技术极客, 也不是专业程序员',
  stances: [{ claim: '提示词工程是伪需求', reason: '模型在进步' }],
  energy: '自信、有感染力',
};

function req(body: unknown) {
  return new Request('http://localhost/api/v1/voice/profile', {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v1/voice/profile', () => {
  it('无行 → 全空默认 + established:false', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue(null as never);
    const json = await (await GET()).json();
    expect(json.data.identity).toBe('');
    expect(json.data.stances).toEqual([]);
    expect(json.data.established).toBe(false);
  });

  it('有行且 identity 非空 → established:true, stances 防御解析', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue({
      userId: 'u1',
      ...VALID,
      stances: [...VALID.stances, { bad: 1 }],
      updatedAt: new Date(),
    } as never);
    const json = await (await GET()).json();
    expect(json.data.established).toBe(true);
    expect(json.data.stances).toEqual(VALID.stances); // 畸形条目丢弃
  });

  it('有行但 identity 空 → established:false', async () => {
    vi.mocked(prisma.creatorVoice.findUnique).mockResolvedValue({
      userId: 'u1',
      ...VALID,
      identity: '',
      updatedAt: new Date(),
    } as never);
    const json = await (await GET()).json();
    expect(json.data.established).toBe(false);
  });
});

describe('PUT /api/v1/voice/profile', () => {
  it('合法 → upsert 全量覆盖并回显 established', async () => {
    vi.mocked(prisma.creatorVoice.upsert).mockResolvedValue({} as never);
    const json = await (await PUT(req(VALID))).json();
    expect(json.success).toBe(true);
    expect(json.data.established).toBe(true);
    const call = vi.mocked(prisma.creatorVoice.upsert).mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u1' });
    expect(call.update).toEqual(VALID);
  });

  it('空档案也可保存(全部字段可选), established:false', async () => {
    vi.mocked(prisma.creatorVoice.upsert).mockResolvedValue({} as never);
    const json = await (
      await PUT(req({ origin: '', identity: '', notIdentity: '', stances: [], energy: '' }))
    ).json();
    expect(json.data.established).toBe(false);
  });

  it('非法 JSON → 400', async () => {
    const res = await PUT(req('{bad'));
    expect(res.status).toBe(400);
    expect(prisma.creatorVoice.upsert).not.toHaveBeenCalled();
  });

  it('超限字段 → 400 且不写库', async () => {
    const res = await PUT(req({ ...VALID, identity: 'a'.repeat(201) }));
    expect(res.status).toBe(400);
    expect(prisma.creatorVoice.upsert).not.toHaveBeenCalled();
  });

  it('stances 6 条 → 400', async () => {
    const many = Array.from({ length: 6 }, () => ({ claim: 'x', reason: 'y' }));
    const res = await PUT(req({ ...VALID, stances: many }));
    expect(res.status).toBe(400);
  });
});
