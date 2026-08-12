import { describe, expect, it, vi, beforeEach } from 'vitest';

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ radarQueue: queueMock }));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const radarConfigMock = vi.hoisted(() => ({ getRadarConfig: vi.fn() }));
vi.mock('@/lib/radar/config', () => radarConfigMock);

import { POST } from '@/app/api/v1/radar/trigger/route';

const ORIGINAL_DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'ds-fake';
  radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: true });
});

describe('POST /api/v1/radar/trigger', () => {
  it('入队成功 → ok({queued:true}), add 参数为 radar-scan job + manual- jobId', async () => {
    queueMock.add.mockResolvedValue({ id: 'job-1' });

    const res = await POST();

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ queued: true });
    expect(queueMock.add).toHaveBeenCalledTimes(1);
    expect(queueMock.add).toHaveBeenCalledWith(
      'radar-scan',
      {},
      expect.objectContaining({ jobId: expect.stringMatching(/^manual-\d+$/) }),
    );
  });

  it('未启用 (enabled=false) → 400, 固定文案, 不入队', async () => {
    radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 20, enabled: false });

    const res = await POST();

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('雷达未启用或未配置 Tavily key，请到设置完成配置');
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('未配置 Tavily key (hasKey=false) → 400, 固定文案, 不入队', async () => {
    radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: false, dailyLimit: 20, enabled: true });

    const res = await POST();

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('雷达未启用或未配置 Tavily key，请到设置完成配置');
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('未配置 DEEPSEEK_API_KEY → 503, 固定文案, 不入队', async () => {
    delete process.env.DEEPSEEK_API_KEY;

    const res = await POST();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('服务端未配置 DEEPSEEK_API_KEY');
    expect(queueMock.add).not.toHaveBeenCalled();

    process.env.DEEPSEEK_API_KEY = ORIGINAL_DEEPSEEK_API_KEY;
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
