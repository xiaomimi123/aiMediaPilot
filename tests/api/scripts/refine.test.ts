import { describe, expect, it, vi, beforeEach } from 'vitest';

const llmMock = vi.hoisted(() => ({ callStructured: vi.fn() }));
vi.mock('@/lib/llm/deepseek', () => ({
  DeepSeekTextLLM: vi.fn(() => llmMock),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

// resolveDeepSeekApiKey 内部查 AIConfig(+decrypt); 单测已在别处覆盖, 这里只关心
// route 是否正确消费其返回值 — 直接代理 env (与 generate.test.ts 一致的写法)。
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

const getStyleContextMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/script/style', () => ({ getStyleContext: getStyleContextMock }));

import { POST } from '@/app/api/v1/scripts/[id]/refine/route';

function reqJSON(body: unknown) {
  return new Request('http://t/api/v1/scripts/draft1/refine', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

const baseSections = [
  { role: 'hook', startSec: 0, endSec: 3, text: '你还在为周报发愁吗？这三个技巧帮你搞定。' },
  { role: 'main', startSec: 3, endSec: 40, text: '第一步先打开 ChatGPT, 把你的素材丢进去。' },
  { role: 'cta', startSec: 40, endSec: 45, text: '记得点赞关注, 我们下期见。' },
];

const researchBrief = {
  points: [{ fact: '某数据 42%', source: 'https://example.com/a', usage: '作为 hook 部分的反差数据' }],
};

const styleContext = { mode: 'description' as const, description: '语速快, 短句多', samples: [] };

// 十三期任务四: 六幕稿 fixture — act 字段依次为 ACT_KEYS 顺序, 供 scope='act'/'all' 测试复用。
const ACT_KEYS_LOCAL = ['hook', 'concept_a', 'concept_b', 'trivia', 'synthesis', 'punchline'] as const;

function makeAct(act: (typeof ACT_KEYS_LOCAL)[number], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    act,
    title: `${act}标题`,
    narration: `这是 ${act} 幕的口播文案示例内容, 足够长满足最小长度要求。`,
    visual: '画面提示',
    note: '备注说明',
    targetSec: 10,
    beats: [{ keyword: 'a' }, { keyword: 'b' }, { keyword: 'c' }],
    facts: [],
    ...overrides,
  };
}

function makeSixActs() {
  return ACT_KEYS_LOCAL.map((act) => makeAct(act));
}

const sixActFourDims = { gain: '收获', surprise: '意外', clarity: '清晰', appeal: '吸引' };

function baseSixActDraft(overrides: Partial<{ userId: string; platform: string; output: unknown }> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    niche: 'ai-knowledge',
    platform: 'douyin',
    output: {
      research: researchBrief,
      script: { acts: makeSixActs() },
      four_dims: sixActFourDims,
      hooks: [{ text: '钩子一', rationale: '痛点反差' }],
      titles: [{ text: '标题一', hookType: '数字' }],
      cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写', colorTone: '白底红字' },
      durationSec: 90,
      lintIssues: [],
    },
    ...overrides,
  };
}

function baseDraft(overrides: Partial<{ userId: string; platform: string; output: unknown }> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    niche: 'ai-knowledge',
    platform: 'douyin',
    output: {
      research: researchBrief,
      script: { sections: baseSections },
      hooks: [{ text: '钩子一', rationale: '痛点反差' }],
      titles: [{ text: '标题一', hookType: '数字' }],
      cover: { textOverlay: '3 分钟', shotIdea: '屏幕特写', colorTone: '白底红字' },
      durationSec: 45,
    },
    ...overrides,
  };
}

const xhsResearch = {
  points: [{ fact: '小红书数据 88%', source: 'https://example.com/b', usage: '用于 intro 里的反差数据' }],
};

const xhsIntroOld = '你是不是也经常写完稿子还要来回改？今天分享几个小技巧, 帮你一次搞定小红书图文笔记。';
const xhsBodyOld =
  '第一步, 先明确你的目标受众是谁。第二步, 用一个具体场景开头, 让读者有代入感。**第三步, 把干货浓缩成 3 条以内的清单**, 太多读者记不住。最后用一句话总结, 呼应开头的场景, 形成闭环。';
const xhsTitles = [{ text: '✨这样写小红书笔记, 效率翻倍', hookType: '数字' }];
const xhsCoverText = '3 个技巧';
const xhsTags = ['#AI效率', '#小红书运营'];
const xhsShotIdeas = [{ idx: 1, description: '封面大字截图' }];

function baseXhsDraft(overrides: Partial<{ userId: string; platform: string; output: unknown }> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    niche: 'ai-knowledge',
    platform: 'xiaohongshu',
    output: {
      research: xhsResearch,
      titles: xhsTitles,
      coverText: xhsCoverText,
      intro: xhsIntroOld,
      body: xhsBodyOld,
      tags: xhsTags,
      shotIdeas: xhsShotIdeas,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEEPSEEK_API_KEY = 'sk-test';
  getStyleContextMock.mockResolvedValue(styleContext);
  prismaMock.scriptDraft.findUnique.mockResolvedValue(baseDraft());
  prismaMock.scriptDraft.update.mockResolvedValue({});
});

describe('POST /api/v1/scripts/[id]/refine — scope=section', () => {
  it('合法改写 (只有目标块 text 变了) → 200, 整体替换 output.script.sections 持久化', async () => {
    const newSections = [
      baseSections[0],
      { ...baseSections[1], text: '第一步先打开豆包, 把你的素材丢进去, 三分钟出稿。' },
      baseSections[2],
    ];
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: newSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 1, instruction: '换个更接地气的说法' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.sections).toEqual(newSections);

    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          research: researchBrief,
          script: { sections: newSections },
          hooks: expect.anything(),
          titles: expect.anything(),
          cover: expect.anything(),
          durationSec: 45,
        }),
      },
    });
  });

  it('复用 output.research 传给 SCRIPT_REFINE, 不重新搜索', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: baseSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqJSON({ scope: 'section', sectionIdx: 0, instruction: '更简洁一点' }), ctx);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
    const call = llmMock.callStructured.mock.calls[0][0];
    const userText = (call.userMessage[0] as { text: string }).text;
    expect(userText).toContain('某数据 42%');
  });

  it('AI 改动了未指定的段落 → 502, 且不写库', async () => {
    const newSections = [
      { ...baseSections[0], text: '被越权改动的 hook 文本, 不应该被改。' },
      { ...baseSections[1], text: '这一块才是目标块, 允许改。' },
      baseSections[2],
    ];
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: newSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 1, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('AI 修改了未指定的段落, 请重试');
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('AI 返回块数与原稿不一致 → 502, 且不写库', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: [baseSections[0], baseSections[1]] },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 1, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.message).toBe('AI 修改了未指定的段落, 请重试');
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('sectionIdx 越界 → 400, 不调用 LLM', async () => {
    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 99, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('sectionIdx 缺失 (scope=section) → 400', async () => {
    const res = await POST(reqJSON({ scope: 'section', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('负数 sectionIdx → 400', async () => {
    const res = await POST(reqJSON({ scope: 'section', sectionIdx: -1, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/scripts/[id]/refine — scope=all', () => {
  it('合法重写全稿 (块数 3-6, 首块 role=hook) → 200, 整体替换持久化', async () => {
    const newSections = [
      { role: 'hook', startSec: 0, endSec: 3, text: '全新开场白, 更抓人。' },
      { role: 'main', startSec: 3, endSec: 40, text: '全新的主体内容, 更口语化。' },
      { role: 'cta', startSec: 40, endSec: 45, text: '全新的结尾引导关注。' },
    ];
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: newSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqJSON({ scope: 'all', instruction: '整体口语化一点' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.sections).toEqual(newSections);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({ script: { sections: newSections } }),
      },
    });
  });

  it('首块 role 不是 hook → 502, 不写库', async () => {
    const newSections = [
      { role: 'main', startSec: 0, endSec: 3, text: '不该是 main 打头, 首块必须是 hook。' },
      { role: 'main', startSec: 3, endSec: 40, text: '中间内容。' },
      { role: 'cta', startSec: 40, endSec: 45, text: '结尾引导关注。' },
    ];
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: newSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    const res = await POST(reqJSON({ scope: 'all', instruction: '整体口语化一点' }), ctx);
    expect(res.status).toBe(502);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/refine — xiaohongshu', () => {
  it('scope=section → 400 小红书暂不支持分块改稿, 不调用 LLM', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft());
    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 0, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe('小红书暂不支持分块改稿');
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('scope=all 合法改写 → 200, 只覆盖 intro/body, 其余四键原样持久化', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft());
    const newIntro = '全新开头, 一句话戳中痛点, 让读者立刻想往下看。';
    const newBody =
      '全新正文第一段, 讲一个具体场景。**全新正文第二段, 加粗关键干货**。全新正文第三段, 呼应开头收尾。';
    llmMock.callStructured.mockResolvedValueOnce({
      result: { intro: newIntro, body: newBody },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'all', instruction: '换个更有冲击力的开头' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ intro: newIntro, body: newBody });

    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          research: xhsResearch,
          titles: xhsTitles,
          coverText: xhsCoverText,
          intro: newIntro,
          body: newBody,
          tags: xhsTags,
          shotIdeas: xhsShotIdeas,
        }),
      },
    });
  });

  it('复用 output.research 传给 XHS_REFINE, 不重新搜索', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft());
    llmMock.callStructured.mockResolvedValueOnce({
      result: { intro: xhsIntroOld, body: xhsBodyOld },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqJSON({ scope: 'all', instruction: '更简洁一点' }), ctx);
    expect(llmMock.callStructured).toHaveBeenCalledTimes(1);
    const call = llmMock.callStructured.mock.calls[0][0];
    const userText = (call.userMessage[0] as { text: string }).text;
    expect(userText).toContain('小红书数据 88%');
  });

  it('getStyleContext 被以 (userId, "xiaohongshu") 调用', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft());
    llmMock.callStructured.mockResolvedValueOnce({
      result: { intro: xhsIntroOld, body: xhsBodyOld },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(getStyleContextMock).toHaveBeenCalledWith('user1', 'xiaohongshu');
  });

  it('旧稿没有 intro/body → 400, 不调用 LLM', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { titles: xhsTitles, coverText: xhsCoverText, tags: xhsTags, shotIdeas: xhsShotIdeas } }),
    );
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → 500, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft());
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(500);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/refine — 六幕稿 scope=act', () => {
  it('合法改写 (只有目标幕 narration 变了) → 200, 整体替换 output.script.acts 持久化', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const newActs = original.map((a, i) => (i === 1 ? { ...a, narration: '全新的 concept_a 幕内容, 换了个说法。' } : a));
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: newActs },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'concept_a', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.acts).toEqual(newActs);

    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          research: researchBrief,
          script: { acts: newActs },
          four_dims: sixActFourDims,
          hooks: expect.anything(),
          titles: expect.anything(),
          cover: expect.anything(),
          durationSec: 90,
        }),
      },
    });
  });

  it('其余五幕 narration 逐字不变的断言 (直接比对 fixture)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const newActs = original.map((a, i) => (i === 0 ? { ...a, narration: '全新的 hook 幕内容。' } : a));
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: newActs },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'hook', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    for (let i = 1; i < 6; i++) {
      expect(json.data.acts[i].narration).toBe(original[i].narration);
    }
  });

  it('越权改动了未指定幕的 narration → 502, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const newActs = original.map((a, i) => {
      if (i === 1) return { ...a, narration: '这是目标幕, 允许改。' };
      if (i === 0) return { ...a, narration: '被越权改动的 hook 幕, 不应该被改。' };
      return a;
    });
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: newActs },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'concept_a', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('AI 修改了未指定的幕, 请重试');
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('act 字段被错标/挪位 (narration 恰好仍按原索引对齐) → 502, 不写库 (审查修复#1)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    // 目标幕是 concept_b (index 2), 只改它的 narration —— 合法。但同时把 index 0 的 act 从
    // 'hook' 错标成 'concept_a' (narration 保持原索引对齐的原文不变), 这在旧的"只比 narration"
    // 校验下会被误判为"未改动", 必须被识别为越权改动。
    const newActs = original.map((a, i) => {
      if (i === 2) return { ...a, narration: '这是目标幕 concept_b, 允许改。' };
      if (i === 0) return { ...a, act: 'concept_a' };
      return a;
    });
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: newActs },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'concept_b', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('AI 修改了未指定的幕, 请重试');
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('actKey 非法 → 400, 不调用 LLM (校验先于查库, 不消费 findUnique 的 once mock)', async () => {
    const res = await POST(reqJSON({ scope: 'act', actKey: 'bogus_act', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.findUnique).not.toHaveBeenCalled();
  });

  it('actKey 缺失 (scope=act) → 400, 不调用 LLM (校验先于查库)', async () => {
    const res = await POST(reqJSON({ scope: 'act', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
    expect(prismaMock.scriptDraft.findUnique).not.toHaveBeenCalled();
  });

  it('旧 sections 稿走 scope=act → 400 (该脚本还没有可改写的六幕稿)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseDraft());
    const res = await POST(reqJSON({ scope: 'act', actKey: 'hook', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('六幕稿走 scope=section → 400 (提示改用 scope=act)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const res = await POST(reqJSON({ scope: 'section', sectionIdx: 0, instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/refine — 六幕稿 scope=all', () => {
  it('合法重写全部六幕 (act 顺序与 ACT_KEYS 一致) → 200, 整体替换持久化', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const newActs = makeSixActs().map((a) => ({ ...a, narration: `全新的 ${a.act} 幕内容, 整体重写。` }));
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: newActs },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'all', instruction: '整体口语化一点' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.acts).toEqual(newActs);
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({ script: { acts: newActs } }),
      },
    });
  });

  it('acts 顺序被打乱 → 502, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const shuffled = makeSixActs();
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: shuffled },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'all', instruction: '整体口语化一点' }), ctx);
    expect(res.status).toBe(502);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('acts 数量不对 (5 项) → 502, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: makeSixActs().slice(0, 5) },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });

    const res = await POST(reqJSON({ scope: 'all', instruction: '整体口语化一点' }), ctx);
    expect(res.status).toBe(502);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('getStyleContext 被以 (userId, "douyin") 调用', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    llmMock.callStructured.mockResolvedValueOnce({
      result: { acts: makeSixActs() },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(getStyleContextMock).toHaveBeenCalledWith('user1', 'douyin');
  });

  it('LLM 抛错 → 500, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(500);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/refine — 六幕稿响应严格 schema 校验 (审查修复#2)', () => {
  // 这两个用例故意用 mockImplementationOnce 而不是 mockResolvedValueOnce —— 真实
  // callStructured (deepseek.ts/vision.ts) 内部会把 LLM 原始响应喂给传入的 responseSchema
  // 做 parse (JSON mode 分支是 `opts.responseSchema.parse(parsed)`, 逐字可查 src/lib/llm/vision.ts)。
  // 这里在 mock 里手动复现同一步 `opts.responseSchema.parse(...)`, 才能真实验证 route.ts
  // 传给 callStructured 的是 six-act.ts 导出的严格 ScriptActSchema (含 title.max(20) 硬校验、
  // narration.max(1500)+截断 800 等), 而不是此前那份宽松手写 copy —— 否则测试只是在验证
  // mock 本身回显了什么, 测不出 schema 是否真的严格。
  function mockStructuredWithRealSchemaParse(rawResult: unknown) {
    llmMock.callStructured.mockImplementationOnce(async (opts: { responseSchema: { parse: (v: unknown) => unknown } }) => ({
      result: opts.responseSchema.parse(rawResult),
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    }));
  }

  it('title 超过 20 字上限 (无 transform 截断) → schema parse 失败 → 500, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const newActs = original.map((a, i) => (i === 0 ? { ...a, title: 'a'.repeat(25) } : a));
    mockStructuredWithRealSchemaParse({ acts: newActs });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'hook', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(500);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });

  it('narration 超过展示上限 (1200 字, 在原始上限 1500 内) → 被真实 schema 截断到 800, 而非原样持久化', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const oversized = 'x'.repeat(1200);
    const newActs = original.map((a, i) => (i === 0 ? { ...a, narration: oversized } : a));
    mockStructuredWithRealSchemaParse({ acts: newActs });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'hook', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.acts[0].narration.length).toBe(800);
    expect(json.data.acts[0].narration).toBe(oversized.slice(0, 800));
    expect(prismaMock.scriptDraft.update).toHaveBeenCalledWith({
      where: { id: 'draft1' },
      data: {
        output: expect.objectContaining({
          script: { acts: expect.arrayContaining([expect.objectContaining({ narration: oversized.slice(0, 800) })]) },
        }),
      },
    });
  });

  it('narration 超过原始上限 (1600 字, 超过 1500) → schema parse 失败 → 500, 不写库', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseSixActDraft());
    const original = makeSixActs();
    const newActs = original.map((a, i) => (i === 0 ? { ...a, narration: 'y'.repeat(1600) } : a));
    mockStructuredWithRealSchemaParse({ acts: newActs });

    const res = await POST(reqJSON({ scope: 'act', actKey: 'hook', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(500);
    expect(prismaMock.scriptDraft.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/refine — 公共校验', () => {
  it('scope 非法值 → 400', async () => {
    const res = await POST(reqJSON({ scope: 'bogus', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
  });

  it('instruction 空 → 400', async () => {
    const res = await POST(reqJSON({ scope: 'all', instruction: '' }), ctx);
    expect(res.status).toBe(400);
  });

  it('instruction 超过 200 字 → 400', async () => {
    const res = await POST(reqJSON({ scope: 'all', instruction: '啊'.repeat(201) }), ctx);
    expect(res.status).toBe(400);
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await POST(
      new Request('http://t/api/v1/scripts/draft1/refine', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('脚本不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseDraft({ userId: 'other' }));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(404);
  });

  // 注意: platform 覆盖成 'xiaohongshu' 但 output 仍是 baseDraft 的 douyin 形状
  // (script.sections, 没有顶层 intro/body)——route 先按 platform 分流进
  // handleXhsRefine (route.ts:92), 命中的是 xhs 分支自己的「旧稿没有 intro/body」
  // 400 校验, 不是下面 platform !== 'douyin' 分支 (route.ts:95) 的「不支持平台」
  // 400。用例名如实反映实际命中的分支, 「不支持平台」语义由下一个用例单独覆盖。
  it('platform=xiaohongshu 但旧稿是 douyin 输出形状 (无 intro/body) → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseDraft({ platform: 'xiaohongshu' }));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('platform 不支持 (非 douyin/xiaohongshu) → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseDraft({ platform: 'gongzhonghao' }));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
    expect(llmMock.callStructured).not.toHaveBeenCalled();
  });

  it('旧稿没有 output.script.sections → 400', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseDraft({ output: { titles: [{ text: '老结构标题' }] } }),
    );
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(400);
  });

  it('无 DEEPSEEK_API_KEY → 503', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(503);
  });

  it('LLM 抛错 → 500', async () => {
    llmMock.callStructured.mockRejectedValueOnce(new Error('LLM down'));
    const res = await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(res.status).toBe(500);
  });

  it('getStyleContext 被以 (userId, "douyin") 调用', async () => {
    llmMock.callStructured.mockResolvedValueOnce({
      result: { sections: baseSections },
      usage: { model: 'deepseek', promptTokens: 10, completionTokens: 10, estCostUSD: 0 },
    });
    await POST(reqJSON({ scope: 'all', instruction: '换个说法' }), ctx);
    expect(getStyleContextMock).toHaveBeenCalledWith('user1', 'douyin');
  });
});
