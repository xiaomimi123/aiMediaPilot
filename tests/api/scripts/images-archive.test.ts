import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    findUnique: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const readFileMock = vi.hoisted(() => vi.fn());
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, readFile: readFileMock };
});

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

import { GET } from '@/app/api/v1/scripts/[id]/images/archive/route';

function reqGET(url = 'http://t/api/v1/scripts/draft1/images/archive') {
  return new Request(url, { method: 'GET' });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

const titles = [{ text: '✨打工人秒变效率怪', hookType: '数字' }];
const intro = '你是不是也经常写完稿子还要来回改？今天分享几个小技巧, 帮你一次搞定小红书图文笔记。';
const body =
  '第一步, 先明确你的目标受众是谁。第二步, 用一个具体场景开头, 让读者有代入感。**第三步, 把干货浓缩成 3 条以内的清单**, 太多读者记不住。';
const tags = ['AI效率', '小红书运营'];

const images = {
  0: { path: '/generated/draft1/0.png', prompt: 'p0', createdAt: '2026-08-14T00:00:00.000Z' },
  1: { path: '/generated/draft1/1.png', prompt: 'p1', createdAt: '2026-08-14T00:00:00.000Z' },
};

function baseXhsDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    topic: '效率工具测评',
    platform: 'xiaohongshu',
    output: { titles, intro, body, tags, images },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue(baseXhsDraft());
  readFileMock.mockImplementation(async (p: unknown) => {
    if (String(p).endsWith('0.png')) return Buffer.from('fake-png-0');
    if (String(p).endsWith('1.png')) return Buffer.from('fake-png-1');
    throw new Error('ENOENT: no such file');
  });
});

describe('GET /api/v1/scripts/[id]/images/archive — 成功', () => {
  it('返回 zip 二进制: 含所有 png + note.txt, headers 正确', async () => {
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    const cd = res.headers.get('Content-Disposition');
    expect(cd).toContain('attachment');
    expect(cd).toContain("filename*=UTF-8''");
    expect(cd).toContain(encodeURIComponent('效率工具测评-发布包.zip'));

    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(['0.png', '1.png', 'note.txt']);

    const png0 = await zip.file('0.png')!.async('nodebuffer');
    expect(png0.toString()).toBe('fake-png-0');
    const png1 = await zip.file('1.png')!.async('nodebuffer');
    expect(png1.toString()).toBe('fake-png-1');

    const note = await zip.file('note.txt')!.async('string');
    expect(note).toBe(`${titles[0].text}\n\n${intro}\n\n${body}\n\n#AI效率 #小红书运营`);
  });
});

describe('GET /api/v1/scripts/[id]/images/archive — 部分缺失', () => {
  it('单张文件缺失: 跳过该张, 其余照常打包, console.warn 记录', async () => {
    readFileMock.mockImplementation(async (p: unknown) => {
      if (String(p).endsWith('0.png')) return Buffer.from('fake-png-0');
      throw new Error('ENOENT: no such file');
    });
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(['0.png', 'note.txt']);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('全部文件缺失 → 400', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file'));
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe('GET /api/v1/scripts/[id]/images/archive — 校验', () => {
  it('脚本不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ userId: 'other' }));
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(404);
  });

  it('非小红书平台 → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ platform: 'douyin' }));
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(400);
  });

  it('output 没有 images (未出图) → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { titles, intro, body, tags } }),
    );
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(400);
  });

  it('output.images 为空对象 → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { titles, intro, body, tags, images: {} } }),
    );
    const res = await GET(reqGET(), ctx);
    expect(res.status).toBe(400);
  });
});
