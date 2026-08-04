import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  cockpitPrefs: { findFirst: vi.fn() },
  cockpitContent: { count: vi.fn(), create: vi.fn() },
  cockpitStageEvent: { create: vi.fn() },
  cockpitInspiration: { create: vi.fn() },
  $transaction: vi.fn(),
  $disconnect: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { applyPlan } from '../../scripts/migrate-cockpit';

const emptyPlan = {
  contents: [],
  inspirations: [],
  skippedArchivedDrafts: 0,
  skippedNonPoolTopics: 0,
  totalDraftsSeen: 0,
  totalTopicsSeen: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = 0;
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
  prismaMock.cockpitContent.count.mockResolvedValue(0);
});

describe('applyPlan — onboarding 顺序守卫', () => {
  it('CockpitPrefs 不存在 (未 onboarding) → 中止, 不写任何表, exitCode=1', async () => {
    prismaMock.cockpitPrefs.findFirst.mockResolvedValue(null);
    await applyPlan('user1', emptyPlan);
    expect(process.exitCode).toBe(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.cockpitContent.count).not.toHaveBeenCalled();
  });

  it('CockpitPrefs 存在但 setupComplete=false (onboarding 未完成) → 中止, 不写任何表', async () => {
    prismaMock.cockpitPrefs.findFirst.mockResolvedValue({ userId: 'user1', setupComplete: false });
    await applyPlan('user1', emptyPlan);
    expect(process.exitCode).toBe(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('CockpitPrefs 存在且 setupComplete=true → 放行, 继续走既有的重复迁移检查', async () => {
    prismaMock.cockpitPrefs.findFirst.mockResolvedValue({ userId: 'user1', setupComplete: true });
    prismaMock.cockpitContent.count.mockResolvedValue(0);
    await applyPlan('user1', emptyPlan);
    expect(process.exitCode).toBe(0);
    expect(prismaMock.cockpitContent.count).toHaveBeenCalledWith({ where: { userId: 'user1' } });
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('setupComplete=true 但已存在 CockpitContent (疑似已迁移过) → 仍中止 (既有防重复迁移逻辑不受影响)', async () => {
    prismaMock.cockpitPrefs.findFirst.mockResolvedValue({ userId: 'user1', setupComplete: true });
    prismaMock.cockpitContent.count.mockResolvedValue(3);
    await applyPlan('user1', emptyPlan);
    expect(process.exitCode).toBe(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
