import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/douyin/list', () => ({
  runDouyinListAdapter: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  contentAnalysis: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  cockpitContent: {
    updateMany: vi.fn(),
  },
  user: { update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({
  QUEUES: { ANALYZE: 'analyze', RETRO: 'retro', AUTO_SYNC: 'auto-sync' },
  retroQueue: queueMock,
}));

import { runAutoSync } from '@/lib/douyin/auto-sync';
import { runDouyinListAdapter } from '@/lib/douyin/list';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.contentAnalysis.findFirst.mockResolvedValue(null);
  prismaMock.contentAnalysis.update.mockResolvedValue({});
  prismaMock.cockpitContent.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.user.update.mockResolvedValue({});
  queueMock.add.mockResolvedValue({});
});

describe('runAutoSync', () => {
  it('高分匹配 → matchedCount=1 + prisma.update + retroQueue.add', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'AI 工具排行榜 Top 10' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'x.mp4', draftTitle: 'AI 工具排行榜 Top 10' },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(1);
    expect(stats.skippedAlreadyMatched).toBe(0);
    expect(stats.skippedLowConfidence).toBe(0);
    expect(prismaMock.contentAnalysis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data: expect.objectContaining({
          douyinAwemeId: '7234567890',
          douyinUrl: 'https://www.douyin.com/video/7234567890',
          retroStatus: 'SCHEDULED',
        }),
      }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'retro',
      { analysisId: 'a1' },
      expect.objectContaining({ delay: 0 }),
    );
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user1' } }),
    );
    expect(prismaMock.cockpitContent.updateMany).toHaveBeenCalledWith({
      where: {
        analysisId: 'a1',
        userId: 'user1',
        stage: { in: ['recording', 'editing', 'publishing'] },
      },
      data: expect.objectContaining({
        publicationStatus: 'published',
        publishedAt: '2026-06-10',
        stage: 'review',
      }),
    });
  });

  it('cockpit 回填 updateMany 抛错 → 不阻断主流程 (matchedCount 仍 1)', async () => {
    prismaMock.cockpitContent.updateMany.mockRejectedValueOnce(new Error('db down'));
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890', postedAt: '2026-06-10 14:30', plays: '8.5w', desc: 'AI 工具排行榜 Top 10' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'x.mp4', draftTitle: 'AI 工具排行榜 Top 10' },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(1);
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('低分跳过 → matchedCount=0, skippedLowConfidence=1', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7000000000', postedAt: '', plays: '0', desc: '完全不同的标题 abcdef' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'x.mp4', draftTitle: '原始 ChatGPT 教程' },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(0);
    expect(stats.skippedLowConfidence).toBe(1);
    expect(prismaMock.contentAnalysis.update).not.toHaveBeenCalled();
    expect(prismaMock.cockpitContent.updateMany).not.toHaveBeenCalled();
  });

  it('已匹配 aweme 全局 skip → skippedAlreadyMatched=1', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7000000000', postedAt: '', plays: '0', desc: '什么' },
    ]);
    prismaMock.contentAnalysis.findFirst.mockResolvedValueOnce({ id: 'existing' });
    const stats = await runAutoSync('user1');
    expect(stats.skippedAlreadyMatched).toBe(1);
    expect(stats.matchedCount).toBe(0);
    expect(prismaMock.cockpitContent.updateMany).not.toHaveBeenCalled();
  });

  it('draftTitle=null 走 videoFilename basename fallback', async () => {
    (runDouyinListAdapter as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { awemeId: '7234567890', postedAt: '', plays: '0', desc: 'mock-1' },
    ]);
    prismaMock.contentAnalysis.findMany.mockResolvedValueOnce([
      { id: 'a1', videoFilename: 'mock-1.mp4', draftTitle: null },
    ]);
    const stats = await runAutoSync('user1');
    expect(stats.matchedCount).toBe(1);
  });
});
