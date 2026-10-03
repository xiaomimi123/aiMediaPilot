import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { getFilmModel, setFilmModel } from '@/lib/film-session/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok({ model: await getFilmModel(prisma) });
}

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { model?: string };
  try {
    await setFilmModel(prisma, String(b.model ?? ''));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
  return ok({ model: await getFilmModel(prisma) });
}
