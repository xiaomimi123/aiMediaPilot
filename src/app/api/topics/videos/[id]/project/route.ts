import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createProjectFromVideo } from '@/lib/benchmark/adopt';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { title } = (await req.json().catch(() => ({}))) as { title?: string };
  const v = await prisma.benchmarkVideo.findUnique({ where: { id: params.id } });
  if (!v) return fail('找不到这条作品', 404);
  const p = await createProjectFromVideo(prisma, v.id, typeof title === 'string' ? title : undefined);
  return ok({ projectId: p.id });
}
