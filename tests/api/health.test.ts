import { describe, expect, it, vi, beforeEach } from 'vitest';

const redisMock = vi.hoisted(() => ({ ping: vi.fn(async () => 'PONG') }));
vi.mock('@/lib/redis', () => ({ redis: redisMock }));

const queueMock = vi.hoisted(() => ({
  getWorkers: vi.fn(async () => [{ name: 'w1', idle: '3' }]),
  getJobCounts: vi.fn(async () => ({ waiting: 1, active: 0, delayed: 0, failed: 2, completed: 9 })),
}));
vi.mock('@/jobs/queue', () => ({
  videoProductionQueue: queueMock,
  analyzeQueue: queueMock,
  retroQueue: queueMock,
  radarQueue: queueMock,
  autoSyncQueue: queueMock,
  syncQueue: queueMock,
}));

import { GET } from '@/app/api/v1/health/route';

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.ping.mockResolvedValue('PONG');
  queueMock.getWorkers.mockResolvedValue([{ name: 'w1', idle: '3' }]);
  queueMock.getJobCounts.mockResolvedValue({ waiting: 1, active: 0, delayed: 0, failed: 2, completed: 9 });
});

async function body() {
  return (await (await GET()).json()).data;
}

describe('GET /api/v1/health', () => {
  it('Redis 通、worker 在 → ready', async () => {
    const d = await body();
    expect(d.redis).toBe('up');
    expect(d.workers.online).toBe(1);
    expect(d.ready).toBe(true);
    expect(d.hint).toBeNull();
  });

  it('worker 不在 → not ready, 并给出启动命令', async () => {
    queueMock.getWorkers.mockResolvedValue([]);
    const d = await body();
    expect(d.workers.online).toBe(0);
    expect(d.ready).toBe(false);
    expect(d.hint).toContain('worker:dev');
  });

  it('Redis 挂了 → not ready, 且不因为异常把接口打成 500', async () => {
    redisMock.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await GET();
    const d = (await res.json()).data;
    expect(res.status).toBe(200);
    expect(d.redis).toBe('down');
    expect(d.ready).toBe(false);
  });

  it('报出每条队列的积压 —— 任务停着不动时要能看见堆了多少', async () => {
    const d = await body();
    expect(d.queues['video-production']).toMatchObject({ waiting: 1, failed: 2 });
    expect(Object.keys(d.queues).length).toBeGreaterThanOrEqual(5);
  });

  it('队列查询失败不影响整体结果 —— 单条队列坏掉不该让健康检查瞎掉', async () => {
    queueMock.getJobCounts.mockRejectedValue(new Error('boom'));
    const res = await GET();
    const d = (await res.json()).data;
    expect(res.status).toBe(200);
    expect(d.queues['video-production']).toBeNull();
  });

  it('给出 worker 空闲秒数 —— 用来判断它是活着还是卡住了', async () => {
    queueMock.getWorkers.mockResolvedValue([{ name: 'w1', idle: '7' }, { name: 'w2', idle: '2' }]);
    const d = await body();
    expect(d.workers.online).toBe(2);
    expect(d.workers.minIdleSec).toBe(2);
  });
});
