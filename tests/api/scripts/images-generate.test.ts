import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/image/provider', () => ({
  getImageProvider: vi.fn(() => ({ generate: generateMock })),
}));

vi.mock('@/lib/llm/resolve-image-key', () => ({
  resolveImageApiKey: vi.fn(async () => process.env.IMAGE_API_KEY ?? null),
}));

vi.mock('@/lib/user', () => ({
  getOrCreateDefaultUser: vi.fn(async () => ({ id: 'user1' })),
}));

const prismaMock = vi.hoisted(() => ({
  scriptDraft: {
    findUnique: vi.fn(),
  },
  $executeRaw: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const mkdirMock = vi.hoisted(() => vi.fn(async () => undefined));
const writeFileMock = vi.hoisted(() => vi.fn(async (_path: unknown, _data: unknown) => undefined));
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, mkdir: mkdirMock, writeFile: writeFileMock };
});

import { POST } from '@/app/api/v1/scripts/[id]/images/route';

function reqPOST(body: unknown, url = 'http://t/api/v1/scripts/draft1/images') {
  return new Request(url, { method: 'POST', body: JSON.stringify(body) });
}

const ctx = { params: Promise.resolve({ id: 'draft1' }) };

const validPlan = {
  style: 'minimalist flat illustration, warm pastel palette, soft shadow',
  images: [
    { idx: 0, prompt: 'render the Chinese headline text as bold poster-style large text overlay, portrait 3:4' },
    { idx: 1, prompt: 'a screenshot mockup of a poster with big Chinese cover text, portrait 3:4 composition' },
    { idx: 2, prompt: 'a close-up of a ChatGPT input box showing a prompt example, portrait 3:4 composition' },
  ],
};

function baseXhsDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'draft1',
    userId: 'user1',
    platform: 'xiaohongshu',
    output: { coverText: 'x', imagePlan: validPlan },
    ...overrides,
  };
}

// $executeRaw 以 tagged template 形式调用: prisma.$executeRaw`...${a}...${b}...${c}`
// 在 mock 下等价于 prismaMock.$executeRaw(stringsArray, a, b, c) —— 本文件里
// SQL 固定是
// `UPDATE ... SET output = output || jsonb_build_object('images', coalesce(output->'images','{}'::jsonb) || jsonb_build_object(${idxParam}, ${jsonParam}::jsonb)) WHERE id = ${idParam}`,
// 所以每次调用的参数数组形状固定为 [strings, idxParam(string), jsonParam(string), idParam(string)]。
// (用 `||` + `coalesce(output->'images','{}')` 而不是 `jsonb_set(..., true)` 是因为
// jsonb_set 的 create_missing 只对 path 最后一级生效, 父键 images 不存在时会静默
// no-op —— 见路由文件头注释, 这是本轮修复的核心 bug。)
function rawCallArgs(call: unknown[]) {
  const [, idxParam, jsonParam, idParam] = call as [unknown, string, string, string];
  return { idxParam, record: JSON.parse(jsonParam), idParam };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.IMAGE_API_KEY = 'sk-test';
  prismaMock.scriptDraft.findUnique.mockResolvedValue(baseXhsDraft());
  prismaMock.$executeRaw.mockResolvedValue(undefined);
  generateMock.mockResolvedValue(Buffer.from('fake-png-bytes'));
});

describe('POST /api/v1/scripts/[id]/images — 成功', () => {
  it('生成成功: 写盘路径正确, $executeRaw 原子写参数形状正确, ok 响应 { idx, path }', async () => {
    const res = await POST(reqPOST({ idx: 1 }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ idx: 1, path: '/generated/draft1/1.png' });

    expect(mkdirMock).toHaveBeenCalledWith(
      expect.stringContaining(`${['public', 'generated', 'draft1'].join('/')}`),
      { recursive: true },
    );
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBuf] = writeFileMock.mock.calls[0];
    expect(String(writtenPath)).toMatch(/1\.png$/);
    expect(Buffer.isBuffer(writtenBuf)).toBe(true);

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    const { idxParam, record, idParam } = rawCallArgs(prismaMock.$executeRaw.mock.calls[0]);
    expect(idxParam).toBe('1');
    expect(idParam).toBe('draft1');
    expect(record).toEqual({
      path: '/generated/draft1/1.png',
      prompt: validPlan.images[1].prompt,
      createdAt: expect.any(String),
    });
  });

  it('quality 透传给 provider.generate; 未传时默认 medium', async () => {
    await POST(reqPOST({ idx: 0, quality: 'high' }), ctx);
    expect(generateMock).toHaveBeenCalledWith({
      prompt: validPlan.images[0].prompt,
      size: '1024x1536',
      quality: 'high',
    });

    generateMock.mockClear();
    await POST(reqPOST({ idx: 0 }), ctx);
    expect(generateMock).toHaveBeenCalledWith({
      prompt: validPlan.images[0].prompt,
      size: '1024x1536',
      quality: 'medium',
    });
  });

  it('原子写不 spread 生成前读到的快照: SQL 参数只含当前 idx 的单条 record, 不携带其他 idx 或整份 output', async () => {
    // 读到的快照里 idx 0 已有记录 —— 旧实现会把这份快照 spread 进 update data,
    // 新实现的写路径必须完全不依赖这份快照的 images 内容 (由 DB 端原子表达式
    // 基于行内当前值合并, 而不是应用层 merge)。
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({
        output: {
          coverText: 'x',
          imagePlan: validPlan,
          images: {
            0: { path: '/generated/draft1/0.png', prompt: 'old prompt', createdAt: '2026-01-01T00:00:00.000Z' },
          },
        },
      }),
    );
    await POST(reqPOST({ idx: 1 }), ctx);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    const { idxParam, record } = rawCallArgs(prismaMock.$executeRaw.mock.calls[0]);
    expect(idxParam).toBe('1');
    expect(record).toEqual({
      path: '/generated/draft1/1.png',
      prompt: validPlan.images[1].prompt,
      createdAt: expect.any(String),
    });
    // 写入参数里不应出现 idx 0 的旧记录信息 —— 证明没有把快照整份带进 SQL 参数。
    expect(JSON.stringify(prismaMock.$executeRaw.mock.calls[0])).not.toContain('old prompt');
  });

  it('output 其余键不受影响: 原子表达式只作用于 images[idx] 这一路径, SQL 参数不携带 output 整体', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { coverText: 'x', tags: ['#a'], imagePlan: validPlan } }),
    );
    await POST(reqPOST({ idx: 0 }), ctx);
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);
    const callArgsStr = JSON.stringify(prismaMock.$executeRaw.mock.calls[0]);
    // record 参数只含 {path, prompt, createdAt} —— 不含 coverText/tags/imagePlan,
    // 证明写入不是靠应用层 spread 整份 output 再回写。
    expect(callArgsStr).not.toContain('coverText');
    expect(callArgsStr).not.toContain('imagePlan');
  });

  it('imagePlan.images 乱序 (数组顺序与 idx 字段不一致) → 按 idx 字段匹配取对 prompt', async () => {
    const shuffledPlan = {
      style: validPlan.style,
      images: [
        { idx: 2, prompt: validPlan.images[2].prompt },
        { idx: 0, prompt: validPlan.images[0].prompt },
        { idx: 1, prompt: validPlan.images[1].prompt },
      ],
    };
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({ output: { coverText: 'x', imagePlan: shuffledPlan } }),
    );
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(200);
    expect(generateMock).toHaveBeenCalledWith({
      prompt: validPlan.images[0].prompt,
      size: '1024x1536',
      quality: 'medium',
    });
    const { record } = rawCallArgs(prismaMock.$executeRaw.mock.calls[0]);
    expect(record.prompt).toBe(validPlan.images[0].prompt);
  });

  it('覆盖写: 同 idx 再次生成写入新 record (依赖 DB jsonb_set 覆盖旧值, 不依赖读快照)', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(
      baseXhsDraft({
        output: {
          coverText: 'x',
          imagePlan: validPlan,
          images: {
            1: { path: '/generated/draft1/1.png', prompt: 'stale prompt', createdAt: '2020-01-01T00:00:00.000Z' },
          },
        },
      }),
    );
    await POST(reqPOST({ idx: 1 }), ctx);
    const { record } = rawCallArgs(prismaMock.$executeRaw.mock.calls[0]);
    expect(record.prompt).toBe(validPlan.images[1].prompt);
    expect(record.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('POST /api/v1/scripts/[id]/images — 并发写 (竞态回归)', () => {
  it('两个并发请求写不同 idx: 写路径不依赖生成前读到的快照, 两次 $executeRaw 调用互不覆盖', async () => {
    // 两次请求"生成前"读到的是同一份不含任何 images 的快照 —— 精确复现 T5 前端
    // 并发 2 对同一 draftId 不同 idx 同时 POST 的场景: provider.generate() 耗时
    // 30-120s 期间, 两个请求手里的快照都是生成前那一刻的旧版本。
    //
    // 旧实现: 写库时 `{ ...draft.output, images: { ...existingImages, [idx]: record } }`
    // —— 两次都基于同一份"不含任何 images"的快照 spread, 后落库的 update 会把
    // 先落库请求刚写入的 idx 整个覆盖掉 (因为它的 existingImages 快照里根本没有
    // 对方那条记录)。
    //
    // 新实现: 写库改成 `$executeRaw` 原子单键写入 (见路由文件内 SQL), 断言点 —— 每次调用的 SQL 参数只包含"自己这个 idx 的单条 record", 完全不
    // 引用另一个 idx 或整份 images/output 快照。只要参数形状证明了这一点, 就说明
    // 两次写入在应用层是互相独立的原子单键操作, 由 Postgres 行锁保证串行化,
    // 不存在互相覆盖的可能 —— 竞态在写路径设计上被消除, 而不是靠碰运气不撞车。
    prismaMock.scriptDraft.findUnique.mockResolvedValue(
      baseXhsDraft({ output: { coverText: 'x', imagePlan: validPlan } }),
    );

    const [res0, res1] = await Promise.all([
      POST(reqPOST({ idx: 0 }), ctx),
      POST(reqPOST({ idx: 1 }), ctx),
    ]);
    expect(res0.status).toBe(200);
    expect(res1.status).toBe(200);

    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2);
    const calls = prismaMock.$executeRaw.mock.calls.map(rawCallArgs);
    const call0 = calls.find((c) => c.idxParam === '0');
    const call1 = calls.find((c) => c.idxParam === '1');
    expect(call0).toBeDefined();
    expect(call1).toBeDefined();

    expect(call0!.idParam).toBe('draft1');
    expect(call1!.idParam).toBe('draft1');
    expect(call0!.record).toEqual({
      path: '/generated/draft1/0.png',
      prompt: validPlan.images[0].prompt,
      createdAt: expect.any(String),
    });
    expect(call1!.record).toEqual({
      path: '/generated/draft1/1.png',
      prompt: validPlan.images[1].prompt,
      createdAt: expect.any(String),
    });

    // 互相独立: 每次调用的整段参数序列化后, 都不包含对方 idx 的 path/prompt。
    const raw0 = JSON.stringify(prismaMock.$executeRaw.mock.calls.find((c) => c[1] === '0'));
    const raw1 = JSON.stringify(prismaMock.$executeRaw.mock.calls.find((c) => c[1] === '1'));
    expect(raw0).not.toContain('/1.png');
    expect(raw1).not.toContain('/0.png');
  });
});

describe('POST /api/v1/scripts/[id]/images — 校验', () => {
  it('body idx 缺失/非法类型 → 400, 不调 provider', async () => {
    const res = await POST(reqPOST({}), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('idx 非整数 → 400', async () => {
    const res = await POST(reqPOST({ idx: 1.5 }), ctx);
    expect(res.status).toBe(400);
  });

  it('quality 非法值 → 400, 不调 provider', async () => {
    const res = await POST(reqPOST({ idx: 0, quality: 'ultra' }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('请求体不是合法 JSON → 400', async () => {
    const res = await POST(new Request('http://t/api/v1/scripts/draft1/images', { method: 'POST', body: '{bad' }), ctx);
    expect(res.status).toBe(400);
  });

  it('脚本不存在 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(null);
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(404);
  });

  it('跨用户 → 404', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ userId: 'other' }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(404);
  });

  it('非小红书平台 → 400, 不调 provider', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ platform: 'douyin' }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('无 imagePlan → 400, 不调 provider', async () => {
    prismaMock.scriptDraft.findUnique.mockResolvedValueOnce(baseXhsDraft({ output: { coverText: 'x' } }));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('idx 越界 (计划中没有该 idx) → 400 文案「出图计划中没有第 <idx+1> 张」, 不调 provider', async () => {
    const res = await POST(reqPOST({ idx: 99 }), ctx);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toBe('出图计划中没有第 100 张');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('无 key → 503 文案「OpenAI 生图 key 未配置」, 不调 provider, 不写库', async () => {
    delete process.env.IMAGE_API_KEY;
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.message).toBe('OpenAI 生图 key 未配置');
    expect(generateMock).not.toHaveBeenCalled();
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/images — provider 失败', () => {
  it('provider throw → 502 文案含「第 <idx+1> 张生成失败」, 不写库, 不写盘记录', async () => {
    generateMock.mockRejectedValueOnce(new Error('rate limited'));
    const res = await POST(reqPOST({ idx: 1 }), ctx);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('第 2 张生成失败');
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/scripts/[id]/images — 写盘失败', () => {
  it('writeFile reject → 500 文案「图片写入失败, 请重试」, 不写库', async () => {
    writeFileMock.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toBe('图片写入失败, 请重试');
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });

  it('mkdir reject → 500 文案「图片写入失败, 请重试」, 不写库', async () => {
    mkdirMock.mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const res = await POST(reqPOST({ idx: 0 }), ctx);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.message).toBe('图片写入失败, 请重试');
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled();
  });
});
