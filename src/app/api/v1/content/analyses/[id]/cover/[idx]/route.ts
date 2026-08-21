import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';

export async function GET(_req: Request, { params }: { params: { id: string; idx: string } }) {
  const user = await getOrCreateDefaultUser();
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a || a.userId !== user.id) return fail('not found', 404);
  const candidates = (a.coverCandidates as { path: string }[] | null) ?? [];
  const idx = parseInt(params.idx, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= candidates.length) return fail('out of range', 404);

  // 校验路径在 analysis 目录内 (防 path traversal)
  const UPLOADS_ROOT = path.resolve(process.env.UPLOADS_ROOT || './uploads');
  const expectedPrefix = path.resolve(UPLOADS_ROOT, a.id);
  const resolved = path.resolve(candidates[idx].path);
  if (!resolved.startsWith(expectedPrefix + path.sep)) return fail('forbidden', 403);

  const buf = await fs.readFile(resolved);
  return new Response(buf as any, {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=3600' },
  });
}
