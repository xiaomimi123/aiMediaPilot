import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  videoTemplate: { findUnique: vi.fn() },
  cockpitContent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn(), create: vi.fn() },
  videoProduction: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('@/jobs/queue', () => ({ videoProductionQueue: queueMock }));

const bumpMock = vi.hoisted(() => ({ bumpCockpitRev: vi.fn(async () => undefined) }));
vi.mock('@/lib/cockpit/server-store', () => bumpMock);

vi.mock('fs/promises', () => {
  const m = { mkdir: vi.fn(async () => undefined) };
  return { default: m, ...m };
});

import { POST } from '@/app/api/v1/video-templates/[id]/produce/route';
// 一致性测试特意不 mock draft-restore —— 要证明 produce 路由自己写进
// scriptDraft.create 的 output 形状能被 worker 三处消费点唯一认的真实
// parseDraftOutput 解析出 acts/four_dims, 而不是靠一个跟 parseDraftOutput 判别口径
// 脱钩的假设自我证明。
import { parseDraftOutput } from '@/lib/cockpit/draft-restore';

const SIX_ACT = {
  acts: ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'].map((act) => ({
    act,
    title: `${act} 标题`,
    narration: `${act} 的台词内容, 足够长以通过校验。`,
    visual: '画面描述',
    note: '备注',
    targetSec: 15,
    beats: [{ keyword: 'k1' }, { keyword: 'k2' }, { keyword: 'k3' }],
    facts: [],
  })),
  four_dims: { gain: 'g', surprise: 's', clarity: 'c', appeal: 'a' },
};

// `ScriptDraft.output` 的真实落库形状(照抄 scripts/generate/route.ts:194 的嵌套约定:
// `script: { acts }` + 顶层 `four_dims`) —— `parseDraftOutput` 唯一认这个形状, 也是
// video-production-worker.ts 三处消费点(handleTalkingHeadBroll/handleIllustrationTts/
// loadNarrations)读六幕稿的唯一入口。Prisma 的 Json 列读回来是解析好的对象(不是
// JSON 字符串), mock 也必须是对象, 不能再套一层 JSON.stringify。
const NESTED_OUTPUT = { script: { acts: SIX_ACT.acts }, four_dims: SIX_ACT.four_dims };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.videoTemplate.findUnique.mockResolvedValue({
    id: 't1', userId: 'user1', deliveryMode: 'ppt-narration', voicePreset: null,
  });
  prismaMock.videoProduction.create.mockImplementation(async ({ data }: any) => data);
});

function req(body: unknown): Request {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/v1/video-templates/[id]/produce', () => {
  it('传 contentId 且该内容已有六幕定稿 → 直接建生成任务, 带上 templateId', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({
      id: 'c1', userId: 'user1', scriptDraftId: 'd1',
    });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: NESTED_OUTPUT });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const created = prismaMock.videoProduction.create.mock.calls[0][0].data;
    expect(created.templateId).toBe('t1');
    expect(created.contentId).toBe('c1');
    expect(created.mode).toBe('ppt-narration');
    expect(created.srt.length).toBeGreaterThan(0);
    // 非真人出镜模式立即入队
    expect(queueMock.add).toHaveBeenCalledTimes(1);
  });

  it('传 script(粘贴/灵感出稿) → 自动建内容卡并关联六幕稿', async () => {
    prismaMock.cockpitContent.create.mockResolvedValue({ id: 'newc1', userId: 'user1' });
    prismaMock.scriptDraft.create.mockResolvedValue({ id: 'newd1' });

    const res = await POST(req({ script: SIX_ACT, title: '我的新内容' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledTimes(1);
    // 建卡后必须关联 scriptDraftId, 否则 worker 找不到六幕稿
    expect(prismaMock.cockpitContent.update).toHaveBeenCalled();
    expect(prismaMock.cockpitContent.update.mock.calls[0][0].data.scriptDraftId).toBe('newd1');
    // 服务端直写 cockpit 数据必须 bump rev, 否则前端读脏缓存
    expect(bumpMock.bumpCockpitRev).toHaveBeenCalledWith('user1');
    // 新卡的 deliveryMode 跟随模板
    expect(prismaMock.cockpitContent.create.mock.calls[0][0].data.deliveryMode).toBe('ppt-narration');
  });

  it('真人出镜模板: 建任务但不立即入队(等上传视频后触发)', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({
      id: 't1', userId: 'user1', deliveryMode: 'talking-head-broll', voicePreset: null,
    });
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: 'd1' });
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: NESTED_OUTPUT });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    expect(prismaMock.videoProduction.create).toHaveBeenCalledTimes(1);
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('内容没有六幕定稿 → 400, 不建任务', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: null });

    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(400);
    expect(prismaMock.videoProduction.create).not.toHaveBeenCalled();
  });

  it('模板归属别的用户 → 404', async () => {
    prismaMock.videoTemplate.findUnique.mockResolvedValue({ id: 't1', userId: 'other' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('内容归属别的用户 → 404', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'other', scriptDraftId: 'd1' });
    const res = await POST(req({ contentId: 'c1' }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(404);
  });

  it('既没传 contentId 也没传 script → 400', async () => {
    const res = await POST(req({}) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  it('script 形状不是合法六幕 → 400', async () => {
    const res = await POST(req({ script: { acts: [] } }) as any, { params: { id: 't1' } });
    expect(res.status).toBe(400);
  });

  // 跨路径一致性回归测试(修复 review 指出的 parseDraftOutput 不兼容后新增):
  // 自动建卡分支写进 scriptDraft.create 的 output, 必须能被真实的(未 mock 的)
  // parseDraftOutput 解析出 acts/four_dims —— 这正是 worker 三处消费点读六幕稿的
  // 唯一入口。这个测试的价值在于它会对"写库形状"的回归失真:上一版把 output 写成
  // 扁平 `{ acts, four_dims }`(没有 script 包装层)时, 这里会真的失败(证据见
  // task-9-report.md 的 red→green 记录), 不是靠自我一致的假设通过。
  it('script(粘贴/灵感出稿) 建卡时写进 scriptDraft.create 的 output 能被真实 parseDraftOutput 解析出 acts/four_dims', async () => {
    prismaMock.cockpitContent.create.mockResolvedValue({ id: 'newc1', userId: 'user1' });
    prismaMock.scriptDraft.create.mockResolvedValue({ id: 'newd1' });

    const res = await POST(req({ script: SIX_ACT, title: '我的新内容' }) as any, { params: { id: 't1' } });

    expect(res.status).toBe(200);
    const writtenOutput = prismaMock.scriptDraft.create.mock.calls[0][0].data.output;
    const parsed = parseDraftOutput(writtenOutput);
    expect(parsed?.acts).toBeDefined();
    expect(parsed?.four_dims).toBeDefined();
    expect(parsed?.acts?.map((a) => a.act)).toEqual(SIX_ACT.acts.map((a) => a.act));
    expect(parsed?.four_dims).toEqual(SIX_ACT.four_dims);
  });
});
