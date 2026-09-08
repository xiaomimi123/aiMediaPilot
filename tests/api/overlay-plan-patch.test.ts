import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 三十七期 Task 5: 剪辑台「文字叠加」PATCH。
 *
 * mock prisma 照 `tests/api/video-templates/crud.test.ts` / `tests/api/
 * video-production-film-plan.test.ts` 先例——`videoProduction.updateMany`
 * 是全量替换的落库入口, count 用来模拟乐观并发。
 */

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findUnique: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PATCH } from '@/app/api/v1/cockpit/video-productions/[id]/overlay-plan/route';

function patchReq(body: unknown): Request {
  return new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
}

function makeVp(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'vp1', userId: 'user1', status: 'plan_ready', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoProduction.updateMany.mockResolvedValue({ count: 1 });
});

describe('PATCH /api/v1/cockpit/video-productions/[id]/overlay-plan', () => {
  it('合法全量替换 → 200 且落库调用带 overlayPlan', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = {
      items: [
        { kind: 'keyword', text: '效率翻倍', slot: 'left-1', startMs: 0, endMs: 3000 },
      ],
    };

    const res = await PATCH(patchReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.updateMany).toHaveBeenCalledTimes(1);
    const data = prismaMock.videoProduction.updateMany.mock.calls[0][0].data;
    expect(data.overlayPlan).toEqual(plan);
  });

  it('带 x/y 覆盖坐标的条目 → 通过校验, 原样落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = {
      items: [
        { kind: 'note', text: '解决拖延', slot: 'left-2', startMs: 1000, endMs: 4000, x: 0.2, y: 0.5 },
      ],
    };

    const res = await PATCH(patchReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    const data = prismaMock.videoProduction.updateMany.mock.calls[0][0].data;
    expect(data.overlayPlan).toEqual(plan);
  });

  it('非法 slot 枚举外的值 → 400, 不落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = {
      items: [
        { kind: 'keyword', text: '效率翻倍', slot: 'middle', startMs: 0, endMs: 3000 },
      ],
    };

    const res = await PATCH(patchReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(prismaMock.videoProduction.updateMany).not.toHaveBeenCalled();
  });

  it('schema 外字段 → 400(.strict() 拦), 不落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = {
      items: [
        { kind: 'keyword', text: '效率翻倍', slot: 'left-1', startMs: 0, endMs: 3000, color: 'red' },
      ],
    };

    const res = await PATCH(patchReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.updateMany).not.toHaveBeenCalled();
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: 'not-json' }), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
  });

  it('别人的任务 → 404, 不落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp({ userId: 'other' }));
    const plan = { items: [] };

    const res = await PATCH(patchReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.updateMany).not.toHaveBeenCalled();
  });

  it('不存在的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await PATCH(patchReq({ plan: { items: [] } }), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });

  it('非 plan_ready 状态 → 400, 不落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp({ status: 'building' }));
    const res = await PATCH(patchReq({ plan: { items: [] } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.updateMany).not.toHaveBeenCalled();
  });

  it('读写之间状态变化(updateMany count:0) → 409', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    prismaMock.videoProduction.updateMany.mockResolvedValue({ count: 0 });
    const res = await PATCH(patchReq({ plan: { items: [] } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(409);
  });

  it('空 items 数组(全部清空) → 200', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const res = await PATCH(patchReq({ plan: { items: [] } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    const data = prismaMock.videoProduction.updateMany.mock.calls[0][0].data;
    expect(data.overlayPlan).toEqual({ items: [] });
  });
});
