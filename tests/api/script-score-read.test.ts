import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from '@/app/api/v1/cockpit/contents/[id]/script-score/route';
import { GET as LIST } from '@/app/api/v1/cockpit/script-scores/route';
import { scriptFingerprint } from '@/lib/cockpit/script-score';

const ACTS = [
  { act: 'hook', title: '钩子', narration: '先说清楚，我不卖课。', visual: '出镜正面', targetSec: 12 },
  { act: 'punchline', title: '收尾', narration: '你做电商也是一样的。', visual: '出镜正面', targetSec: 8 },
];

const SOFT = {
  fingerprint: scriptFingerprint(ACTS),
  dimensions: [
    { key: 'hookPower', label: '钩子力度', score: 12, max: 15, reason: 'a' },
    { key: 'gain', label: '获得感', score: 10, max: 12, reason: 'b' },
    { key: 'surprise', label: '意外感', score: 9, max: 12, reason: 'c' },
    { key: 'authenticity', label: '真实感', score: 8, max: 10, reason: 'd' },
    { key: 'pivotClarity', label: '关键转向', score: 7, max: 8, reason: 'e' },
    { key: 'punchline', label: '金句收束', score: 6, max: 8, reason: 'f' },
  ],
  topFixes: [],
  scoredAt: '2026-08-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({
    id: 'c1', userId: 'user1', scriptDraftId: 'd1', scriptScore: null,
  });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: { script: { acts: ACTS } } });
});

describe('GET script-score', () => {
  it('没跑过软指标也能拿到硬指标 —— 打开页面不该是空白', async () => {
    const res = await GET(new Request('http://x'), { params: { id: 'c1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.score.softScored).toBe(false);
    expect(body.data.score.max).toBe(35);
  });

  it('跑过就返回 100 分制', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'd1', scriptScore: SOFT,
    });
    const res = await GET(new Request('http://x'), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.data.score.max).toBe(100);
    expect(body.data.score.softStale).toBe(false);
  });

  it('没有稿子时返回 null 而不是报错 —— 大多数内容本来就还没写稿', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: null, scriptScore: null,
    });
    const res = await GET(new Request('http://x'), { params: { id: 'c1' } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.score).toBeNull();
  });

  it('别人的内容读不到', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other' });
    const res = await GET(new Request('http://x'), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
  });
});

describe('GET script-scores (批量)', () => {
  it('一次查完所有稿子, 不按内容条数发 N 次查询', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([
      { id: 'c1', scriptDraftId: 'd1', scriptScore: SOFT },
      { id: 'c2', scriptDraftId: 'd2', scriptScore: null },
      { id: 'c3', scriptDraftId: null, scriptScore: null },
    ]);
    prismaMock.scriptDraft.findMany.mockResolvedValue([
      { id: 'd1', output: { script: { acts: ACTS } } },
      { id: 'd2', output: { script: { acts: ACTS } } },
    ]);

    const res = await GET_LIST();
    const body = await res.json();

    expect(prismaMock.scriptDraft.findMany).toHaveBeenCalledTimes(1);
    expect(body.data.scores.c1).toMatchObject({ max: 100, softScored: true });
    expect(body.data.scores.c2).toMatchObject({ max: 35, softScored: false });
    // 没稿子的内容不出现在结果里 —— 前端据此不渲染徽章
    expect(body.data.scores.c3).toBeUndefined();
  });

  it('稿子结构不认识就跳过, 不要整个接口挂掉', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{ id: 'c1', scriptDraftId: 'd1', scriptScore: null }]);
    prismaMock.scriptDraft.findMany.mockResolvedValue([{ id: 'd1', output: { sections: [] } }]);
    const res = await GET_LIST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.scores).toEqual({});
  });
});

function GET_LIST() {
  return LIST(new Request('http://x'));
}
