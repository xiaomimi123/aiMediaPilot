import { describe, expect, it, vi, beforeEach } from 'vitest';

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ autoSyncQueue: queueMock }));

import { POST } from '@/app/api/v1/douyin/auto-sync/trigger/route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/douyin/auto-sync/trigger', () => {
  it('入队成功 → ok({queued:true}), add 参数为 auto-sync job + manual- jobId', async () => {
    queueMock.add.mockResolvedValue({ id: 'job-1' });

    const res = await POST();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ queued: true });
    expect(queueMock.add).toHaveBeenCalledTimes(1);
    expect(queueMock.add).toHaveBeenCalledWith(
      'auto-sync',
      {},
      expect.objectContaining({ jobId: expect.stringMatching(/^manual-\d+$/) }),
    );
  });

  it('队列不可用 (redis 未连) → 503, 文案固定', async () => {
    queueMock.add.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6379'));

    const res = await POST();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('任务队列不可用，请确认 worker 已启动');
  });

  it('add() 挂起不 resolve/reject (ioredis 离线队列) → 4s 超时 → 503, 文案固定', async () => {
    vi.useFakeTimers();
    try {
      queueMock.add.mockReturnValue(new Promise(() => {})); // 永不 settle

      const resPromise = POST();
      await vi.advanceTimersByTimeAsync(4000);
      const res = await resPromise;

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe('任务队列不可用，请确认 worker 已启动');
    } finally {
      vi.useRealTimers();
    }
  });

  it('add() 在超时前正常 resolve → 仍然 200 (超时只在挂起时兜底)', async () => {
    vi.useFakeTimers();
    try {
      queueMock.add.mockResolvedValue({ id: 'job-2' });

      const resPromise = POST();
      const res = await resPromise;

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toEqual({ queued: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
