import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  actualMetric: {
    findMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { resolveBaseline } from '@/lib/prediction/baseline';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', baselinePlays: null });
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
});

describe('resolveBaseline', () => {
  it('无 baseline 且无 retro → null', async () => {
    expect(await resolveBaseline('u1')).toBeNull();
  });

  it('User.baselinePlays=500n, 0 retro → onboarding 分支', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 500n });
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 500, source: 'onboarding', retroSampleCount: 0 });
  });

  it('2 条 retro (<3) → 走 onboarding 值, 不动 User.baselinePlays', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 800n });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([{ plays: 600n }, { plays: 700n }]);
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 800, source: 'onboarding', retroSampleCount: 2 });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('3 条 retro plays=[100,500,1000] → median=500, source=retro-median, 写回 User', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 999n });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 500n },
      { plays: 1000n },
    ]);
    const result = await resolveBaseline('u1');
    expect(result).toEqual({ value: 500, source: 'retro-median', retroSampleCount: 3 });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { baselinePlays: 500n },
    });
  });

  it('4 条 retro plays=[100,200,800,1000] → median=(200+800)/2=500', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: null });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 200n },
      { plays: 800n },
      { plays: 1000n },
    ]);
    const result = await resolveBaseline('u1');
    expect(result?.value).toBe(500);
    expect(result?.source).toBe('retro-median');
  });

  it('写回失败不抛, 仍返回 retro-median 结果', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: null });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 500n },
      { plays: 1000n },
    ]);
    prismaMock.user.update.mockRejectedValueOnce(new Error('db down'));
    const result = await resolveBaseline('u1');
    expect(result?.value).toBe(500);
    expect(result?.source).toBe('retro-median');
  });

  it('User.baselinePlays=0n → 视为 null (无 retro)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 0n });
    expect(await resolveBaseline('u1')).toBeNull();
  });

  it('baselinePlays 与新 median 相等时 不 UPDATE (避免热路径无谓写)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', baselinePlays: 500n });
    prismaMock.actualMetric.findMany.mockResolvedValueOnce([
      { plays: 100n },
      { plays: 500n },
      { plays: 1000n },
    ]);
    const result = await resolveBaseline('u1');
    expect(result?.value).toBe(500);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
