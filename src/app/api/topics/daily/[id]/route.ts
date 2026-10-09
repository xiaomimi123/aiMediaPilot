import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { adoptDaily, dismissDaily } from '@/lib/topics/daily';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (b.action === 'adopt') return ok(await adoptDaily(prisma, params.id));
    if (b.action === 'dismiss') {
      await dismissDaily(prisma, params.id);
      return ok({});
    }
    return fail('action 不对', 400);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}
