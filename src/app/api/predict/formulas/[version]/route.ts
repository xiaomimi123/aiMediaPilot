import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { decideFormula } from '@/lib/predict/calibrate';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { version: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'accept' && body.action !== 'reject') return fail('action 只能是 accept 或 reject', 400);
  try {
    await decideFormula(prisma, Number(params.version), body.action);
    return ok({ version: Number(params.version) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 409);
  }
}
