import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WorkspaceState } from '@/lib/cockpit/model';

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  cockpitPrefs: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  cockpitContent: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitInspiration: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitStageEvent: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitReviewDay: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitLiveSession: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitScheduleObjectType: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitScheduleObject: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitGoalCycle: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  cockpitInsightRule: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  accountMetric: { findMany: vi.fn() },
  contentAnalysis: { findMany: vi.fn() },
  platformAccount: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  actualMetric: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET, PUT } from '@/app/api/v1/cockpit/workspace/route';

function req(body: unknown): Request {
  return new Request('http://t/api/v1/cockpit/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function emptyState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    schemaVersion: 16,
    designStyle: 'editorial',
    navigationOrder: ['inspirations', 'momentum', 'schedule', 'pipeline', 'goals', 'review'],
    profile: {
      creatorName: '测试创作者',
      dashboardTitle: '测试工作台',
      primaryPlatform: '小红书',
      contentFocus: '测试',
    },
    pageTitles: {
      inspirations: 'a', today: 'b', week: 'c', schedule: 'd',
      pipeline: 'e', goals: 'f', review: 'g', settings: 'h',
    },
    inspirationCards: [],
    contents: [],
    stageEvents: [],
    reviewDays: [],
    liveSessions: [],
    scheduleObjectTypes: [],
    scheduleObjects: [],
    stageColors: {
      inbox: '#1', topic: '#2', script: '#3', recording: '#4',
      editing: '#5', publishing: '#6', review: '#7', archived: '#8',
    },
    goal: {
      id: 'goal-default', objective: '', startDate: '', endDate: '', status: 'active',
      outputTarget: 0, quotas: [], followerStart: 0, followerTarget: 0,
      qualityMetric: 'views', qualityThreshold: 0, qualityTarget: 0,
    },
    goalHistory: [],
    followerSnapshots: [],
    insightRules: [],
    contentTypes: [],
    setupComplete: false,
    lastBackupAt: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 默认空库
  prismaMock.cockpitPrefs.findUnique.mockResolvedValue(null);
  prismaMock.cockpitContent.findMany.mockResolvedValue([]);
  prismaMock.cockpitInspiration.findMany.mockResolvedValue([]);
  prismaMock.cockpitStageEvent.findMany.mockResolvedValue([]);
  prismaMock.cockpitReviewDay.findMany.mockResolvedValue([]);
  prismaMock.cockpitLiveSession.findMany.mockResolvedValue([]);
  prismaMock.cockpitScheduleObjectType.findMany.mockResolvedValue([]);
  prismaMock.cockpitScheduleObject.findMany.mockResolvedValue([]);
  prismaMock.cockpitGoalCycle.findMany.mockResolvedValue([]);
  prismaMock.cockpitInsightRule.findMany.mockResolvedValue([]);
  prismaMock.accountMetric.findMany.mockResolvedValue([]);
  // extras 默认: 无绑定账号, 无 baseline, 无复盘
  prismaMock.contentAnalysis.findMany.mockResolvedValue([]);
  prismaMock.platformAccount.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.actualMetric.findMany.mockResolvedValue([]);
  // CAS claim: 默认没抢到行 (count 0)，各测试按需覆盖
  prismaMock.cockpitPrefs.updateMany.mockResolvedValue({ count: 0 });
  // $transaction 默认直接把 prismaMock 自身当 tx 传给回调
  prismaMock.$transaction.mockImplementation((cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock));
});

describe('GET /api/v1/cockpit/workspace', () => {
  it('空库 → 返回默认 state (schemaVersion 16, goal-default) + extras', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.state.schemaVersion).toBe(16);
    expect(json.data.state.goal.id).toBe('goal-default');
    expect(json.data.state.followerSnapshots).toEqual([]);
    expect(json.data.extras).toEqual({
      predictions: {},
      account: null,
      settings: { baselinePlays: null, retroMedian: null, retroCount: 0 },
    });
    expect(json.data.rev).toBe('1970-01-01T00:00:00.000Z');
  });

  it('三期 IA 演化: platform 字段 — contents 组装带出 platform', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{
      id: 'content1', userId: 'user1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A',
      platform: 'xiaohongshu', stage: 'inbox', publicationStatus: 'draft', priority: 'normal',
      tags: [], publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
      topic: {}, script: {}, recordingNotes: '', editingNotes: '', metrics: {}, review: {},
      scriptDraftId: null, analysisId: null, createdAt: 'c', updatedAt: 'u',
    }]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.contents[0].platform).toBe('xiaohongshu');
  });

  it("三期 IA 演化: platform 字段 — 存量行缺失 platform 时防御性回退 'douyin'", async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{
      id: 'content1', userId: 'user1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A',
      stage: 'inbox', publicationStatus: 'draft', priority: 'normal',
      tags: [], publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
      topic: {}, script: {}, recordingNotes: '', editingNotes: '', metrics: {}, review: {},
      scriptDraftId: null, analysisId: null, createdAt: 'c', updatedAt: 'u',
    }]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.contents[0].platform).toBe('douyin');
  });

  it('十期: intent 字段 — contents 组装带出 intent', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{
      id: 'content1', userId: 'user1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A',
      platform: 'douyin', intent: 'convert', stage: 'inbox', publicationStatus: 'draft', priority: 'normal',
      tags: [], publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
      topic: {}, script: {}, recordingNotes: '', editingNotes: '', metrics: {}, review: {},
      scriptDraftId: null, analysisId: null, createdAt: 'c', updatedAt: 'u',
    }]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.contents[0].intent).toBe('convert');
  });

  it("十期: intent 字段 — 存量行缺失 intent 时防御性回退 ''", async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{
      id: 'content1', userId: 'user1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A',
      platform: 'douyin', stage: 'inbox', publicationStatus: 'draft', priority: 'normal',
      tags: [], publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
      topic: {}, script: {}, recordingNotes: '', editingNotes: '', metrics: {}, review: {},
      scriptDraftId: null, analysisId: null, createdAt: 'c', updatedAt: 'u',
    }]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.contents[0].intent).toBe('');
  });

  it('六期 T2: scriptDraftId 只读下发 — contents 组装带出 scriptDraftId (供抽屉懒加载拉回改稿 UI)', async () => {
    prismaMock.cockpitContent.findMany.mockResolvedValue([{
      id: 'content1', userId: 'user1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A',
      platform: 'douyin', stage: 'script', publicationStatus: 'draft', priority: 'normal',
      tags: [], publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
      topic: {}, script: {}, recordingNotes: '', editingNotes: '', metrics: {}, review: {},
      scriptDraftId: 'draft1', analysisId: null, createdAt: 'c', updatedAt: 'u',
    }]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.contents[0].scriptDraftId).toBe('draft1');
    // analysisId 是服务端字段中前端暂不消费的那个, 继续剥掉
    expect(json.data.state.contents[0]).not.toHaveProperty('analysisId');
  });

  it('无绑定 PlatformAccount → extras.account 为 null', async () => {
    prismaMock.platformAccount.findFirst.mockResolvedValue(null);
    const res = await GET();
    const json = await res.json();
    expect(json.data.extras.account).toBeNull();
  });

  it('已绑定 PlatformAccount + 有 lastAutoSyncAt → extras.account 完整形状', async () => {
    prismaMock.platformAccount.findFirst.mockResolvedValue({
      nickname: '小林的账号',
      loginStatus: 'VALID',
      followerCount: 12345,
      lastSyncAt: new Date('2026-08-03T02:00:00.000Z'),
    });
    prismaMock.user.findUnique.mockImplementation(async ({ select }: { select: Record<string, boolean> }) => {
      if (select.lastAutoSyncAt) return { lastAutoSyncAt: new Date('2026-08-04T02:00:00.000Z') };
      if (select.baselinePlays) return { baselinePlays: 8000n };
      return null;
    });
    prismaMock.actualMetric.findMany.mockResolvedValue([
      { plays: 1000n }, { plays: 2000n }, { plays: 3000n },
    ]);

    const res = await GET();
    const json = await res.json();

    expect(json.data.extras.account).toEqual({
      nickname: '小林的账号',
      loginStatus: 'VALID',
      followerCount: 12345,
      lastSyncAt: '2026-08-03T02:00:00.000Z',
      lastAutoSyncAt: '2026-08-04T02:00:00.000Z',
    });
    expect(json.data.extras.settings).toEqual({
      baselinePlays: '8000',
      retroMedian: 2000,
      retroCount: 3,
    });
  });

  it('followerSnapshots 来自 accountMetric mock', async () => {
    prismaMock.accountMetric.findMany.mockResolvedValue([
      { id: 'am1', date: new Date('2026-08-01T00:00:00.000Z'), followerCount: 123 },
    ]);
    const res = await GET();
    const json = await res.json();
    expect(json.data.state.followerSnapshots).toEqual([
      { id: 'am1', date: '2026-08-01', followers: 123 },
    ]);
  });

  it('异常 → 500', async () => {
    prismaMock.cockpitPrefs.findUnique.mockRejectedValueOnce(new Error('db down'));
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toContain('加载失败');
  });
});

describe('PUT /api/v1/cockpit/workspace', () => {
  it('缺少 state 或 rev → 400', async () => {
    const res = await PUT(req({ rev: 'x' }));
    expect(res.status).toBe(400);
  });

  it('rev 不匹配 → 409, 不写任何表', async () => {
    prismaMock.cockpitPrefs.findUnique.mockResolvedValue({
      userId: 'user1', updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const res = await PUT(req({ state: emptyState(), rev: '2026-07-01T00:00:00.000Z' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toBe('conflict');
    expect(prismaMock.cockpitPrefs.upsert).not.toHaveBeenCalled();
    expect(prismaMock.cockpitContent.deleteMany).not.toHaveBeenCalled();
  });

  it('首次保存(无已有 prefs 行) → 跳过冲突检测, 正常写入', async () => {
    prismaMock.cockpitPrefs.findUnique.mockResolvedValue(null);
    prismaMock.cockpitPrefs.upsert.mockResolvedValue({
      userId: 'user1', updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    });
    const res = await PUT(req({ state: emptyState(), rev: 'anything-ignored' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rev).toBe('2026-08-04T00:00:00.000Z');
  });

  it('并发: 同一个 rev 连续 PUT 两次 → 第一次 CAS 抢到行 200, 第二次抢不到行 409 (compare-and-set)', async () => {
    prismaMock.cockpitPrefs.updateMany
      .mockResolvedValueOnce({ count: 1 }) // 第一次: updateMany 原子抢到行
      .mockResolvedValueOnce({ count: 0 }); // 第二次: 行的 updatedAt 已被第一次改变, 抢不到
    prismaMock.cockpitPrefs.upsert.mockResolvedValueOnce({
      userId: 'user1', updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    });
    // 第二次 count===0 时需要区分"首次保存"与"真冲突": findUnique 返回已存在的行 → 判定冲突
    prismaMock.cockpitPrefs.findUnique.mockResolvedValueOnce({
      userId: 'user1', updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    });

    const rev = '2026-08-01T00:00:00.000Z';
    const first = await PUT(req({ state: emptyState(), rev }));
    expect(first.status).toBe(200);

    const second = await PUT(req({ state: emptyState(), rev }));
    expect(second.status).toBe(409);
    // 抢不到行的一方不应该继续写任何实体表
    expect(prismaMock.cockpitContent.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('正常保存: 各表按预期 deleteMany + upsert, contents 不带 scriptDraftId/analysisId', async () => {
    prismaMock.cockpitPrefs.findUnique.mockResolvedValue({
      userId: 'user1', updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    prismaMock.cockpitPrefs.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.cockpitPrefs.upsert.mockResolvedValue({
      userId: 'user1', updatedAt: new Date('2026-08-04T00:00:00.000Z'),
    });

    const state = emptyState({
      inspirationCards: [{
        id: 'insp1', text: '灵感', createdAt: 'c', updatedAt: 'u', convertedContentIds: [],
      }],
      contents: [{
        id: 'content1', title: 'T', idea: 'I', contentType: 'ct', tier: 'A', platform: 'douyin', intent: 'trust', stage: 'inbox',
        publicationStatus: 'draft', priority: 'normal', tags: [], createdAt: 'c', updatedAt: 'u',
        publishedAt: '', xhsLink: '', coverCopy: '', publishCopy: '',
        topic: {
          audience: '', painPoint: '', pointOfView: '', commonAngle: '', contrastAngle: '',
          assets: '', minimumProduction: '',
          score: { audience: 0, pain: 0, scene: 0, demonstrable: 0, distribution: 0, efficiency: 0 },
        },
        script: { headline: '', hook: '', conclusion: '', body: '', example: '', ending: '' },
        recordingNotes: '', editingNotes: '',
        metrics: { views: 0, likes: 0, saves: 0, comments: 0, followerGain: 0, capturedAt: '' },
        review: { rating: 0, analysis: '', learnedRule: '', completedAt: '' },
      }],
      goal: {
        id: 'goal-active', objective: 'o', startDate: 's', endDate: 'e', status: 'active',
        outputTarget: 1, quotas: [], followerStart: 0, followerTarget: 0,
        qualityMetric: 'views', qualityThreshold: 0, qualityTarget: 0,
      },
      goalHistory: [{
        id: 'goal-archived', objective: 'old', startDate: 's', endDate: 'e', status: 'archived',
        outputTarget: 1, quotas: [], followerStart: 0, followerTarget: 0,
        qualityMetric: 'views', qualityThreshold: 0, qualityTarget: 0,
      }],
      followerSnapshots: [{ id: 'fs1', date: '2026-08-01', followers: 1 }],
    });

    const res = await PUT(req({ state, rev: '2026-08-01T00:00:00.000Z' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.rev).toBe('2026-08-04T00:00:00.000Z');

    // inspirationCards
    expect(prismaMock.cockpitInspiration.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', id: { notIn: ['insp1'] } },
    });
    expect(prismaMock.cockpitInspiration.upsert).toHaveBeenCalledTimes(1);

    // contents — 空表也要 deleteMany；且 upsert data 不含 scriptDraftId/analysisId
    expect(prismaMock.cockpitContent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', id: { notIn: ['content1'] } },
    });
    expect(prismaMock.cockpitContent.upsert).toHaveBeenCalledTimes(1);
    const contentUpsertArgs = prismaMock.cockpitContent.upsert.mock.calls[0][0];
    expect(contentUpsertArgs.update).not.toHaveProperty('scriptDraftId');
    expect(contentUpsertArgs.update).not.toHaveProperty('analysisId');
    expect(contentUpsertArgs.create).not.toHaveProperty('scriptDraftId');
    expect(contentUpsertArgs.create).not.toHaveProperty('analysisId');
    // 三期 IA 演化: platform 字段 — update/create 两个分支都要写入
    expect(contentUpsertArgs.update.platform).toBe('douyin');
    expect(contentUpsertArgs.create.platform).toBe('douyin');
    // 十期: intent 字段 — 与 platform 同属可写字段, update/create 两个分支都要写入
    expect(contentUpsertArgs.update.intent).toBe('trust');
    expect(contentUpsertArgs.create.intent).toBe('trust');

    // 空表 (stageEvents 等) 仍然要 deleteMany, 且不 upsert
    expect(prismaMock.cockpitStageEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', id: { notIn: [] } },
    });
    expect(prismaMock.cockpitStageEvent.upsert).not.toHaveBeenCalled();

    // goal + goalHistory 合并写入 CockpitGoalCycle
    expect(prismaMock.cockpitGoalCycle.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user1', id: { notIn: ['goal-active', 'goal-archived'] } },
    });
    expect(prismaMock.cockpitGoalCycle.upsert).toHaveBeenCalledTimes(2);

    // followerSnapshots 派生数据, 不落库
    expect(prismaMock.accountMetric.findMany).not.toHaveBeenCalled();

    // prefs upsert 最终发生
    expect(prismaMock.cockpitPrefs.upsert).toHaveBeenCalledTimes(1);
  });
});
