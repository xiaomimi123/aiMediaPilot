import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findUnique: vi.fn() },
  scriptDraft: { findUnique: vi.fn() },
  videoProduction: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

vi.mock('node:fs/promises', () => ({
  default: { mkdir: vi.fn(async () => undefined) },
  mkdir: vi.fn(async () => undefined),
}));

import { POST } from '@/app/api/v1/cockpit/video-productions/route';
import { GET as GET_ONE } from '@/app/api/v1/cockpit/video-productions/[id]/route';
import { GET as GET_LATEST } from '@/app/api/v1/cockpit/video-productions/latest/route';
import { POST as POST_APPROVE } from '@/app/api/v1/cockpit/video-productions/[id]/approve/route';

function req(url: string, body?: unknown): Request {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const SIX_ACT_SCRIPT = {
  four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
  acts: [
    { act: 'hook', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 3, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
    { act: 'concept_a', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 5, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
    { act: 'concept_b', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 5, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
    { act: 'trivia', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 3, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
    { act: 'synthesis', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 5, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
    { act: 'punchline', title: 't', narration: '0123456789', visual: 'v', note: 'n', targetSec: 2, beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }], facts: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/v1/cockpit/video-productions', () => {
  it('内容没有关联 scriptDraft → 400', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'user1',
      scriptDraftId: null,
      script: {},
    });
    const res = await POST(req('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('关联的 scriptDraft 不是六幕形态 → 400', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'user1',
      scriptDraftId: 'sd1',
      script: {},
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({
      id: 'sd1',
      output: { script: { sections: [] } },
    });
    const res = await POST(req('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('关联的 scriptDraft 有六幕脚本 → 200, create 被调用, 队列 mode:preview', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'user1',
      scriptDraftId: 'sd1',
      script: {},
    });
    // 真实落库形状 (见 scripts/generate/route.ts douyin 分支): acts 包在 script.{acts} 里,
    // four_dims 在顶层——与前端抽屉懒加载复用同一份 parseDraftOutput 解析。
    prismaMock.scriptDraft.findUnique.mockResolvedValue({
      id: 'sd1',
      output: { script: { acts: SIX_ACT_SCRIPT.acts }, four_dims: SIX_ACT_SCRIPT.four_dims },
    });
    prismaMock.videoProduction.create.mockResolvedValue({ id: 'vp1', status: 'queued' });
    queueMock.add.mockResolvedValue({ id: 'job-1' });

    const res = await POST(req('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('queued');
    expect(prismaMock.videoProduction.create).toHaveBeenCalledTimes(1);
    expect(queueMock.add).toHaveBeenCalledWith(
      'produce',
      expect.objectContaining({ mode: 'preview' }),
    );
  });

  it('内容属于别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1',
      userId: 'other-user',
      scriptDraftId: 'sd1',
      script: {},
    });
    const res = await POST(req('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));
    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/cockpit/video-productions/[id]', () => {
  it('查到别人的记录 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'other-user',
      status: 'preview_ready',
    });
    const res = await GET_ONE(req('http://t/api/v1/cockpit/video-productions/vp1'), {
      params: { id: 'vp1' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/cockpit/video-productions/latest', () => {
  it('查无记录 → ok({data:null}) 不是 404', async () => {
    prismaMock.videoProduction.findFirst.mockResolvedValue(null);
    const res = await GET_LATEST(req('http://t/api/v1/cockpit/video-productions/latest?contentId=c1'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();
  });
});

describe('POST /api/v1/cockpit/video-productions/[id]/approve', () => {
  it('status !== preview_ready → 400, 不入队', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      status: 'building',
    });
    const res = await POST_APPROVE(req('http://t/api/v1/cockpit/video-productions/vp1/approve', {}), {
      params: { id: 'vp1' },
    });
    expect(res.status).toBe(400);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('status === preview_ready → 200, 状态转 approved, 队列 mode:master', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1',
      userId: 'user1',
      status: 'preview_ready',
    });
    prismaMock.videoProduction.update.mockResolvedValue({ id: 'vp1', status: 'approved' });
    queueMock.add.mockResolvedValue({ id: 'job-2' });

    const res = await POST_APPROVE(req('http://t/api/v1/cockpit/video-productions/vp1/approve', {}), {
      params: { id: 'vp1' },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vp1' },
        data: expect.objectContaining({ status: 'approved' }),
      }),
    );
    expect(queueMock.add).toHaveBeenCalledWith(
      'produce',
      expect.objectContaining({ mode: 'master' }),
    );
  });
});
