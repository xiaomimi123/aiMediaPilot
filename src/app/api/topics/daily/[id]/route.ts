import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { adoptDaily, answerDaily, dismissDaily } from '@/lib/topics/daily';
import { createGenDeps } from '@/lib/topics/deps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; answers?: unknown; results?: unknown };
  try {
    if (b.action === 'adopt') return ok(await adoptDaily(prisma, params.id));
    // rewrite / results: 旧页面(实测清单)的叫法, 同义
    if (b.action === 'answer' || b.action === 'rewrite') {
      const raw = b.answers ?? b.results;
      const answers = Array.isArray(raw) ? raw.map((x) => String(x ?? '')) : [];
      await answerDaily(prisma, await createGenDeps(prisma, new Date()), params.id, answers);
      return ok({});
    }
    if (b.action === 'dismiss') {
      await dismissDaily(prisma, params.id);
      return ok({});
    }
    return fail('action 不对', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}
