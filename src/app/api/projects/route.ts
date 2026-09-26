import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { toProjectView } from '@/lib/project/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  return ok(rows.map(toProjectView));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const persona = await prisma.personaProfile.findUnique({ where: { id: 'me' } });
  const p = await prisma.project.create({
    data: {
      title: body.title?.trim() || '未命名项目',
      // 经 JSON 往返: 行里的 updatedAt 是 Date, Json 列只收纯 JSON 值
      personaSnapshot: persona ? (JSON.parse(JSON.stringify(persona)) as Prisma.InputJsonValue) : undefined,
    },
  });
  return ok(toProjectView(p));
}
