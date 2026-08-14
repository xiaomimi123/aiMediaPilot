import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const bumpCockpitRevMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/cockpit/server-store', () => ({
  bumpCockpitRev: bumpCockpitRevMock,
}));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findMany: vi.fn(), update: vi.fn() },
  cockpitStageEvent: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
  $disconnect: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { planXhsStageMigration, applyMigration } from '../../scripts/migrate-xhs-stages';

describe('planXhsStageMigration — 纯函数', () => {
  it('只挑出 platform=xiaohongshu 且 stage 为 recording/editing 的卡片, 目标一律为 script', () => {
    const rows = [
      { id: 'c1', title: 'A', platform: 'xiaohongshu', stage: 'recording', userId: 'u1' },
      { id: 'c2', title: 'B', platform: 'xiaohongshu', stage: 'editing', userId: 'u1' },
      { id: 'c3', title: 'C', platform: 'xiaohongshu', stage: 'script', userId: 'u1' }, // 已在 script, 不应出现
      { id: 'c4', title: 'D', platform: 'douyin', stage: 'recording', userId: 'u2' }, // 非小红书, 不应出现
    ];

    const plan = planXhsStageMigration(rows);

    expect(plan).toEqual([
      { id: 'c1', title: 'A', from: 'recording', to: 'script', userId: 'u1' },
      { id: 'c2', title: 'B', from: 'editing', to: 'script', userId: 'u1' },
    ]);
  });

  it('空输入 → 空计划', () => {
    expect(planXhsStageMigration([])).toEqual([]);
  });

  it('输入本身已是干净集合 (无需再过滤) 仍能正确产出计划', () => {
    const rows = [{ id: 'c9', title: 'X', platform: 'xiaohongshu', stage: 'editing', userId: 'u9' }];
    expect(planXhsStageMigration(rows)).toEqual([
      { id: 'c9', title: 'X', from: 'editing', to: 'script', userId: 'u9' },
    ]);
  });
});

describe('applyMigration — 单事务写库', () => {
  let txMock: typeof prismaMock;

  beforeEach(() => {
    vi.clearAllMocks();
    txMock = prismaMock;
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => unknown) => cb(txMock));
  });

  it('空计划 → 不开事务, 不写库', async () => {
    await applyMigration([]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('非空计划 → 单事务内: 逐卡 stage 更新 + 清理该卡 recording/editing 排期 + 按去重 userId bump rev', async () => {
    const plan = [
      { id: 'c1', title: 'A', from: 'recording' as const, to: 'script' as const, userId: 'u1' },
      { id: 'c2', title: 'B', from: 'editing' as const, to: 'script' as const, userId: 'u1' },
      { id: 'c3', title: 'C', from: 'recording' as const, to: 'script' as const, userId: 'u2' },
    ];

    await applyMigration(plan);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

    expect(prismaMock.cockpitContent.update).toHaveBeenCalledTimes(3);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { stage: 'script', updatedAt: expect.any(String) },
    });

    expect(prismaMock.cockpitStageEvent.deleteMany).toHaveBeenCalledTimes(3);
    expect(prismaMock.cockpitStageEvent.deleteMany).toHaveBeenCalledWith({
      where: { contentId: 'c1', stage: { in: ['recording', 'editing'] } },
    });

    // userId 去重: u1 出现两次(c1,c2), u2 一次(c3) → bump 应各只调用一次
    expect(bumpCockpitRevMock).toHaveBeenCalledTimes(2);
    expect(bumpCockpitRevMock).toHaveBeenCalledWith('u1', txMock);
    expect(bumpCockpitRevMock).toHaveBeenCalledWith('u2', txMock);
  });
});
