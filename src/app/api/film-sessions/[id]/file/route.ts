import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { parseRange } from '@/lib/files/range';
import { resolveSessionFile } from '@/lib/film-session/files';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/** 出片过程里的关键帧截图与成片预览: 只读该会话片子目录内的 png / mp4 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const s = await prisma.filmSession.findUnique({ where: { id: params.id } });
  if (!s?.filmDir) return fail('文件不存在', 404);
  const full = resolveSessionFile(path.join(process.cwd(), s.filmDir), new URL(req.url).searchParams.get('path') ?? '');
  if (!full) return fail('文件不存在', 404);
  const stat = await fs.stat(full).catch(() => null);
  if (!stat) return fail('文件不存在', 404);

  const size = stat.size;
  const range = parseRange(req.headers.get('range'), size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(full, { start, end })) as unknown as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'content-type': TYPES[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(end - start + 1),
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
      ...(range ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
