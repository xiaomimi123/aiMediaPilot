import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * 任务四: renderer 入口 —— API 默认值与面板切换。
 *
 * 覆盖两条创建路由的缺省规则(mode === 'ppt-narration' → 'remotion', 其它 → 'legacy',
 * 显式传值优先)与 `[id]/route.ts` 新增的 PATCH 切换(只在 canStartProduction 时允许,
 * 且必须同时清空 filmPlan/alignedActs)。
 */

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn(), create: vi.fn() },
  videoTemplate: { findUnique: vi.fn() },
  videoProduction: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

const bumpMock = vi.hoisted(() => ({ bumpCockpitRev: vi.fn(async () => undefined) }));
vi.mock('@/lib/cockpit/server-store', () => bumpMock);

vi.mock('node:fs/promises', () => {
  const m = { mkdir: vi.fn(async () => undefined) };
  return { default: m, ...m };
});
vi.mock('fs/promises', () => {
  const m = { mkdir: vi.fn(async () => undefined) };
  return { default: m, ...m };
});

import { Prisma } from '@prisma/client';
import { POST as POST_COCKPIT } from '@/app/api/v1/cockpit/video-productions/route';
import { POST as POST_PRODUCE } from '@/app/api/v1/video-templates/[id]/produce/route';
import { PATCH } from '@/app/api/v1/cockpit/video-productions/[id]/route';
import { defaultRendererForMode } from '@/lib/video-production/renderer';

const SIX_ACT_ACTS = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'].map((act) => ({
  act,
  title: `${act} 标题`,
  narration: `${act} 的台词内容, 足够长以通过校验。`,
  visual: '画面描述',
  note: '备注',
  targetSec: 15,
  beats: [{ keyword: 'k1' }, { keyword: 'k2' }, { keyword: 'k3' }],
  facts: [],
}));
const FOUR_DIMS = { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' };
const NESTED_OUTPUT = { script: { acts: SIX_ACT_ACTS }, four_dims: FOUR_DIMS };

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoProduction.create.mockImplementation(async ({ data }: any) => data);
});

describe('缺省规则单元 —— defaultRendererForMode', () => {
  it('ppt-narration → remotion', () => {
    expect(defaultRendererForMode('ppt-narration')).toBe('remotion');
  });
  it('talking-head-broll → legacy', () => {
    expect(defaultRendererForMode('talking-head-broll')).toBe('legacy');
  });
  it('illustration-tts → legacy', () => {
    expect(defaultRendererForMode('illustration-tts')).toBe('legacy');
  });
});

describe('POST /api/v1/cockpit/video-productions —— renderer 缺省与显式传值', () => {
  it('不传 renderer, deliveryMode 落到 ppt-narration(非 talking-head-broll/illustration-tts 的兜底)→ 建库 renderer 是 remotion', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'sd1', deliveryMode: 'douyin', script: {},
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'sd1', output: NESTED_OUTPUT });

    const res = await POST_COCKPIT(jsonReq('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.mode).toBe('ppt-narration');
    expect(created.renderer).toBe('remotion');
  });

  it('显式传 legacy —— 即便 mode 是 ppt-narration, 也要按用户说的来, 不被缺省规则覆盖', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'sd1', deliveryMode: 'douyin', script: {},
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'sd1', output: NESTED_OUTPUT });

    const res = await POST_COCKPIT(
      jsonReq('http://t/api/v1/cockpit/video-productions', { contentId: 'c1', renderer: 'legacy' }),
    );

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.mode).toBe('ppt-narration');
    expect(created.renderer).toBe('legacy');
  });

  it('deliveryMode=illustration-tts, 不传 renderer → 落库 legacy(这条链还没迁)', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'sd1', deliveryMode: 'illustration-tts', script: {},
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'sd1', output: NESTED_OUTPUT });

    const res = await POST_COCKPIT(jsonReq('http://t/api/v1/cockpit/video-productions', { contentId: 'c1' }));

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.mode).toBe('illustration-tts');
    expect(created.renderer).toBe('legacy');
  });

  it('renderer 传非法值 → 400, 不建库', async () => {
    const res = await POST_COCKPIT(
      jsonReq('http://t/api/v1/cockpit/video-productions', { contentId: 'c1', renderer: 'not-a-renderer' }),
    );
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/video-templates/[id]/produce —— renderer 缺省与显式传值', () => {
  function req(body: unknown): Request {
    return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
  }

  beforeEach(() => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'ppt-narration', voicePreset: null,
    });
  });

  it('模板 deliveryMode=ppt-narration, 不传 renderer → 落库 remotion', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: NESTED_OUTPUT });

    const res = await POST_PRODUCE(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.renderer).toBe('remotion');
  });

  it('模板 deliveryMode=talking-head-broll, 不传 renderer → 落库 legacy', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'talking-head-broll', voicePreset: null,
    });
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: NESTED_OUTPUT });

    const res = await POST_PRODUCE(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.renderer).toBe('legacy');
  });

  it('显式传 remotion —— 即便模板是 talking-head-broll, 也照用户说的来', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'talking-head-broll', voicePreset: null,
    });
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: NESTED_OUTPUT });

    const res = await POST_PRODUCE(
      req({ contentId: 'c1', renderer: 'remotion' }) as any,
      { params: { id: 't1' } },
    );

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.renderer).toBe('remotion');
  });

  it('renderer 传非法值 → 400, 不建库', async () => {
    const res = await POST_PRODUCE(req({ contentId: 'c1', renderer: 'nope' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/cockpit/video-productions/[id] —— 切换渲染方式', () => {
  function req(body: unknown): Request {
    return new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
  }

  it('可启动状态下切换 —— 同时把 filmPlan 和 alignedActs 置 null, 不是只改 renderer', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      // mode 必须在 REMOTION_READY_MODES 里, 否则会撞上复审补的"未迁移 mode 拒绝切
      // 到 remotion"那道新关(见下面单独一组测试)——这条测试关心的是切换成功之后的
      // 副作用清理, 不是这道新关, 所以显式给一个已迁移的 mode。
      id: 'vp1', userId: 'user1', status: 'queued', renderer: 'legacy', mode: 'ppt-narration',
    });
    prismaMock.videoProduction.update.mockResolvedValue({ id: 'vp1', renderer: 'remotion' });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    const data = prismaMock.videoProduction.update.mock.calls[0][0].data;
    expect(data.renderer).toBe('remotion');
    // Json? 字段清空要用 Prisma.JsonNull —— update 输入类型不接受裸 null(TS2322),
    // 这条任务的语义要求换渲染器后旧方案必须真的被抹掉, 不是维持原样。
    expect(data.filmPlan).toEqual(Prisma.JsonNull);
    expect(data.alignedActs).toEqual(Prisma.JsonNull);
    // productionNotice 是 String? 不是 Json?, 清空用裸 null 即可。终审修复轮的 scoped
    // 复审实测: 删掉路由里这行清空, 全部测试照常绿 —— 这条断言就是补那个洞的。
    // 不清的后果: 无声片的提醒会顶在切换后的新任务上, 有声片顶着「无声」提示比没提示更糟。
    expect(data.productionNotice).toBeNull();
  });

  it('复审(幂等): 传的 renderer 跟当前值一样 —— 直接返回, 不清 filmPlan/alignedActs, 不该有副作用', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'failed', renderer: 'remotion', filmPlan: { shots: [] },
    });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.renderer).toBe('remotion');
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('处理中的任务不许切换 → 400, 不调用 update', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'building', renderer: 'legacy',
    });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('已完成的任务不许切换 → 400', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'done', renderer: 'legacy',
    });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('renderer 传非法值 → 400, 不查库也不更新', async () => {
    const res = await PATCH(req({ renderer: 'nope' }), { params: { id: 'vp1' } });
    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.findUnique).not.toHaveBeenCalled();
  });

  it('别人的任务 → 404', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'other', status: 'queued', renderer: 'legacy',
    });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(404);
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  /*
   * 复审补(二十九期 Task 2 收尾): talking-head-broll 还没有对应的 Remotion handler
   * (worker dispatch 里的 REMOTION_READY_MODES 不含它)——切到 'remotion' 会让任务
   * 卡在没人接的分支, 界面却显示「新版渲染」的徽标, 对用户是可见的误导。这道关必须
   * 挡在真正切库之前。
   */
  it('mode 不在 REMOTION_READY_MODES 里(talking-head-broll)切到 remotion → 400, 不更新', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'queued', renderer: 'legacy', mode: 'talking-head-broll',
    });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe('该交付方式暂不支持新版渲染');
    expect(prismaMock.videoProduction.update).not.toHaveBeenCalled();
  });

  it('talking-head-broll 切回 legacy 不受限制(只有切到 remotion 才检查清单)', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'queued', renderer: 'remotion', mode: 'talking-head-broll',
    });
    prismaMock.videoProduction.update.mockResolvedValue({ id: 'vp1', renderer: 'legacy' });

    const res = await PATCH(req({ renderer: 'legacy' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.update).toHaveBeenCalled();
  });

  it('illustration-tts(已迁移)切到 remotion → 不被这道新关拦, 正常更新', async () => {
    prismaMock.videoProduction.findUnique.mockResolvedValue({
      id: 'vp1', userId: 'user1', status: 'queued', renderer: 'legacy', mode: 'illustration-tts',
    });
    prismaMock.videoProduction.update.mockResolvedValue({ id: 'vp1', renderer: 'remotion' });

    const res = await PATCH(req({ renderer: 'remotion' }), { params: { id: 'vp1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.update).toHaveBeenCalled();
  });
});
