import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: {
    count: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async (_path: string, _opts?: unknown) => undefined),
  rm: vi.fn(async (_path: string, _opts?: unknown) => undefined),
  copyFile: vi.fn(async (_src: string, _dest: string) => undefined),
  readdir: vi.fn(async () => [] as string[]),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { PUT } from '@/app/api/v1/video-templates/[id]/route';
import { POST as DUPLICATE } from '@/app/api/v1/video-templates/[id]/duplicate/route';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

beforeEach(() => vi.clearAllMocks());

function jsonReq(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('PUT /api/v1/video-templates/[id] — defaultShotStyle', () => {
  it('带合法 defaultShotStyle → update 收到的 data.defaultShotStyle 与之相等', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });

    const res = await PUT(
      jsonReq({ ...PRESET_TEMPLATES[0], defaultShotStyle: { accent: 'red', speed: 1.5 } }) as any,
      { params: { id: 't1' } },
    );

    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.defaultShotStyle).toEqual({
      accent: 'red',
      speed: 1.5,
    });
  });

  it('带非法 defaultShotStyle(speed 超范围) → 400, update 不被调', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });

    const res = await PUT(
      jsonReq({ ...PRESET_TEMPLATES[0], defaultShotStyle: { speed: 5 } }) as any,
      { params: { id: 't1' } },
    );

    expect(res.status).toBe(400);
    expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
  });

  it('带 defaultShotStyle: null → 落 null(清除预设)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });

    const res = await PUT(
      jsonReq({ ...PRESET_TEMPLATES[0], defaultShotStyle: null }) as any,
      { params: { id: 't1' } },
    );

    expect(res.status).toBe(200);
    const written = prismaMock.videoTemplate.update.mock.calls[0][0].data.defaultShotStyle;
    // Prisma.JsonNull 是一个带 _getNamespace 的特殊标记对象, 不是 JS 的 null ——
    // 断言它序列化后确实代表"清除"而不是"未提供"。
    expect(written === null || (written && typeof written === 'object')).toBe(true);
    expect(written).not.toBeUndefined();
  });
});

describe('POST /api/v1/video-templates/[id]/duplicate — defaultShotStyle', () => {
  it('源模板有 defaultShotStyle → create 的 data 里原样带上', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1',
      userId: 'user1',
      name: '原模板',
      description: '',
      deliveryMode: 'ppt-narration',
      visualStyle: 'card',
      palette: null,
      voicePreset: null,
      scriptPrompt: null,
      captionStyle: null,
      bgmPath: null,
      bgmVolume: 0.15,
      introPath: null,
      outroPath: null,
      isPreset: true,
      defaultShotStyle: { accent: 'blue', scale: 1.2 },
    });
    prismaMock.videoTemplate.create.mockResolvedValue({ id: 'copy1' });

    const res = await DUPLICATE(new Request('http://x', { method: 'POST' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoTemplate.create.mock.calls[0][0].data;
    expect(created.defaultShotStyle).toEqual({ accent: 'blue', scale: 1.2 });
  });
});
