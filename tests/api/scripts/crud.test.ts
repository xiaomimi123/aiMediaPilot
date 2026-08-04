import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  cockpitContent: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST as savePOST, GET as listGET } from '@/app/api/v1/scripts/route';
import { GET as itemGET, DELETE as itemDELETE, PATCH as itemPATCH } from '@/app/api/v1/scripts/[id]/route';

const validOutput = {
  hooks: [
    { text: '一一一一一', rationale: '理一二三四五' },
    { text: '二二二二二', rationale: '理二三四五六' },
    { text: '三三三三三', rationale: '理三四五六七' },
  ],
  retentionBeats: [
    { startSec: 0, endSec: 3, beat: '钩子开' },
    { startSec: 3, endSec: 60, beat: '内容主体' },
    { startSec: 60, endSec: 65, beat: 'CTA结尾' },
  ],
  titles: [
    { text: '标题一二三四五', hookType: '数字' },
    { text: '标题二三四五六', hookType: '反差' },
    { text: '标题三四五六七', hookType: '问题' },
  ],
  cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写镜头', colorTone: '白底红字' },
};

function reqJSON(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.create.mockResolvedValue({ id: 'draft1' });
  prismaMock.scriptDraft.findMany.mockResolvedValue([]);
  prismaMock.scriptDraft.findUnique.mockResolvedValue(null);
  prismaMock.scriptDraft.delete.mockResolvedValue({});
  prismaMock.scriptDraft.update.mockResolvedValue({});
  prismaMock.cockpitContent.findUnique.mockResolvedValue(null);
  prismaMock.cockpitContent.update.mockResolvedValue({});
});

describe('Scripts CRUD', () => {
  it('POST save → 200 + prisma.create', async () => {
    const res = await savePOST(
      reqJSON('http://t/api/v1/scripts', 'POST', { topic: '主题一', niche: 'ai-knowledge', output: validOutput }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('draft1');
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user1',
          topic: '主题一',
          niche: 'ai-knowledge',
        }),
      }),
    );
  });

  it('POST 带 cockpitContentId (归属自己) → cockpitContent.update 被调用', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce({ id: 'c1', userId: 'user1' });
    const res = await savePOST(
      reqJSON('http://t/api/v1/scripts', 'POST', {
        topic: '主题一',
        niche: 'ai-knowledge',
        output: validOutput,
        cockpitContentId: 'c1',
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { scriptDraftId: 'draft1' },
    });
  });

  it('POST 带 cockpitContentId 但归属别人 → 忽略, 不调用 update', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce({ id: 'c1', userId: 'other-user' });
    const res = await savePOST(
      reqJSON('http://t/api/v1/scripts', 'POST', {
        topic: '主题一',
        niche: 'ai-knowledge',
        output: validOutput,
        cockpitContentId: 'c1',
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('POST 不带 cockpitContentId → 不调用 cockpitContent.update', async () => {
    const res = await savePOST(
      reqJSON('http://t/api/v1/scripts', 'POST', { topic: '主题一', niche: 'ai-knowledge', output: validOutput }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('GET list → 数组, scope userId', async () => {
    prismaMock.scriptDraft.findMany.mockResolvedValueOnce([
      { id: 'a', topic: 't1', niche: 'ai-knowledge', createdAt: new Date() },
    ]);
    const res = await listGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1' },
      }),
    );
  });

  it('GET [id] 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'user1',
      topic: 't',
      niche: 'ai-knowledge',
      output: validOutput,
      createdAt: new Date(),
    });
    const res1 = await itemGET(new Request('http://t'), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res1.status).toBe(200);

    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'other-user',
      topic: 't',
      niche: 'ai-knowledge',
      output: validOutput,
      createdAt: new Date(),
    });
    const res2 = await itemGET(new Request('http://t'), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res2.status).toBe(404);
  });

  it('DELETE 自己的 → 200; 别人的 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({
      id: 'draft1',
      userId: 'user1',
    });
    const res1 = await itemDELETE(new Request('http://t', { method: 'DELETE' }), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res1.status).toBe(200);
    expect(prismaMock.scriptDraft.delete).toHaveBeenCalledWith({ where: { id: 'draft1' } });

    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'other' });
    const res2 = await itemDELETE(new Request('http://t', { method: 'DELETE' }), { params: Promise.resolve({ id: 'draft1' }) });
    expect(res2.status).toBe(404);
  });

  it('PATCH archived 自己的 → 200 + update 带 archivedAt; 别人的 → 404; body 非法 → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'user1' });
    const res1 = await itemPATCH(
      reqJSON('http://t/api/v1/scripts/draft1', 'PATCH', { archived: true }),
      { params: Promise.resolve({ id: 'draft1' }) },
    );
    expect(res1.status).toBe(200);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'draft1' },
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    );

    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce({ id: 'draft1', userId: 'other' });
    const res2 = await itemPATCH(
      reqJSON('http://t/api/v1/scripts/draft1', 'PATCH', { archived: true }),
      { params: Promise.resolve({ id: 'draft1' }) },
    );
    expect(res2.status).toBe(404);

    const res3 = await itemPATCH(
      reqJSON('http://t/api/v1/scripts/draft1', 'PATCH', { archived: 'yes' }),
      { params: Promise.resolve({ id: 'draft1' }) },
    );
    expect(res3.status).toBe(400);
  });
});
