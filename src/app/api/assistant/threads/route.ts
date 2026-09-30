import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

const view = (t: { id: string; title: string; updatedAt: Date }) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt.toISOString() });

export async function GET() {
  const rows = await prisma.assistantThread.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 });
  return ok(rows.map(view));
}

export async function POST() {
  return ok(view(await prisma.assistantThread.create({ data: {} })));
}
