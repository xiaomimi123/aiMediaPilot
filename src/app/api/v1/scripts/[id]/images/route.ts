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
 * `{ path, prompt, createdAt }` 落到 `output.images[idx]` (spread 保留其余 idx
 * 与 output 其余键)。
 *
 * 一次只生一张 (前端逐张调用, 便于单张重试/展示进度), 不做批量。
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

  const { imagePlan, images: existingImages } = parsedOutput.data;
  if (idx >= imagePlan.images.length) return fail('idx 超出出图计划范围', 400);

  const apiKey = await resolveImageApiKey(user.id);
  if (!apiKey) return fail('OpenAI 生图 key 未配置', 503);

  const prompt = imagePlan.images[idx].prompt;
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
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${idx}.png`), buf);

  const relPath = `/generated/${id}/${idx}.png`;
  await prisma.scriptDraft.update({
    where: { id },
    data: {
      output: {
        ...(draft.output as Record<string, unknown>),
        images: {
          ...(existingImages ?? {}),
          [idx]: { path: relPath, prompt, createdAt: new Date().toISOString() },
        },
      },
    },
  });

  return ok({ idx, path: relPath });
}
