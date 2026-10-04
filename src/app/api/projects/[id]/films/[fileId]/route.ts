import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { deleteFilm, FilmInUse } from '@/lib/film/delete';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string; fileId: string } }) {
  try {
    return ok(await deleteFilm(prisma, params.id, params.fileId));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), e instanceof FilmInUse ? 409 : 404);
  }
}
