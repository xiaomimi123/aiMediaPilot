import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'sk-test') }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: () => llmMock }));

const prismaMock = vi.hoisted(() => ({
  contentPlan: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
  contentPlanDay: {
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/persona/profile', () => ({
  loadPersonaProfile: vi.fn(),
}));
vi.mock('@/lib/persona/voice', () => ({
  loadCreatorVoice: vi.fn(async () => null),
}));

import { POST } from '@/app/api/v1/content-plans/generate/route';
import { loadPersonaProfile } from '@/lib/persona/profile';

const PROFILE = {
  audience: 'AI 知识小白',
  targetFans: '',
  pillars: [{ name: 'AI 工具实操', description: '手把手教用 AI 工具' }],
  angle: '',
  avoid: '',
  painPoints: [],
  offerings: [],
  productLogic: '',
  marketInsight: null,
  systemSummary: '',
};

function makeDay(dayIndex: number) {
  return {
    dayIndex,
    pillarName: 'AI 工具实操',
    topic: `选题 ${dayIndex}`,
    angle: `角度 ${dayIndex}`,
    hookDirection: `钩子方向 ${dayIndex}`,
  };
}

function req(body: unknown): Request {
  return new Request('http://x/api/v1/content-plans/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadPersonaProfile).mockResolvedValue(PROFILE as any);
  prismaMock.contentPlan.findFirst.mockResolvedValue(null);
  prismaMock.contentPlan.create.mockResolvedValue({ id: 'plan1' });
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
});

describe('POST /api/v1/content-plans/generate', () => {
  it('pillars 空 → 400, 不调用 LLM', async () => {
    vi.mocked(loadPersonaProfile).mockResolvedValue(null);
    const res = await POST(req({ weeklyCadence: 3 }));
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('LLM 只返回 29 条 → 500, 不落库(不接受部分成功)', async () => {
    llmMock.callStructured.mockResolvedValue({
      result: { days: Array.from({ length: 29 }, (_, i) => makeDay(i + 1)) },
      usage: {},
    });
    const res = await POST(req({ weeklyCadence: 3 }));
    expect(res.status).toBe(500);
    expect(prismaMock.contentPlan.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('30 条合法 + 已有 active 规划 → transaction 内先归档旧规划再建新的', async () => {
    llmMock.callStructured.mockResolvedValue({
      result: { days: Array.from({ length: 30 }, (_, i) => makeDay(i + 1)) },
      usage: {},
    });
    prismaMock.contentPlan.findFirst.mockResolvedValue({ id: 'old-plan' });

    const res = await POST(req({ weeklyCadence: 3, startDate: '2026-09-10' }));
    expect(res.status).toBe(200);

    expect(prismaMock.contentPlan.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1', status: 'active' },
        data: expect.objectContaining({ status: 'archived' }),
      }),
    );
    expect(prismaMock.contentPlan.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.contentPlanDay.createMany).toHaveBeenCalledTimes(1);
    const createdDays = prismaMock.contentPlanDay.createMany.mock.calls[0][0].data;
    expect(createdDays).toHaveLength(30);

    const json = await res.json();
    expect(json.data.planId).toBe('plan1');
  });

  it('没有已有 active 规划时不调用归档', async () => {
    llmMock.callStructured.mockResolvedValue({
      result: { days: Array.from({ length: 30 }, (_, i) => makeDay(i + 1)) },
      usage: {},
    });
    prismaMock.contentPlan.findFirst.mockResolvedValue(null);

    const res = await POST(req({ weeklyCadence: 3 }));
    expect(res.status).toBe(200);
    expect(prismaMock.contentPlan.updateMany).not.toHaveBeenCalled();
  });
});
