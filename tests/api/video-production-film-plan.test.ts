import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 三十一期 Task 2: 剪辑台 FilmPlan 读写 API。
 *
 * mock prisma 照 `[id]/route.ts` 既有测试先例(见 video-production-renderer-default.test.ts)。
 * `probeVideoDurationMs` mock 照 `video-production-talking-head-broll-remotion.test.ts` 先例。
 */

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoProduction: { findUnique: vi.fn(), update: vi.fn() },
  videoTemplate: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const probeVideoDurationMsMock = vi.hoisted(() => vi.fn(async () => 20000));
vi.mock('@/lib/video/ffmpeg', () => ({ probeVideoDurationMs: probeVideoDurationMsMock }));

import { GET, PUT } from '@/app/api/v1/cockpit/video-productions/[id]/film-plan/route';

function putReq(body: unknown): Request {
  return new Request('http://x', { method: 'PUT', body: JSON.stringify(body) });
}

/** 一张最简单的合法 statement 分镜。 */
function statementShot(shotId: string, startMs: number, endMs: number) {
  return { shotId, startMs, endMs, card: 'statement' as const, slots: { text: `第${shotId}镜` } };
}

beforeEach(() => {
  vi.clearAllMocks();
  probeVideoDurationMsMock.mockResolvedValue(20000);
  prismaMock.videoTemplate.findUnique.mockResolvedValue(null);
  prismaMock.videoProduction.update.mockImplementation(async ({ data }: any) => ({ id: 'vp1', ...data }));
});

describe('GET /api/v1/cockpit/video-productions/[id]/film-plan', () => {
  it('正常返回 filmPlan + alignedActs + mode + visualStyle + aspect + totalMs', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', mode: 'illustration-tts', templateId: 't1', sourceVideoPath: null,
      filmPlan: { shots: [statementShot('s1', 0, 5000)] },
      alignedActs: [
        { act: 'hook', startMs: 0, endMs: 5000 },
        { act: 'concept_a', startMs: 5000, endMs: 5000 }, // 零时长, 没讲到
      ],
    });
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', aspect: '9:16', talkingHeadLayout: 'cutaway' });

    const res = await GET(new Request('http://x'), { params: { id: 'vp1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.mode).toBe('illustration-tts');
    expect(body.data.visualStyle).toBe('illustration');
    expect(body.data.aspect).toBe('9:16');
    expect(body.data.filmPlan.shots).toHaveLength(1);
    expect(body.data.alignedActs).toHaveLength(2);
    // 零时长窗口被过滤, 总时长取最后一个非零窗口的 endMs
    expect(body.data.totalMs).toBe(5000);
  });

  it('不存在或不是自己的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(null);
    const res = await GET(new Request('http://x'), { params: { id: 'nope' } });
    expect(res.status).toBe(404);
  });

  it('别人的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'other' });
    const res = await GET(new Request('http://x'), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/v1/cockpit/video-productions/[id]/film-plan —— ppt-narration/illustration-tts(铺满校验)', () => {
  function makeVp(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'vp1', userId: 'user1', mode: 'ppt-narration', status: 'plan_ready', templateId: null,
      sourceVideoPath: null,
      alignedActs: [
        { act: 'hook', startMs: 0, endMs: 5000 },
        { act: 'concept_a', startMs: 5000, endMs: 10000 },
      ],
      ...overrides,
    };
  }

  it('合法方案 → 200 且落库调用带 plan', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = { shots: [statementShot('s1', 0, 10000)] };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.update).toHaveBeenCalledTimes(1);
    const data = prismaMock.videoProduction.update.mock.calls[0][0].data;
    expect(data.filmPlan).toEqual(plan);
  });

  it('时间轴留空档 → 400 且错误文案含具体毫秒数(ppt 铺满校验生效)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    // 4000~5000 之间留了 1000 毫秒空档
    const plan = { shots: [statementShot('s1', 0, 4000), statementShot('s2', 5000, 10000)] };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.some((e: string) => e.includes('1000 毫秒'))).toBe(true);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('槽位塞 schema 外字段(color)→ 400(.strict() 拦)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    const plan = {
      shots: [{ shotId: 's1', startMs: 0, endMs: 10000, card: 'statement', slots: { text: '标题', color: 'red' } }],
    };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('非 plan_ready 状态 → 400, 不落库', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp({ status: 'building' }));
    const plan = { shots: [statementShot('s1', 0, 10000)] };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('别人的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp({ userId: 'other' }));
    const res = await PUT(putReq({ plan: { shots: [statementShot('s1', 0, 10000)] } }), { params: { id: 'vp1' } });
    expect(res.status).toBe(404);
  });
});

describe('PUT —— talking-head-broll 按 layout 选对校验器', () => {
  function makeVp(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'vp1', userId: 'user1', mode: 'talking-head-broll', status: 'plan_ready',
      templateId: 't1', sourceVideoPath: '/tmp/source.mp4',
      alignedActs: [
        { act: 'hook', startMs: 0, endMs: 5000 },
        { act: 'concept_a', startMs: 5000, endMs: 10000 },
      ],
      ...overrides,
    };
  }

  it('cutaway: 空档放行(不必铺满, 只要间隙 >= 1000ms)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', talkingHeadLayout: 'cutaway' });
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    probeVideoDurationMsMock.mockResolvedValue(20000);
    // s1: 0~2000, s2: 5000~8000 —— 中间 3000ms 空档(>=1000, 允许, 露出真人)
    const plan = { shots: [statementShot('s1', 0, 2000), statementShot('s2', 5000, 8000)] };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.update).toHaveBeenCalledTimes(1);
  });

  it('pip: windowed 校验生效 —— 幕内 1000ms 空档在 cutaway 语义下会放行, 在 pip 语义下必须报错', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', talkingHeadLayout: 'pip' });
    prismaMock.videoProduction.findUnique.mockResolvedValue(makeVp());
    probeVideoDurationMsMock.mockResolvedValue(20000);
    // 幕窗口 [0,5000) 内: s1 0~2000, s2 3000~5000 —— 2000~3000 之间 1000ms 空档。
    // 这个空档 >= BROLL_MIN_GAP_MS(1000), 按 checkBrollPlanTiming 的规则不会被拦;
    // 但 pip 用的是 checkFilmPlanTimingWindowed(幕内必须铺满), 必须报错——
    // 这条用例专门验证"选对了 windowed, 不是误选成了 broll"。
    const plan = {
      shots: [
        statementShot('s1', 0, 2000),
        statementShot('s2', 3000, 5000),
        statementShot('s3', 5000, 10000),
      ],
    };

    const res = await PUT(putReq({ plan }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors.some((e: string) => e.includes('毫秒'))).toBe(true);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });
});
