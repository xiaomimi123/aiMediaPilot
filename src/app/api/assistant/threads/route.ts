import { prisma } from '@/lib/prisma';
import { ok } from '@/lib/api';
import { listThreads, newThread } from '@/lib/assistant/threads';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return ok(await listThreads(prisma, new URL(req.url).searchParams.get('current') ?? undefined));
}

export async function POST() {
  return ok(await newThread(prisma));
}
