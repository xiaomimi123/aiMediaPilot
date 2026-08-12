import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  radarRun: { findFirst: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/radar/runs/latest/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/radar/runs/latest', () => {
  it('从未运行过 → {run: null}', async () => {
    prismaMock.radarRun.findFirst.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ run: null });
    expect(prismaMock.radarRun.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user1' },
      orderBy: { startedAt: 'desc' },
    });
  });

  it('存在运行记录 → 摘要形状 (关键词数/搜索/读取/入库/错误数)', async () => {
    const startedAt = new Date('2026-08-13T10:00:00.000Z');
    const finishedAt = new Date('2026-08-13T10:05:00.000Z');
    prismaMock.radarRun.findFirst.mockResolvedValue({
      id: 'run1',
      startedAt,
      finishedAt,
      keywordsUsed: ['AI 模型', 'Vibe Coding'],
      searched: 12,
      read: 8,
      kept: 5,
      errors: [{ keyword: 'x', message: 'boom' }],
    });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      run: {
        id: 'run1',
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        keywordsCount: 2,
        searched: 12,
        read: 8,
        kept: 5,
        errorsCount: 1,
      },
    });
  });

  it('finishedAt 为 null (运行中) → 保留 null, 不抛错', async () => {
    const startedAt = new Date('2026-08-13T10:00:00.000Z');
    prismaMock.radarRun.findFirst.mockResolvedValue({
      id: 'run2',
      startedAt,
      finishedAt: null,
      keywordsUsed: [],
      searched: 0,
      read: 0,
      kept: 0,
      errors: [],
    });
    const res = await GET();
    const json = await res.json();
    expect(json.data.run.finishedAt).toBeNull();
    expect(json.data.run.keywordsCount).toBe(0);
  });
});
