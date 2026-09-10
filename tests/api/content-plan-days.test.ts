import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'sk-test') }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: () => llmMock }));

const prismaMock = vi.hoisted(() => ({
  contentPlan: {
    findUnique: vi.fn(),
  },
  contentPlanDay: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  scriptDraft: {
    findUnique: vi.fn(),
  },
  videoProduction: {
    findUnique: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { PATCH } from '@/app/api/v1/content-plans/[id]/days/[dayIndex]/route';
import { POST as REROLL } from '@/app/api/v1/content-plans/[id]/days/[dayIndex]/reroll/route';

const PLAN = {
  id: 'plan1',
  userId: 'user1',
  totalDays: 30,
  personaSnapshot: {
    audience: 'AI 知识小白',
    pillars: [{ name: 'AI 工具实操', description: '手把手教用 AI 工具' }],
    angle: '',
    avoid: '',
  },
};

function makeDay(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'day1',
    planId: 'plan1',
    dayIndex: 1,
    pillarName: 'AI 工具实操',
    topic: '原题',
    angle: '原角度',
    hookDirection: '原钩子',
    status: 'pending',
    scriptDraftId: null,
    videoProductionId: null,
    edited: false,
    ...overrides,
  };
}

function req(body: unknown): Request {
  return new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
}

function rerollReq(): Request {
  return new Request('http://x', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentPlan.findUnique.mockResolvedValue(PLAN);
  prismaMock.contentPlanDay.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...makeDay(),
    ...data,
  }));
});

describe('PATCH /api/v1/content-plans/[id]/days/[dayIndex] - edit', () => {
  it('pending 状态改 topic → 200 + edited=true', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));

    const res = await PATCH(req({ action: 'edit', topic: '新选题标题' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.contentPlanDay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'day1' },
        data: expect.objectContaining({ topic: '新选题标题', edited: true }),
      }),
    );
  });

  it('scripted 状态下 edit → 409', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'scripted' }));

    const res = await PATCH(req({ action: 'edit', topic: '新选题标题' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(409);
    expect(prismaMock.contentPlanDay.update).not.toHaveBeenCalled();
  });

  it('一个字段都不传 → 400', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));

    const res = await PATCH(req({ action: 'edit' }), { params: { id: 'plan1', dayIndex: '1' } });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/content-plans/[id]/days/[dayIndex] - mark-scripted', () => {
  it('归属校验: 他人稿子 → 404', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'draft1', userId: 'other-user' });

    const res = await PATCH(req({ action: 'mark-scripted', scriptDraftId: 'draft1' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(404);
    expect(prismaMock.contentPlanDay.update).not.toHaveBeenCalled();
  });

  it('归属校验通过 → pending 变 scripted', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'draft1', userId: 'user1' });

    const res = await PATCH(req({ action: 'mark-scripted', scriptDraftId: 'draft1' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.contentPlanDay.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'scripted', scriptDraftId: 'draft1' }) }),
    );
  });

  it('已是 scripted 且同一份稿子 → 幂等 200 不动', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(
      makeDay({ status: 'scripted', scriptDraftId: 'draft1' }),
    );

    const res = await PATCH(req({ action: 'mark-scripted', scriptDraftId: 'draft1' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.contentPlanDay.update).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.findUnique).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/content-plans/[id]/days/[dayIndex] - mark-produced', () => {
  it('pending 直接 mark-produced → 409(只准从 scripted 走)', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));

    const res = await PATCH(req({ action: 'mark-produced', videoProductionId: 'vp1' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(409);
    expect(prismaMock.contentPlanDay.update).not.toHaveBeenCalled();
  });

  it('scripted → mark-produced 成功', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'scripted', scriptDraftId: 'draft1' }));
    prismaMock.videoProduction.findUnique.mockResolvedValue({ id: 'vp1', userId: 'user1' });

    const res = await PATCH(req({ action: 'mark-produced', videoProductionId: 'vp1' }), {
      params: { id: 'plan1', dayIndex: '1' },
    });
    expect(res.status).toBe(200);
    expect(prismaMock.contentPlanDay.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'produced', videoProductionId: 'vp1' }) }),
    );
  });
});

describe('POST /api/v1/content-plans/[id]/days/[dayIndex]/reroll', () => {
  it('scripted 状态 → 409, 不调用 LLM', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'scripted' }));

    const res = await REROLL(rerollReq(), { params: { id: 'plan1', dayIndex: '1' } });
    expect(res.status).toBe(409);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('user message 含避开列表(本天原题 + 其余天的题目)', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending', topic: '原题A' }));
    prismaMock.contentPlanDay.findMany.mockResolvedValue([{ topic: '第2天的题' }, { topic: '第3天的题' }]);
    llmMock.callStructured.mockResolvedValue({
      result: { dayIndex: 1, pillarName: 'AI 工具实操', topic: '全新选题标题', angle: '全新差异化角度', hookDirection: '全新钩子方向' },
      usage: {},
    });

    const res = await REROLL(rerollReq(), { params: { id: 'plan1', dayIndex: '1' } });
    expect(res.status).toBe(200);

    const callArgs = llmMock.callStructured.mock.calls[0][0];
    const userMessageText = JSON.stringify(callArgs.userMessage);
    expect(userMessageText).toContain('原题A');
    expect(userMessageText).toContain('第2天的题');
    expect(userMessageText).toContain('第3天的题');

    expect(prismaMock.contentPlanDay.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          topic: '全新选题标题',
          angle: '全新差异化角度',
          hookDirection: '全新钩子方向',
          edited: true,
        }),
      }),
    );
  });

  it('LLM 失败 → 500, 不覆写原数据', async () => {
    prismaMock.contentPlanDay.findUnique.mockResolvedValue(makeDay({ status: 'pending' }));
    prismaMock.contentPlanDay.findMany.mockResolvedValue([]);
    llmMock.callStructured.mockRejectedValue(new Error('llm boom'));

    const res = await REROLL(rerollReq(), { params: { id: 'plan1', dayIndex: '1' } });
    expect(res.status).toBe(500);
    expect(prismaMock.contentPlanDay.update).not.toHaveBeenCalled();
  });
});
