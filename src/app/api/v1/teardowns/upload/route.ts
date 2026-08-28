import { NextRequest } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { ok, fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';
import { teardownQueue } from '@/jobs/queue';

/**
 * 上传对标视频 → 自动转写 → 拆解(二十三期)。
 *
 * 在这条路之前, 拆一条同行的片子要先自己把口播抄下来 —— 表单上那句「视频上传 →
 * 自动转写还没接」挂了很久, 而 ASR 其实早就有了(真人出镜模式一直在用本地 Whisper)。
 * 这里只是把现成的零件接起来。
 *
 * 走队列而不是同步: 本地 Whisper 约 1x 实时, 一条三分钟的片子要跑三分钟, 撑不住
 * 一个 HTTP 请求。贴转写稿那条路仍然是同步的 —— 那一步几秒钟就完了, 没必要牵扯
 * worker。
 */

const ALLOWED_VIDEO_MIME = /^video\/(mp4|quicktime|webm|x-matroska)$/;
const MAX_BYTES = 500 * 1024 * 1024;

/** 只接受简单字母数字扩展名, 防构造文件名拼出越权路径(同 upload-source 路由)。 */
function safeExt(name: string | undefined, fallback: string): string {
  const raw = (name ?? '').split('.').pop() ?? '';
  return /^[a-zA-Z0-9]{1,5}$/.test(raw) ? raw.toLowerCase() : fallback;
}

export async function POST(req: NextRequest) {
  const user = await getOrCreateDefaultUser();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail('multipart 解析失败', 400);
  }

  const video = form.get('video');
  if (!(video instanceof File)) return fail('缺少 video 字段', 400);
  if (!ALLOWED_VIDEO_MIME.test(video.type)) return fail(`不支持的视频格式: ${video.type}`, 400);
  if (video.size > MAX_BYTES) {
    return fail(`视频超过 500MB 上限 (${(video.size / 1024 / 1024).toFixed(1)} MB)`, 400);
  }

  const title = String(form.get('title') ?? '').trim();
  if (title.length === 0 || title.length > 120) return fail('标题必填, 120 字以内', 400);
  const author = String(form.get('author') ?? '').trim().slice(0, 60);
  const url = String(form.get('url') ?? '').trim().slice(0, 500);

  // 先建记录拿到 id, 再按 id 建目录 —— 目录名用 id 才不会和别的拆解撞
  const created = await prisma.teardown.create({
    data: { userId: user.id, title, author, url, transcript: '', status: 'transcribing' },
  });

  const dir = path.join(process.cwd(), 'teardowns', created.id);
  await fs.mkdir(dir, { recursive: true });
  const sourceVideoPath = path.join(dir, `source.${safeExt(video.name, 'mp4')}`);
  await fs.writeFile(sourceVideoPath, Buffer.from(await video.arrayBuffer()));

  await prisma.teardown.update({ where: { id: created.id }, data: { sourceVideoPath } });
  await teardownQueue.add('teardown', { teardownId: created.id });

  return ok({ teardownId: created.id, status: 'transcribing' });
}
