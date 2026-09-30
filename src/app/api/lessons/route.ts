import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { toLessonView } from '@/lib/retro/view';

export const dynamic = 'force-dynamic';

export async function GET() {
  const rows = await prisma.writingLesson.findMany({ where: { status: { not: 'rejected' } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  return ok(rows.map(toLessonView));
}
