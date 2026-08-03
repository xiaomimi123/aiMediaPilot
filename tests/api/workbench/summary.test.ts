import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findMany: vi.fn() },
  contentAnalysis: { findMany: vi.fn() },
  topicIdea: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/workbench/route';

const NOW = new Date('2026-08-03T12:00:00Z');

function draft(over: Record<string, unknown>) {
  return {
    id: 'd1', topic: '主题', platform: 'douyin', picked: null, analysisId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'), analysis: null, distributions: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  prismaMock.scriptDraft.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.topicIdea.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/v1/workbench', () => {
  it('空数据 → 全零 counts + 空列', async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.counts).toEqual({ pool: 0, drafting: 0, ready: 0, shot: 0, published: 0, retroed: 0 });
    expect(json.data.columns.drafting).toEqual([]);
  });

  it('draft 按 deriveStage 分列, archived 被 where 排除', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({ id: 'a' }),                                            // DRAFTING
      draft({ id: 'b', picked: { titleIdx: 0 } }),                   // READY
      draft({
        id: 'c', picked: {}, analysisId: 'an1',
        analysis: { id: 'an1', publishedAt: null, retroStatus: null, createdAt: new Date('2026-08-02T00:00:00Z') },
      }),                                                            // SHOT
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.counts).toMatchObject({ drafting: 1, ready: 1, shot: 1 });
    expect(json.data.columns.shot[0].detailUrl).toBe('/content/script/c');
    // archivedAt: null 必须在 where 里 (spec §2.1 归档不显示)
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user1', archivedAt: null }),
      }),
    );
  });

  it('PUBLISHED 卡带 retro 倒计时: T+3, 已发 1 天 → 2', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({
        id: 'p', picked: {}, analysisId: 'an2',
        analysis: {
          id: 'an2', publishedAt: new Date('2026-08-02T12:00:00Z'),
          retroStatus: 'SCHEDULED', createdAt: new Date('2026-08-01T00:00:00Z'),
        },
      }),
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.columns.published[0].retroCountdownDays).toBe(2);
  });

  it('孤儿 analysis (没链 script) 也进看板, kind=analysis', async () => {
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      {
        id: 'an3', draftTitle: null, videoFilename: 'v.mp4',
        publishedAt: null, retroStatus: null, createdAt: new Date('2026-08-01T00:00:00Z'),
      },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.counts.shot).toBe(1);
    expect(json.data.columns.shot[0]).toMatchObject({
      kind: 'analysis', title: 'v.mp4', detailUrl: '/content/preflight/an3',
    });
    // 孤儿过滤必须用 fromScripts: { none: {} }
    expect(prismaMock.contentAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user1', fromScripts: { none: {} } }),
      }),
    );
  });

  it('分发记录参与 stage + 徽标字段', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({
        id: 'x', picked: {},
        distributions: [
          { platform: 'bilibili', publishedAt: new Date('2026-08-02T00:00:00Z') },
          { platform: 'youtube', publishedAt: new Date('2026-08-03T00:00:00Z') },
        ],
      }),
    ]);
    const res = await GET();
    const json = await res.json();
    const card = json.data.columns.published[0];
    expect(card.distributionCount).toBe(2);
    expect(card.distributionPlatforms).toEqual(['bilibili', 'youtube']);
    // 仅靠 Distribution 发布的内容不参与 retro 管线 (spec §2.3), 不应显示假复盘倒计时
    expect(card.retroCountdownDays).toBeNull();
  });

  it('RETROED 列按 stageSince 降序排列 → 最近的优先', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      draft({
        id: 'older', picked: {}, analysisId: 'an_older',
        analysis: {
          id: 'an_older', publishedAt: new Date('2026-08-01T00:00:00Z'),
          retroStatus: 'COMPLETED', createdAt: new Date('2026-08-01T00:00:00Z'),
        },
      }),
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      {
        id: 'an_newer', draftTitle: null, videoFilename: 'newer.mp4',
        publishedAt: new Date('2026-08-02T00:00:00Z'),
        retroStatus: 'COMPLETED', createdAt: new Date('2026-08-02T00:00:00Z'),
      },
    ]);
    const res = await GET();
    const json = await res.json();
    // counts.retroed 显示全部
    expect(json.data.counts.retroed).toBe(2);
    // columns.retroed 按 stageSince 降序 → 较新的 (orphan) 应在前
    expect(json.data.columns.retroed[0].id).toBe('an_newer');
    expect(json.data.columns.retroed[0].kind).toBe('analysis');
    expect(json.data.columns.retroed[1].id).toBe('older');
    expect(json.data.columns.retroed[1].kind).toBe('script');
  });
});
