import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const radarConfigMock = vi.hoisted(() => ({
  getRadarConfig: vi.fn(),
  saveRadarConfig: vi.fn(),
}));
vi.mock('@/lib/radar/config', () => radarConfigMock);

import { GET, PUT } from '@/app/api/v1/radar/config/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/radar/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: false, dailyLimit: 20, enabled: false });
  radarConfigMock.saveRadarConfig.mockResolvedValue(undefined);
});

describe('GET /api/v1/radar/config', () => {
  it('返回 {hasKey, dailyLimit, enabled}, 不含明文/密文 key 字段', async () => {
    radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 30, enabled: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ hasKey: true, dailyLimit: 30, enabled: true });
    expect(json.data).not.toHaveProperty('tavilyKey');
    expect(json.data).not.toHaveProperty('tavilyKeyEncrypted');
    expect(radarConfigMock.getRadarConfig).toHaveBeenCalledWith('user1');
  });
});

describe('PUT /api/v1/radar/config', () => {
  it('传 tavilyKey → 转发给 saveRadarConfig', async () => {
    const res = await PUT(req({ tavilyKey: 'tvly-abc' }));
    expect(res.status).toBe(200);
    expect(radarConfigMock.saveRadarConfig).toHaveBeenCalledWith('user1', { tavilyKey: 'tvly-abc' });
  });

  it('只传 dailyLimit → 只更新该字段', async () => {
    const res = await PUT(req({ dailyLimit: 50 }));
    expect(res.status).toBe(200);
    expect(radarConfigMock.saveRadarConfig).toHaveBeenCalledWith('user1', { dailyLimit: 50 });
  });

  it('只传 enabled → 只更新该字段', async () => {
    const res = await PUT(req({ enabled: true }));
    expect(res.status).toBe(200);
    expect(radarConfigMock.saveRadarConfig).toHaveBeenCalledWith('user1', { enabled: true });
  });

  it('三个字段一起传 → 全部转发', async () => {
    const res = await PUT(req({ tavilyKey: 'k', dailyLimit: 10, enabled: false }));
    expect(res.status).toBe(200);
    expect(radarConfigMock.saveRadarConfig).toHaveBeenCalledWith('user1', {
      tavilyKey: 'k', dailyLimit: 10, enabled: false,
    });
  });

  it('dailyLimit 非正整数 → 400, 不保存', async () => {
    const res = await PUT(req({ dailyLimit: 0 }));
    expect(res.status).toBe(400);
    expect(radarConfigMock.saveRadarConfig).not.toHaveBeenCalled();
  });

  it('dailyLimit 非整数 → 400', async () => {
    const res = await PUT(req({ dailyLimit: 1.5 }));
    expect(res.status).toBe(400);
    expect(radarConfigMock.saveRadarConfig).not.toHaveBeenCalled();
  });

  it('enabled 非布尔 → 400', async () => {
    const res = await PUT(req({ enabled: 'yes' }));
    expect(res.status).toBe(400);
    expect(radarConfigMock.saveRadarConfig).not.toHaveBeenCalled();
  });

  it('tavilyKey 非字符串 → 400', async () => {
    const res = await PUT(req({ tavilyKey: 123 }));
    expect(res.status).toBe(400);
    expect(radarConfigMock.saveRadarConfig).not.toHaveBeenCalled();
  });

  it('tavilyKey 传空串 → 显式清空, 照常转发', async () => {
    const res = await PUT(req({ tavilyKey: '' }));
    expect(res.status).toBe(200);
    expect(radarConfigMock.saveRadarConfig).toHaveBeenCalledWith('user1', { tavilyKey: '' });
  });

  it('保存成功后返回最新的 getRadarConfig 结果', async () => {
    radarConfigMock.getRadarConfig.mockResolvedValue({ hasKey: true, dailyLimit: 50, enabled: true });
    const res = await PUT(req({ dailyLimit: 50 }));
    const json = await res.json();
    expect(json.data).toEqual({ hasKey: true, dailyLimit: 50, enabled: true });
  });

  it('非法 JSON → 400', async () => {
    const badReq = new Request('http://t/api/v1/radar/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await PUT(badReq);
    expect(res.status).toBe(400);
  });
});
