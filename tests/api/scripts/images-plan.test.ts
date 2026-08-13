import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

// resolveDeepSeekApiKey 内部查 AIConfig(+decrypt); 单测已在别处覆盖, 这里只关心
// route 是否正确消费其返回值 — 直接代理 env (与 refine.test.ts 一致的写法)。
vi.mock('@/lib/llm/resolve-key', () => ({
  resolveDeepSeekApiKey: vi.fn(async () => process.env.DEEPSEEK_API_KEY ?? null),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { POST } from '@/app/api/v1/scripts/[id]/images/plan/route';

function reqPOST(url = 'http://t/api/v1/scripts/draft1/images/plan') {
  return new Request(url, { method: 'POST' });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

const xhsTitles = [{ text: '✨这样写小红书笔记, 效率翻倍', hookType: '数字' }];
const xhsCoverText = '3 个技巧';
const xhsIntro = '你是不是也经常写完稿子还要来回改？今天分享几个小技巧, 帮你一次搞定小红书图文笔记。';
const xhsBody =
  '第一步, 先明确你的目标受众是谁。第二步, 用一个具体场景开头, 让读者有代入感。**第三步, 把干货浓缩成 3 条以内的清单**, 太多读者记不住。最后用一句话总结, 呼应开头的场景, 形成闭环。';
const xhsTags = ['#AI效率', '#小红书运营'];
const xhsShotIdeas = [
  { idx: 1, description: '封面大字截图' },
  { idx: 2, description: 'ChatGPT 输入框特写' },
];

const fullXhsOutput = {
  titles: xhsTitles,
  coverText: xhsCoverText,
  intro: xhsIntro,
  body: xhsBody,
  tags: xhsTags,
  shotIdeas: xhsShotIdeas,
};

// 注意: overrides.output (若给出) 完整替换默认 output, 不做深合并 —
// 需要"既有完整内容 + imagePlan"的用例请显式 { ...fullXhsOutput, imagePlan }。
function baseXhsDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    niche: 'ai-knowledge',
    platform: 'xiaohongshu',
    output: fullXhsOutput,
    ...overrides,
  };
}

const validPlan = {
  style: 'minimalist flat illustration, warm pastel palette, soft shadow',
  images: [
    { idx: 0, prompt: 'render the Chinese headline text as bold poster-style large text overlay, portrait 3:4' },
    { idx: 1, prompt: 'a screenshot mockup of a poster with big Chinese cover text, portrait 3:4 composition' },
    { idx: 2, prompt: 'a close-up of a ChatGPT input box showing a prompt example, portrait 3:4 composition' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  prismaMock.scriptDraft.findUnique.mockResolvedValue(baseXhsDraft());
  prismaMock.scriptDraft.update.mockResolvedValue({});
});

describe('POST /api/v1/scripts/[id]/images/plan — 幂等', () => {
  it('已有 output.imagePlan 且无 ?force=1 → 直接 ok(既有计划), 不调 LLM', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { ...fullXhsOutput, imagePlan: validPlan } }),
    );
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.plan).toEqual(validPlan);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('已有 output.imagePlan 且带 ?force=1 → 重新调 LLM 并覆盖持久化', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({
        output: {
          ...fullXhsOutput,
          imagePlan: { style: 'old style token here', images: [{ idx: 0, prompt: 'x'.repeat(20) }] },
        },
      }),
    );
    llmMock.callStructured.mockResolvedValueOnce({
      result: validPlan,
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST('http://t/api/v1/scripts/draft1/images/plan?force=1'), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.plan).toEqual(validPlan);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledTimes(1);
  });

  it('没有既有计划 → 正常调 LLM 生成', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: validPlan,
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(200);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v1/scripts/[id]/images/plan — 生成成功', () => {
  it('落盘 output.imagePlan, spread 保留其余键, 响应 { plan }', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: validPlan,
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ plan: validPlan });

    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          titles: xhsTitles,
          coverText: xhsCoverText,
          intro: xhsIntro,
          body: xhsBody,
          tags: xhsTags,
          shotIdeas: xhsShotIdeas,
          imagePlan: validPlan,
        }),
      },
    });
  });

  it('把 coverText/intro/body/shotIdeas 传给 IMAGE_PLAN.buildUserMessage (userMessage 含关键内容)', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: validPlan,
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqPOST(), ctx);
    const call = llmMock.callStructured.mock.calls[0][0];
    const userText = (call.userMessage[0] as { text: string }).text;
    expect(userText).toContain(xhsCoverText);
    expect(userText).toContain(xhsIntro);
    expect(userText).toContain('封面大字截图');
  });
});

describe('POST /api/v1/scripts/[id]/images/plan — 校验', () => {
  it('非小红书平台 → 400, 不调 LLM', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ platform: 'douyin' }));
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('缺 intro/body/shotIdeas → 400, 不调 LLM', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { titles: xhsTitles, coverText: xhsCoverText, tags: xhsTags } }),
    );
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('脚本不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ userId: 'other' }));
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(404);
  });

  it('无 DEEPSEEK_API_KEY → 503, 不写库', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(503);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('LLM 返回 images 数量与 1+shotIdeas 不符 → 502 重试文案, 不写库', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: { style: validPlan.style, images: validPlan.images.slice(0, 2) },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/重试/);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('LLM 返回 images 数量对但 idx 字段有缺失 (非 {0..N-1}) → 502 重试文案, 不写库', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: {
        style: validPlan.style,
        images: [
          { idx: 0, prompt: validPlan.images[0].prompt },
          { idx: 1, prompt: validPlan.images[1].prompt },
          { idx: 5, prompt: validPlan.images[2].prompt }, // 应为 2, 缺失导致 idx 集合不是 {0,1,2}
        ],
      },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/重试/);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('LLM 返回 images 数量对但 idx 字段重复 → 502 重试文案, 不写库', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: {
        style: validPlan.style,
        images: [
          { idx: 0, prompt: validPlan.images[0].prompt },
          { idx: 0, prompt: validPlan.images[1].prompt }, // 重复 idx=0, 缺 idx=2
          { idx: 2, prompt: validPlan.images[2].prompt },
        ],
      },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/重试/);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 500, 不写库', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqPOST(), ctx);
    expect(res.status).toBe(500);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});
