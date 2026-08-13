import { z } from 'zod';
import { readFile } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * zip 发布包下载 — 把已生成的小红书图文笔记 (标题/正文/标签) + 已出的配图打包成
 * 一个 zip 文件, 供用户一次性下载发布素材。
 *
 * 二进制响应例外: 本路由返回原始 zip 字节流, 不走全站 `ok()` JSON 包裹约定
 * (与 `content/analyses/[id]/cover/[idx]/route.ts` 的图片二进制响应同一先例) ——
 * `Content-Type: application/zip` 本身就是响应体的真实类型, 硬套 JSON 包裹反而
 * 需要客户端先转 base64 再解包, 得不偿失。
 */

// 防御性读取 ScriptDraft.output — 只关心打包所需的字段, 其余键原样忽略 (本路由不写库)。
const OutputReadSchema = z
  .object({
    titles: z.array(z.object({ text: z.string() })).min(1),
    intro: z.string(),
    body: z.string(),
    tags: z.array(z.string()).optional().default([]),
    images: z
      .record(z.string(), z.object({ path: z.string(), prompt: z.string(), createdAt: z.string() }))
      .optional(),
  })
  .passthrough();

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const user = await getOrCreateDefaultUser();
  const draft = await prisma.scriptDraft.findUnique({
    where: { id },
    select: { id: true, userId: true, topic: true, platform: true, output: true },
  });
  if (!draft || draft.userId !== user.id) return fail('脚本不存在', 404);
  if (draft.platform !== 'xiaohongshu') return fail('仅支持小红书脚本出图', 400);

  const parsedOutput = OutputReadSchema.safeParse(draft.output);
  if (!parsedOutput.success) return fail('该脚本还没有可打包的图文笔记, 请先生成', 400);

  const { titles, intro, body, tags, images } = parsedOutput.data;
  const entries = Object.entries(images ?? {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  if (entries.length === 0) return fail('该脚本还没有生成任何配图, 请先出图', 400);

  const zip = new JSZip();
  let addedCount = 0;
  for (const [idx, img] of entries) {
    const filePath = path.join(process.cwd(), 'public', img.path);
    try {
      const buf = await readFile(filePath);
      zip.file(`${idx}.png`, buf);
      addedCount += 1;
    } catch (e) {
      console.warn(`[GET scripts/images/archive] 第 ${idx} 张配图文件缺失, 跳过`, filePath, e);
    }
  }
  if (addedCount === 0) return fail('配图文件均已缺失, 请重新出图后再打包', 400);

  const noteText = [
    titles[0].text,
    intro,
    body,
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n\n');
  zip.file('note.txt', noteText);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const filename = `${draft.topic}-发布包.zip`;

  // Response 的 BodyInit 类型 (lib.dom) 与 Node Buffer/Uint8Array 的类型参数对不上
  // (@types/node 与 lib.dom 的 TypedArray 泛型冲突), 运行时 Buffer 本就是合法 body ——
  // 与 `content/analyses/[id]/cover/[idx]/route.ts` 的同类二进制响应同一处理方式。
  return new Response(buffer as any, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
