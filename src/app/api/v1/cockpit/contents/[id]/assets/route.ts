import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

const KINDS = ['image', 'table', 'text'] as const;
const IMAGE_MIME = /^image\/(png|jpeg|jpg|webp|gif)$/;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 20_000;

/** 内容素材根目录 —— 与 VIDEO_PRODUCTION_ROOT / VIDEO_TEMPLATE_ROOT 同一范式。 */
export function contentAssetDir(contentId: string): string {
  return path.join(process.env.CONTENT_ASSET_ROOT || './content-assets', contentId);
}

/** 只接受简单字母数字扩展名, 防构造文件名拼出越权路径(同 upload-source 的 safeExt)。 */
function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

async function ownedContent(contentId: string) {
  const user = await getOrCreateDefaultUser();
  const content = await prisma.cockpitContent.findUnique({ where: { id: contentId } });
  if (!content || content.userId !== user.id) return null;
  return user;
}

/**
 * 内容专属真实素材的上传(二十一期方向 B)。
 *
 * 为什么必须让用户写描述: Builder 靠它判断该在哪一镜用这份素材。只说"有 3 张图"
 * 的话, 实测模型要么乱塞要么干脆不用。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await ownedContent(params.id);
  if (!user) return fail('内容不存在', 404);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('multipart 解析失败', 400); }

  const kind = form.get('kind');
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    return fail('kind 必须是 image/table/text', 400);
  }

  const description = form.get('description');
  if (typeof description !== 'string' || !description.trim()) {
    return fail('请写一句素材说明——Builder 靠它判断该在哪一镜用这份素材', 400);
  }

  const now = new Date().toISOString();
  const id = randomUUID().slice(0, 12);
  const base = {
    id, userId: user.id, contentId: params.id,
    kind, description: description.trim(), createdAt: now,
  };

  if (kind === 'image') {
    const file = form.get('file');
    if (!(file instanceof File)) return fail('缺少 file 字段', 400);
    if (!IMAGE_MIME.test(file.type)) return fail(`不支持的图片格式: ${file.type}`, 400);
    if (file.size > MAX_IMAGE_BYTES) return fail('图片超过 20MB 上限', 400);

    const dir = contentAssetDir(params.id);
    await fs.mkdir(dir, { recursive: true });
    // 文件名与用户输入完全脱钩, 只保留扩展名 —— 恶意文件名这条路直接堵死
    const fileName = `${id}.${safeExt(file.name, 'png')}`;
    const filePath = path.join(dir, fileName);
    await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer()));

    const created = await prisma.contentAsset.create({
      data: { ...base, fileName, filePath, text: null },
    });
    return ok({ asset: created });
  }

  const text = form.get('text');
  if (typeof text !== 'string' || !text.trim()) return fail('素材内容不能为空', 400);
  if (text.length > MAX_TEXT_CHARS) return fail('素材内容过长', 400);

  const created = await prisma.contentAsset.create({
    data: { ...base, fileName: null, filePath: null, text: text.trim() },
  });
  return ok({ asset: created });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await ownedContent(params.id);
  if (!user) return fail('内容不存在', 404);

  const assets = await prisma.contentAsset.findMany({
    where: { userId: user.id, contentId: params.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, kind: true, description: true, fileName: true, text: true, createdAt: true },
  });
  return ok({ assets });
}
