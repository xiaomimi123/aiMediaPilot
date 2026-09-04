import { describe, expect, it, vi, beforeEach } from 'vitest';

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

import { POST } from '@/app/api/v1/cockpit/video-productions/[id]/start/route';

const VP = {
  id: 'vp1',
  userId: 'user1',
  mode: 'ppt-narration',
  status: 'queued',
  sourceVideoPath: null as string | null,
};

function req() {
  return new Request('http://x', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP });
  prismaMock.videoProduction.update.mockResolvedValue({ ...VP });
  queueMock.getJob.mockResolvedValue(null);
  queueMock.getWorkers.mockResolvedValue([{ id: 'w1' }]);
});

describe('POST video-productions/[id]/start', () => {
  it('别人的任务启动不了', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, userId: 'other' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('入队时用固定 jobId, 重复点不会堆出多份任务', async () => {
    await POST(req(), { params: { id: 'vp1' } });
    const opts = queueMock.add.mock.calls[0][2] as { jobId?: string };
    expect(opts.jobId).toBe('vp1-preview');
  });

  // 真机踩到的: BullMQ 的 Job.validateOptions 直接抛 "Custom Id cannot contain :",
  // 整个路由 500。mock 的 add 只记参数不校验, 所以单测全绿而线上炸 —— 把这条约束
  // 显式钉死在这里。
  it('jobId 不能含冒号 —— BullMQ 会拒绝', async () => {
    await POST(req(), { params: { id: 'vp1' } });
    const opts = queueMock.add.mock.calls[0][2] as { jobId?: string };
    expect(opts.jobId).not.toContain(':');
  });

  it('同 id 的旧 job 还在时先删掉再入队 —— 否则 BullMQ 会因为 jobId 重复而静默丢弃', async () => {
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

  it('查 worker 失败不影响入队 —— 这只是提示信息, 不该把启动搞挂', async () => {
    queueMock.getWorkers.mockRejectedValue(new Error('redis 抖了'));
    const res = await POST(req(), { params: { id: 'vp1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.workerOnline).toBeNull();
  });

  it('真人出镜还没上传视频时不许启动 —— 入队也只会立刻失败', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      ...VP, mode: 'talking-head-broll', status: 'queued', sourceVideoPath: null,
    });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('真人出镜已上传视频的可以启动', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      ...VP, mode: 'talking-head-broll', status: 'source_uploaded', sourceVideoPath: '/x/source.mov',
    });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    expect(queueMock.add).toHaveBeenCalled();
  });

  // 'queued' 对 talking-head-broll 是「视频还没传」的哨兵值(见 VideoProductionPanel
  // 的 needsUploadFirst)。重启时把它退回 queued, 面板会反过来说"请先上传视频"。
  it('真人出镜重启后保持 source_uploaded, 不退回 queued', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      ...VP, mode: 'talking-head-broll', status: 'source_uploaded', sourceVideoPath: '/x/source.mov',
    });
    await POST(req(), { params: { id: 'vp1' } });
    expect(prismaMock.videoProduction.update.mock.calls[0][0].data.status).toBe('source_uploaded');
  });

  it('已经在跑的任务不许重复启动', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, status: 'building' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('失败的任务可以重来, 并把错误信息清掉', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, status: 'failed' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    const data = prismaMock.videoProduction.update.mock.calls[0][0].data;
    expect(data.status).toBe('queued');
    expect(data.errorMessage).toBeNull();
  });

  // 三十一期(生成前剪辑台) Task 1: plan_ready(分镜待确认)不许走 /start——start 的
  // 语义是"重新产 plan", 会覆盖用户在剪辑台里对方案做的调整, 必须走 Task 4 的显式
  // 确认对话框(继续渲染打 /render 路由), 不能通过这个入口直接触发。
  it('plan_ready 状态不许 /start —— 会覆盖用户已调整的方案, 必须走 /render 确认', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ ...VP, status: 'plan_ready' });
    const res = await POST(req(), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });
});
