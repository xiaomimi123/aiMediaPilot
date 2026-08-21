import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';

const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-matroska)$/;

/** Only allow simple alphanum extensions (1-5 chars) to prevent path traversal via crafted filenames. */
function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

/**
 * 真人出镜模式 (talking-head-broll) 出镜视频上传 (十九期 T3)。
 * 只有该模式需要用户上传自己拍摄的素材；其它模式 (ppt-narration/illustration-tts)
 * 不消费此路由。
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('生成任务不存在', 404);
  if (vp.mode !== 'talking-head-broll') return fail('只有真人出镜模式需要上传视频', 400);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('multipart 解析失败', 400);
  }
  const video = form.get('video');
  if (!(video instanceof File)) return fail('缺少 video 字段', 400);
  if (!ALLOWED_VIDEO_MIME.test(video.type)) return fail(`不支持的视频格式: ${video.type}`, 400);
  if (video.size > MAX_BYTES) return fail(`视频超过 500MB 上限 (${(video.size / 1024 / 1024).toFixed(1)} MB)`, 400);

  const ext = safeExt(video.name, 'mp4');
  const sourceVideoPath = path.join(vp.productionRoot, `source.${ext}`);
  await fs.writeFile(sourceVideoPath, Buffer.from(await video.arrayBuffer()));

  const updated = await prisma.videoProduction.update({
    where: { id: params.id },
    data: { sourceVideoPath, status: 'source_uploaded', updatedAt: new Date().toISOString() },
  });
  return ok({ sourceVideoPath: updated.sourceVideoPath, status: updated.status });
}
