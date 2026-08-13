import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config as loadEnv } from 'dotenv';

// vitest 不会像 Next.js 那样自动把 .env 灌进 process.env —— 显式加载, 必须排在
// `new PrismaClient()` 之前 (PrismaClient 构造时才读 DATABASE_URL, import 语句
// 本身不触发)。
loadEnv();

import { PrismaClient, Prisma } from '@prisma/client';
import { writeGeneratedImage } from '@/lib/image/write-generated-image';

/**
 * `writeGeneratedImage` 真实连 Postgres 的集成测试 (docker compose 的
 * mediapilot-postgres, 见仓库 README「快速开始」)。
 *
 * 起因: mock 断言层曾经全绿, 但复审在真实 Postgres 15/16 上实测发现
 * `jsonb_set(output, ARRAY['images', idx], record, true)` 的 create_missing
 * 只对 path 最后一级生效 —— `output.images` 父键不存在时 (出图计划路由从不
 * 预先初始化该键, 每篇稿子第一次生图必然如此) 整条 UPDATE 静默 no-op, 首图
 * 请求 200 成功但根本没落库。mock 测试测不出这类"SQL 语义与预期不符"的问题,
 * 所以这里直接对真实数据库跑 `writeGeneratedImage`, 用 `findUnique` 读回验证
 * 落库结果, 而不是断言 SQL 参数形状。
 *
 * 若本机没有起 Postgres (docker compose up -d postgres), `beforeAll` 里的
 * `$connect()` 会直接抛错让整个 describe 失败 —— 有意不做静默 skip: 这条测试
 * 存在的意义就是防止"mock 断言看起来对但真实写库行为是错的"这类回归再次溜过去。
 */
describe('writeGeneratedImage — 真实 Postgres 集成测试', () => {
  const prisma = new PrismaClient();
  const userId = 'itest-write-generated-image-user';
  const draftId = 'itest-write-generated-image-draft';

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.scriptDraft.deleteMany({ where: { id: draftId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({ data: { id: userId, name: 'write-generated-image itest user' } });
  });

  afterAll(async () => {
    await prisma.scriptDraft.deleteMany({ where: { id: draftId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  async function seedDraft(output: Record<string, unknown>) {
    await prisma.scriptDraft.deleteMany({ where: { id: draftId } });
    await prisma.scriptDraft.create({
      data: {
        id: draftId,
        userId,
        topic: 't',
        niche: 'n',
        platform: 'xiaohongshu',
        output: output as Prisma.InputJsonValue,
      },
    });
  }

  async function readImages(): Promise<Record<string, unknown>> {
    const row = await prisma.scriptDraft.findUniqueOrThrow({ where: { id: draftId } });
    return (row.output as Record<string, unknown>).images as Record<string, unknown>;
  }

  beforeEach(async () => {
    await seedDraft({ coverText: 'x' }); // 关键: 不含 images 键, 复现每篇稿子首次生图的真实状态
  });

  it('① output 无 images 键时, 首图写入真实落库 (回归: jsonb_set 父键不存在时静默 no-op)', async () => {
    await writeGeneratedImage(prisma, draftId, 0, {
      path: '/generated/x/0.png',
      prompt: 'p0',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const row = await prisma.scriptDraft.findUniqueOrThrow({ where: { id: draftId } });
    const output = row.output as Record<string, unknown>;
    // 修复前 (jsonb_set 版本) 这里 output 会原样等于种子值 { coverText: 'x' } ——
    // UPDATE 静默 no-op, images 键根本不会出现。
    expect(output.coverText).toBe('x'); // 其余键不受影响
    expect(output.images).toEqual({
      '0': { path: '/generated/x/0.png', prompt: 'p0', createdAt: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('② 顺序两次写不同 idx 互不覆盖', async () => {
    await writeGeneratedImage(prisma, draftId, 0, { path: '/p0', prompt: 'p0', createdAt: 'a' });
    await writeGeneratedImage(prisma, draftId, 1, { path: '/p1', prompt: 'p1', createdAt: 'b' });

    expect(await readImages()).toEqual({
      '0': { path: '/p0', prompt: 'p0', createdAt: 'a' },
      '1': { path: '/p1', prompt: 'p1', createdAt: 'b' },
    });
  });

  it('③ 并发写不同 idx 互不覆盖 (Promise.all 真并发, 复现 T5 前端池并发 2 对同一 draftId 不同 idx 同时 POST)', async () => {
    await Promise.all([
      writeGeneratedImage(prisma, draftId, 0, { path: '/p0', prompt: 'p0', createdAt: 'a' }),
      writeGeneratedImage(prisma, draftId, 1, { path: '/p1', prompt: 'p1', createdAt: 'b' }),
      writeGeneratedImage(prisma, draftId, 2, { path: '/p2', prompt: 'p2', createdAt: 'c' }),
    ]);

    // 三次并发写全部落库且互不覆盖 —— 证明 Postgres 行锁串行化了并发 UPDATE,
    // 每次写入都基于行内最新值合并 (而不是各自基于生成前读到的旧快照覆盖)。
    expect(await readImages()).toEqual({
      '0': { path: '/p0', prompt: 'p0', createdAt: 'a' },
      '1': { path: '/p1', prompt: 'p1', createdAt: 'b' },
      '2': { path: '/p2', prompt: 'p2', createdAt: 'c' },
    });
  });

  it('④ 覆盖写: 同 idx 再次写入覆盖旧值, 不影响其他 idx', async () => {
    await seedDraft({
      coverText: 'x',
      images: {
        0: { path: '/old', prompt: 'old prompt', createdAt: 'old' },
        1: { path: '/p1', prompt: 'p1', createdAt: 'b' },
      },
    });

    await writeGeneratedImage(prisma, draftId, 0, { path: '/new', prompt: 'new prompt', createdAt: 'new' });

    expect(await readImages()).toEqual({
      '0': { path: '/new', prompt: 'new prompt', createdAt: 'new' },
      '1': { path: '/p1', prompt: 'p1', createdAt: 'b' },
    });
  });
});
