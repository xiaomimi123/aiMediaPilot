import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 三十二期 Task 4: 剪辑台「整片预览」音频流 —— `@remotion/player` 播 TTS 人声，
 * Player 拖时间轴要能 seek，所以必须支持 Range 请求(206 + Content-Range +
 * Accept-Ranges)，不能只做全量返回；否则拖进度条时浏览器拿不到中间字节。
 * 形状照抄同目录 `[id]/file` 路由：鉴权用 getOrCreateDefaultUser + vp.userId
 * 比对，404 口径也一致(别人的任务返 404，不泄漏存在性)。
 *
 * 音频文件路径固定为 `<productionRoot>/tts-audio.wav`。文件不存在是「无声任务」
 * 的正常情形 —— 例如 ppt-narration 没配 TTS 时出的片就没有人声轨，不是错误，
 * 同样返回 404，前端据此决定 Player 是否挂音频轨。
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  const filePath = path.join(vp.productionRoot, 'tts-audio.wav');

  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return fail('文件不存在', 404);
  }

  const range = req.headers.get('range');
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match?.[2] ? parseInt(match[2], 10) : size - 1;

    if (start >= size || end >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'content-range': `bytes */${size}` },
      });
    }

    const nodeStream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        'content-type': 'audio/wav',
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    });
  }

  const nodeStream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 200,
    headers: {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
      'content-length': String(size),
    },
  });
}
