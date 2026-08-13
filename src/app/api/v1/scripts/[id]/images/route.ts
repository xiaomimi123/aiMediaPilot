import { z } from 'zod';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { getImageProvider } from '@/lib/image/provider';
import { resolveImageApiKey } from '@/lib/llm/resolve-image-key';
import { ImagePlanSchema } from '@/lib/llm/prompts/image-plan';

/**
 * 逐张生图路由 — 按 output.imagePlan 里指定 idx 的 prompt 生成单张配图,
 * 写盘 `public/generated/<draftId>/<idx>.png` (mkdir recursive, 覆盖), 并把
 * `{ path, prompt, createdAt }` 落到 `output.images[idx]`。
 *
 * 一次只生一张 (前端逐张调用, 便于单张重试/展示进度), 不做批量。前端对同一
 * draftId 的多个 idx 会并发调用本路由 (池并发 2) —— provider.generate() 耗时
 * 30-120s, 若写库时用"生成前读到的 output 快照" spread 拼装, 两个并发请求都会
 * 拼着同一份陈旧快照, 后落库的会把先落库那张的 images[idx] 记录静默覆盖掉。
 * 因此落库不用 update + spread, 改用 `$executeRaw` + `jsonb_set` 对
 * output.images[idx] 做数据库层原子单键写入 (基于行内当前值, Postgres 行锁
 * 天然串行化并发 UPDATE), 生成前的快照读取只用于 plan/idx 存在性校验。
 */

const BodySchema = z.object({
  idx: z.number().int().min(0),
  quality: z.enum(['low', 'medium', 'high']).optional(),
});

// 防御性读取 ScriptDraft.output — 只关心出图所需的 imagePlan/images 两个字段,
// 其余键原样透传。
const OutputReadSchema = z
  .object({
    imagePlan: ImagePlanSchema,
    images: z
      .record(
        z.string(),
        z.object({ path: z.string(), prompt: z.string(), createdAt: z.string() }),
      )
      .optional(),
  })
  .passthrough();

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail('请求体不是合法 JSON', 400);
  }

  const parsedBody = BodySchema.safeParse(rawBody);
  if (!parsedBody.success) return fail('idx 必须是非负整数, quality 必须是 low/medium/high', 400);
  const { idx, quality = 'medium' } = parsedBody.data;

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true, platform: true, output: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  if (draft.platform !== 'xiaohongshu') return fail('仅支持小红书脚本出图', 400);

  const parsedOutput = OutputReadSchema.safeParse(draft.output);
  if (!parsedOutput.success) return fail('该脚本还没有出图计划, 请先生成', 400);

  const { imagePlan } = parsedOutput.data;
  // 按 idx 字段匹配, 不用数组下标 — imagePlan.images 每个元素自带 idx, 但 LLM
  // 输出顺序不保证与 idx 一致, 数组下标取值在错位时会静默拿到别张图的 prompt。
  const planImage = imagePlan.images.find((img) => img.idx === idx);
  if (!planImage) return fail(`出图计划中没有第 ${idx + 1} 张`, 400);

  const apiKey = await resolveImageApiKey(user.id);
  if (!apiKey) return fail('OpenAI 生图 key 未配置', 503);

  const prompt = planImage.prompt;
  const provider = getImageProvider(apiKey);

  let buf: Buffer;
  try {
    buf = await provider.generate({ prompt, size: '1024x1536', quality });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[POST scripts/images]', e);
    return fail(`第 ${idx + 1} 张生成失败: ${msg}`, 502);
  }

  const dir = path.join(process.cwd(), 'public', 'generated', id);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${idx}.png`), buf);
  } catch (e) {
    console.error('[POST scripts/images] 写盘失败', e);
    return fail('图片写入失败, 请重试', 500);
  }

  const relPath = `/generated/${id}/${idx}.png`;
  const record = { path: relPath, prompt, createdAt: new Date().toISOString() };
  // 原子写: 基于行内当前值单键更新 output.images[idx], 不依赖生成前读到的快照,
  // 消除并发生图请求互相覆盖对方落库结果的竞态 (见文件头注释)。
  await prisma.$executeRaw`UPDATE "ScriptDraft" SET output = jsonb_set(output, ARRAY['images', ${String(idx)}], ${JSON.stringify(record)}::jsonb, true) WHERE id = ${id}`;

  return ok({ idx, path: relPath });
}
