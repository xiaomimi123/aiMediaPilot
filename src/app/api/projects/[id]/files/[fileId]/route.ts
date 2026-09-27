import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { parseRange } from '@/lib/files/range';

export const dynamic = 'force-dynamic';

// mov/m4v 也按 video/mp4 发: Chrome 对 video/quicktime 常拒播, 而 H.264 的 mov 用 mp4 类型能正常播放
const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/mp4', '.m4v': 'video/mp4', '.json': 'application/json' };

export async function GET(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const f = await prisma.projectFile.findFirst({ where: { id: params.fileId, projectId: params.id } });
  if (!f) return fail('文件不存在', 404);
  const stat = await fs.stat(f.path).catch(() => null);
  if (!stat) return fail('文件不在磁盘上了（可能被移动或删除）', 404);

  const size = stat.size;
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(f.path, { start, end })) as unknown as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'content-type': TYPES[path.extname(f.path).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
