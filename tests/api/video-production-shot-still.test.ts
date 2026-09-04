import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 三十一期 Task 3: 剪辑台的 renderStill 卡面图接口。
 *
 * 路由层只测鉴权/越界/404 分支——真渲染 + 缓存命中 + 孤儿清理已经在
 * `tests/lib/video-production/shot-still-cache.test.ts` 里用真渲染测过一遍,
 * 这里 mock 掉 `ensureShotStill` 避免路由测试也要真的跑一次 Remotion。
 */

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findUnique: vi.fn() },
  videoTemplate: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const ensureShotStillMock = vi.hoisted(() => vi.fn(async (opts: any) => ({
  filePath: `/tmp/fake-${opts.shotIndex}.png`,
  hit: false,
})));
vi.mock('@/lib/video-production/shot-still-cache', () => ({
  ensureShotStill: ensureShotStillMock,
  stillCacheFileName: vi.fn(() => 'fake.png'),
}));

const readFileMock = vi.hoisted(() => vi.fn(async () => Buffer.from('fake-png-bytes')));
vi.mock('node:fs/promises', () => {
  const m = { readFile: readFileMock };
  return { default: m, ...m };
});

import { GET } from '@/app/api/v1/cockpit/video-productions/[id]/shot-still/[shotIndex]/route';

function statementShot(shotId: string, startMs: number, endMs: number) {
  return { shotId, startMs, endMs, card: 'statement' as const, slots: { text: `第${shotId}镜` } };
}

function baseVp(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'vp1',
    userId: 'user1',
    mode: 'ppt-narration',
    templateId: null,
    productionRoot: '/tmp/vp1',
    status: 'plan_ready',
    filmPlan: { shots: [statementShot('s1', 0, 3000), statementShot('s2', 3000, 6000)] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readFileMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
  ensureShotStillMock.mockImplementation(async (opts: any) => ({
    filePath: `/tmp/fake-${opts.shotIndex}.png`,
    hit: false,
  }));
  prismaMock.videoTemplate.findUnique.mockResolvedValue(null);
});

describe('GET /api/v1/cockpit/video-productions/[id]/shot-still/[shotIndex]', () => {
  it('正常返回 image/png, 且把该镜/aspect/visualStyle 传给 ensureShotStill', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(
      baseVp({ mode: 'illustration-tts', templateId: 't1' }),
    );
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', aspect: '9:16' });

    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(ensureShotStillMock).toHaveBeenCalledTimes(1);
    const call = ensureShotStillMock.mock.calls[0][0];
    expect(call.shotIndex).toBe(1);
    expect(call.shot.shotId).toBe('s2');
    expect(call.aspect).toBe('9:16');
    expect(call.visualStyle).toBe('illustration');
    expect(call.stillsDir).toBe('/tmp/vp1/stills');
  });

  it('不存在或不是自己的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), { params: { id: 'nope', shotIndex: '0' } });
    expect(res.status).toBe(404);
    expect(ensureShotStillMock).not.toHaveBeenCalled();
  });

  it('别人的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp({ userId: 'other' }));
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '0' } });
    expect(res.status).toBe(404);
  });

  it('filmPlan 为空 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp({ filmPlan: null }));
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '0' } });
    expect(res.status).toBe(404);
    expect(ensureShotStillMock).not.toHaveBeenCalled();
  });

  it('filmPlan.shots 是空数组(brollEnabled=false 的出镜链) → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp({ filmPlan: { shots: [] } }));
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '0' } });
    expect(res.status).toBe(404);
  });

  it('shotIndex 越界 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp());
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '2' } });
    expect(res.status).toBe(404);
    expect(ensureShotStillMock).not.toHaveBeenCalled();
  });

  it('shotIndex 不是纯数字(比如混了字母) → 404, 不会被 parseInt 静默截断放行', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp());
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '1abc' } });
    expect(res.status).toBe(404);
    expect(ensureShotStillMock).not.toHaveBeenCalled();
  });

  it('status 不限制——preview_ready 的任务也能看卡面', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(baseVp({ status: 'preview_ready' }));
    const res = await GET(new Request('http://x'), { params: { id: 'vp1', shotIndex: '0' } });
    expect(res.status).toBe(200);
  });
});
