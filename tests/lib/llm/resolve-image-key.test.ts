import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  aIConfig: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const decryptMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/crypto', () => ({ decrypt: decryptMock }));

import { resolveImageApiKey } from '@/lib/llm/resolve-image-key';

function row(overrides: Partial<{
  id: string;
  apiKey: string;
  isDefault: boolean;
  createdAt: Date;
}> = {}) {
  return {
    id: 'cfg1',
    userId: 'u1',
    provider: 'gpt-image',
    modelId: 'gpt-image-1',
    apiKey: 'enc:sk-fake',
    isDefault: false,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveImageApiKey', () => {
  it('有行 → 解密后返回', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([
      row({ id: 'a', isDefault: true, apiKey: 'enc:default-key' }),
    ]);
    decryptMock.mockImplementation((v: string) => v.replace('enc:', 'plain:'));

    const out = await resolveImageApiKey('u1');

    expect(out).toBe('plain:default-key');
    expect(prismaMock.aIConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', provider: 'gpt-image' } }),
    );
  });

  it('多条行 (isDefault 混杂) → 取 rows[0] (findMany 已按 isDefault desc, createdAt desc 排序)', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([
      row({ id: 'default-row', isDefault: true, apiKey: 'enc:default-key' }),
      row({ id: 'older-row', isDefault: false, apiKey: 'enc:older-key' }),
    ]);
    decryptMock.mockImplementation((v: string) => v.replace('enc:', 'plain:'));

    const out = await resolveImageApiKey('u1');

    expect(out).toBe('plain:default-key');
    expect(decryptMock).toHaveBeenCalledWith('enc:default-key');
  });

  it('解密失败 (ENCRYPTION_KEY 变更/数据损坏) → null, 不 throw', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([row({ apiKey: 'corrupted' })]);
    decryptMock.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });

    const out = await resolveImageApiKey('u1');

    expect(out).toBeNull();
  });

  it('无行 (空数组) → null, 不调用 decrypt', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([]);

    const out = await resolveImageApiKey('u1');

    expect(out).toBeNull();
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it('AIConfig 查询本身抛错 (db down) → null, 不向上抛异常', async () => {
    prismaMock.aIConfig.findMany.mockRejectedValue(new Error('connection refused'));

    const out = await resolveImageApiKey('u1');

    expect(out).toBeNull();
  });

  it('日志不含明文/密文 key', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.aIConfig.findMany.mockResolvedValue([row({ apiKey: 'enc:secret-payload-xyz' })]);
    decryptMock.mockImplementation(() => {
      throw new Error('bad key');
    });

    await resolveImageApiKey('u1');

    for (const call of warnSpy.mock.calls) {
      const joined = call.map((a) => String(a)).join(' ');
      expect(joined).not.toContain('secret-payload-xyz');
      expect(joined).not.toContain('enc:secret-payload-xyz');
    }
    warnSpy.mockRestore();
  });
});
