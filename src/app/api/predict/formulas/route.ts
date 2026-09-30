import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { ensureActiveFormula } from '@/lib/predict/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const active = await ensureActiveFormula(prisma);
  const p = await prisma.predictionFormula.findFirst({ where: { status: 'proposed' } });
  return ok({ active, proposed: p ? { version: p.version, params: p.params, reason: p.reason } : null });
}
