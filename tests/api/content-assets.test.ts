import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findUnique: vi.fn() },
  contentAsset: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

// 显式标注参数类型 —— 否则 vi.fn(async () => ...) 推出的调用记录是空元组 `[]`,
// 读 calls[0][0] 在本项目 strict tsconfig 下过不了 tsc(同 packaging.test.ts 先例)
const fsMock = vi.hoisted(() => ({
  mkdir: vi.fn(async (_p: string, _o?: unknown) => undefined),
  writeFile: vi.fn(async (_p: string, _d?: unknown) => undefined),
  rm: vi.fn(async (_p: string, _o?: unknown) => undefined),
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));

import { POST, GET } from '@/app/api/v1/cockpit/contents/[id]/assets/route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1' });
  prismaMock.contentAsset.create.mockImplementation(async ({ data }: never) => data);
  prismaMock.contentAsset.findMany.mockResolvedValue([]);
});

function imageReq(description: string, fileName = 'shot.png'): Request {
  const fd = new FormData();
  fd.append('kind', 'image');
  fd.append('description', description);
  fd.append('file', new Blob([new Uint8Array(500)], { type: 'image/png' }), fileName);
  return new Request('http://x', { method: 'POST', body: fd });
}

function textReq(kind: 'table' | 'text', description: string, text: string): Request {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('description', description);
  fd.append('text', text);
  return new Request('http://x', { method: 'POST', body: fd });
}

describe('POST /api/v1/cockpit/contents/[id]/assets', () => {
  it('上传截图 → 落盘并入库, 带上描述', async () => {
    const res = await POST(imageReq('DeepSeek 官方定价页') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect(fsMock.writeFile).toHaveBeenCalledTimes(1);
    const data = prismaMock.contentAsset.create.mock.calls[0][0].data;
    expect(data.kind).toBe('image');
    expect(data.description).toBe('DeepSeek 官方定价页');
    expect(data.contentId).toBe('c1');
  });

  it('描述是必填 —— 没有它 Builder 无从判断该在哪一镜用', async () => {
    const res = await POST(imageReq('') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.contentAsset.create).not.toHaveBeenCalled();
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('表格素材存文本, 不落文件', async () => {
    const res = await POST(textReq('table', '价格对比', '模型\t价格\nV4\t2元') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(200);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
    expect(prismaMock.contentAsset.create.mock.calls[0][0].data.text).toContain('V4');
  });

  it('长文素材同样存文本', async () => {
    await POST(textReq('text', '课程目录', '第一章\n第二章') as never, { params: { id: 'c1' } });
    expect(prismaMock.contentAsset.create.mock.calls[0][0].data.kind).toBe('text');
  });

  it('文字类素材内容为空 → 400', async () => {
    const res = await POST(textReq('table', '空表格', '   ') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(400);
  });

  it('非法 kind → 400', async () => {
    const fd = new FormData();
    fd.append('kind', 'video');
    fd.append('description', 'x');
    const res = await POST(new Request('http://x', { method: 'POST', body: fd }) as never, { params: { id: 'c1' } });
    expect(res.status).toBe(400);
  });

  it('非图片格式传到 image 位 → 400', async () => {
    const fd = new FormData();
    fd.append('kind', 'image');
    fd.append('description', 'x');
    fd.append('file', new Blob([new Uint8Array(100)], { type: 'application/pdf' }), 'a.pdf');
    const res = await POST(new Request('http://x', { method: 'POST', body: fd }) as never, { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it('内容归属别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other' });
    const res = await POST(imageReq('x') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });

  it('恶意文件名不会拼出越权路径', async () => {
    await POST(imageReq('x', '../../etc/passwd.png') as never, { params: { id: 'c1' } });
    const written = fsMock.writeFile.mock.calls[0][0] as string;
    expect(written).not.toContain('..');
    expect(written).toContain('c1');
  });
});

describe('GET /api/v1/cockpit/contents/[id]/assets', () => {
  it('列出该内容的素材', async () => {
    prismaMock.contentAsset.findMany.mockResolvedValue([
      { id: 'a1', kind: 'image', description: '定价页', fileName: 'a.png', text: null },
    ]);
    const res = await GET(new Request('http://x') as never, { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.data.assets).toHaveLength(1);
    expect(prismaMock.contentAsset.findMany.mock.calls[0][0].where).toEqual({ userId: 'user1', contentId: 'c1' });
  });

  it('内容归属别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other' });
    const res = await GET(new Request('http://x') as never, { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });
});
