import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })) }));

const prismaMock = vi.hoisted(() => ({
  cockpitContent: { findUnique: vi.fn(), update: vi.fn() },
  scriptDraft: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'sk-test') }));

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: () => llmMock }));

import { POST } from '@/app/api/v1/cockpit/contents/[id]/script-score/route';
import { scriptFingerprint } from '@/lib/cockpit/script-score';

const ACTS = [
  { act: 'hook', title: '钩子', narration: '我靠给别人装开源项目赚到了第一笔钱。', visual: '出镜正面', targetSec: 12 },
  { act: 'punchline', title: '收尾', narration: '别猜，去测。', visual: '出镜正面', targetSec: 8 },
];

const MODEL_OUTPUT = {
  hookPower: { score: 15, reason: '开头有结果' },
  failureNarrative: { score: 8, reason: '踩坑一笔带过' },
  pivotClarity: { score: 10, reason: '转折干净' },
  resultCredibility: { score: 10, reason: '有验证动作' },
  punchline: { score: 8, reason: '收得住' },
  topFixes: ['把踩坑展开'],
};

function req() {
  return new Request('http://x', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.cockpitContent.findUnique.mockResolvedValue({
    id: 'c1',
    userId: 'user1',
    scriptDraftId: 'd1',
  });
  prismaMock.scriptDraft.findUnique.mockResolvedValue({
    id: 'd1',
    output: { script: { acts: ACTS } },
  });
  prismaMock.cockpitContent.update.mockResolvedValue({});
  llmMock.callStructured.mockResolvedValue({ result: MODEL_OUTPUT, usage: {} });
});

describe('POST script-score', () => {
  it('别人的内容打不了分', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'someone-else' });
    const res = await POST(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(404);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('没有稿子就不要浪费一次调用', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValue({ id: 'c1', userId: 'user1', scriptDraftId: null });
    const res = await POST(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('打完分把结果连同稿子指纹一起落库', async () => {
    const res = await POST(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(200);

    const written = prismaMock.cockpitContent.update.mock.calls[0][0].data.scriptScore;
    expect(written.fingerprint).toBe(scriptFingerprint(ACTS));
    expect(written.dimensions).toHaveLength(5);
    expect(written.topFixes).toEqual(['把踩坑展开']);
    expect(typeof written.scoredAt).toBe('string');
  });

  it('返回的是硬软合并后的完整评分', async () => {
    const res = await POST(req(), { params: { id: 'c1' } });
    const body = await res.json();
    expect(body.data.score.max).toBe(100);
    expect(body.data.score.softScored).toBe(true);
    expect(body.data.score.softStale).toBe(false);
    expect(body.data.score.dimensions).toHaveLength(9);
  });

  it('模型挂了不要把脏数据写进库', async () => {
    llmMock.callStructured.mockRejectedValue(new Error('boom'));
    const res = await POST(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(500);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('稿子不是六幕结构时明确报错, 而不是打一个没意义的分', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValue({ id: 'd1', output: { sections: [] } });
    const res = await POST(req(), { params: { id: 'c1' } });
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });
});
