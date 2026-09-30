import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/lib/api';
import { getNotesConfig } from '@/lib/notes/config';
import { decideProposal, ProposalConflict, toProposalView } from '@/lib/notes/proposals';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await prisma.noteProposal.findUnique({ where: { id: params.id } });
  if (!p) return fail('找不到这个提议', 404);
  return ok(toProposalView(p));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'accept' && body.action !== 'reject') return fail('action 只能是 accept 或 reject', 400);
  try {
    const today = new Date().toLocaleDateString('sv-SE');
    return ok(await decideProposal(prisma, params.id, body.action, await getNotesConfig(prisma), today));
  } catch (e) {
    if (e instanceof ProposalConflict) return fail(e.message, 409);
    return fail(e instanceof Error ? e.message : String(e), 404);
  }
}
