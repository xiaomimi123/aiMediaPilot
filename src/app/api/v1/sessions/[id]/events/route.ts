import { prisma } from '@/lib/prisma';
import { sseResponse } from '@/lib/sse';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  async function* gen() {
    let lastStatus: string | null = null;
    let lastQr: string | null = null;
    const terminal = new Set(['LOGGED_IN', 'EXPIRED', 'ERROR']);
    const startedAt = Date.now();
    const MAX_MS = 10 * 60 * 1000;

    while (Date.now() - startedAt < MAX_MS) {
      const s = await prisma.browserSession.findUnique({
        where: { id },
        select: { status: true, accountId: true, qrCode: true },
      });
      if (!s) {
        yield JSON.stringify({ error: 'session not found' });
        return;
      }
      // 把 qrCode 变化也作为推送触发条件之一
      if (s.status !== lastStatus || s.qrCode !== lastQr) {
        lastStatus = s.status;
        lastQr = s.qrCode;
        yield JSON.stringify({
          status: s.status,
          accountId: s.accountId,
          qrCode: s.qrCode,
        });
      }
      if (terminal.has(s.status)) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    yield JSON.stringify({ status: 'TIMEOUT' });
  }
  return sseResponse(gen());
}
