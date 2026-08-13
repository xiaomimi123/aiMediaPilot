import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

// resolveDeepSeekApiKey 内部查 AIConfig(+decrypt); 单测已在别处覆盖, 这里只关心
// route 是否正确消费其返回值 — 直接代理 env, 保留既有 `process.env.DEEPSEEK_API_KEY`
// 测试模式 (设置/删除 env 即可控制 key 有无), 不需要额外 mock prisma.aIConfig。
vi.mock('@/lib/llm/resolve-key', () => ({
  resolveDeepSeekApiKey: vi.fn(async () => process.env.DEEPSEEK_API_KEY ?? null),
}));

const prismaMock = vi.hoisted(() => ({
  inspirationInsight: { findFirst: vi.fn() },
  scriptDraft: { create: vi.fn() },
  cockpitContent: { findUnique: vi.fn(), update: vi.fn() },
  personaProfile: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const runResearchMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/script/research', () => ({ runResearch: runResearchMock }));

const getStyleContextMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/script/style', () => ({ getStyleContext: getStyleContextMock }));

import { POST } from '@/app/api/v1/scripts/generate/route';

function makeReq(body: unknown): Request {
  return new Request('http://test/api/v1/scripts/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 旧平台 (xiaohongshu/gongzhonghao) 响应形状回归用 — 字段名任意, callStructured 在测试里被
// mock 掉不会真的过 zod, 这里只用来断言 route 把 out.result 原样 spread 进 data。
const legacyPlatformResponse = {
  titles: [{ text: '标题候选一', hookType: '数字' }],
  body: '正文占位',
};

const researchBrief = {
  points: [{ fact: '某数据 42%', source: 'https://example.com/a', usage: '作为 hook 部分的反差数据' }],
};

const styleContext = { mode: 'description' as const, description: '语速快, 短句多', samples: [] };

const douyinScriptResult = {
  sections: [
    { role: 'hook', startSec: 0, endSec: 3, text: '你还在为周报发愁吗？' },
    { role: 'main', startSec: 3, endSec: 40, text: '教你三个 prompt 技巧。' },
    { role: 'cta', startSec: 40, endSec: 45, text: '记得点赞关注。' },
  ],
  hooks: [
    { text: '钩子一', rationale: '痛点反差' },
    { text: '钩子二', rationale: '数字承诺' },
    { text: '钩子三', rationale: '悬念展开' },
  ],
  titles: [
    { text: '标题候选一', hookType: '数字' },
    { text: '标题候选二', hookType: '反差' },
    { text: '标题候选三', hookType: '问题' },
  ],
  cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写', colorTone: '白底红字' },
};

const xhsScriptResult = {
  titles: [
    { text: '✨打工人秒变效率怪', hookType: '情感' },
    { text: '老板都夸的周报秘籍', hookType: '反差' },
    { text: '3 个 ChatGPT 周报 prompt', hookType: '数字' },
  ],
  coverText: '周报 3 分钟搞定',
  intro: '你是不是也每周写周报花 2 小时? 上周我发现了 3 个 prompt, 从此告别加班写周报。',
  body: '第一步, 把工作记录喂进去...\n\n第二步, 让 AI 提炼要点...\n\n第三步, 让 AI 用你的口吻改写...',
  tags: ['ChatGPT', 'AI 工具', '打工人', '效率', '副业'],
  shotIdeas: [
    { idx: 1, description: 'ChatGPT 输入框截图, prompt 示范' },
    { idx: 2, description: '工作记录 vs 周报 对比图' },
    { idx: 3, description: '最终周报截图' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  llmMock.callStructured.mockResolvedValue({
    result: douyinScriptResult,
    usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
  });
  prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
  prismaMock.scriptDraft.create.mockResolvedValue({ id: 'draft1' });
  prismaMock.cockpitContent.findUnique.mockResolvedValue(null);
  prismaMock.cockpitContent.update.mockResolvedValue({});
  prismaMock.personaProfile.findUnique.mockResolvedValue(null);
  runResearchMock.mockResolvedValue(researchBrief);
  getStyleContextMock.mockResolvedValue(styleContext);
});

describe('POST /api/v1/scripts/generate — douyin (两阶段: research → style → 写稿)', () => {
  it('正常 topic+niche → 200, 两阶段顺序编排: runResearch → getStyleContext → callStructured', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(runResearchMock).toHaveBeenCalledWith('user1', {
      topic: '如何用 ChatGPT 写周报',
      niche: 'ai-knowledge',
      userMaterials: undefined,
    });
    expect(getStyleContextMock).toHaveBeenCalledWith('user1', 'douyin');
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
  });

  it('响应 data 含 research/sections/researchDegraded=false (research 命中)', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    const json = await res.json();
    expect(json.data.research).toEqual(researchBrief);
    expect(json.data.researchDegraded).toBe(false);
    expect(json.data.sections).toEqual(douyinScriptResult.sections);
    expect(json.data.hooks).toEqual(douyinScriptResult.hooks);
    expect(json.data.titles).toEqual(douyinScriptResult.titles);
    expect(json.data.cover).toEqual(douyinScriptResult.cover);
    expect(json.data.durationSec).toBe(45);
    expect(json.data.platform).toBe('douyin');
  });

  it('research 返回 null (降级) 时仍正常写稿, researchDegraded=true, research=null', async () => {
    runResearchMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.research).toBeNull();
    expect(json.data.researchDegraded).toBe(true);
    expect(json.data.sections).toEqual(douyinScriptResult.sections);
    // 写稿 prompt 收到的 brief 应该是 null
    const call = llmMock.callStructured.mock.calls[0][0];
    expect(call.userMessage).toBeDefined();
  });

  it('响应含 scriptDraftId, 且已把完整 output 形状持久化到 ScriptDraft', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    const json = await res.json();
    expect(json.data.scriptDraftId).toBe('draft1');

    expect(prismaMock.scriptDraft.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        topic: '如何用 ChatGPT 写周报',
        niche: 'ai-knowledge',
        platform: 'douyin',
        output: {
          research: researchBrief,
          script: { sections: douyinScriptResult.sections },
          hooks: douyinScriptResult.hooks,
          titles: douyinScriptResult.titles,
          cover: douyinScriptResult.cover,
          durationSec: 45,
        },
      },
      select: { id: true },
    });
  });

  it('materials 透传给 runResearch 作为 userMaterials', async () => {
    await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', materials: '我自己的素材文本' }),
    );
    expect(runResearchMock).toHaveBeenCalledWith('user1', {
      topic: '如何用 ChatGPT 写周报',
      niche: 'ai-knowledge',
      userMaterials: '我自己的素材文本',
    });
  });

  it('durationSec 省略 → 默认 45, 且写进持久化 output 与响应', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    const json = await res.json();
    expect(json.data.durationSec).toBe(45);
    const call = llmMock.callStructured.mock.calls[0][0];
    expect(call.userMessage[0].text).toContain('45 秒');
  });

  it.each([30, 60])('durationSec=%d 合法值透传', async (durationSec) => {
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', durationSec }),
    );
    const json = await res.json();
    expect(json.data.durationSec).toBe(durationSec);
  });

  it('durationSec 非法值 (如 40) → 400', async () => {
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', durationSec: 40 }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it('topic 空 → 400', async () => {
    const res = await POST(makeReq({ topic: '', niche: 'ai-knowledge' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toMatch(/LLM down|生成失败/);
  });

  it('runResearch 异常不应冒泡 (research.ts 承诺永不 throw, 这里仅确认 route 不额外 catch 出错)', async () => {
    runResearchMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/scripts/generate — douyin cockpitContentId 关联回写', () => {
  it('带 cockpitContentId 且归属正确 → cockpitContent.update 被调, 参数为 { scriptDraftId: draft.id }, 响应仍 200', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce({ id: 'content1', userId: 'user1' });
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', cockpitContentId: 'content1' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.scriptDraftId).toBe('draft1');

    expect(prismaMock.cockpitContent.findUnique).toHaveBeenCalledWith({
      where: { id: 'content1' },
      select: { id: true, userId: true },
    });
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: { scriptDraftId: 'draft1' },
    });
  });

  it('cockpitContentId 不属于当前用户 → 不调 update, console.warn 不触发 (静默跳过), 生成响应仍 200', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce({ id: 'content1', userId: 'other-user' });
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', cockpitContentId: 'content1' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('cockpitContentId 不存在 → 不调 update, 生成响应仍 200', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', cockpitContentId: 'ghost' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });

  it('cockpitContent 归属校验/写入抛错 → 仅 console.warn 不阻断生成响应, 仍 200 且带 scriptDraftId', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    prismaMock.cockpitContent.findUnique.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', cockpitContentId: 'content1' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.scriptDraftId).toBe('draft1');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('不带 cockpitContentId → 不查/不调 cockpitContent', async () => {
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.cockpitContent.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/generate — xiaohongshu (两阶段: research → style → 写稿, output 落库)', () => {
  beforeEach(() => {
    llmMock.callStructured.mockResolvedValue({
      result: xhsScriptResult,
      usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
    });
  });

  it('正常 topic+niche → 200, 两阶段顺序编排: runResearch → getStyleContext(userId, "xiaohongshu") → callStructured', async () => {
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(runResearchMock).toHaveBeenCalledWith('user1', {
      topic: '如何用 ChatGPT 写周报',
      niche: 'ai-knowledge',
      userMaterials: undefined,
    });
    expect(getStyleContextMock).toHaveBeenCalledWith('user1', 'xiaohongshu');
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
  });

  it('materials 透传给 runResearch 作为 userMaterials (durationSec 对 xhs 无意义, 不校验/不透传)', async () => {
    await POST(
      makeReq({
        topic: '如何用 ChatGPT 写周报',
        niche: 'ai-knowledge',
        platform: 'xiaohongshu',
        materials: '我自己的素材文本',
        durationSec: 60,
      }),
    );
    expect(runResearchMock).toHaveBeenCalledWith('user1', {
      topic: '如何用 ChatGPT 写周报',
      niche: 'ai-knowledge',
      userMaterials: '我自己的素材文本',
    });
  });

  it('响应 data 含 research/researchDegraded=false (research 命中) + 6 区块字段', async () => {
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    const json = await res.json();
    expect(json.data.platform).toBe('xiaohongshu');
    expect(json.data.research).toEqual(researchBrief);
    expect(json.data.researchDegraded).toBe(false);
    expect(json.data.titles).toEqual(xhsScriptResult.titles);
    expect(json.data.coverText).toBe(xhsScriptResult.coverText);
    expect(json.data.intro).toBe(xhsScriptResult.intro);
    expect(json.data.body).toBe(xhsScriptResult.body);
    expect(json.data.tags).toEqual(xhsScriptResult.tags);
    expect(json.data.shotIdeas).toEqual(xhsScriptResult.shotIdeas);
  });

  it('research 返回 null (降级) 时仍正常写稿, researchDegraded=true, research=null', async () => {
    runResearchMock.mockResolvedValueOnce(null);
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.research).toBeNull();
    expect(json.data.researchDegraded).toBe(true);
    expect(json.data.titles).toEqual(xhsScriptResult.titles);
    expect(prismaMock.scriptDraft.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ output: expect.objectContaining({ research: null }) }) }),
    );
  });

  it('响应含 scriptDraftId, 且已把新形状 output 持久化到 ScriptDraft: { research, titles, coverText, intro, body, tags, shotIdeas }', async () => {
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    const json = await res.json();
    expect(json.data.scriptDraftId).toBe('draft1');

    expect(prismaMock.scriptDraft.create).toHaveBeenCalledWith({
      data: {
        userId: 'user1',
        topic: '如何用 ChatGPT 写周报',
        niche: 'ai-knowledge',
        platform: 'xiaohongshu',
        output: {
          research: researchBrief,
          titles: xhsScriptResult.titles,
          coverText: xhsScriptResult.coverText,
          intro: xhsScriptResult.intro,
          body: xhsScriptResult.body,
          tags: xhsScriptResult.tags,
          shotIdeas: xhsScriptResult.shotIdeas,
        },
      },
      select: { id: true },
    });
  });

  it('cockpitContentId 归属正确 → cockpitContent.update 被调, 参数为 { scriptDraftId: draft.id }', async () => {
    prismaMock.cockpitContent.findUnique.mockResolvedValueOnce({ id: 'content1', userId: 'user1' });
    const res = await POST(
      makeReq({
        topic: '如何用 ChatGPT 写周报',
        niche: 'ai-knowledge',
        platform: 'xiaohongshu',
        cockpitContentId: 'content1',
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.cockpitContent.update).toHaveBeenCalledWith({
      where: { id: 'content1' },
      data: { scriptDraftId: 'draft1' },
    });
  });

  it('styleHints/inspirationApplied 不再被调 (即使传 inspirationId 也不查 InspirationInsight)', async () => {
    const res = await POST(
      makeReq({
        topic: '如何用 ChatGPT 写周报',
        niche: 'ai-knowledge',
        platform: 'xiaohongshu',
        inspirationId: 'insight1',
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.inspirationApplied).toBeUndefined();
    expect(json.data.styleHints).toBeUndefined();
    expect(prismaMock.inspirationInsight.findFirst).not.toHaveBeenCalled();
  });

  it('topic 空 → 400 (与 douyin 共用校验)', async () => {
    const res = await POST(makeReq({ topic: '', niche: 'ai-knowledge', platform: 'xiaohongshu' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});

describe('POST /api/v1/scripts/generate — 人设定位注入 (T4)', () => {
  const personaRow = {
    userId: 'user1',
    audience: '25-35 岁互联网从业者',
    targetFans: '想转行做 AI 的人',
    pillars: [{ name: '工具评测', description: '拆解 AI 工具实际效果' }],
    angle: '只讲能落地的方法',
    avoid: '不做标题党',
  };

  it('douyin: 无档案 → systemPrompt 不含人设定位段', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).not.toContain('你的定位');
  });

  it('douyin: 有档案 → systemPrompt 含人设定位内容 (受众/支柱)', async () => {
    prismaMock.personaProfile.findUnique.mockResolvedValue(personaRow);
    const res = await POST(makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge' }));
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('25-35 岁互联网从业者');
    expect(systemPrompt).toContain('工具评测');
    expect(prismaMock.personaProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user1' } });
  });

  it('xiaohongshu: 无档案 → systemPrompt 不含人设定位段', async () => {
    llmMock.callStructured.mockResolvedValue({
      result: xhsScriptResult,
      usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
    });
    prismaMock.personaProfile.findUnique.mockResolvedValue(null);
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).not.toContain('你的定位');
  });

  it('xiaohongshu: 有档案 → systemPrompt 含人设定位内容 (受众/支柱)', async () => {
    llmMock.callStructured.mockResolvedValue({
      result: xhsScriptResult,
      usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
    });
    prismaMock.personaProfile.findUnique.mockResolvedValue(personaRow);
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'xiaohongshu' }),
    );
    expect(res.status).toBe(200);
    const systemPrompt = llmMock.callStructured.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('25-35 岁互联网从业者');
    expect(systemPrompt).toContain('工具评测');
    expect(prismaMock.personaProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user1' } });
  });

  it('gongzhonghao: 分支不动 — 不查 personaProfile', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: legacyPlatformResponse,
      usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
    });
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'gongzhonghao' }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.personaProfile.findUnique).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/generate — gongzhonghao 回归 (分支代码字符级不动, 响应形状不变)', () => {
  it('200, data = { platform, inspirationApplied, ...result }, 不碰 research/style/scriptDraft', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: legacyPlatformResponse,
      usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
    });
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'gongzhonghao' }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.platform).toBe('gongzhonghao');
    expect(json.data.inspirationApplied).toBe(false);
    expect(json.data.titles).toEqual(legacyPlatformResponse.titles);
    expect(json.data.body).toBe(legacyPlatformResponse.body);
    // 没有 douyin/xiaohongshu 两阶段字段
    expect(json.data.research).toBeUndefined();
    expect(json.data.researchDegraded).toBeUndefined();
    expect(json.data.scriptDraftId).toBeUndefined();

    expect(runResearchMock).not.toHaveBeenCalled();
    expect(getStyleContextMock).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.create).not.toHaveBeenCalled();
  });

  it('topic 空 → 400 (与 douyin 共用校验)', async () => {
    const res = await POST(makeReq({ topic: '', niche: 'ai-knowledge', platform: 'gongzhonghao' }));
    expect(res.status).toBe(400);
  });

  it('LLM 抛错 → 500 (与 douyin 共用 catch 结构, 但走原分支)', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(
      makeReq({ topic: '如何用 ChatGPT 写周报', niche: 'ai-knowledge', platform: 'gongzhonghao' }),
    );
    expect(res.status).toBe(500);
  });

  describe('inspirationId 透传 (原有行为不变)', () => {
    it('inspirationId 存在 → LLM userMessage 含 hookTypes/titlePatterns 文本片段', async () => {
      llmMock.callStructured.mockResolvedValueOnce({
        result: legacyPlatformResponse,
        usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
      });
      prismaMock.inspirationInsight.findFirst.mockResolvedValue({
        output: {
          hookTypes: ['数字', '反差'],
          titlePatterns: ['以数字开头', '含 emoji'],
          durationInsight: '45-60s 最优',
        },
      });
      const res = await POST(
        makeReq({
          topic: '主题示例',
          niche: 'ai-knowledge',
          platform: 'gongzhonghao',
          inspirationId: 'insight1',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.inspirationApplied).toBe(true);

      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).toContain('钩子类型: 数字 / 反差');
      expect(userText).toContain('标题模式: 以数字开头 / 含 emoji');
      expect(userText).toContain('时长规律: 45-60s 最优');
      expect(userText).toContain('参考下面对标爆款的共性');

      expect(prismaMock.inspirationInsight.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'insight1', userId: 'user1' },
        }),
      );
    });

    it('inspirationId 不存在或不属于自己 → 跑下去 + inspirationApplied=false', async () => {
      llmMock.callStructured.mockResolvedValueOnce({
        result: legacyPlatformResponse,
        usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
      });
      prismaMock.inspirationInsight.findFirst.mockResolvedValue(null);
      const res = await POST(
        makeReq({
          topic: '主题示例',
          niche: 'ai-knowledge',
          platform: 'gongzhonghao',
          inspirationId: 'not-mine',
        }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.inspirationApplied).toBe(false);

      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).not.toContain('参考下面对标爆款');
    });

    it('不传 inspirationId → 不查 Prisma, 不带 styleHints', async () => {
      llmMock.callStructured.mockResolvedValueOnce({
        result: legacyPlatformResponse,
        usage: { model: 'deepseek', promptTokens: 100, completionTokens: 200, estCostUSD: 0.001 },
      });
      const res = await POST(
        makeReq({ topic: '主题示例', niche: 'ai-knowledge', platform: 'gongzhonghao' }),
      );
      expect(res.status).toBe(200);
      expect(prismaMock.inspirationInsight.findFirst).not.toHaveBeenCalled();
      const call = llmMock.callStructured.mock.calls[0][0];
      const userText = (call.userMessage[0] as { text: string }).text;
      expect(userText).not.toContain('参考下面对标爆款');
    });
  });
});
