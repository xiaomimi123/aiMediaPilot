import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { createDraft, listDrafts } from '@/lib/draft/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok(await listDrafts(prisma));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; body?: string; source?: string; ideaId?: string };
  try {
    // 带 ideaId 就是从点子池展开
    if (b.ideaId) {
      const { draftFromIdea } = await import('@/lib/draft/store');
      return ok(await draftFromIdea(prisma, b.ideaId));
    }
    return ok(await createDraft(prisma, { title: b.title, body: b.body, source: b.source }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
}
