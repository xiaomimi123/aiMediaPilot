import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PUT } from '@/app/api/v1/scripts/[id]/acts/route';

const ACT = {
  act: 'hook',
  title: '钩子',
  narration: '原台词',
  visual: '出镜正面',
  note: '慢一点',
  targetSec: 12,
  beats: [{ keyword: 'a' }],
  facts: [],
};

const OUTPUT = {
  script: { acts: [ACT] },
  four_dims: { gain: 'g', appeal: 'a', clarity: 'c', surprise: 's' },
  durationSec: 90,
};

function req(body: unknown) {
  return new Request('http://x', { method: 'PUT', body: JSON.stringify(body) });
}
const ctx = { params: Promise.resolve({ id: 'd1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.scriptDraft.findUnique.mockResolvedValue({
    id: 'd1',
    userId: 'user1',
    output: JSON.parse(JSON.stringify(OUTPUT)),
  });
  prismaMock.scriptDraft.update.mockResolvedValue({});
});

describe('PUT /api/v1/scripts/[id]/acts', () => {
  it('别人的稿子改不了', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', userId: 'other', output: OUTPUT });
    const res = await PUT(req({ acts: [ACT] }), ctx);
    expect(res.status).toBe(404);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('保存后只有 acts 变, output 的其他部分原样保留', async () => {
    const edited = { ...ACT, narration: '改过的台词' };
    const res = await PUT(req({ acts: [edited] }), ctx);
    expect(res.status).toBe(200);
    const written = prismaMock.scriptDraft.update.mock.calls[0][0].data.output;
    expect(written.script.acts[0].narration).toBe('改过的台词');
    expect(written.four_dims).toEqual(OUTPUT.four_dims);
    expect(written.durationSec).toBe(90);
  });

  it('只接受白名单字段 —— 前端多塞的东西不写进库', async () => {
    const res = await PUT(req({ acts: [{ ...ACT, 评分: 99, __proto__hack: 1 }] }), ctx);
    expect(res.status).toBe(200);
    const saved = prismaMock.scriptDraft.update.mock.calls[0][0].data.output.script.acts[0];
    expect(Object.keys(saved).sort()).toEqual(
      ['act', 'beats', 'facts', 'narration', 'note', 'targetSec', 'title', 'visual'].sort(),
    );
  });

  it('非六幕结构的旧稿拒绝保存, 而不是把它改成六幕', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValue({
      id: 'd1', userId: 'user1', output: { sections: [] },
    });
    const res = await PUT(req({ acts: [ACT] }), ctx);
    expect(res.status).toBe(400);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('acts 不是数组 → 400', async () => {
    const res = await PUT(req({ acts: 'nope' }), ctx);
    expect(res.status).toBe(400);
  });

  it('幕名不在六幕里 → 400, 不悄悄丢掉', async () => {
    const res = await PUT(req({ acts: [{ ...ACT, act: 'intro' }] }), ctx);
    expect(res.status).toBe(400);
  });

  it('targetSec 是负数 → 400', async () => {
    const res = await PUT(req({ acts: [{ ...ACT, targetSec: -1 }] }), ctx);
    expect(res.status).toBe(400);
  });

  it('请求体不是 JSON → 400', async () => {
    const bad = new Request('http://x', { method: 'PUT', body: '{' });
    const res = await PUT(bad, ctx);
    expect(res.status).toBe(400);
  });

  it('返回保存后的 acts, 前端据此确认落库内容', async () => {
    const res = await PUT(req({ acts: [{ ...ACT, narration: 'x' }] }), ctx);
    const body = await res.json();
    expect(body.data.acts[0].narration).toBe('x');
    expect(typeof body.data.savedAt).toBe('string');
  });
});
