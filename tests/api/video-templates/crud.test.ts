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

// 显式给会被 .mock.calls[0][0] 取用的 mock 标注参数类型 —— 否则 vi.fn(async () => undefined)
// 推出的调用记录是空元组 `[]`, 在本项目的 strict tsconfig 下过不了 tsc (同 packaging.test.ts 的教训)。
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async (_path: string, _opts?: unknown) => undefined),
  rm: vi.fn(async (_path: string, _opts?: unknown) => undefined),
  copyFile: vi.fn(async (_src: string, _dest: string) => undefined),
  readdir: vi.fn(async () => [] as string[]),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { GET, POST } from '@/app/api/v1/video-templates/route';
import { PUT, DELETE } from '@/app/api/v1/video-templates/[id]/route';
import { POST as DUPLICATE } from '@/app/api/v1/video-templates/[id]/duplicate/route';
import { PRESET_TEMPLATES } from '@/lib/video-template/model';

beforeEach(() => vi.clearAllMocks());

function jsonReq(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/v1/video-templates', () => {
  it('用户 0 条模板时播种 3 个预设', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(0);
    prismaMock.videoTemplate.findMany.mockResolvedValue([]);

    await GET();

    expect(prismaMock.videoTemplate.createMany).toHaveBeenCalledTimes(1);
    const seeded = prismaMock.videoTemplate.createMany.mock.calls[0][0].data;
    expect(seeded).toHaveLength(3);
    expect(seeded.every((t: any) => t.isPreset === true)).toBe(true);
    expect(seeded.every((t: any) => t.userId === 'user1')).toBe(true);
  });

  it('已有模板时不重复播种(幂等)', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(2);
    prismaMock.videoTemplate.findMany.mockResolvedValue([]);

    await GET();

    expect(prismaMock.videoTemplate.createMany).not.toHaveBeenCalled();
  });

  it('只返回当前用户的模板', async () => {
    prismaMock.videoTemplate.count.mockResolvedValue(1);
    prismaMock.videoTemplate.findMany.mockResolvedValue([{ id: 't1' }]);

    await GET();

    expect(prismaMock.videoTemplate.findMany.mock.calls[0][0].where).toEqual({ userId: 'user1' });
  });
});

describe('POST /api/v1/video-templates', () => {
  it('合法配置 → 创建成功', async () => {
    prismaMock.videoTemplate.create.mockResolvedValue({ id: 'new1' });
    const res = await POST(jsonReq({ ...PRESET_TEMPLATES[0], name: '我的模板' }));
    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.videoTemplate.create.mock.calls[0][0].data.isPreset).toBe(false);
  });

  it('非法交付模式 → 400, 不落库', async () => {
    const res = await POST(jsonReq({ ...PRESET_TEMPLATES[0], deliveryMode: 'manual' }));
    expect(res.status).toBe(400);
    expect(prismaMock.videoTemplate.create).not.toHaveBeenCalled();
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: 'not-json' }));
    expect(res.status).toBe(400);
  });

  // 终审发现4(防御性): 新建时模板 id 还没确定, templateAssetDir 前缀校验无从谈起——
  // 素材本来就只能通过 /assets 上传接口(先 POST 建模板拿到 id, 再传素材), 所以新建
  // 请求体里这三个字段必须是 null, 非 null 直接拒绝, 不做静默丢弃(静默丢弃会让调用方
  // 误以为素材已经生效)。
  it('新建时素材路径字段非 null → 400, 不落库', async () => {
    const res = await POST(jsonReq({ ...PRESET_TEMPLATES[0], bgmPath: 'video-templates/other/bgm.mp3' }));
    expect(res.status).toBe(400);
    expect(prismaMock.videoTemplate.create).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/video-templates/[id]', () => {
  it('归属别的用户 → 404, 不更新', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await PUT(jsonReq(PRESET_TEMPLATES[0]) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
  });

  it('预设模板同样可以改(isPreset 只是徽标)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1', isPreset: true });
    prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });
    const res = await PUT(jsonReq({ ...PRESET_TEMPLATES[0], name: '改过的' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.update.mock.calls[0][0].data.name).toBe('改过的');
  });

  // 终审发现4(防御性): bgmPath/introPath/outroPath 直接拼进 ffmpeg -i 参数, 必须落在
  // 该模板自己的素材目录下, 否则绕开 /assets 上传路由的 MIME 白名单/大小上限/safeExt 防护。
  describe('素材路径越权校验(终审发现4)', () => {
    it('三个素材路径都落在本模板素材目录前缀内 → 通过', async () => {
      prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
      prismaMock.videoTemplate.update.mockResolvedValue({ id: 't1' });
      const res = await PUT(jsonReq({
        ...PRESET_TEMPLATES[0],
        bgmPath: 'video-templates/t1/bgm.mp3',
        introPath: 'video-templates/t1/intro.mp4',
        outroPath: 'video-templates/t1/outro.mp4',
      }) as any, { params: { id: 't1' } });
      expect(res.status).toBe(200);
      expect(prismaMock.videoTemplate.update).toHaveBeenCalledTimes(1);
    });

    it('bgmPath 指向别的模板目录 → 400, 不落库', async () => {
      prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
      const res = await PUT(jsonReq({
        ...PRESET_TEMPLATES[0],
        bgmPath: 'video-templates/t2/bgm.mp3',
      }) as any, { params: { id: 't1' } });
      expect(res.status).toBe(400);
      expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
    });

    it('introPath 指向任意文件系统路径(如 /etc/passwd) → 400, 不落库', async () => {
      prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
      const res = await PUT(jsonReq({
        ...PRESET_TEMPLATES[0],
        introPath: '/etc/passwd',
      }) as any, { params: { id: 't1' } });
      expect(res.status).toBe(400);
      expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
    });

    it('目录名前缀碰撞(t1 vs t12)不能被越权 —— t12 的路径不能通过 t1 的校验', async () => {
      prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
      const res = await PUT(jsonReq({
        ...PRESET_TEMPLATES[0],
        outroPath: 'video-templates/t12/outro.mp4',
      }) as any, { params: { id: 't1' } });
      expect(res.status).toBe(400);
      expect(prismaMock.videoTemplate.update).not.toHaveBeenCalled();
    });
  });
});

describe('DELETE /api/v1/video-templates/[id]', () => {
  it('删除模板同时清理素材目录', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'user1' });
    prismaMock.videoTemplate.delete.mockResolvedValue({ id: 't1' });

    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoTemplate.delete).toHaveBeenCalledTimes(1);
    expect(fsMock.rm).toHaveBeenCalledTimes(1);
    expect(fsMock.rm.mock.calls[0][0]).toContain('t1');
  });

  it('归属别的用户 → 404, 不删除也不动文件', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
    expect(prismaMock.videoTemplate.delete).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/video-templates/[id]/duplicate', () => {
  it('复制素材文件本体到新模板目录, 而不是共用路径', async () => {
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
      bgmPath: '/templates/t1/bgm.mp3',
      bgmVolume: 0.15,
      introPath: null,
      outroPath: null,
      isPreset: true,
    });
    prismaMock.videoTemplate.create.mockResolvedValue({ id: 'copy1' });

    const res = await DUPLICATE(new Request('http://x', { method: 'POST' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    const created = prismaMock.videoTemplate.create.mock.calls[0][0].data;
    // 新模板的 bgmPath 必须指向自己的目录, 不能还指着 t1
    expect(created.bgmPath).not.toBe('/templates/t1/bgm.mp3');
    expect(created.bgmPath).toContain(created.id);
    // 副本不是预设
    expect(created.isPreset).toBe(false);
    expect(created.name).toContain('原模板');
  });
});
