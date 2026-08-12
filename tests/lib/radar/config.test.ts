import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  radarConfig: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getRadarConfig, saveRadarConfig, getDecryptedTavilyKey } from '@/lib/radar/config';

// crypto.ts 要求 ENCRYPTION_KEY 是 64 位 hex 字符串, 测试环境不会自动加载 .env
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getRadarConfig', () => {
  it('没有配置行 → 默认值 (hasKey=false, dailyLimit=20, enabled=false)', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue(null);
    const config = await getRadarConfig('u1');
    expect(config).toEqual({ hasKey: false, dailyLimit: 20, enabled: false });
  });

  it('tavilyKeyEncrypted 为空串 → hasKey=false (空串=未配置语义)', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue({
      userId: 'u1',
      tavilyKeyEncrypted: '',
      dailyLimit: 20,
      enabled: false,
    });
    const config = await getRadarConfig('u1');
    expect(config.hasKey).toBe(false);
  });

  it('tavilyKeyEncrypted 非空 → hasKey=true, 不回显任何 key 相关字段', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue({
      userId: 'u1',
      tavilyKeyEncrypted: 'ciphertext-blob',
      dailyLimit: 30,
      enabled: true,
    });
    const config = await getRadarConfig('u1');
    expect(config).toEqual({ hasKey: true, dailyLimit: 30, enabled: true });
    expect(config).not.toHaveProperty('tavilyKey');
    expect(config).not.toHaveProperty('tavilyKeyEncrypted');
  });
});

describe('saveRadarConfig', () => {
  it('保存 tavilyKey → 落库前加密, 不是明文', async () => {
    prismaMock.radarConfig.upsert.mockResolvedValue({});
    await saveRadarConfig('u1', { tavilyKey: 'tvly-real-secret' });

    const call = prismaMock.radarConfig.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'u1' });
    expect(call.update.tavilyKeyEncrypted).toBeDefined();
    expect(call.update.tavilyKeyEncrypted).not.toBe('tvly-real-secret');
    expect(call.update.tavilyKeyEncrypted).not.toContain('tvly-real-secret');
  });

  it('传入空字符串 tavilyKey → 显式清空 (存回空串, 不加密)', async () => {
    prismaMock.radarConfig.upsert.mockResolvedValue({});
    await saveRadarConfig('u1', { tavilyKey: '' });
    const call = prismaMock.radarConfig.upsert.mock.calls[0][0];
    expect(call.update.tavilyKeyEncrypted).toBe('');
  });

  it('不传 tavilyKey → update 数据里不含 tavilyKeyEncrypted 字段 (保持原值)', async () => {
    prismaMock.radarConfig.upsert.mockResolvedValue({});
    await saveRadarConfig('u1', { dailyLimit: 50 });
    const call = prismaMock.radarConfig.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('tavilyKeyEncrypted');
    expect(call.update.dailyLimit).toBe(50);
  });

  it('只传 enabled → 只更新 enabled', async () => {
    prismaMock.radarConfig.upsert.mockResolvedValue({});
    await saveRadarConfig('u1', { enabled: true });
    const call = prismaMock.radarConfig.upsert.mock.calls[0][0];
    expect(call.update).toEqual({ enabled: true });
  });
});

describe('getDecryptedTavilyKey — 加密/解密往返', () => {
  it('保存后再读取 → 拿回原始明文 (round trip)', async () => {
    let stored = '';
    prismaMock.radarConfig.upsert.mockImplementation(async ({ update, create }: any) => {
      stored = update.tavilyKeyEncrypted ?? create.tavilyKeyEncrypted;
    });

    await saveRadarConfig('u1', { tavilyKey: 'tvly-super-secret-key' });

    prismaMock.radarConfig.findUnique.mockResolvedValue({
      userId: 'u1',
      tavilyKeyEncrypted: stored,
      dailyLimit: 20,
      enabled: true,
    });

    const decrypted = await getDecryptedTavilyKey('u1');
    expect(decrypted).toBe('tvly-super-secret-key');
  });

  it('未配置 (行不存在) → null', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue(null);
    expect(await getDecryptedTavilyKey('u1')).toBeNull();
  });

  it('未配置 (空串) → null, 不尝试 decrypt', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue({
      userId: 'u1',
      tavilyKeyEncrypted: '',
      dailyLimit: 20,
      enabled: false,
    });
    expect(await getDecryptedTavilyKey('u1')).toBeNull();
  });

  it('密文损坏/ENCRYPTION_KEY 不匹配 → 捕获异常返回 null, 不抛出', async () => {
    prismaMock.radarConfig.findUnique.mockResolvedValue({
      userId: 'u1',
      tavilyKeyEncrypted: 'not-valid-base64-ciphertext!!',
      dailyLimit: 20,
      enabled: false,
    });
    expect(await getDecryptedTavilyKey('u1')).toBeNull();
  });
});
