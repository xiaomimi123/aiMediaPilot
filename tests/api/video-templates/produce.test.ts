import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitContent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn(), create: vi.fn() },
  videoProduction: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

const bumpMock = vi.hoisted(() => ({ bumpCockpitRev: vi.fn(async () => undefined) }));
vi.mock('@/lib/cockpit/server-store', () => bumpMock);

vi.mock('fs/promises', () => {
  const m = { mkdir: vi.fn(async () => undefined) };
  return { default: m, ...m };
});

import { POST } from '@/app/api/v1/video-templates/[id]/produce/route';

const SIX_ACT = {
  acts: ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'].map((act) => ({
    act,
    title: `${act} 标题`,
    narration: `${act} 的台词内容, 足够长以通过校验。`,
    visual: '画面描述',
    note: '备注',
    targetSec: 15,
    beats: [{ keyword: 'k1' }, { keyword: 'k2' }, { keyword: 'k3' }],
    facts: [],
  })),
  four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration', voicePreset: null,
  });
  prismaMock.videoProduction.create.mockImplementation(async ({ data }: any) => data);
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/v1/video-templates/[id]/produce', () => {
  it('传 contentId 且该内容已有六幕定稿 → 直接建生成任务, 带上 templateId', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'd1',
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: JSON.stringify(SIX_ACT) });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.templateId).toBe('t1');
    expect(created.contentId).toBe('c1');
    expect(created.mode).toBe('ppt-narration');
    expect(created.srt.length).toBeGreaterThan(0);
    // 非真人出镜模式立即入队
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it('传 script(粘贴/灵感出稿) → 自动建内容卡并关联六幕稿', async () => {
    prismaMock.cockpitContent.create.mockResolvedValue({ id: 'newc1', userId: 'user1' });
    prismaMock.scriptDraft.create.mockResolvedValue({ id: 'newd1' });

    const res = await POST(req({ script: SIX_ACT, title: '我的新内容' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledTimes(1);
    // 建卡后必须关联 scriptDraftId, 否则 worker 找不到六幕稿
    expect(prismaMock.cockpitContent.update).toHaveBeenCalled();
    expect(prismaMock.cockpitContent.update.mock.calls[0][0].data.scriptDraftId).toBe('newd1');
    // 服务端直写 cockpit 数据必须 bump rev, 否则前端读脏缓存
    expect(bumpMock.bumpCockpitRev).toHaveBeenCalledWith('user1');
    // 新卡的 deliveryMode 跟随模板
    expect(prismaMock.cockpitContent.create.mock.calls[0][0].data.deliveryMode).toBe('ppt-narration');
  });

  it('真人出镜模板: 建任务但不立即入队(等上传视频后触发)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'talking-head-broll', voicePreset: null,
    });
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: JSON.stringify(SIX_ACT) });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.create).toHaveBeenCalledTimes(1);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('内容没有六幕定稿 → 400, 不建任务', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: null });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });

  it('模板归属别的用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('内容归属别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other', scriptDraftId: 'd1' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('既没传 contentId 也没传 script → 400', async () => {
    const res = await POST(req({}) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  it('script 形状不是合法六幕 → 400', async () => {
    const res = await POST(req({ script: { acts: [] } }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });
});
