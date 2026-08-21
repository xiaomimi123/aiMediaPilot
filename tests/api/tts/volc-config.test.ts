import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  volcTtsConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET, POST } from '@/app/api/v1/tts/volc-config/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/tts/volc-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/v1/tts/volc-config', () => {
  it('无配置 → hasConfig:false, 带默认 resourceId/voiceType', async () => {
    prismaMock.volcTtsConfig.findUnique.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.hasConfig).toBe(false);
    expect(json.data.resourceId).toBe('seed-tts-2.0');
    expect(json.data.voiceType).toBe('zh_female_vv_uranus_bigtts');
    expect(json.data.apiKeyMasked).toBe('');
  });

  it('有配置 → 返回掩码, 绝不返回明文', async () => {
    // 真实加密的密文, 明文为 'volc-real-secret-key-12345'
    const { encrypt } = await import('@/lib/crypto');
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    const plain = 'volc-real-secret-key-12345';
    const encrypted = encrypt(plain);
    prismaMock.volcTtsConfig.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'user1',
      apiKey: encrypted,
      resourceId: 'seed-tts-2.0',
      voiceType: 'zh_female_vv_uranus_bigtts',
    });

    const res = await GET();
    const json = await res.json();
    expect(json.data.hasConfig).toBe(true);
    expect(json.data.resourceId).toBe('seed-tts-2.0');
    expect(json.data.voiceType).toBe('zh_female_vv_uranus_bigtts');
    expect(json.data.apiKeyMasked).not.toBe(plain);
    expect(JSON.stringify(json.data)).not.toContain(plain);
  });
});

describe('POST /api/v1/tts/volc-config', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  });

  it('缺 apiKey → 400', async () => {
    const res = await POST(req({ resourceId: 'seed-tts-2.0' }) as any);
    expect(res.status).toBe(400);
    expect(prismaMock.volcTtsConfig.upsert).not.toHaveBeenCalled();
  });

  it('apiKey 为空串 → 400', async () => {
    const res = await POST(req({ apiKey: '' }) as any);
    expect(res.status).toBe(400);
    expect(prismaMock.volcTtsConfig.upsert).not.toHaveBeenCalled();
  });

  it('正常保存 → 200, apiKey 落库前加密 (非明文)', async () => {
    const plain = 'volc-plaintext-api-key';
    prismaMock.volcTtsConfig.upsert.mockResolvedValue({ id: 'c1' });

    const res = await POST(req({ apiKey: plain }) as any);
    expect(res.status).toBe(200);
    expect(prismaMock.volcTtsConfig.upsert).toHaveBeenCalledTimes(1);

    const call = prismaMock.volcTtsConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'user1' });
    expect(call.update.apiKey).not.toBe(plain);
    expect(call.create.apiKey).not.toBe(plain);
    expect(call.create.userId).toBe('user1');
    // 默认值兜底
    expect(call.create.resourceId).toBe('seed-tts-2.0');
    expect(call.create.voiceType).toBe('zh_female_vv_uranus_bigtts');
  });

  it('传自定义 resourceId/voiceType → 透传', async () => {
    prismaMock.volcTtsConfig.upsert.mockResolvedValue({ id: 'c1' });
    const res = await POST(req({ apiKey: 'k', resourceId: 'custom-tier', voiceType: 'zh_male_liufei_uranus_bigtts' }) as any);
    expect(res.status).toBe(200);
    const call = prismaMock.volcTtsConfig.upsert.mock.calls[0][0];
    expect(call.create.resourceId).toBe('custom-tier');
    expect(call.create.voiceType).toBe('zh_male_liufei_uranus_bigtts');
  });
});
