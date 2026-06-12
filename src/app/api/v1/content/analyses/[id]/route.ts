import { promises as fs } from 'fs';
import path from 'path';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);
  return ok(a);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const a = await prisma.contentAnalysis.findUnique({ where: { id: params.id } });
  if (!a) return fail('not found', 404);

  // Fix 6: reject DELETE while worker is running — user must cancel first
  if (a.status === 'QUEUED' || a.status === 'PREPROCESSING' || a.status === 'ANALYZING') {
    return fail('任务运行中无法删除,请先取消', 400);
  }

  // 删除磁盘文件 (整个 analysis 目录)
  const UPLOADS_ROOT = process.env.UPLOADS_ROOT || './uploads';
  const analysisDir = path.join(UPLOADS_ROOT, a.id);
  await fs.rm(analysisDir, { recursive: true, force: true }).catch(() => {});

  await prisma.contentAnalysis.delete({ where: { id: params.id } });
  return ok({ id: params.id });
}
