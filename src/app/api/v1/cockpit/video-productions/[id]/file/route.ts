import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';
import { prisma } from '@/lib/prisma';

/**
 * 预览片 / 正式成片文件流 (十五期收尾 E2E 修复) — `VideoProduction.previewPath`/
 * `masterPath` 落的是渲染 worker 写盘用的服务器文件系统路径 (如
 * `./video-productions/<id>/preview.mp4`)，不是浏览器可直接请求的 URL；面板原先
 * 把它直接塞进 `<video src>`/`<a href>` 拿不到任何字节。这里补一条按 kind 取文件、
 * 支持 Range 请求 (播放器拖进度条依赖它) 的流式下载路由，权属校验与其它路由一致。
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getOrCreateDefaultUser();
  const vp = await prisma.videoProduction.findUnique({ where: { id: params.id } });
  if (!vp || vp.userId !== user.id) return fail('不存在', 404);

  const kind = new URL(req.url).searchParams.get('kind');
  const filePath = kind === 'master' ? vp.masterPath : vp.previewPath;
  if (!filePath) return fail('文件尚未生成', 404);

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
    const nodeStream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 206,
      headers: {
        'content-type': 'video/mp4',
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
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': String(size),
    },
  });
}
