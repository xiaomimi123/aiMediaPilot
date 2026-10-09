import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { adoptDaily, dismissDaily, rewriteDaily } from '@/lib/topics/daily';
import { createGenDeps } from '@/lib/topics/deps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; results?: unknown };
  try {
    if (b.action === 'adopt') return ok(await adoptDaily(prisma, params.id));
    if (b.action === 'rewrite') {
      const results = Array.isArray(b.results) ? b.results.map((x) => String(x ?? '')) : [];
      await rewriteDaily(prisma, await createGenDeps(prisma, new Date()), params.id, results);
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
