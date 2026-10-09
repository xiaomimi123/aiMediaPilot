import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { toProjectView } from '@/lib/project/view';
import { createFromOwnScript, createProject } from '@/lib/project/create';
import { DEFAULT_TARGET_SEC, type Script } from '@/lib/script/model';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  return ok(rows.map(toProjectView));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string; script?: Script; targetSec?: number; voiceSampleText?: string };
  // 「我自己写了一篇」: 带脚本建作品, 原文存为说话样本
  if (body.script) {
    const targetSec = Number.isInteger(body.targetSec) && body.targetSec! >= 15 && body.targetSec! <= 300 ? body.targetSec! : DEFAULT_TARGET_SEC;
    try {
      const p = await createFromOwnScript(prisma, { title: body.title, script: body.script, targetSec, originalText: String(body.voiceSampleText ?? '') });
      return ok(toProjectView(p));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), 400);
    }
  }
  const p = await createProject(prisma, body.title);
  return ok(toProjectView(p));
}
