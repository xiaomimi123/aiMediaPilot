import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/api';
import { addIdea, listIdeas } from '@/lib/topics/daily';

export const dynamic = 'force-dynamic';

export async function GET() {
  return ok(await listIdeas(prisma));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { text?: string };
  try {
    return ok(await addIdea(prisma, String(b.text ?? '')));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 400);
  }
}
