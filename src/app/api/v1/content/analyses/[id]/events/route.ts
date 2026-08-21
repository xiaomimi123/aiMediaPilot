import { prisma } from '@/lib/prisma';
import { sseResponse } from '@/lib/sse';
import { fail } from '@/lib/api';
import { getOrCreateDefaultUser } from '@/lib/user';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const user = await getOrCreateDefaultUser();
  const owner = await prisma.contentAnalysis.findUnique({ where: { id }, select: { userId: true } });
  if (!owner || owner.userId !== user.id) return fail('not found', 404);

  async function* gen() {
    const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
    const startedAt = Date.now();
    const MAX_MS = 15 * 60 * 1000;
    let lastSnapshot = '';

    while (Date.now() - startedAt < MAX_MS) {
      const a = await prisma.contentAnalysis.findUnique({
        where: { id },
        select: { status: true, progress: true, errorMessage: true, completedAt: true },
      });
      if (!a) {
        yield JSON.stringify({ error: 'not found' });
        return;
      }
      const snap = JSON.stringify({
        status: a.status,
        progress: a.progress,
        errorMessage: a.errorMessage,
      });
      if (snap !== lastSnapshot) {
        lastSnapshot = snap;
        yield snap;
      }
      if (terminal.has(a.status)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    yield JSON.stringify({ status: 'TIMEOUT' });
  }

  return sseResponse(gen());
}
