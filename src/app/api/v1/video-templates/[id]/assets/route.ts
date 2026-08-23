import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { templateAssetDir } from '@/lib/video-template/store';

const KIND_SPEC = {
  bgm: {
    field: 'bgmPath' as const,
    mime: /^audio\/(mpeg|mp3|wav|x-wav|x-m4a|mp4|aac)$/,
    maxBytes: 50 * 1024 * 1024,
    fallbackExt: 'mp3',
  },
  intro: {
    field: 'introPath' as const,
    mime: /^video\/(mp4|quicktime|webm|x-matroska)$/,
    maxBytes: 200 * 1024 * 1024,
    fallbackExt: 'mp4',
  },
  outro: {
    field: 'outroPath' as const,
    mime: /^video\/(mp4|quicktime|webm|x-matroska)$/,
    maxBytes: 200 * 1024 * 1024,
    fallbackExt: 'mp4',
  },
};

/** 只接受简单字母数字扩展名, 防构造文件名拼出越权路径(同 upload-source 路由的 safeExt)。 */
function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

/** 模板素材上传(二十期): BGM / 片头 / 片尾, 素材全部由用户自己上传(spec §2.3)。 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const t = await prisma.videoTemplate.findUnique({ where: { id: params.id } });
  if (!t || t.userId !== user.id) return fail('模板不存在', 404);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('multipart 解析失败', 400); }

  const kind = form.get('kind');
  if (typeof kind !== 'string' || !(kind in KIND_SPEC)) return fail('kind 必须是 bgm/intro/outro', 400);
  const spec = KIND_SPEC[kind as keyof typeof KIND_SPEC];

  const file = form.get('file');
  if (!(file instanceof File)) return fail('缺少 file 字段', 400);
  if (!spec.mime.test(file.type)) return fail(`不支持的文件格式: ${file.type}`, 400);
  if (file.size > spec.maxBytes) {
    return fail(`文件超过 ${(spec.maxBytes / 1024 / 1024).toFixed(0)}MB 上限`, 400);
  }

  const dir = templateAssetDir(params.id);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${kind}.${safeExt(file.name, spec.fallbackExt)}`);
  await fs.writeFile(dest, Buffer.from(await file.arrayBuffer()));

  await prisma.videoTemplate.update({
    where: { id: params.id },
    data: { [spec.field]: dest, updatedAt: new Date().toISOString() },
  });
  return ok({ [spec.field]: dest });
}
