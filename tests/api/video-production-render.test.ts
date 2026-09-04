import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * POST /api/v1/cockpit/video-productions/[id]/render(三十一期 Task 1)——
 * 生成前剪辑台的「确认」按钮打这个路由。风格照 `[id]/start` 路由的先例:
 * jobId 幂等(先删旧 job 再加)、worker 在线检查与 hint 同款。
 *
 * 与 /start 的关键行为差异——只接受 plan_ready, 且 job payload 带
 * `skipPlanGeneration: true`。
 */

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({
  add: vi.fn(async (_n: string, _d: unknown, _o?: unknown) => ({ id: 'job1' })),
  getJob: vi.fn(async (_id: string) => null as { remove: () => Promise<void> } | null),
  getWorkers: vi.fn(async () => [{ id: 'w1' }]),
}));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

import { POST } from '@/app/api/v1/cockpit/video-productions/[id]/render/route';

const VP = {
  id: 'vp1',
  userId: 'user1',
  mode: 'ppt-narration',
  status: 'plan_ready',
};

function req() {
  return new Request('http://x', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP });
  prismaMock.videoProduction.update.mockResolvedValue({ ...VP, status: 'queued' });
  queueMock.getJob.mockResolvedValue(null);
  queueMock.getWorkers.mockResolvedValue([{ id: 'w1' }]);
});

describe('POST video-productions/[id]/render', () => {
  it('别人的任务确认不了', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, userId: 'other' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('只接受 plan_ready —— 其它状态一律 400, 不入队', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, status: 'queued' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('preview_ready(已经渲完的老状态)也不接受 —— 不是"确认"这一步该处理的', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, status: 'preview_ready' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('plan_ready → 200, 状态转回 queued, 入队 mode:preview 且带 skipPlanGeneration:true', async () => {
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);

    const updateData = prismaMock.videoProduction.update.mock.calls[0][0].data;
    expect(updateData.status).toBe('queued');

    expect(queueMock.add).toHaveBeenCalledWith(
      'produce',
      { videoProductionId: 'vp1', mode: 'preview', skipPlanGeneration: true },
      expect.objectContaining({ jobId: 'vp1-preview' }),
    );
  });

  it('入队时用固定 jobId(与 /start 同一条, preview 渲染始终只有一个在跑的 job)', async () => {
    await POST(req(), { params: { id: 'vp1' } });
    const opts = queueMock.add.mock.calls[0][2] as { jobId?: string };
    expect(opts.jobId).toBe('vp1-preview');
  });

  it('同 id 的旧 job 还在时先删掉再入队 —— 幂等, 与 /start 同一先例', async () => {
    const remove = vi.fn(async () => {});
    queueMock.getJob.mockResolvedValue({ remove });
    await POST(req(), { params: { id: 'vp1' } });
    expect(remove).toHaveBeenCalled();
    expect(queueMock.add).toHaveBeenCalled();
  });

  it('有 worker 在跑时告诉用户已经开始', async () => {
    const res = await POST(req(), { params: { id: 'vp1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.workerOnline).toBe(true);
  });

  it('没有 worker 时仍然入队, 但明说没人处理并给出启动命令', async () => {
    queueMock.getWorkers.mockResolvedValue([]);
    const res = await POST(req(), { params: { id: 'vp1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(queueMock.add).toHaveBeenCalled();
    expect(body.data.workerOnline).toBe(false);
    expect(body.data.hint).toContain('worker:dev');
  });

  it('查 worker 失败不影响入队', async () => {
    queueMock.getWorkers.mockRejectedValue(new Error('redis 抖了'));
    const res = await POST(req(), { params: { id: 'vp1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.workerOnline).toBeNull();
  });
});
