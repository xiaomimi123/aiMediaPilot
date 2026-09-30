import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { toProjectView } from '@/lib/project/view';
import { createProject } from '@/lib/project/create';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
  return ok(rows.map(toProjectView));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const p = await createProject(prisma, body.title);
  return ok(toProjectView(p));
}
