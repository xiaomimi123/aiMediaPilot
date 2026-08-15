import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/user', () => ({ getOrCreateDefaultUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: { creatorVoice: { upsert: vi.fn(), update: vi.fn() }, creatorExperience: { create: vi.fn() } },
}));
vi.mock('@/lib/llm/resolve-key', () => ({ resolveDeepSeekApiKey: vi.fn(async () => 'sk-test') }));
const callStructured = vi.fn();
vi.mock('@/lib/llm/clients', () => ({ getDeepSeekTextLLM: vi.fn(() => ({ callStructured })) }));

const { prisma } = await import('@/lib/prisma');
const { resolveDeepSeekApiKey } = await import('@/lib/llm/resolve-key');
const { POST } = await import('@/app/api/v1/voice/draft/route');

const DRAFT = {
  origin: '三年前被裁之后开始用 AI 自救, 第一次靠它接到活儿的那天决定把过程讲出来',
  identity: '一个靠 AI 提高认知的普通人',
  notIdentity: '不是技术极客, 也不是专业程序员',
  stances: [{ claim: '提示词工程是伪需求', reason: '模型进步会抹平技巧差异' }],
  energy: '自信、有感染力',
  experienceCandidates: ['上周用某工具做小红书封面, 连续翻车三次才发现是尺寸参数问题'],
};

function req(body: unknown) {
  return new Request('http://localhost/api/v1/voice/draft', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const answers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ q: `问题${i + 1}`, a: `回答${i + 1}` }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveDeepSeekApiKey).mockResolvedValue('sk-test');
  callStructured.mockResolvedValue({ result: DRAFT, usage: {} });
});

describe('POST /api/v1/voice/draft', () => {
  it('6 问正常 → 返回 draft 且**不落库**', async () => {
    const json = await (await POST(req({ answers: answers(6) }))).json();
    expect(json.success).toBe(true);
    expect(json.data.draft.identity).toBe(DRAFT.identity);
    expect(json.data.draft.experienceCandidates).toHaveLength(1);
    // 起草不落库 —— 人物志与经历都不写
    expect(prisma.creatorVoice.upsert).not.toHaveBeenCalled();
    expect(prisma.creatorVoice.update).not.toHaveBeenCalled();
    expect(prisma.creatorExperience.create).not.toHaveBeenCalled();
  });

  it('answers 7 条 → 400', async () => {
    const res = await POST(req({ answers: answers(7) }));
    expect(res.status).toBe(400);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it('answers 空数组 → 400', async () => {
    expect((await POST(req({ answers: [] }))).status).toBe(400);
  });

  it('非法 JSON → 400', async () => {
    expect((await POST(req('{bad'))).status).toBe(400);
  });

  it('无 DeepSeek key → 503', async () => {
    vi.mocked(resolveDeepSeekApiKey).mockResolvedValue(null);
    const res = await POST(req({ answers: answers(3) }));
    expect(res.status).toBe(503);
    expect(callStructured).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 500', async () => {
    callStructured.mockRejectedValue(new Error('boom'));
    const res = await POST(req({ answers: answers(3) }));
    expect(res.status).toBe(500);
  });

  it('未作答的问题以「(未作答)」进 prompt, 不丢问题', async () => {
    await POST(req({ answers: [{ q: '你是谁', a: '' }] }));
    const content = callStructured.mock.calls[0][0].userMessage;
    expect(content[0].text).toContain('你是谁');
    expect(content[0].text).toContain('(未作答)');
  });
});
