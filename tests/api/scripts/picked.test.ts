import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  cockpitContent: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  cockpitStageEvent: {
    create: vi.fn(),
  },
  $executeRaw: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const depositStyleSample = vi.hoisted(() => vi.fn());
vi.mock('@/lib/script/style', () => ({ depositStyleSample }));

import { PUT } from '@/app/api/v1/scripts/[id]/picked/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/scripts/abc/picked', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'abc' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'abc', userId: 'user1', platform: 'douyin' });
  prismaMock.scriptDraft.update.mockResolvedValue({});
  prismaMock.cockpitContent.findFirst.mockResolvedValue(null);
  prismaMock.cockpitContent.update.mockResolvedValue({});
  prismaMock.cockpitStageEvent.create.mockResolvedValue({});
  prismaMock.$executeRaw.mockResolvedValue(undefined);
  depositStyleSample.mockResolvedValue(true);
});

describe('PUT /api/v1/scripts/[id]/picked', () => {
  it('valid body → 200 + prisma.update 调用', async () => {
    const res = await PUT(
      reqJSON({ titleIdx: 1, hookIdx: 0, reviewed: { cover: true } }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'abc' },
      data: expect.objectContaining({
        picked: expect.objectContaining({
          titleIdx: 1,
          hookIdx: 0,
          reviewed: { cover: true },
        }),
      }),
    });
  });

  it('script 不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'other' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(404);
  });

  it('reviewed 非 boolean 值过滤', async () => {
    await PUT(reqJSON({ reviewed: { cover: true, bad: 'not-bool' } }), ctx);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'abc' },
      data: expect.objectContaining({
        picked: expect.objectContaining({
          reviewed: { cover: true },
        }),
      }),
    });
  });

  it('关联 cockpit content 且 stage === script → 推进 recording + 补一条 completed script StageEvent', async () => {
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({ id: 'content1', stage: 'script' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.findFirst).toHaveBeenCalledWith({
      where: { scriptDraftId: 'abc', userId: 'user1' },
      select: { id: true, stage: true },
    });
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: expect.objectContaining({ stage: 'recording' }),
    });
    expect(prismaMock.cockpitStageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user1',
        contentId: 'content1',
        stage: 'script',
        rank: 0,
        completedAt: expect.any(String),
      }),
    });
    // 钩子写了 cockpit content/stage event → 必须敲一下 prefs.updatedAt (bumpCockpitRev)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.$executeRaw.mock.calls[0]).toContain('user1');
  });

  it('douyin 定稿 → recording (DEFAULT 流回归)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'user1', platform: 'douyin' });
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({ id: 'content1', stage: 'script' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: expect.objectContaining({ stage: 'recording' }),
    });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('xiaohongshu 定稿 → publishing (新语义, 录制/剪辑对小红书是死阶段)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'user1', platform: 'xiaohongshu' });
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({ id: 'content1', stage: 'script' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: expect.objectContaining({ stage: 'publishing' }),
    });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('gongzhonghao 定稿 → recording (未收录平台走 DEFAULT 流)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'abc', userId: 'user1', platform: 'gongzhonghao' });
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({ id: 'content1', stage: 'script' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: expect.objectContaining({ stage: 'recording' }),
    });
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('关联 cockpit content 但 stage !== script → 不推进, 也不 bump rev', async () => {
    prismaMock.cockpitContent.findFirst.mockResolvedValueOnce({ id: 'content1', stage: 'recording' });
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
    expect(prismaMock.cockpitStageEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('没有关联的 cockpit content → 不推进, 定稿本身仍成功, 也不 bump rev', async () => {
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
    expect(prismaMock.cockpitStageEvent.create).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('定稿成功 → 调用 depositStyleSample(userId, draftId)', async () => {
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(depositStyleSample).toHaveBeenCalledWith('user1', 'abc');
  });

  it('depositStyleSample 失败(reject) → 不阻塞定稿, 仍返回 200', async () => {
    depositStyleSample.mockRejectedValueOnce(new Error('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await PUT(reqJSON({ reviewed: {} }), ctx);
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
