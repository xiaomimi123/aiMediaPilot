import { describe, expect, it, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  aIConfig: { findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const decryptMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/crypto', () => ({ decrypt: decryptMock }));

import { resolveDeepSeekApiKey } from '@/lib/llm/resolve-key';

function row(overrides: Partial<{
  id: string;
  apiKey: string;
  isDefault: boolean;
  createdAt: Date;
}> = {}) {
  return {
    id: 'cfg1',
    userId: 'u1',
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    apiKey: 'enc:sk-fake',
    isDefault: false,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEEPSEEK_API_KEY;
});

describe('resolveDeepSeekApiKey', () => {
  it('单条默认行 → 解密后返回', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([
      row({ id: 'a', isDefault: true, apiKey: 'enc:default-key' }),
    ]);
    decryptMock.mockImplementation((v: string) => v.replace('enc:', 'plain:'));

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('plain:default-key');
    expect(prismaMock.aIConfig.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', provider: 'deepseek' } }),
    );
  });

  it('多条行 (isDefault 混杂) → 默认行优先, 忽略非默认行', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([
      // Prisma orderBy 已经把结果排好序 (isDefault desc, createdAt desc);
      // mock 直接按该顺序返回, 断言 resolver 取 rows[0] 而非任意挑选。
      row({ id: 'default-row', isDefault: true, apiKey: 'enc:default-key', createdAt: new Date('2026-01-01') }),
      row({ id: 'older-row', isDefault: false, apiKey: 'enc:older-key', createdAt: new Date('2025-06-01') }),
    ]);
    decryptMock.mockImplementation((v: string) => v.replace('enc:', 'plain:'));

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('plain:default-key');
    expect(decryptMock).toHaveBeenCalledWith('enc:default-key');
  });

  it('无默认行 → 取最新一条 (findMany 已按 createdAt desc 排序, 取 rows[0])', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([
      row({ id: 'newer-row', isDefault: false, apiKey: 'enc:newer-key', createdAt: new Date('2026-02-01') }),
      row({ id: 'older-row', isDefault: false, apiKey: 'enc:older-key', createdAt: new Date('2025-06-01') }),
    ]);
    decryptMock.mockImplementation((v: string) => v.replace('enc:', 'plain:'));

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('plain:newer-key');
  });

  it('解密失败 (ENCRYPTION_KEY 变更/数据损坏) → 回退 env', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([row({ apiKey: 'corrupted' })]);
    decryptMock.mockImplementation(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });
    process.env.DEEPSEEK_API_KEY = 'sk-env-fallback';

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('sk-env-fallback');
  });

  it('解密失败且 env 也未配置 → null', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([row()]);
    decryptMock.mockImplementation(() => {
      throw new Error('bad key');
    });

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBeNull();
  });

  it('未配置 AIConfig (空数组) → 回退 env', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([]);
    process.env.DEEPSEEK_API_KEY = 'sk-env-only';

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('sk-env-only');
    expect(decryptMock).not.toHaveBeenCalled();
  });

  it('AIConfig 与 env 都未配置 → null', async () => {
    prismaMock.aIConfig.findMany.mockResolvedValue([]);

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBeNull();
  });

  it('AIConfig 查询本身抛错 (db down) → 回退 env, 不向上抛异常', async () => {
    prismaMock.aIConfig.findMany.mockRejectedValue(new Error('connection refused'));
    process.env.DEEPSEEK_API_KEY = 'sk-env-db-down';

    const out = await resolveDeepSeekApiKey('u1');

    expect(out).toBe('sk-env-db-down');
  });
});
