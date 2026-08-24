import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findMany: vi.fn() },
  cockpitContent: { findMany: vi.fn() },
  videoTemplate: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/video-productions/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findMany.mockResolvedValue([]);
  prismaMock.videoTemplate.findMany.mockResolvedValue([]);
});

function vp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vp1', status: 'preview_ready', mode: 'ppt-narration',
    masterPath: null, previewPath: '/x/preview.mp4', contentId: 'c1', templateId: 't1',
    createdAt: '2026-08-01T00:00:00.000Z', errorMessage: null,
    ...overrides,
  };
}

describe('GET /api/v1/video-productions (成片库)', () => {
  it('只查当前用户的任务', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([vp()]);
    await GET(new Request('http://x'));
    expect(prismaMock.videoProduction.findMany.mock.calls[0][0].where).toEqual({ userId: 'user1' });
  });

  it('按创建时间倒序', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([]);
    await GET(new Request('http://x'));
    expect(prismaMock.videoProduction.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('不返回 srt/alignedActs/rawTranscript 这些大字段', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([]);
    await GET(new Request('http://x'));
    const sel = prismaMock.videoProduction.findMany.mock.calls[0][0].select;
    expect(sel.srt).toBeUndefined();
    expect(sel.alignedActs).toBeUndefined();
    expect(sel.rawTranscript).toBeUndefined();
    expect(sel.errorMessage).toBe(true);
  });

  it('模板页与内容详情页发起的任务都列出(templateId 为空的旧入口任务不能被漏掉)', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([
      vp({ id: 'fromTemplate', templateId: 't1' }),
      vp({ id: 'fromDetail', templateId: null }),
    ]);
    const json = await (await GET(new Request('http://x'))).json();
    expect(json.data.productions.map((p: { id: string }) => p.id)).toEqual(['fromTemplate', 'fromDetail']);
  });

  it('带上内容标题, 方便认出这条片子讲的是什么', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([vp({ contentId: 'c1' })]);
    prismaMock.cockpitContent.findMany.mockResolvedValue([{ id: 'c1', title: 'DeepSeek 涨价三倍' }]);
    const json = await (await GET(new Request('http://x'))).json();
    expect(json.data.productions[0].contentTitle).toBe('DeepSeek 涨价三倍');
  });

  it('带上模板名; 无模板(旧入口)时为 null 而不是崩', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([
      vp({ id: 'a', templateId: 't1' }),
      vp({ id: 'b', templateId: null }),
    ]);
    prismaMock.videoTemplate.findMany.mockResolvedValue([{ id: 't1', name: '图文口播' }]);
    const json = await (await GET(new Request('http://x'))).json();
    expect(json.data.productions[0].templateName).toBe('图文口播');
    expect(json.data.productions[1].templateName).toBeNull();
  });

  it('内容卡已被删时 contentTitle 为 null, 不影响其余条目', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([vp({ contentId: 'gone' })]);
    prismaMock.cockpitContent.findMany.mockResolvedValue([]);
    const json = await (await GET(new Request('http://x'))).json();
    expect(json.data.productions[0].contentTitle).toBeNull();
  });

  it('关联查询也限制在当前用户内(不能拿别人的标题)', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([vp()]);
    await GET(new Request('http://x'));
    expect(prismaMock.cockpitContent.findMany.mock.calls[0][0].where.userId).toBe('user1');
    expect(prismaMock.videoTemplate.findMany.mock.calls[0][0].where.userId).toBe('user1');
  });

  it('没有任何任务时返回空数组而不是报错', async () => {
    prismaMock.videoProduction.findMany.mockResolvedValue([]);
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    expect((await res.json()).data.productions).toEqual([]);
  });
});
